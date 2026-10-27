"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import {
  CHAT_ROUND_PRESETS,
  formatChatRoundLabel,
  parseChatRoundInput,
} from "@/lib/settlement-chat";

/**
 * Chat rounding picker: preset chips (1c … 1g) plus "Other" for any step
 * (`25c`, `2s`, `1g 5s`, plain copper). Shared by the Share card and Options.
 */
export function ChatRoundPicker({
  value,
  onChange,
  label,
  customLabel,
  customPlaceholder,
  customApply,
  className,
}: {
  value: number;
  onChange: (copper: number) => void;
  label: string;
  customLabel: string;
  customPlaceholder: string;
  customApply: string;
  className?: string;
}) {
  const isPreset = CHAT_ROUND_PRESETS.some((preset) => preset.copper === value);
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const parsed = parseChatRoundInput(draft);
  const showCustom = customOpen || !isPreset;

  function apply() {
    if (parsed == null) return;
    onChange(parsed);
    setDraft("");
    setCustomOpen(!CHAT_ROUND_PRESETS.some((preset) => preset.copper === parsed));
  }

  const chip = (active: boolean) =>
    cn(
      "px-2 py-1 font-mono transition-colors border-r border-[#6e5338]/40 last:border-r-0",
      active ? "bg-[#6e5338] text-[#f7f3ea]" : "text-muted-foreground hover:bg-[#efe6d6]",
    );

  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-xs", className)}>
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex overflow-hidden rounded-sm border border-[#6e5338]/55 bg-card"
      >
        {CHAT_ROUND_PRESETS.map((preset) => (
          <button
            key={preset.copper}
            type="button"
            role="radio"
            aria-checked={value === preset.copper && !customOpen}
            onClick={() => {
              setCustomOpen(false);
              setDraft("");
              onChange(preset.copper);
            }}
            className={chip(value === preset.copper && !customOpen)}
          >
            {preset.labelKey}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={showCustom}
          onClick={() => setCustomOpen(true)}
          className={chip(showCustom)}
        >
          {!isPreset ? formatChatRoundLabel(value) : customLabel}
        </button>
      </div>
      {showCustom ? (
        <form
          className="inline-flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={customPlaceholder}
            aria-label={customLabel}
            aria-invalid={draft.trim() !== "" && parsed == null}
            className="h-7 w-32 rounded-sm border border-[#6e5338]/55 bg-card px-2 font-mono text-xs aria-invalid:border-destructive"
          />
          <button
            type="submit"
            disabled={parsed == null}
            className="h-7 rounded-sm border border-[#6e5338]/55 bg-card px-2 hover:bg-[#efe6d6] disabled:opacity-50"
          >
            {customApply}
          </button>
        </form>
      ) : null}
    </div>
  );
}
