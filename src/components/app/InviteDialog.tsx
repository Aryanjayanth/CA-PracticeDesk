import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Copy, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Field } from "./common";
import { inviteUser } from "@/lib/firms.functions";
import { ROLES, type Role } from "@/hooks/use-roles";
import { errMsg, label } from "@/lib/format";

export function InviteDialog({
  firm,
  onClose,
}: {
  firm: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const run = useServerFn(inviteUser);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [busy, setBusy] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState("");
  const [copied, setCopied] = useState(false);

  const resetAll = () => {
    setEmail("");
    setName("");
    setCreatedLink(null);
    setInvitedEmail("");
    setCopied(false);
    onClose();
  };

  const copyLink = () => {
    if (!createdLink) return;
    navigator.clipboard.writeText(createdLink);
    setCopied(true);
    toast.success("Direct invite link copied to clipboard!");
    setTimeout(() => setCopied(false), 2500);
  };

  const send = async () => {
    if (!firm) return;
    setBusy(true);
    try {
      const r = await run({
        data: {
          firmId: firm.id,
          email,
          fullName: name,
          role,
          redirectTo: `${window.location.origin}/set-password`,
        },
      });
      qc.invalidateQueries();
      if (r.status === "invited") {
        if (r.inviteLink) {
          setCreatedLink(r.inviteLink);
          setInvitedEmail(email);
          toast.success(`Invitation email dispatched to ${email}!`);
        } else {
          toast.success(`Invite sent to ${email}`);
          resetAll();
        }
      } else {
        toast.success("Existing account added to firm");
        resetAll();
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!firm} onOpenChange={(o) => !o && resetAll()}>
      <DialogContent className="max-w-md">
        {createdLink ? (
          <>
            <DialogHeader>
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Mail className="h-6 w-6" />
              </div>
              <DialogTitle className="text-center">Invitation Dispatched!</DialogTitle>
              <DialogDescription className="text-center">
                An invitation email has been sent to{" "}
                <span className="font-semibold text-foreground">{invitedEmail}</span>.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 pt-2">
              <div className="text-xs text-muted-foreground">
                You can also copy and share the direct activation link below via WhatsApp or chat:
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={createdLink}
                  readOnly
                  className="font-mono text-xs select-all bg-muted/50"
                />
                <Button type="button" size="sm" onClick={copyLink} className="shrink-0 gap-1.5">
                  {copied ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>

            <DialogFooter className="mt-4">
              <Button onClick={resetAll} className="w-full">
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Invite to {firm?.name}</DialogTitle>
              <DialogDescription>
                They will receive an email invitation to set up their password and join your firm.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <Field label="Full name">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                />
              </Field>
              <Field label="Email *">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="rahul@example.com"
                />
              </Field>
              <Field label="Role">
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {label(r)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetAll}>
                Cancel
              </Button>
              <Button onClick={send} disabled={busy || !email}>
                {busy ? "Sending…" : "Send Invite"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
