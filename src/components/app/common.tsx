import { useState, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
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

export function StatCard({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: "success" | "warning" | "danger" | "info"; hint?: string }) {
  return (
    <Card className="shadow-none">
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={cn("mt-1 text-2xl font-semibold tabular-nums",
          tone === "success" && "text-success", tone === "warning" && "text-warning-foreground",
          tone === "danger" && "text-destructive", tone === "info" && "text-primary")}>{value}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export function Field({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

export function NativeSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn("flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", props.className)} />
  );
}

export function ReasonDialog({ open, onOpenChange, title, description, confirmLabel = "Confirm", onConfirm, destructive }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; confirmLabel?: string;
  onConfirm: (reason: string) => Promise<void> | void; destructive?: boolean;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setReason(""); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <Field label="Reason (required)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={destructive ? "destructive" : "default"} disabled={!reason.trim() || busy}
            onClick={async () => { setBusy(true); try { await onConfirm(reason.trim()); setReason(""); onOpenChange(false); } finally { setBusy(false); } }}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NoAccess() {
  return <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">You don't have permission to view this page.</div>;
}
