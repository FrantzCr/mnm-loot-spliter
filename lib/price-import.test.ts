import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { openDatabase, upsertPrice } from "./db";
import {
  applyPriceImport,
  parsePriceImportBytes,
  previewPriceImport,
} from "./price-import";

describe("price import", () => {
  it("previews conflicts and can keep local or replace", () => {
    const file = path.join(os.tmpdir(), `registre-import-${Date.now()}-${Math.random()}.sqlite`);
    try {
      const db = openDatabase(file);
      upsertPrice(db, "Objet local", 100);
      upsertPrice(db, "Objet partagé", 50);

      const incoming = [
        { itemName: "Objet partagé", unitCopper: 75 },
        { itemName: "Objet nouveau", unitCopper: 20 },
        { itemName: "Objet local", unitCopper: 100 },
      ];
      const preview = previewPriceImport(incoming, db);
      assert.equal(preview.added, 1);
      assert.equal(preview.unchanged, 1);
      assert.equal(preview.conflicts.length, 1);
      assert.equal(preview.conflicts[0]?.itemName, "Objet partagé");

      const kept = applyPriceImport(incoming, "keepLocal", db);
      assert.equal(kept.added, 1);
      assert.equal(kept.replaced, 0);
      assert.equal(kept.skippedConflicts, 1);
      const shared = db.prepare("SELECT unit_copper FROM price_book WHERE item_key = ?").get("objet partagé") as {
        unit_copper: number;
      };
      assert.equal(Number(shared.unit_copper), 50);

      const replaced = applyPriceImport(incoming, "replaceConflicts", db);
      assert.equal(replaced.added, 0);
      assert.equal(replaced.replaced, 1);
      const after = db.prepare("SELECT unit_copper FROM price_book WHERE item_key = ?").get("objet partagé") as {
        unit_copper: number;
      };
      assert.equal(Number(after.unit_copper), 75);
      db.close();
    } finally {
      fs.rmSync(file, { force: true });
      for (const suffix of ["-wal", "-shm"]) {
        fs.rmSync(`${file}${suffix}`, { force: true });
      }
    }
  });

  it("reads prices from a foreign sqlite price_book", () => {
    const file = path.join(os.tmpdir(), `registre-foreign-${Date.now()}-${Math.random()}.sqlite`);
    try {
      const foreign = new DatabaseSync(file);
      foreign.exec(`
        CREATE TABLE price_book (
          id TEXT PRIMARY KEY,
          item_key TEXT NOT NULL UNIQUE,
          item_name TEXT NOT NULL,
          unit_copper INTEGER NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      foreign
        .prepare(
          "INSERT INTO price_book (id, item_key, item_name, unit_copper, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("1", "soie", "Spider Silk", 33, new Date().toISOString());
      foreign.close();
      const bytes = fs.readFileSync(file);
      const entries = parsePriceImportBytes(bytes, "copie.sqlite");
      assert.equal(entries.length, 1);
      assert.equal(entries[0]?.itemName, "Spider Silk");
      assert.equal(entries[0]?.unitCopper, 33);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});
