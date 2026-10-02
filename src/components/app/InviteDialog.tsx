import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Field } from "./common";
import { inviteUser } from "@/lib/firms.functions";
import { errMsg } from "@/lib/format";

export function InviteDialog({ firm, onClose, allowOwner = true }: { firm: { id: string; name: string } | null; onClose: () => void; allowOwner?: boolean }) {
  const qc = useQueryClient();
  const run = useServerFn(inviteUser);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"owner" | "admin" | "accountant" | "staff" | "cashier">("staff");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!firm) return;
    setBusy(true);
    try {
      const r = await run({ data: { firmId: firm.id, email, fullName: name, role, redirectTo: `${window.location.origin}/set-password` } });
      toast.success(r.status === "invited" ? `Invite sent to ${email}` : "Existing account added to firm");
      qc.invalidateQueries();
      setEmail(""); setName(""); onClose();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={!!firm} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Invite to {firm?.name}</DialogTitle><DialogDescription>They'll get an email to set a password.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Email *"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Role">
            <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
              {(allowOwner ? ["owner", "admin", "accountant", "staff", "cashier"] : ["admin", "accountant", "staff", "cashier"]).map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
            </select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={send} disabled={busy || !email}>{busy ? "Sending…" : "Send invite"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
