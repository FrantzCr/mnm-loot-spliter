import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COPPER_PER_GOLD, COPPER_PER_SILVER } from "@/lib/money";
import {
  EQUITABLE_CHAT_ANNOUNCE,
  GAME_CHAT_MAX,
  buildSettlementChatMessages,
  formatChatRoundLabel,
  formatCoinsChat,
  formatTransferChat,
  normalizeChatRoundStep,
  parseChatRoundInput,
  roundCopperForChat,
} from "@/lib/settlement-chat";

describe("settlement-chat", () => {
  it("normalizes round steps to a positive copper integer", () => {
    assert.equal(normalizeChatRoundStep(0), COPPER_PER_SILVER);
    assert.equal(normalizeChatRoundStep(-3), COPPER_PER_SILVER);
    assert.equal(normalizeChatRoundStep("10"), 10);
    assert.equal(normalizeChatRoundStep(5.9), 5);
  });

  it("rounds chat amounts to the chosen copper step", () => {
    assert.equal(roundCopperForChat(0), 0);
    assert.equal(roundCopperForChat(49), 0);
    assert.equal(roundCopperForChat(50), 100);
    assert.equal(roundCopperForChat(889), 900);
    assert.equal(roundCopperForChat(840), 800);

    assert.equal(roundCopperForChat(7, 5), 5);
    assert.equal(roundCopperForChat(8, 5), 10);
    assert.equal(roundCopperForChat(14, 10), 10);
    assert.equal(roundCopperForChat(16, 10), 20);
    assert.equal(roundCopperForChat(12_345, COPPER_PER_GOLD), 10_000);
  });

  it("formats coins after rounding; keeps copper when step is under 1s", () => {
    assert.equal(formatCoinsChat(0), "0s");
    assert.equal(formatCoinsChat(73), "1s");
    assert.equal(formatCoinsChat(7, 1), "7c");
    assert.equal(formatCoinsChat(12, 5), "10c");
    assert.equal(formatCoinsChat(100 + 73), "2s");
    assert.equal(formatCoinsChat(100 * 100 + 5), "1g");
  });

  it("formats a transfer on one ASCII line", () => {
    assert.equal(
      formatTransferChat({ from: "Polipopolin", to: "Sickrose", copper: 889 }),
      "Polipopolin>Sickrose 9s",
    );
    assert.equal(
      formatTransferChat({ from: "A", to: "B", copper: 47 }, 10),
      "A>B 50c",
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

  it("keeps small tips when rounding to copper", () => {
    const messages = buildSettlementChatMessages(
      [
        { from: "Alice", to: "Bob", copper: 40 },
        { from: "Carol", to: "Dave", copper: 10 },
      ],
      { roundCopper: 1 },
    );
    assert.equal(messages.length, 1);
    assert.ok(messages[0].includes("Alice>Bob 40c"));
    assert.ok(messages[0].includes("Carol>Dave 10c"));
  });

  it("announces an equitable split when every tip rounds under the step", () => {
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

  it("supports 5s and 1g steps", () => {
    assert.equal(roundCopperForChat(240, 5 * COPPER_PER_SILVER), 0);
    assert.equal(roundCopperForChat(260, 5 * COPPER_PER_SILVER), 500);
    assert.equal(formatCoinsChat(14_000, COPPER_PER_GOLD), "1g");
  });

  it("formats and parses free-form round steps", () => {
    assert.equal(formatChatRoundLabel(5), "5c");
    assert.equal(formatChatRoundLabel(COPPER_PER_SILVER), "1s");
    assert.equal(formatChatRoundLabel(5 * COPPER_PER_SILVER), "5s");
    assert.equal(formatChatRoundLabel(COPPER_PER_GOLD), "1g");
    assert.equal(parseChatRoundInput("5c"), 5);
    assert.equal(parseChatRoundInput("10c"), 10);
    assert.equal(parseChatRoundInput("5s"), 500);
    assert.equal(parseChatRoundInput("1g"), COPPER_PER_GOLD);
    assert.equal(parseChatRoundInput("1g 5s"), COPPER_PER_GOLD + 500);
    assert.equal(parseChatRoundInput("25"), 25);
    assert.equal(parseChatRoundInput(""), null);
    assert.equal(parseChatRoundInput("nope"), null);
  });
});
