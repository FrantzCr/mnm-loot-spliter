import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EQUITABLE_CHAT_ANNOUNCE,
  GAME_CHAT_MAX,
  buildSettlementChatMessages,
  formatCoinsChat,
  formatTransferChat,
  roundCopperForChat,
} from "@/lib/settlement-chat";

describe("settlement-chat", () => {
  it("rounds chat amounts to the nearest silver", () => {
    assert.equal(roundCopperForChat(0), 0);
    assert.equal(roundCopperForChat(49), 0);
    assert.equal(roundCopperForChat(50), 100);
    assert.equal(roundCopperForChat(889), 900);
    assert.equal(roundCopperForChat(840), 800);
  });

  it("formats coins with short suffixes after silver rounding", () => {
    assert.equal(formatCoinsChat(0), "0s");
    assert.equal(formatCoinsChat(73), "1s");
    assert.equal(formatCoinsChat(100 + 73), "2s");
    assert.equal(formatCoinsChat(100 * 100 + 5), "1g");
  });

  it("formats a transfer on one ASCII line", () => {
    assert.equal(
      formatTransferChat({ from: "Polipopolin", to: "Sickrose", copper: 889 }),
      "Polipopolin>Sickrose 9s",
    );
  });

  it("keeps a short party in one message under the chat cap", () => {
    const messages = buildSettlementChatMessages([
      { from: "Alice", to: "Bob", copper: 500 },
      { from: "Carol", to: "Dave", copper: 250 },
      { from: "Eve", to: "Frank", copper: 40 }, // rounds to 0s — dropped from chat
    ]);
    assert.equal(messages.length, 1);
    assert.ok(
      messages[0].startsWith(
        "MnM Loot Splitter — equitable loot split (vendor prices), tip whom: ",
      ),
    );
    assert.ok(messages[0].includes("Alice>Bob 5s"));
    assert.ok(messages[0].includes("Carol>Dave 3s"));
    assert.ok(!messages[0].includes("Eve>Frank"));
    assert.ok(messages[0].length <= GAME_CHAT_MAX);
    assert.ok(!messages[0].includes("\n"));
  });

  it("announces an equitable split when every tip rounds under a silver", () => {
    const messages = buildSettlementChatMessages([
      { from: "Alice", to: "Bob", copper: 40 },
      { from: "Carol", to: "Dave", copper: 10 },
    ]);
    assert.deepEqual(messages, [EQUITABLE_CHAT_ANNOUNCE]);
    assert.ok(EQUITABLE_CHAT_ANNOUNCE.startsWith("MnM Loot Splitter"));
  });

  it("splits long lists into numbered single-line parts", () => {
    const transfers = Array.from({ length: 20 }, (_, i) => ({
      from: `LongNamePayer${i}`,
      to: `LongNamePayee${i}`,
      copper: 12_345 + i,
    }));
    const messages = buildSettlementChatMessages(transfers, 160);
    assert.ok(messages.length > 1);
    for (const [index, message] of messages.entries()) {
      assert.ok(message.length <= 160, message);
      assert.ok(!message.includes("\n"));
      assert.ok(
        message.startsWith(
          `MnM Loot Splitter — equitable split (vendor prices) (${index + 1}/${messages.length}):`,
        ),
      );
    }
  });
});
