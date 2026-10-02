import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/app/DataTable";
import { Field, NativeSelect, PageHeader, ReasonDialog } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useClientLookup, useRoles } from "@/hooks/use-roles";
import { errMsg, fmtDate, inr, MODES, today } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/payments")({
  head: () => ({ meta: [{ title: "Payment Entry — CA PracticeDesk" }, { name: "description", content: "Record payments received." }] }),
  component: PaymentsPage,
});

const empty = { client_id: "", amount: "", mode: "upi", payment_date: today(), reference: "", narration: "" };

function PaymentsPage() {
  const { user } = useRouteContext({ from: "/_authenticated" });
  const { isFinance } = useRoles();
  const qc = useQueryClient();
  const { data: clients } = useClientLookup();
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [rev, setRev] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const q = useQuery({
    queryKey: ["payments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("payments").select("id,payment_code,client_id,amount,mode,payment_date,reference,narration,status,created_at").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const cname = (id: string) => clients?.find((c) => c.id === id)?.name ?? "—";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(f.amount);
    if (!f.client_id) return toast.error("Choose a client");
    if (!(amt > 0)) return toast.error("Amount must be greater than zero");
    if (f.payment_date > today()) return toast.error("Payment date can't be in the future");
    if (f.mode !== "cash" && !f.reference.trim()) return toast.error("Reference number is required for non-cash payments");
    const dup = q.data?.find((p) => p.status !== "reversed" && p.client_id === f.client_id && Number(p.amount) === amt && (p.payment_date === f.payment_date || (f.reference && p.reference === f.reference)));
    if (dup && !confirm(`Possible duplicate of ${dup.payment_code} (${inr(dup.amount)} on ${fmtDate(dup.payment_date)}). Save anyway?`)) return;
    setBusy(true);
    const { error } = await supabase.from("payments").insert({ client_id: f.client_id, amount: amt, mode: f.mode, payment_date: f.payment_date, reference: f.reference.trim() || null, narration: f.narration.trim() || null, created_by: user.id });
    setBusy(false);
    if (error) return toast.error(errMsg(error));
    toast.success("Payment recorded as Unallocated");
    setF(empty);
    qc.invalidateQueries();
  };

  const reverse = async (reason: string) => {
    const { error } = await supabase.rpc("reverse_payment", { _payment_id: rev!, _reason: reason });
    if (error) { toast.error(errMsg(error)); throw error; }
    toast.success("Payment reversed; allocations undone");
    qc.invalidateQueries();
  };

  return (
    <div>
      <PageHeader title="Payment Entry" subtitle="Record money received. New payments start as Unallocated." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="shadow-none">
          <CardHeader className="pb-2"><CardTitle className="text-sm">New Payment</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={save} className="space-y-3">
              <Field label="Client *"><NativeSelect value={f.client_id} onChange={set("client_id")}><option value="">Select client…</option>{clients?.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.client_code})</option>)}</NativeSelect></Field>
              <Field label="Amount (₹) *"><Input type="number" min={0} step="0.01" value={f.amount} onChange={set("amount")} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Mode"><NativeSelect value={f.mode} onChange={set("mode")}>{Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Field>
                <Field label="Date"><Input type="date" max={today()} value={f.payment_date} onChange={set("payment_date")} /></Field>
              </div>
              <Field label="Reference No."><Input value={f.reference} onChange={set("reference")} placeholder="UPI / UTR / Cheque no." /></Field>
              <Field label="Narration"><Input value={f.narration} onChange={set("narration")} /></Field>
              <Button className="w-full" disabled={busy}>{busy ? "Saving…" : "Save Payment"}</Button>
            </form>
          </CardContent>
        </Card>
        <div className="lg:col-span-2">
          <DataTable rows={q.data} loading={q.isLoading} empty="No payments recorded yet." search={(p) => `${p.payment_code} ${p.reference} ${cname(p.client_id)}`}
            columns={[
              { key: "payment_code", header: "Payment", sort: (p) => p.payment_code, className: "font-mono text-xs" },
              { key: "c", header: "Client", render: (p) => cname(p.client_id) },
              { key: "d", header: "Date", sort: (p) => p.payment_date, render: (p) => fmtDate(p.payment_date) },
              { key: "m", header: "Mode", render: (p) => MODES[p.mode] },
              { key: "reference", header: "Reference" },
              { key: "a", header: "Amount", align: "right", sort: (p) => Number(p.amount), render: (p) => inr(p.amount) },
              { key: "s", header: "Status", render: (p) => <StatusBadge status={p.status} /> },
              ...(isFinance ? [{ key: "x", header: "", render: (p: { id: string; status: string }) => p.status !== "reversed" && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRev(p.id)}>Reverse</Button> }] : []),
            ]} />
        </div>
      </div>
      <ReasonDialog open={!!rev} onOpenChange={(o) => !o && setRev(null)} title="Reverse payment?" description="The payment stays on record as Reversed. Any allocations are undone and invoice balances restored." confirmLabel="Reverse" destructive onConfirm={reverse} />
    </div>
  );
}
