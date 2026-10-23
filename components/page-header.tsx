import { cn } from "cn";

/**
 * Page-level title + optional subtitle.
 * Scale: page title text-xl (heading) · subtitle text-sm muted (body).
 * Section titles stay on CardTitle (text-base). Shell product name lives in the thin brown toolbar.
 */
export function PageHeader({
  title,
  subtitle,
  action,
  eyebrow,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  /** Content above the title (e.g. back link). */
  eyebrow?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow}
        <h2 className={cn("font-heading text-xl leading-snug", eyebrow ? "mt-0.5" : null)}>{title}</h2>
        {subtitle ? <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}
