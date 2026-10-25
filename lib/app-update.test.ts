import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareSemver, evaluateUpdate, pickSetupAsset, type GithubRelease } from "./app-update";

describe("compareSemver", () => {
  it("orders patch/minor/major", () => {
    assert.equal(compareSemver("0.1.2", "0.1.1") > 0, true);
    assert.equal(compareSemver("0.2.0", "0.1.9") > 0, true);
    assert.equal(compareSemver("1.0.0", "0.9.9") > 0, true);
    assert.equal(compareSemver("0.1.1", "0.1.1"), 0);
  });

  it("ignores leading v", () => {
    assert.equal(compareSemver("v0.1.2", "0.1.1") > 0, true);
  });
});

describe("pickSetupAsset", () => {
  it("prefers setup/x64 exe", () => {
    const asset = pickSetupAsset([
      { name: "notes.txt", browser_download_url: "https://example/notes", size: 10 },
      {
        name: "MnM_Loot_Splitter_0.1.2_x64-setup.exe",
        browser_download_url: "https://example/setup",
        size: 30_000_000,
      },
    ]);
    assert.equal(asset?.name, "MnM_Loot_Splitter_0.1.2_x64-setup.exe");
  });
});

describe("evaluateUpdate", () => {
  const release: GithubRelease = {
    tag_name: "v0.1.2",
    name: "MnM Loot Splitter 0.1.2",
    body: "Fixes",
    html_url: "https://github.com/FrantzCr/mnm-loot-spliter/releases/tag/v0.1.2",
    assets: [
      {
        name: "MnM_Loot_Splitter_0.1.2_x64-setup.exe",
        browser_download_url: "https://example/setup.exe",
        size: 30_000_000,
      },
    ],
  };

  it("reports available when newer", () => {
    const result = evaluateUpdate("0.1.1", release);
    assert.equal(result.status, "available");
    if (result.status === "available") {
      assert.equal(result.latest, "0.1.2");
      assert.equal(result.asset.name, "MnM_Loot_Splitter_0.1.2_x64-setup.exe");
    }
  });

  it("reports up to date when same or older tag", () => {
    assert.equal(evaluateUpdate("0.1.2", release).status, "upToDate");
    assert.equal(evaluateUpdate("0.2.0", release).status, "upToDate");
  });
});
