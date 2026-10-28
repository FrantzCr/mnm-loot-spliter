use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager};

/// Dev (`npm run dev` / `tauri:dev`) stays on 4721.
/// The packaged exe uses 14721 so it never attaches to a leftover Next dev server
/// (that would show the Next.js “N” badge and feel like a flicker/dev build).
const DEV_REGISTER_URL: &str = "http://127.0.0.1:4721";
const PACKAGED_REGISTER_URL: &str = "http://127.0.0.1:14721";
const PACKAGED_REGISTER_PORT: &str = "14721";

struct SidecarState(Mutex<Option<Child>>);

fn port_open(port: &str) -> bool {
  let addr = format!("127.0.0.1:{port}");
  TcpStream::connect_timeout(
    &addr.parse().expect("static address"),
    Duration::from_millis(200),
  )
  .is_ok()
}

/// HTTP GET / — TCP alone can succeed before Next is ready to serve pages.
fn register_http_ok(port: &str) -> bool {
  let addr = format!("127.0.0.1:{port}");
  let Ok(mut stream) = TcpStream::connect_timeout(
    &addr.parse().expect("static address"),
    Duration::from_millis(400),
  ) else {
    return false;
  };
  let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
  let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
  let request = format!("GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
  if stream.write_all(request.as_bytes()).is_err() {
    return false;
  }
  let mut buf = [0_u8; 64];
  let Ok(n) = stream.read(&mut buf) else {
    return false;
  };
  let head = String::from_utf8_lossy(&buf[..n]);
  head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200")
}

fn wait_for_register(port: &str, timeout: Duration) -> bool {
  let started = std::time::Instant::now();
  while started.elapsed() < timeout {
    if register_http_ok(port) {
      return true;
    }
    thread::sleep(Duration::from_millis(250));
  }
  false
}

fn looks_like_register_dir(dir: &Path) -> bool {
  dir.join("server.js").is_file() && dir.join("node.exe").is_file()
}

/// Packaged layout from `desktop:prepare` + `bundle.resources: ["resources/register/**/*"]`.
///
/// On Windows, `resource_dir()` is the folder that contains the exe, so the runtime lives at
/// `$RESOURCE/resources/register`. Older layouts / other platforms may use `$RESOURCE/register`.
fn packaged_register_dir(app: &AppHandle) -> Option<PathBuf> {
  let resource = app.path().resource_dir().ok()?;
  for candidate in [
    resource.join("resources").join("register"),
    resource.join("register"),
  ] {
    if looks_like_register_dir(&candidate) {
      return Some(candidate);
    }
  }
  None
}

fn sidecar_log_paths(app: &AppHandle) -> Option<(PathBuf, PathBuf)> {
  let dir = app.path().app_log_dir().ok()?;
  std::fs::create_dir_all(&dir).ok()?;
  Some((dir.join("sidecar-stdout.log"), dir.join("sidecar-stderr.log")))
}

fn append_sidecar_note(path: &Path, note: &str) {
  if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
    let _ = writeln!(file, "{note}");
  }
}

fn packaged_build_id(register_dir: &Path) -> Option<String> {
  let raw = fs::read_to_string(register_dir.join(".next").join("BUILD_ID")).ok()?;
  let id = raw.trim();
  if id.is_empty() {
    None
  } else {
    Some(id.to_string())
  }
}

/// Next puts the build id in RSC payloads as `"b":"<id>"`. A stale Node left on
/// 14721 after an upgrade still answers HTTP 200 but serves chunk URLs from the
/// previous build — soft-nav to /group then whitescreens.
fn live_register_matches_build(port: &str, expected_build_id: &str) -> bool {
  let addr = format!("127.0.0.1:{port}");
  let Ok(mut stream) = TcpStream::connect_timeout(
    &addr.parse().expect("static address"),
    Duration::from_millis(400),
  ) else {
    return false;
  };
  let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
  let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
  let request = format!(
    "GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nRSC: 1\r\nConnection: close\r\n\r\n"
  );
  if stream.write_all(request.as_bytes()).is_err() {
    return false;
  }
  let mut body = Vec::new();
  let _ = stream.read_to_end(&mut body);
  let text = String::from_utf8_lossy(&body);
  if !(text.contains("HTTP/1.1 200") || text.contains("HTTP/1.0 200")) {
    return false;
  }
  text.contains(&format!("\"b\":\"{expected_build_id}\""))
}

/// Kill orphaned Node listeners on the packaged register port (Windows).
/// Safe for this app: only targets `node` processes bound to 14721.
#[cfg(windows)]
fn kill_stale_register_listeners(port: &str) {
  use std::os::windows::process::CommandExt;
  const CREATE_NO_WINDOW: u32 = 0x0800_0000;
  let script = format!(
    "Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object {{ $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; if ($proc -and $proc.ProcessName -eq 'node') {{ Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }} }}"
  );
  let _ = Command::new("powershell.exe")
    .args(["-NoProfile", "-Command", &script])
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .creation_flags(CREATE_NO_WINDOW)
    .status();
  thread::sleep(Duration::from_millis(400));
}

#[cfg(not(windows))]
fn kill_stale_register_listeners(_port: &str) {}

fn start_sidecar(app: &AppHandle, state: &SidecarState) -> Result<(), String> {
  let register_dir = packaged_register_dir(app).ok_or_else(|| {
    let hint = app
      .path()
      .resource_dir()
      .map(|p| p.display().to_string())
      .unwrap_or_else(|_| "(resource_dir unavailable)".into());
    format!(
      "Packaged register runtime not found under {hint} (expected resources/register). Rebuild with npm run desktop:prepare."
    )
  })?;
  let expected_build = packaged_build_id(&register_dir);

  if register_http_ok(PACKAGED_REGISTER_PORT) {
    if let Some(ref build) = expected_build {
      if live_register_matches_build(PACKAGED_REGISTER_PORT, build) {
        return Ok(());
      }
      log::warn!(
        "Register on :{PACKAGED_REGISTER_PORT} is stale (build mismatch) — replacing sidecar"
      );
    } else {
      // No BUILD_ID on disk: keep previous reuse behaviour.
      return Ok(());
    }
    kill_stale_register_listeners(PACKAGED_REGISTER_PORT);
  } else if port_open(PACKAGED_REGISTER_PORT) {
    // Port taken but not serving yet — wait briefly, then verify build or replace.
    if wait_for_register(PACKAGED_REGISTER_PORT, Duration::from_secs(8)) {
      if expected_build
        .as_ref()
        .is_none_or(|build| live_register_matches_build(PACKAGED_REGISTER_PORT, build))
      {
        return Ok(());
      }
      log::warn!(
        "Register on :{PACKAGED_REGISTER_PORT} came up with a stale build — replacing sidecar"
      );
      kill_stale_register_listeners(PACKAGED_REGISTER_PORT);
    } else {
      kill_stale_register_listeners(PACKAGED_REGISTER_PORT);
      if port_open(PACKAGED_REGISTER_PORT) {
        return Err(format!(
          "Port {PACKAGED_REGISTER_PORT} is in use but the register did not respond. Close other MnM Loot Splitter instances and try again."
        ));
      }
    }
  }

  let node = register_dir.join("node.exe");

  let mut command = Command::new(&node);
  // Relative script path: absolute paths under "MnM Loot Splitter" break Node argv quoting.
  command
    .arg("server.js")
    .current_dir(&register_dir)
    .env("PORT", PACKAGED_REGISTER_PORT)
    .env("HOSTNAME", "127.0.0.1")
    .stdin(Stdio::null());

  if let Some((stdout_path, stderr_path)) = sidecar_log_paths(app) {
    append_sidecar_note(
      &stderr_path,
      &format!(
        "--- sidecar start {} dir={} ---",
        chrono_like_now(),
        register_dir.display()
      ),
    );
    match OpenOptions::new()
      .create(true)
      .append(true)
      .open(&stdout_path)
    {
      Ok(file) => {
        command.stdout(Stdio::from(file));
      }
      Err(_) => {
        command.stdout(Stdio::null());
      }
    }
    match OpenOptions::new()
      .create(true)
      .append(true)
      .open(&stderr_path)
    {
      Ok(file) => {
        command.stderr(Stdio::from(file));
      }
      Err(_) => {
        command.stderr(Stdio::null());
      }
    }
  } else {
    command.stdout(Stdio::null()).stderr(Stdio::null());
  }

  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
  }

  let child = command
    .spawn()
    .map_err(|error| format!("Could not start the local register: {error}"))?;
  *state.0.lock().map_err(|_| "sidecar lock".to_string())? = Some(child);
  if !wait_for_register(PACKAGED_REGISTER_PORT, Duration::from_secs(90)) {
    return Err(format!(
      "The local register did not answer on port {PACKAGED_REGISTER_PORT}."
    ));
  }
  Ok(())
}

fn chrono_like_now() -> String {
  // Avoid a chrono dependency; local timestamp is enough for log separators.
  format!("{:?}", std::time::SystemTime::now())
}

fn stop_sidecar(state: &SidecarState) {
  if let Ok(mut guard) = state.0.lock() {
    if let Some(mut child) = guard.take() {
      let _ = child.kill();
      let _ = child.wait();
    }
  }
}

fn show_startup_error(app: &AppHandle, error: &str) {
  // Keep the bundled splash document and rewrite it — WebView2 often blocks data: navigation.
  let js_error = serde_json::to_string(error).unwrap_or_else(|_| "\"startup failed\"".into());
  let script = format!(
    concat!(
      "(function(){{",
      "var msg={msg};",
      "document.title='MnM Loot Splitter';",
      "var main=document.querySelector('main')||document.body;",
      "main.innerHTML='';",
      "<h1>MnM Loot Splitter</h1>",
      "<p>Could not start the local register.</p>",
      "<p><code></code></p>",
      "<p>Close the app and launch it again. If the problem continues, reinstall from the setup.</p>';",
      "var code=main.querySelector('code');",
      "if(code) code.textContent=msg;",
      "}})();"
    ),
    msg = js_error
  );
  if let Some(main) = app.get_webview_window("main") {
    let _ = main.eval(&script);
    let _ = main.show();
  }
}

/// Download a GitHub release setup.exe and launch NSIS in `/UPDATE` mode, then exit.
/// Async + blocking pool: a 30 MB download must not freeze the window.
#[tauri::command]
async fn install_update(app: AppHandle, url: String, file_name: String) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || install_update_blocking(&app, &url, &file_name))
    .await
    .map_err(|error| format!("Update task failed: {error}"))?
}

fn install_update_blocking(app: &AppHandle, url: &str, file_name: &str) -> Result<(), String> {
  if !(url.starts_with("https://github.com/")
    || url.starts_with("https://objects.githubusercontent.com/")
    || url.starts_with("https://release-assets.githubusercontent.com/"))
  {
    return Err("Update URL must be a GitHub release asset.".into());
  }
  let safe_name = Path::new(file_name)
    .file_name()
    .and_then(|n| n.to_str())
    .filter(|n| n.ends_with(".exe") && !n.contains(".."))
    .ok_or_else(|| "Invalid installer file name.".to_string())?;

  let temp_dir = std::env::temp_dir().join("mnm-loot-spliter-updates");
  fs::create_dir_all(&temp_dir).map_err(|e| format!("Could not create temp dir: {e}"))?;
  let dest = temp_dir.join(safe_name);

  download_https_file(url, &dest)?;

  // Stop the bundled Node first: NSIS cannot overwrite resources/register/node.exe while it runs.
  // A register reused from an earlier launch is not our child, so also clear the port.
  stop_sidecar(&app.state::<SidecarState>());
  kill_stale_register_listeners(PACKAGED_REGISTER_PORT);

  let mut command = Command::new(&dest);
  // Tauri NSIS: update mode skips some first-run prompts and replaces in place.
  command.arg("/UPDATE");
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    command.creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS);
  }
  command
    .spawn()
    .map_err(|e| format!("Could not launch the installer: {e}"))?;

  // Quit so NSIS can overwrite locked files (exe + resources).
  app.exit(0);
  Ok(())
}

fn download_https_file(url: &str, dest: &Path) -> Result<(), String> {
  // Prefer PowerShell on Windows so we stay dependency-light and follow GitHub redirects.
  #[cfg(windows)]
  {
    let dest_str = dest.to_string_lossy().replace('\'', "''");
    let url_str = url.replace('\'', "''");
    // Windows PowerShell 5.1: force TLS 1.2 (GitHub) and hide the progress bar, which otherwise
    // slows Invoke-WebRequest to a crawl on large files.
    let script = format!(
      "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '{url_str}' -OutFile '{dest_str}' -UseBasicParsing"
    );
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let status = Command::new("powershell.exe")
      .args(["-NoProfile", "-NonInteractive", "-Command", &script])
      .stdin(Stdio::null())
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .creation_flags(CREATE_NO_WINDOW)
      .status()
      .map_err(|e| format!("Download failed to start: {e}"))?;
    if !status.success() {
      return Err(format!("Download failed (exit {status})."));
    }
    let meta = fs::metadata(dest).map_err(|e| format!("Downloaded file missing: {e}"))?;
    if meta.len() < 1_000_000 {
      let _ = fs::remove_file(dest);
      return Err("Downloaded installer looks too small — check the release asset.".into());
    }
    return Ok(());
  }
  #[cfg(not(windows))]
  {
    let _ = (url, dest);
    Err("Updates are only supported on Windows.".into())
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // single-instance must register first so a second launch exits before spawning another sidecar.
  let mut builder = tauri::Builder::default().plugin(tauri_plugin_single_instance::init(
    |app, _args, _cwd| {
      if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.set_focus();
        let _ = main.show();
      }
    },
  ));

  builder = builder
    .manage(SidecarState(Mutex::new(None)))
    .invoke_handler(tauri::generate_handler![install_update])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Dev: Next is started by beforeDevCommand on 4721.
      // Release: bundled Node + standalone server on 14721 (never hitch a ride on npm run dev).
      if cfg!(debug_assertions) {
        if let Some(main) = app.get_webview_window("main") {
          if let Ok(url) = DEV_REGISTER_URL.parse() {
            if let Err(error) = main.navigate(url) {
              log::error!("navigate main: {error}");
            }
          }
          let _ = main.show();
        }
      } else {
        let handle = app.handle().clone();
        let state = app.state::<SidecarState>();
        match start_sidecar(&handle, &state) {
          Ok(()) => {
            if let Some(main) = app.get_webview_window("main") {
              if let Ok(url) = PACKAGED_REGISTER_URL.parse() {
                if let Err(error) = main.navigate(url) {
                  log::error!("navigate main: {error}");
                }
              }
              let _ = main.show();
            }
          }
          Err(error) => {
            log::error!("{error}");
            show_startup_error(&handle, &error);
          }
        }
      }
      Ok(())
    })
    .on_window_event(|window, event| {
      if window.label() != "main" {
        return;
      }
      if let tauri::WindowEvent::Destroyed = event {
        let state = window.app_handle().state::<SidecarState>();
        stop_sidecar(&state);
      }
    });

  builder
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      // app.exit() skips window Destroyed events: stop the sidecar on every exit path.
      if let tauri::RunEvent::Exit = event {
        stop_sidecar(&app.state::<SidecarState>());
      }
    });
}
