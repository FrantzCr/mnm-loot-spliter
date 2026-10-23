"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { Input } from "@/components/ui/input";
import { titleCaseName } from "@/lib/format";
import { cn } from "cn";

export type NameSuggestion = {
  name: string;
  personId: string | null;
};

const MAX_SHOWN = 8;

type GuestNameInputProps = {
  id: string;
  value: string;
  onChange: (name: string, personId: string | null) => void;
  /** When Enter selects a highlighted suggestion, called with that name so the parent can submit immediately. */
  onEnterCommit?: (name: string, personId: string | null) => void;
  suggestions: NameSuggestion[];
  placeholder?: string;
  disabled?: boolean;
  listLabel: string;
};

export function GuestNameInput({
  id,
  value,
  onChange,
  onEnterCommit,
  suggestions,
  placeholder,
  disabled,
  listLabel,
}: GuestNameInputProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const query = value.trim().toLowerCase();
  const filtered =
    query.length === 0
      ? []
      : suggestions.filter((entry) => entry.name.toLowerCase().includes(query)).slice(0, MAX_SHOWN);
  const showList = open && filtered.length > 0;

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function pick(suggestion: NameSuggestion) {
    onChange(titleCaseName(suggestion.name), suggestion.personId);
    setOpen(false);
    setActiveIndex(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (filtered.length === 0) return;

    if (!showList && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(0);
      return;
    }
    if (!showList) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % filtered.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? filtered.length - 1 : current - 1));
      return;
    }
    if (event.key === "Enter" && activeIndex >= 0) {
      const suggestion = filtered[activeIndex];
      if (!suggestion) return;
      event.preventDefault();
      const name = titleCaseName(suggestion.name);
      onChange(name, suggestion.personId);
      setOpen(false);
      setActiveIndex(-1);
      onEnterCommit?.(name, suggestion.personId);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-[12rem]">
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
        onChange={(event) => {
          onChange(titleCaseName(event.target.value), null);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={listLabel}
          className="scrollbar-theme absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-[#6e5338]/40 bg-popover py-1 text-popover-foreground shadow-sm"
        >
          {filtered.map((suggestion, index) => (
            <li
              key={`${suggestion.personId ?? "label"}:${suggestion.name}`}
              id={`${listId}-opt-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={cn(
                "cursor-pointer px-2.5 py-1.5 text-sm",
                index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/70",
              )}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(suggestion);
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              {suggestion.name}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
