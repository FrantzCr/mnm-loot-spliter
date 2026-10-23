import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createGenerationGate } from "./generation-gate";

describe("createGenerationGate", () => {
  it("rejects a poll that started before leave bumped the generation", () => {
    const gate = createGenerationGate();
    const pollToken = gate.snapshot();

    // Client leave/settle starts — same moment as setSaving(true).
    gate.bump();
    const afterLeave = { leftAt: "2026-10-22T12:00:00.000Z" as string | null };
    const stalePoll = { leftAt: null as string | null };

    let view = afterLeave;
    if (gate.isCurrent(pollToken)) view = stalePoll;

    assert.equal(view.leftAt, "2026-10-22T12:00:00.000Z");
    assert.equal(gate.isCurrent(pollToken), false);
  });

  it("applies a poll that started after the latest mutation", () => {
    const gate = createGenerationGate();
    gate.bump();
    const pollToken = gate.snapshot();
    assert.equal(gate.isCurrent(pollToken), true);
  });
});
