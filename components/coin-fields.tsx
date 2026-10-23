"use client";

import { useI18n } from "@/components/locale";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EMPTY_COINS, type CoinParts } from "@/lib/money";

const keys = ["platinum", "gold", "silver", "copper"] as const;

export function CoinFields({
  idPrefix,
  value,
  onChange,
  disabled,
}: {
  idPrefix: string;
  value: CoinParts;
  onChange: (next: CoinParts) => void;
  disabled?: boolean;
}) {
  const { copy } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {keys.map((key) => (
        <div key={key} className="grid gap-1">
          <Label htmlFor={`${idPrefix}-${key}`}>{copy.coins[key]}</Label>
          <Input
            id={`${idPrefix}-${key}`}
            inputMode="numeric"
            disabled={disabled}
            value={disabled ? "" : String(value[key])}
            onChange={(event) => {
              const digits = event.target.value.replace(/[^\d]/g, "").slice(0, 6);
              onChange({
                ...value,
                [key]: digits === "" ? 0 : Number(digits),
              });
            }}
          />
        </div>
      ))}
    </div>
  );
}

export { EMPTY_COINS };
