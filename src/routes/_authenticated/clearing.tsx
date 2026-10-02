import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NoAccess, PageHeader, ReasonDialog } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useRoles } from "@/hooks/use-roles";
import { cn } from "@/lib/utils";
import { errMsg, fmtDate, inr, invoiceDisplayStatus, MODES } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/clearing")({
  validateSearch: (s: Record<string, unknown>) => ({ payment: typeof s.payment === "string" ? s.payment : undefined }),
  head: () => ({ meta: [{ title: "Payment Clearing — CA PracticeDesk" }, { name: "description", content: "Allocate payments to invoices, client by client." }] }),
  component: ClearingPage,
});

type Pay = { id: string; client_id: string; amount: number | string; allocated_amount: number | string; payment_date: string; payment_code: string; mode: string; status: string; clients: { name: string } | null };
type Inv = { id: string; client_id: string; outstanding: number | string | null; due_date: string; invoice_no: string; description: string | null; status: string };

const avail = (p: Pay) => Number(p.amount) - Number(p.allocated_amount);

/** Split invoice amounts across a client's payments, oldest payment first. */
function plan(pays: Pay[], wanted: { invoice_id: string; amount: number }[]) {
  const out = new Map<string, { invoice_id: string; amount: number }[]>();
  const left = pays.map((p) => ({ id: p.id, rem: avail(p) }));
  for (const w of wanted) {
    let need = w.amount;
    for (const p of left) {
      if (need <= 0.001) break;
      if (p.rem <= 0.001) continue;
      const a = Math.round(Math.min(need, p.rem) * 100) / 100;
      p.rem -= a; need -= a;
      out.set(p.id, [...(out.get(p.id) ?? []), { invoice_id: w.invoice_id, amount: a }]);
    }
  }
  return out;
}

async function runPlan(m: Map<string, { invoice_id: string; amount: number }[]>) {
  for (const [pid, list] of m) {
    const { error } = await supabase.rpc("allocate_payment", { _payment_id: pid, _allocations: list });
    if (error) throw error;
  }
}

function ClearingPage() {
  const { isFinance, loading } = useRoles();
  const search = Route.useSearch();
  const qc = useQueryClient();
  const [cid, setCid] = useState<string | undefined>();
  const [amts, setAmts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<string | null>(null);

  const pays = useQuery({
    queryKey: ["open-payments"], enabled: isFinance,
    queryFn: async () => ((await supabase.from("payments").select("*, clients(name)").in("status", ["unallocated", "partially_allocated"]).order("payment_date")).data ?? []) as Pay[],
  });
  const allInvs = useQuery({
    queryKey: ["open-invoices-all"], enabled: isFinance,
    queryFn: async () => ((await supabase.from("invoices").select("id,client_id,outstanding,due_date,invoice_no,description,status").in("status", ["unpaid", "partially_paid"]).order("due_date")).data ?? []) as Inv[],
  });

  const groups = useMemo(() => {
    const g = new Map<string, { id: string; name: string; pays: Pay[]; avail: number; due: number }>();
    for (const p of pays.data ?? []) {
      const x = g.get(p.client_id) ?? { id: p.client_id, name: p.clients?.name ?? "—", pays: [], avail: 0, due: 0 };
      x.pays.push(p); x.avail += avail(p); g.set(p.client_id, x);
    }
    for (const i of allInvs.data ?? []) { const x = g.get(i.client_id); if (x) x.due += Number(i.outstanding); }
    return [...g.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [pays.data, allInvs.data]);

  useEffect(() => {
    if (cid || !pays.data) return;
    const fromSearch = pays.data.find((p) => p.id === search.payment)?.client_id;
    setCid(fromSearch ?? groups[0]?.id);
  }, [pays.data, groups, cid, search.payment]);
  useEffect(() => setAmts({}), [cid]);

  const grp = groups.find((g) => g.id === cid);
  const invs = (allInvs.data ?? []).filter((i) => i.client_id === cid);
  const allocs = useQuery({
    queryKey: ["allocs-client", cid], enabled: !!cid,
    queryFn: async () => (await supabase.from("payment_allocations").select("*, invoices!inner(invoice_no, client_id), payments(payment_code)").eq("invoices.client_id", cid!).order("created_at", { ascending: false }).limit(20)).data ?? [],
  });

  const available = grp?.avail ?? 0;
  const totalAlloc = Object.values(amts).reduce((s, v) => s + (Number(v) || 0), 0);
  const overInv = invs.some((i) => Number(amts[i.id] || 0) > Number(i.outstanding) + 0.001);
  const invalid = totalAlloc <= 0 || totalAlloc > available + 0.001 || overInv;

  if (loading) return null;
  if (!isFinance) return <NoAccess />;

  const fifo = (g: { avail: number }, list: Inv[]) => {
    let left = g.avail; const n: { invoice_id: string; amount: number }[] = [];
    for (const i of list) { if (left <= 0.001) break; const a = Math.min(left, Number(i.outstanding)); if (a > 0) { n.push({ invoice_id: i.id, amount: a }); left -= a; } }
    return n;
  };
  const autoFill = () => { if (grp) setAmts(Object.fromEntries(fifo(grp, invs).map((x) => [x.invoice_id, String(x.amount)]))); };
  const done = () => { setAmts({}); qc.invalidateQueries(); };

  const submit = async () => {
    if (!grp) return;
    setBusy(true);
    try {
      const wanted = invs.filter((i) => Number(amts[i.id]) > 0).map((i) => ({ invoice_id: i.id, amount: Number(amts[i.id]) }));
      await runPlan(plan(grp.pays, wanted));
      toast.success("Payments cleared against invoices");
      done();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const autoAll = async () => {
    setBusy(true);
    let n = 0;
    try {
      for (const g of groups) {
        const list = (allInvs.data ?? []).filter((i) => i.client_id === g.id);
        const wanted = fifo(g, list);
        if (!wanted.length) continue;
        await runPlan(plan(g.pays, wanted)); n++;
      }
      toast.success(n ? `Squared off ${n} client(s) automatically` : "Nothing to clear — no matching outstanding invoices");
      done();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const doUndo = async (reason: string) => {
    const { error } = await supabase.rpc("reverse_allocation", { _allocation_id: undo!, _reason: reason });
    if (error) { toast.error(errMsg(error)); throw error; }
    toast.success("Allocation reversed");
    qc.invalidateQueries();
  };

  return (
    <div>
      <PageHeader title="Payment Clearing" subtitle="Payments are grouped by client. All of a client's payments are pooled, so instalments can square off one invoice together."
        actions={<Button onClick={autoAll} disabled={busy || groups.length === 0}><Sparkles className="mr-1 h-4 w-4" />Auto square-off all</Button>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="shadow-none">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Clients with uncleared payments</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {groups.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No unallocated payments.</p>}
            {groups.map((g) => (
              <button key={g.id} onClick={() => setCid(g.id)} className={cn("w-full rounded-lg border p-4 text-left text-sm hover:bg-muted/50", cid === g.id && "border-primary bg-primary/5")}>
                <div className="flex items-center justify-between"><span className="font-semibold">{g.name}</span><span className="text-xs text-muted-foreground">{g.pays.length} payment(s)</span></div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div><div className="text-muted-foreground">Received, uncleared</div><div className="font-semibold text-primary">{inr(g.avail)}</div></div>
                  <div><div className="text-muted-foreground">Invoices due</div><div className="font-semibold">{inr(g.due)}</div></div>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
        <div className="space-y-4 lg:col-span-2">
          {!grp ? <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">Select a client to clear.</div> : (
            <>
              <Card className="shadow-none">
                <CardContent className="p-4">
                  <div className="mb-3 text-sm font-semibold">{grp.name} — payments being pooled</div>
                  <div className="space-y-1.5">
                    {grp.pays.map((p) => (
                      <div key={p.id} className="flex justify-between rounded-md bg-muted/40 px-3 py-2 text-xs">
                        <span>{p.payment_code} · {fmtDate(p.payment_date)} · {MODES[p.mode]} <StatusBadge status={p.status} className="ml-1" /></span>
                        <span className="font-semibold">{inr(avail(p))}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div><div className="text-xs text-muted-foreground">Total available</div><div className="font-semibold text-primary">{inr(available)}</div></div>
                    <div><div className="text-xs text-muted-foreground">Allocating now</div><div className="font-semibold">{inr(totalAlloc)}</div></div>
                    <div><div className="text-xs text-muted-foreground">Left as advance</div><div className={cn("font-semibold", available - totalAlloc < 0 ? "text-destructive" : "text-success")}>{inr(available - totalAlloc)}</div></div>
                  </div>
                </CardContent>
              </Card>
              <div className="rounded-lg border bg-card">
                <div className="flex items-center justify-between border-b p-3"><span className="text-sm font-semibold">Outstanding invoices</span><Button size="sm" variant="outline" onClick={autoFill}><Wand2 className="mr-1 h-4 w-4" />Auto-fill oldest first</Button></div>
                {invs.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">No outstanding invoices for this client. The money stays as an advance.</p> : (
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Invoice</th><th>Due</th><th>Description</th><th className="text-right">Outstanding</th><th className="px-3 text-right">Allocate (₹)</th></tr></thead>
                    <tbody>
                      {invs.map((i) => {
                        const over = Number(amts[i.id] || 0) > Number(i.outstanding) + 0.001;
                        return (
                          <tr key={i.id} className="border-t">
                            <td className="px-3 py-2 font-mono text-xs">{i.invoice_no} <StatusBadge status={invoiceDisplayStatus(i as never)} className="ml-1" /></td>
                            <td>{fmtDate(i.due_date)}</td>
                            <td className="max-w-[200px] truncate">{i.description}</td>
                            <td className="text-right tabular-nums">{inr(i.outstanding)}</td>
                            <td className="px-3 py-1.5"><div className="flex items-center justify-end gap-1">
                              <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setAmts((a) => ({ ...a, [i.id]: String(Math.min(Number(i.outstanding), Math.max(0, available - totalAlloc + Number(a[i.id] || 0)))) }))}>Max</Button>
                              <Input type="number" min={0} className={cn("h-8 w-32 text-right", over && "border-destructive")} value={amts[i.id] ?? ""} onChange={(e) => setAmts((a) => ({ ...a, [i.id]: e.target.value }))} />
                            </div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                <div className="flex items-center justify-between border-t p-3">
                  <span className="text-sm">{totalAlloc > available + 0.001 && <span className="text-destructive">More than the money received</span>}{overInv && <span className="ml-2 text-destructive">More than an invoice's balance</span>}{!invalid && "Partial amounts are fine — the invoice becomes Partially Paid."}</span>
                  <Button disabled={invalid || busy} onClick={submit}>{busy ? "Clearing…" : "Confirm Clearing"}</Button>
                </div>
              </div>
              {(allocs.data ?? []).length > 0 && (
                <div className="rounded-lg border bg-card p-3">
                  <div className="mb-2 text-sm font-semibold">Recent allocations</div>
                  {allocs.data!.map((a) => (
                    <div key={a.id} className="flex items-center justify-between border-t py-1.5 text-sm">
                      <span className={a.reversed ? "text-muted-foreground line-through" : ""}>{a.invoices?.invoice_no} ← {a.payments?.payment_code} · {fmtDate(a.created_at)}</span>
                      <span className="flex items-center gap-2">{inr(a.amount)}{!a.reversed ? <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setUndo(a.id)}>Reverse</Button> : <StatusBadge status="reversed" />}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <ReasonDialog open={!!undo} onOpenChange={(o) => !o && setUndo(null)} title="Reverse this allocation?" description="The allocation stays in history as reversed; the invoice balance is restored." confirmLabel="Reverse" destructive onConfirm={doUndo} />
    </div>
  );
}
