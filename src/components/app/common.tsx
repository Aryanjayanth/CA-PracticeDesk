import { useState, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: "success" | "warning" | "danger" | "info";
  hint?: string;
}) {
  return (
    <Card className="shadow-none">
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div
          className={cn(
            "mt-1 text-2xl font-semibold tabular-nums",
            tone === "success" && "text-success",
            tone === "warning" && "text-warning-foreground",
            tone === "danger" && "text-destructive",
            tone === "info" && "text-primary",
          )}
        >
          {value}
        </div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export function Field({
  label,
  children,
  className,
  hint,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  hint?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function NativeSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        props.className,
      )}
    />
  );
}

export type ChipOption<T extends string> = { value: T; label: string; hint?: string };

/**
 * Horizontal (wrapping) single-select. Replaces dropdowns for short, known option
 * sets so every choice stays visible and is one click away.
 */
export function ChipSelect<T extends string>({
  value,
  onChange,
  options,
  allowEmpty,
  emptyLabel = "Any",
  className,
  ariaLabel,
  counts,
}: {
  value: T | "";
  onChange: (v: T | "") => void;
  options: readonly ChipOption<T>[];
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
  ariaLabel?: string;
  /** When provided, each chip shows how many rows it would match; empty ones dim. */
  counts?: Record<string, number>;
}) {
  const chip = (active: boolean, count?: number) =>
    cn(
      "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active
        ? "border-primary bg-primary text-primary-foreground shadow-xs"
        : "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
      !active && count === 0 && "opacity-40",
    );

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)} role="group" aria-label={ariaLabel}>
      {allowEmpty && (
        <button
          type="button"
          onClick={() => onChange("")}
          className={chip(value === "")}
          aria-pressed={value === ""}
        >
          {emptyLabel}
        </button>
      )}
      {options.map((o) => {
        const count = counts?.[o.value];
        return (
          <button
            key={o.value}
            type="button"
            title={
              count === undefined ? o.hint : `${o.label} — ${count} client${count === 1 ? "" : "s"}`
            }
            onClick={() => onChange(o.value === value ? "" : o.value)}
            className={chip(value === o.value, count)}
            aria-pressed={value === o.value}
          >
            {o.label}
            {count !== undefined && <span className="ml-1 opacity-70 tabular-nums">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** One filter dimension in a horizontal filter bar: fixed label left, chips wrap right. */
export function ChipFilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-b px-4 py-2.5 last:border-b-0 sm:flex-row sm:items-start sm:gap-4">
      <div className="w-32 shrink-0 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  destructive,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: (reason: string) => Promise<void> | void;
  destructive?: boolean;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setReason("");
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <Field label="Reason (required)">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={!reason.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(reason.trim());
                setReason("");
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NoAccess() {
  return (
    <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">
      You don't have permission to view this page.
    </div>
  );
}
