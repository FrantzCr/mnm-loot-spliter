"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { LOCALES, useI18n } from "@/components/locale";
import { cn } from "cn";
import type { Locale } from "@/lib/locale";

const NAMES: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
};

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a4503]";

export function LanguageMenu() {
  const { locale, setLocale, copy } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const flagId = useId();

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function selectLocale(code: Locale) {
    setLocale(code);
    close(true);
  }

  function focusOption(index: number) {
    const clamped = Math.max(0, Math.min(index, LOCALES.length - 1));
    optionRefs.current[clamped]?.focus();
  }

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const index = Math.max(0, LOCALES.indexOf(locale));
    // Defer so the list is mounted before focusing.
    const frame = window.requestAnimationFrame(() => focusOption(index));
    return () => window.cancelAnimationFrame(frame);
  }, [open, locale]);

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const active = document.activeElement;
    const index = optionRefs.current.findIndex((node) => node === active);
    if (index < 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption((index + 1) % LOCALES.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption((index - 1 + LOCALES.length) % LOCALES.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusOption(LOCALES.length - 1);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={copy.shell.language}
        title={copy.shell.language}
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-md border border-border/80 bg-[#efe6d6]/70 px-2 font-body text-[0.6875rem] tracking-[0.08em] uppercase text-foreground shadow-[inset_0_1px_0_rgba(255,250,240,0.65)] transition-[color,background-color,border-color] duration-150",
          focusRing,
          "hover:border-[#c4a574]/90 hover:bg-[#f7f3ea] hover:text-[#7a4503]",
          open && "border-[#c4a574]/90 bg-[#f7f3ea] text-[#7a4503]",
        )}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onTriggerKeyDown}
      >
        <span lang={locale}>{locale}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn("size-3 text-muted-foreground transition-transform duration-150", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div
          id={menuId}
          role="listbox"
          aria-label={copy.shell.language}
          className="absolute top-full right-0 z-50 mt-1.5 min-w-[11rem] overflow-hidden rounded-md border border-border/80 bg-[#f7f3ea] py-1 shadow-[0_10px_28px_rgba(55,32,10,0.14)]"
          onKeyDown={onListKeyDown}
        >
          {LOCALES.map((code, index) => {
            const active = locale === code;
            return (
              <button
                key={code}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                role="option"
                lang={code}
                aria-selected={active}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-3 py-2 text-left font-body text-sm transition-colors duration-100",
                  focusRing,
                  "focus-visible:outline-offset-[-2px]",
                  active
                    ? "bg-foreground text-background"
                    : "text-foreground hover:bg-[#efe6d6]/90 hover:text-[#7a4503]",
                )}
                onClick={() => selectLocale(code)}
              >
                <span className="inline-flex items-center gap-2.5">
                  <Flag locale={code} clipId={`${flagId}-${code}`} />
                  <span>{NAMES[code]}</span>
                </span>
                <span
                  className={cn(
                    "text-[0.6875rem] tracking-[0.1em] uppercase",
                    active ? "text-background/70" : "text-muted-foreground",
                  )}
                >
                  {code}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function Flag({ locale, clipId }: { locale: Locale; clipId: string }) {
  return (
    <span
      className="inline-flex h-3.5 w-5 shrink-0 overflow-hidden rounded-[2px] shadow-[inset_0_0_0_1px_rgba(55,32,10,0.28)]"
      aria-hidden="true"
    >
      {locale === "fr" ? <France /> : locale === "es" ? <Spain /> : <Britain clipId={clipId} />}
    </span>
  );
}

function Britain({ clipId }: { clipId: string }) {
  return (
    <svg viewBox="0 0 60 30" className="h-full w-full">
      <clipPath id={clipId}>
        <rect width="60" height="30" />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <rect width="60" height="30" fill="#012169" />
        <path d="M0 0 L60 30 M60 0 L0 30" stroke="#fff" strokeWidth="6" />
        <path d="M0 0 L60 30 M60 0 L0 30" stroke="#C8102E" strokeWidth="2.5" />
        <path d="M30 0 V30 M0 15 H60" stroke="#fff" strokeWidth="10" />
        <path d="M30 0 V30 M0 15 H60" stroke="#C8102E" strokeWidth="6" />
      </g>
    </svg>
  );
}

function France() {
  return (
    <svg viewBox="0 0 18 12" className="h-full w-full">
      <rect width="6" height="12" fill="#0055A4" />
      <rect x="6" width="6" height="12" fill="#fff" />
      <rect x="12" width="6" height="12" fill="#EF4135" />
    </svg>
  );
}

function Spain() {
  return (
    <svg viewBox="0 0 18 12" className="h-full w-full">
      <rect width="18" height="12" fill="#AA151B" />
      <rect y="3" width="18" height="6" fill="#F1BF00" />
    </svg>
  );
}
