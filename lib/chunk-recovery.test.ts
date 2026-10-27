import assert from "node:assert/strict";
import test from "node:test";

import { isChunkLoadError } from "./chunk-recovery";

test("isChunkLoadError matches webpack/turbopack chunk failures", () => {
  const named = new Error("boom");
  named.name = "ChunkLoadError";
  assert.equal(isChunkLoadError(named), true);
  assert.equal(isChunkLoadError(new Error("Loading chunk 123 failed.")), true);
  assert.equal(isChunkLoadError(new Error("Loading CSS chunk app-layout failed")), true);
  assert.equal(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: /x.js")), true);
});

test("isChunkLoadError ignores ordinary errors and non-objects", () => {
  assert.equal(isChunkLoadError(new Error("Cannot read properties of undefined")), false);
  assert.equal(isChunkLoadError("ChunkLoadError"), false);
  assert.equal(isChunkLoadError(null), false);
});
