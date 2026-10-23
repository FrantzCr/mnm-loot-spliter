"use client";

import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/components/locale";
import { Card, CardContent } from "@/components/ui/card";

export function RecapScreen() {
  const { copy } = useI18n();

  return (
    <div className="grid gap-4">
      <PageHeader title={copy.recap.title} subtitle={copy.recap.body} />
      <Card>
        <CardContent>
          <p className="font-body text-sm text-muted-foreground">{copy.recap.empty}</p>
        </CardContent>
      </Card>
    </div>
  );
}
