import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/use-roles";
import { PageHeader, StatCard } from "@/components/app/common";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ageingBucket, BUCKETS, fmtDateTime, inr, invoiceDisplayStatus, jobDisplayStatus, label, MODES } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — CA PracticeDesk" }, { name: "description", content: "Firm overview." }] }),
  component: Dashboard,
});

const COLORS = ["var(--chart-3)", "var(--chart-1)", "var(--chart-2)", "var(--chart-5)", "var(--chart-4)"];

function Dashboard() {
  const { isFinance, isCashierOnly, loading, has } = useRoles();
  const q = useQuery({
    queryKey: ["dashboard"],
    enabled: isFinance,
    queryFn: async () => {
      const [c, j, i, p, a] = await Promise.all([
        supabase.from("clients").select("id,status"),
        supabase.from("jobs").select("id,status,due_date"),
        supabase.from("invoices").select("id,status,total,outstanding,due_date"),
        supabase.from("payments").select("id,amount,mode,status,allocated_amount"),
        supabase.from("audit_logs").select("id,action,module,created_at,new_value").in("module", ["jobs", "invoices", "payments", "payment_allocations", "payment_reversals", "discounts"]).order("created_at", { ascending: false }).limit(12),
      ]);
      for (const r of [c, j, i, p]) if (r.error) throw r.error;
      return { clients: c.data!, jobs: j.data!, invoices: i.data!, payments: p.data!, activity: a.data ?? [] };
    },
  });

  if (loading) return null;
  if (isCashierOnly) return <Navigate to="/payments" />;
  if (!isFinance && has("staff")) return <Navigate to="/jobs" />;

  const d = q.data;
  const jobs = d?.jobs ?? [];
  const js = (s: string) => jobs.filter((x) => jobDisplayStatus(x) === s).length;
  const openInv = (d?.invoices ?? []).filter((x) => x.status !== "cancelled" && x.status !== "draft");
  const live = (d?.payments ?? []).filter((x) => x.status !== "reversed");
  const totalInvoiced = openInv.reduce((s, x) => s + Number(x.total), 0);
  const collected = live.reduce((s, x) => s + Number(x.amount), 0);
  const outstanding = openInv.reduce((s, x) => s + Number(x.outstanding), 0);
  const unalloc = live.reduce((s, x) => s + Number(x.amount) - Number(x.allocated_amount), 0);

  const jobChart = ["pending", "in_progress", "completed", "cancelled", "overdue"].map((s) => ({ name: label(s), value: js(s) }));
  const modeChart = Object.entries(MODES).map(([k, v]) => ({ name: v, value: live.filter((x) => x.mode === k).reduce((s, x) => s + Number(x.amount), 0) }));
  const ageChart = BUCKETS.map((b) => ({ name: b, value: openInv.filter((x) => Number(x.outstanding) > 0 && ageingBucket(x.due_date) === b).reduce((s, x) => s + Number(x.outstanding), 0) }));

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Live figures from your books" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Total Clients" value={d?.clients.length ?? "—"} />
        <StatCard label="Active Clients" value={d?.clients.filter((x) => x.status === "active").length ?? "—"} tone="success" />
        <StatCard label="Total Jobs" value={jobs.length} />
        <StatCard label="Pending Jobs" value={js("pending") + js("in_progress")} tone="warning" />
        <StatCard label="Completed Jobs" value={js("completed")} tone="success" />
        <StatCard label="Overdue Jobs" value={js("overdue")} tone="danger" />
        <StatCard label="Total Invoiced" value={inr(totalInvoiced)} tone="info" />
        <StatCard label="Total Collected" value={inr(collected)} tone="success" />
        <StatCard label="Total Outstanding" value={inr(outstanding)} tone="danger" hint={`${openInv.filter((x) => invoiceDisplayStatus(x) === "overdue").length} overdue invoices`} />
        <StatCard label="Unallocated Payments" value={inr(unalloc)} tone="warning" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="shadow-none"><CardHeader className="pb-0"><CardTitle className="text-sm">Job Status</CardTitle></CardHeader>
          <CardContent className="h-64"><ResponsiveContainer><PieChart><Pie data={jobChart} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80}>{jobChart.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}</Pie><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer></CardContent></Card>
        <Card className="shadow-none"><CardHeader className="pb-0"><CardTitle className="text-sm">Collections by Payment Mode</CardTitle></CardHeader>
          <CardContent className="h-64"><ResponsiveContainer><BarChart data={modeChart}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={11} /><YAxis fontSize={11} tickFormatter={(v) => `${v / 1000}k`} /><Tooltip formatter={(v: number) => inr(v)} /><Bar dataKey="value" fill="var(--chart-1)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></CardContent></Card>
        <Card className="shadow-none"><CardHeader className="pb-0"><CardTitle className="text-sm">Receivables Ageing</CardTitle></CardHeader>
          <CardContent className="h-64"><ResponsiveContainer><BarChart data={ageChart}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={10} /><YAxis fontSize={11} tickFormatter={(v) => `${v / 1000}k`} /><Tooltip formatter={(v: number) => inr(v)} /><Bar dataKey="value" fill="var(--chart-4)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></CardContent></Card>
      </div>
      <Card className="mt-4 shadow-none">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Recent Activity</CardTitle></CardHeader>
        <CardContent>
          {(d?.activity.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">No recent activity yet.</p> : (
            <ul className="divide-y text-sm">
              {d!.activity.map((a) => {
                const nv = (a.new_value ?? {}) as Record<string, unknown>;
                const ref = String(nv.job_code ?? nv.invoice_no ?? nv.payment_code ?? nv.reversal_ref ?? "");
                return (
                  <li key={a.id} className="flex justify-between py-2">
                    <span><span className="font-medium">{label(a.module)}</span> {a.action} {ref && <span className="text-muted-foreground">· {ref}</span>}{nv.status ? <span className="text-muted-foreground"> → {label(String(nv.status))}</span> : null}</span>
                    <span className="text-xs text-muted-foreground">{fmtDateTime(a.created_at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
