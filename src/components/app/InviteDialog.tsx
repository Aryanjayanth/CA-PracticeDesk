import { useState, useEffect } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, Link2, Sparkles, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
import { useSuperAdmin } from "@/hooks/use-firm";
import { errMsg, label } from "@/lib/format";

export function InviteDialog({
  firm,
  open,
  onClose,
}: {
  firm?: { id: string; name: string } | null;
  open?: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { isSuperAdmin } = useSuperAdmin();
  const run = useServerFn(inviteUser);

  const [selectedFirmId, setSelectedFirmId] = useState<string>(firm?.id || "");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [busy, setBusy] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState("");
  const [invitedRole, setInvitedRole] = useState<Role>("staff");
  const [emailSent, setEmailSent] = useState(false);
  const [copied, setCopied] = useState(false);

  // Sync selected firm when prop changes
  useEffect(() => {
    if (firm?.id) setSelectedFirmId(firm.id);
  }, [firm?.id]);

  // Load firms if super admin and no firm was explicitly passed
  const firmsQ = useQuery({
    queryKey: ["firms-list-for-invite"],
    enabled: isSuperAdmin && !firm,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("firms")
        .select("id, name, status")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const isOpen = open !== undefined ? open : !!firm;

  const resetAll = () => {
    setEmail("");
    setName("");
    setRole("staff");
    setCreatedLink(null);
    setInvitedEmail("");
    setEmailSent(false);
    setCopied(false);
    onClose();
  };

  const copyLink = () => {
    if (!createdLink) return;
    navigator.clipboard.writeText(createdLink);
    setCopied(true);
    toast.success("Direct activation link copied to clipboard!");
    setTimeout(() => setCopied(false), 2500);
  };

  const targetFirmId = firm?.id || selectedFirmId;
  const targetFirmName =
    firm?.name ||
    firmsQ.data?.find((f) => f.id === selectedFirmId)?.name ||
    "Selected Firm";

  const send = async () => {
    if (!targetFirmId) {
      toast.error("Please select a firm");
      return;
    }
    if (!email.trim()) {
      toast.error("Please enter a valid email address");
      return;
    }
    setBusy(true);
    try {
      const r = await run({
        data: {
          firmId: targetFirmId,
          email: email.trim().toLowerCase(),
          fullName: name.trim() || undefined,
          role,
          redirectTo: `${window.location.origin}/set-password`,
        },
      });
      qc.invalidateQueries();

      if (r.inviteLink) {
        setCreatedLink(r.inviteLink);
        setInvitedEmail(email.trim().toLowerCase());
        setInvitedRole(role);
        setEmailSent(!!r.emailSent);
        toast.success("Direct access link generated successfully!");
      } else {
        toast.success(
          r.status === "invited"
            ? `Invite created for ${email}`
            : "User linked to firm successfully"
        );
        resetAll();
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && resetAll()}>
      <DialogContent className="max-w-md">
        {createdLink ? (
          <>
            <DialogHeader>
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                <Sparkles className="h-6 w-6" />
              </div>
              <DialogTitle className="text-center">Link Ready for {invitedEmail}</DialogTitle>
              <DialogDescription className="text-center">
                Assigned as <span className="font-semibold text-foreground">{label(invitedRole)}</span> at{" "}
                <span className="font-semibold text-foreground">{targetFirmName}</span>.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 pt-2">
              <div className="rounded-lg border border-border/60 bg-muted/40 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                  <span className="flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5 text-primary" /> Direct Login / Setup Link:
                  </span>
                  {emailSent && (
                    <span className="text-emerald-600 dark:text-emerald-400">✓ Email Dispatched</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={createdLink}
                    readOnly
                    onFocus={(e) => e.target.select()}
                    className="font-mono text-xs select-all bg-background border-border/80"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={copyLink}
                    className="shrink-0 gap-1.5"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                Copy and share this link via WhatsApp, email, or chat. Opening it will instantly authenticate the user and let them set their password.
              </p>

              <div className="pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => window.open(createdLink, "_blank", "noopener,noreferrer")}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open Link in New Tab / Test
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
              <DialogTitle className="flex items-center gap-2">
                <Link2 className="h-5 w-5 text-primary" />
                Invite User & Generate Link
              </DialogTitle>
              <DialogDescription>
                {firm
                  ? `Generate a direct activation link and invite a team member to ${firm.name}.`
                  : "Select a firm, role, and email to create an instant activation link."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* If super admin and no firm was locked, show firm selector */}
              {!firm && isSuperAdmin && (
                <Field label="Select Firm *">
                  <div className="relative">
                    <Building2 className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <select
                      value={selectedFirmId}
                      onChange={(e) => setSelectedFirmId(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="">-- Choose a firm --</option>
                      {(firmsQ.data ?? []).map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name} {f.status === "suspended" ? "(Suspended)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </Field>
              )}

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
                  required
                />
              </Field>

              <Field label="Role">
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="admin">Owner / Admin (Full Access)</option>
                  <option value="staff">Staff (Job Execution)</option>
                  <option value="cashier">Cashier (Billing & Payments)</option>
                </select>
              </Field>
            </div>

            <DialogFooter className="mt-2">
              <Button variant="outline" onClick={resetAll}>
                Cancel
              </Button>
              <Button onClick={send} disabled={busy || !email || (!firm && !selectedFirmId)}>
                {busy ? "Generating…" : "Generate Link & Invite"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
