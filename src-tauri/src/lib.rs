use std::fs::OpenOptions;
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

fn wait_for_register(port: &str, timeout: Duration) -> bool {
  let started = std::time::Instant::now();
  while started.elapsed() < timeout {
    if port_open(port) {
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
    use std::io::Write;
    let _ = writeln!(file, "{note}");
  }
}

fn start_sidecar(app: &AppHandle, state: &SidecarState) -> Result<(), String> {
  if port_open(PACKAGED_REGISTER_PORT) {
    return Ok(());
  }

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(SidecarState(Mutex::new(None)))
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
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
