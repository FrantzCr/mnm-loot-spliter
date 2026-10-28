"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  CHAT_ROUND_PRESETS,
  chatRoundToken,
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
      "min-w-9 rounded-sm border px-2 py-1 text-center font-mono transition-colors",
      active
        ? "border-[#6e5338] bg-[#6e5338] text-[#f7f3ea]"
        : "border-[#6e5338]/35 bg-card text-muted-foreground hover:bg-[#efe6d6] hover:text-foreground",
    );

  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-xs", className)}>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex flex-wrap gap-1"
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

/**
 * The announce preview with its rounding phrase ("rounded to 10c" / "exact") turned into a small
 * clickable chip that opens the rounding picker in place. The copied text stays plain.
 */
export function ChatAnnounceWithRound({
  message,
  value,
  onChange,
  label,
  customLabel,
  customPlaceholder,
  customApply,
}: {
  message: string;
  value: number;
  onChange: (copper: number) => void;
  label: string;
  customLabel: string;
  customPlaceholder: string;
  customApply: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const token = chatRoundToken(value);
  const at = message.indexOf(token);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const chip = (
    <span ref={wrap} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          // Sits on the black chat preview: inherit the channel colour.
          "inline-flex items-center gap-0.5 rounded-sm border border-dashed border-current/60 px-1 leading-snug transition-colors hover:border-solid hover:bg-white/10",
          open && "border-solid bg-white/10",
        )}
      >
        {token}
        <ChevronDown className="size-3 opacity-70" aria-hidden />
      </button>
      {open ? (
        <span
          role="dialog"
          aria-label={label}
          className="absolute top-full left-0 z-30 mt-1 grid w-[17rem] gap-2 rounded-sm border border-[#6e5338]/55 bg-card p-2.5 font-body text-foreground shadow-md"
        >
          <span className="text-xs text-muted-foreground">{label}</span>
          <ChatRoundPicker
            value={value}
            onChange={(copper) => {
              onChange(copper);
              setOpen(false);
            }}
            label={label}
            customLabel={customLabel}
            customPlaceholder={customPlaceholder}
            customApply={customApply}
          />
        </span>
      ) : null}
    </span>
  );

  // The "everyone is even" announce carries no rounding phrase: show the chip after it.
  if (at < 0) {
    return (
      <>
        {message} <span className="opacity-60">·</span> {chip}
      </>
    );
  }
  return (
    <>
      {message.slice(0, at)}
      {chip}
      {message.slice(at + token.length)}
    </>
  );
}
