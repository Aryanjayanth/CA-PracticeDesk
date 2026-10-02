import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shield, Eye, EyeOff, Lock, Unlock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, NoAccess, PageHeader } from "@/components/app/common";
import { useRoles } from "@/hooks/use-roles";
import { useCurrentFirm, useSuperAdmin } from "@/hooks/use-firm";
import { useAdminPrivacy } from "@/hooks/use-admin-privacy";
import { AvatarPicker } from "@/components/app/EntityAvatar";
import { errMsg } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — CA PracticeDesk" },
      { name: "description", content: "Firm and administration settings." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { isManager, loading: rolesLoading } = useRoles();
  const { isSuperAdmin, loading: saLoading } = useSuperAdmin();
  const { privacyMode, setPrivacyMode } = useAdminPrivacy();
  const qc = useQueryClient();
  const { data: firm } = useCurrentFirm();
  const q = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await supabase.from("settings").select("*").maybeSingle()).data,
  });

  const [f, setF] = useState<Record<string, string>>({});
  const [logo, setLogo] = useState<string | null>(null);

  useEffect(() => {
    if (q.data) {
      setF(Object.fromEntries(Object.entries(q.data).map(([k, v]) => [k, String(v ?? "")])));
    }
  }, [q.data]);

  useEffect(() => {
    setLogo(firm?.logo_url ?? null);
  }, [firm?.logo_url]);

  if (rolesLoading || saLoading) return null;
  if (!isManager && !isSuperAdmin) return <NoAccess />;

  const set = (k: string) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    if (!f.firm_name?.trim()) return toast.error("Firm name is required");
    if (!q.data) return toast.error("Settings not found for this firm");
    const { error } = await supabase
      .from("settings")
      .update({
        firm_name: f.firm_name,
        address: f.address,
        gstin: f.gstin,
        pan: f.pan,
        phone: f.phone,
        email: f.email,
        bank_details: f.bank_details,
        default_tax_rate: Number(f.default_tax_rate || 0),
      })
      .eq("id", q.data.id);
    if (!error && q.data.firm_id) {
      await supabase
        .from("firms")
        .update({ name: f.firm_name, logo_url: logo })
        .eq("id", q.data.firm_id);
    }
    if (error) return toast.error(errMsg(error));
    toast.success("Settings saved");
    qc.invalidateQueries();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Settings" subtitle="Firm details and workspace preferences" />

      {/* Super Admin Control */}
      {isSuperAdmin && (
        <div className="flex items-center justify-between rounded-xl border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              {privacyMode ? (
                <Lock className="h-4 w-4 text-slate-400" />
              ) : (
                <Unlock className="h-4 w-4 text-emerald-500" />
              )}
            </div>
            <div>
              <div className="text-sm font-semibold">Console Controls</div>
              <div className="text-xs text-muted-foreground">
                {privacyMode ? "Locked" : "Unlocked"}
              </div>
            </div>
          </div>
          <Switch
            checked={!privacyMode}
            onCheckedChange={(unlocked) => setPrivacyMode(!unlocked)}
          />
        </div>
      )}

      {/* Firm Profile Settings */}
      {firm && (
        <div className="grid gap-5 rounded-xl border bg-card p-6 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <AvatarPicker name={f.firm_name} value={logo} onChange={setLogo} square />
          </div>
          <Field label="Firm Name" className="sm:col-span-2">
            <Input value={f.firm_name ?? ""} onChange={set("firm_name")} />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Textarea rows={2} value={f.address ?? ""} onChange={set("address")} />
          </Field>
          <Field label="GSTIN">
            <Input value={f.gstin ?? ""} onChange={set("gstin")} />
          </Field>
          <Field label="PAN">
            <Input value={f.pan ?? ""} onChange={set("pan")} />
          </Field>
          <Field label="Phone">
            <Input value={f.phone ?? ""} onChange={set("phone")} />
          </Field>
          <Field label="Email">
            <Input value={f.email ?? ""} onChange={set("email")} />
          </Field>
          <Field label="Default GST %">
            <Input
              type="number"
              value={f.default_tax_rate ?? ""}
              onChange={set("default_tax_rate")}
            />
          </Field>
          <Field label="Bank Details" className="sm:col-span-2">
            <Textarea rows={2} value={f.bank_details ?? ""} onChange={set("bank_details")} />
          </Field>
          <div>
            <Button onClick={save}>Save Settings</Button>
          </div>
        </div>
      )}
    </div>
  );
}
