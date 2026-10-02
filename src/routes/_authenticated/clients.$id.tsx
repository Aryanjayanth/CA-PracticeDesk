import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Mail, Phone, Pencil, Plus, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable } from "@/components/app/DataTable";
import { Field, NativeSelect, StatCard } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { ClientForm } from "@/components/app/ClientForm";
import { EntityAvatar } from "@/components/app/EntityAvatar";
import { useProfiles, useRoles } from "@/hooks/use-roles";
import { cn } from "@/lib/utils";
import { errMsg, fmtDate, fmtDateTime, FREQS, inr, invoiceDisplayStatus, jobDisplayStatus, label, MODES, today } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/clients/$id")({
  head: () => ({ meta: [{ title: "Client Profile — CA PracticeDesk" }, { name: "description", content: "Client 360° profile." }] }),
  component: ClientProfile,
});

function ClientProfile() {
  const { id } = Route.useParams();
  const { isFinance, isManager } = useRoles();
  const { data: profiles } = useProfiles();
  const pname = (u: string | null) => profiles?.find((p) => p.id === u)?.full_name ?? (u ? "Staff" : "System");
  const [edit, setEdit] = useState(false);
  const [link, setLink] = useState(false);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["client360", id, isFinance, isManager],
    queryFn: async () => {
      const c = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
      if (c.error) throw c.error;
      const [cs, jobs] = await Promise.all([
        supabase.from("client_services").select("*, services(name, service_type, auto_invoice)").eq("client_id", id).order("created_at"),
        supabase.from("jobs").select("*, services(name), invoice_items(invoice_id, invoices(id, invoice_no, status))").eq("client_id", id).order("created_at", { ascending: false }),
      ]);
      let invoices: Awaited<ReturnType<typeof fetchInv>> = [];
      let payments: Awaited<ReturnType<typeof fetchPay>> = [];
      if (isFinance) { invoices = await fetchInv(id); payments = await fetchPay(id); }
      let activity: { id: number; action: string; module: string; created_at: string; record_id: string | null; user_id: string | null; reason: string | null }[] = [];
      if (isManager) {
        const ids = [
          id,
          ...(cs.data ?? []).map((s) => s.id),
          ...(jobs.data ?? []).map((j) => j.id),
          ...invoices.map((i) => i.id),
          ...payments.map((p) => p.id),
        ];
        const a = await supabase
          .from("audit_logs")
          .select("id,action,module,created_at,record_id,user_id,reason")
          .in("record_id", ids)
          .order("created_at", { ascending: false })
          .limit(100);
        activity = (a.data as typeof activity) ?? [];
      }
      return { client: c.data, cs: cs.data ?? [], jobs: jobs.data ?? [], invoices, payments, activity };
    },
  });

  const toggleCs = async (csId: string, status: string) => {
    const { error } = await supabase.from("client_services").update({ status }).eq("id", csId);
    if (error) return toast.error(errMsg(error));
    toast.success(`Service ${status}`);
    qc.invalidateQueries({ queryKey: ["client360"] });
  };
  const toggleCsAutoInvoice = async (csId: string, current: boolean) => {
    const { error } = await supabase.from("client_services").update({ auto_invoice: !current }).eq("id", csId);
    if (error) return toast.error(errMsg(error));
    toast.success(!current ? "Auto-invoicing enabled" : "Auto-invoicing disabled");
    qc.invalidateQueries({ queryKey: ["client360"] });
  };

  const d = q.data;
  if (q.isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!d?.client)
    return (
      <div className="space-y-4">
        <Link
          to="/clients"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Clients</span>
        </Link>
        <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">
          Client not found or you do not have permission to access this record.
        </div>
      </div>
    );
  const c = d.client;
  const live = d.invoices.filter((i) => i.status !== "cancelled" && i.status !== "draft");
  const out = live.filter((i) => Number(i.outstanding) > 0);

  return (
    <div>
      <div className="mb-4">
        <Link
          to="/clients"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Clients</span>
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 rounded-xl border bg-card p-6">
        <div className="flex items-start gap-4">
        <EntityAvatar name={c.name} src={c.avatar_url} className="h-16 w-16 text-xl" />
        <div>
          <div className="flex items-center gap-3"><h1 className="text-2xl font-semibold">{c.name}</h1><StatusBadge status={c.status} /></div>
          <div className="mt-1 flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span className="font-mono">{c.client_code}</span>
            {c.mobile && <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{c.mobile}</span>}
            {c.email && <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{c.email}</span>}
            {c.pan && <span>PAN {c.pan}</span>}{c.gstin && <span>GSTIN {c.gstin}</span>}
          </div>
        </div>
        </div>
        {isManager && <Button variant="outline" onClick={() => setEdit(true)}><Pencil className="mr-1 h-4 w-4" />Edit</Button>}
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          {isFinance && <><TabsTrigger value="invoices">Invoices</TabsTrigger><TabsTrigger value="payments">Payments</TabsTrigger><TabsTrigger value="outstanding">Outstanding</TabsTrigger></>}
          {isManager && <TabsTrigger value="activity">Activity</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Total Jobs" value={d.jobs.length} />
            <StatCard label="Completed" value={d.jobs.filter((j) => j.status === "completed").length} tone="success" />
            <StatCard label="Pending" value={d.jobs.filter((j) => ["pending", "in_progress", "on_hold"].includes(j.status)).length} tone="warning" />
            <StatCard label="Overdue" value={d.jobs.filter((j) => jobDisplayStatus(j) === "overdue").length} tone="danger" />
            {isFinance && <>
              <StatCard label="Total Invoiced" value={inr(live.reduce((s, i) => s + Number(i.total), 0))} tone="info" />
              <StatCard label="Total Paid" value={inr(live.reduce((s, i) => s + Number(i.amount_paid), 0))} tone="success" />
              <StatCard label="Outstanding" value={inr(live.reduce((s, i) => s + Number(i.outstanding), 0))} tone="danger" />
              <StatCard label="Unallocated" value={inr(d.payments.filter((p) => p.status !== "reversed").reduce((s, p) => s + Number(p.amount) - Number(p.allocated_amount), 0))} tone="warning" />
            </>}
          </div>
          <div className="mt-4 grid gap-2 rounded-lg border bg-card p-4 text-sm sm:grid-cols-3">
            {[["Type", c.client_type], ["GST Type", c.gst_type], ["Business", c.business_type], ["Industry", c.industry], ["FY", c.financial_year], ["TAN", c.tan], ["Address", c.address], ["Notes", c.notes], ["Created", fmtDate(c.created_at)]].map(([k, v]) => (
              <div key={k}><div className="text-xs text-muted-foreground">{k}</div><div>{v || "—"}</div></div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="services" className="mt-4">
          <DataTable rows={d.cs} empty="No services linked to this client."
            toolbar={isManager && <Button size="sm" className="ml-auto" onClick={() => setLink(true)}><Plus className="mr-1 h-4 w-4" />Link Service</Button>}
            columns={[
              { key: "s", header: "Service", render: (r) => <span className="font-medium">{r.services?.name}</span> },
              { key: "f", header: "Frequency", render: (r) => FREQS[r.frequency] },
              { key: "fee", header: "Agreed Fee", align: "right", render: (r) => inr(r.agreed_fee) },
              { key: "sd", header: "Start", render: (r) => fmtDate(r.start_date) },
              { key: "ed", header: "End", render: (r) => fmtDate(r.end_date) },
              { key: "dd", header: "Due", render: (r) => `${r.due_days} days after period` },
              {
                key: "ai",
                header: "Auto-Invoice",
                render: (r) => isManager ? (
                  <div className="flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => toggleCsAutoInvoice(r.id, r.auto_invoice)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${r.auto_invoice ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                      title={r.auto_invoice ? "Auto-invoicing ON: click to turn off" : "Auto-invoicing OFF: click to turn on"}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-lg ring-0 transition duration-200 ease-in-out ${r.auto_invoice ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>
                ) : (
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${r.auto_invoice ? 'bg-sky-500/10 text-sky-600' : 'text-muted-foreground'}`}>
                    {r.auto_invoice ? "Yes" : "No"}
                  </span>
                ),
              },
              { key: "st", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
              { key: "a", header: "", render: (r) => isManager && (
                <div className="flex gap-1">
                  {r.status === "active" ? <Button size="sm" variant="ghost" onClick={() => toggleCs(r.id, "paused")}>Pause</Button> : r.status === "paused" ? <Button size="sm" variant="ghost" onClick={() => toggleCs(r.id, "active")}>Resume</Button> : null}
                  {r.status !== "stopped" && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => toggleCs(r.id, "stopped")}>Stop</Button>}
                </div>
              ) },
            ]} />
        </TabsContent>

        <TabsContent value="jobs" className="mt-4">
          <DataTable rows={d.jobs} empty="No jobs for this client." search={(j) => `${j.job_code} ${j.title}`}
            columns={[
              { key: "job_code", header: "Job", render: (j) => <Link to="/jobs/$id" params={{ id: j.id }} className="font-mono text-xs text-primary hover:underline">{j.job_code}</Link> },
              { key: "title", header: "Title" },
              { key: "due", header: "Due", sort: (j) => j.due_date ?? "", render: (j) => fmtDate(j.due_date) },
              { key: "net", header: "Net", align: "right", render: (j) => isFinance ? inr(j.net_amount) : "—" },
              { key: "st", header: "Status", render: (j) => <StatusBadge status={jobDisplayStatus(j)} /> },
              {
                key: "fs",
                header: "Billing",
                render: (j) => {
                  const inv = (j.invoice_items as Array<{ invoice_id: string; invoices: { id: string; invoice_no: string; status: string } | null }> | null)?.[0]?.invoices;
                  if (inv) {
                    return (
                      <Link
                        to="/invoices/$id"
                        params={{ id: inv.id }}
                        className="group inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium bg-muted/60 hover:bg-muted border border-border/50 transition-colors"
                        title={`Click to open Invoice ${inv.invoice_no}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <StatusBadge status={j.financial_status === "closed" ? "paid" : (inv.status || "invoiced")} />
                        <span className="font-mono text-[11px] text-primary underline underline-offset-2 group-hover:text-primary/80">
                          {inv.invoice_no}
                        </span>
                      </Link>
                    );
                  }
                  return (
                    <div className="inline-flex items-center gap-1.5">
                      <StatusBadge status={j.financial_status} />
                      {j.auto_invoice && (
                        <span className="rounded bg-sky-500/10 px-1 py-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-400" title="Auto-invoice enabled on completion">
                          Auto
                        </span>
                      )}
                    </div>
                  );
                },
              },
            ]} />
        </TabsContent>

        {isFinance && <>
          <TabsContent value="invoices" className="mt-4"><InvTable rows={d.invoices} /></TabsContent>
          <TabsContent value="payments" className="mt-4">
            <DataTable rows={d.payments} empty="No payments from this client."
              columns={[
                { key: "payment_code", header: "Payment", className: "font-mono text-xs" },
                { key: "d", header: "Date", render: (p) => fmtDate(p.payment_date) },
                { key: "m", header: "Mode", render: (p) => MODES[p.mode] },
                { key: "reference", header: "Reference" },
                { key: "a", header: "Amount", align: "right", render: (p) => inr(p.amount) },
                { key: "al", header: "Allocated", align: "right", render: (p) => inr(p.allocated_amount) },
                { key: "s", header: "Status", render: (p) => <StatusBadge status={p.status} /> },
              ]} />
          </TabsContent>
          <TabsContent value="outstanding" className="mt-4">
            <InvTable rows={out} empty="Nothing outstanding — all settled." />
            {out.length > 0 && <div className="mt-2 text-right text-sm font-semibold">Total outstanding: {inr(out.reduce((s, i) => s + Number(i.outstanding), 0))}</div>}
          </TabsContent>
        </>}

        {isManager && (
          <TabsContent value="activity" className="mt-4">
            <DataTable
              rows={d.activity}
              empty="No activity recorded yet for this client."
              columns={[
                { key: "t", header: "Timestamp", render: (a) => fmtDateTime(a.created_at) },
                {
                  key: "user",
                  header: "Done By",
                  render: (a) => (
                    <span className="font-medium text-foreground">
                      {pname(a.user_id)}
                    </span>
                  ),
                },
                {
                  key: "action",
                  header: "Action",
                  render: (a) => (
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
                        a.action === "insert" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                        a.action === "update" && "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                        a.action === "delete" && "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                        !["insert", "update", "delete"].includes(a.action) && "bg-muted text-muted-foreground"
                      )}
                    >
                      {a.action === "insert" ? "Created" : a.action === "update" ? "Updated" : a.action === "delete" ? "Deleted" : label(a.action)}
                    </span>
                  ),
                },
                {
                  key: "module",
                  header: "Area",
                  render: (a) => <span className="capitalize">{label(a.module)}</span>,
                },
                {
                  key: "details",
                  header: "Notes / Details",
                  render: (a) =>
                    a.reason ? (
                      <span className="text-xs italic text-muted-foreground">{a.reason}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    ),
                },
              ]}
            />
          </TabsContent>
        )}
      </Tabs>

      <ClientForm open={edit} onOpenChange={setEdit} client={c} />
      <LinkServiceDialog open={link} onOpenChange={setLink} clientId={id} />
    </div>
  );
}

const fetchInv = async (id: string) => {
  const { data, error } = await supabase.from("invoices").select("*").eq("client_id", id).order("invoice_date", { ascending: false });
  if (error) throw error;
  return data;
};
const fetchPay = async (id: string) => {
  const { data, error } = await supabase.from("payments").select("*").eq("client_id", id).order("payment_date", { ascending: false });
  if (error) throw error;
  return data;
};

function InvTable({ rows, empty = "No invoices." }: { rows: Awaited<ReturnType<typeof fetchInv>>; empty?: string }) {
  return (
    <DataTable rows={rows} empty={empty}
      columns={[
        { key: "n", header: "Invoice", render: (i) => <Link to="/invoices/$id" params={{ id: i.id }} className="font-mono text-xs text-primary hover:underline">{i.invoice_no}</Link> },
        { key: "d", header: "Date", render: (i) => fmtDate(i.invoice_date) },
        { key: "dd", header: "Due", render: (i) => fmtDate(i.due_date) },
        { key: "t", header: "Total", align: "right", render: (i) => inr(i.total) },
        { key: "p", header: "Paid", align: "right", render: (i) => inr(i.amount_paid) },
        { key: "o", header: "Outstanding", align: "right", render: (i) => inr(i.outstanding) },
        { key: "s", header: "Status", render: (i) => <StatusBadge status={invoiceDisplayStatus(i)} /> },
      ]} />
  );
}

function LinkServiceDialog({ open, onOpenChange, clientId }: { open: boolean; onOpenChange: (o: boolean) => void; clientId: string }) {
  const qc = useQueryClient();
  const { data: profiles } = useProfiles();
  const svcs = useQuery({ queryKey: ["services"], queryFn: async () => (await supabase.from("services").select("*").eq("active", true).order("name")).data ?? [] });
  const [f, setF] = useState({ service_id: "", agreed_fee: "", frequency: "monthly", start_date: today(), end_date: "", due_days: "20", assigned_staff: "", notes: "", auto_invoice: false });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const pick = (sid: string) => {
    const s = svcs.data?.find((x) => x.id === sid);
    setF((p) => ({ ...p, service_id: sid, agreed_fee: s ? String(s.default_fee) : "", frequency: s?.frequency ?? p.frequency, due_days: s ? String(s.due_days) : p.due_days, auto_invoice: s?.auto_invoice ?? false }));
  };
  const save = async () => {
    if (!f.service_id) return toast.error("Choose a service");
    if (!(Number(f.agreed_fee) >= 0) || f.agreed_fee === "") return toast.error("Enter a valid fee");
    if (f.end_date && f.end_date < f.start_date) return toast.error("End date must be after start date");
    const { error } = await supabase.from("client_services").insert({
      client_id: clientId, service_id: f.service_id, agreed_fee: Number(f.agreed_fee), frequency: f.frequency,
      start_date: f.start_date, end_date: f.end_date || null, due_days: Number(f.due_days) || 0, assigned_staff: f.assigned_staff || null, notes: f.notes || null,
      auto_invoice: f.auto_invoice,
    });
    if (error) return toast.error(errMsg(error));
    toast.success("Service linked");
    qc.invalidateQueries({ queryKey: ["client360"] });
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Link Service to Client</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Service *" className="sm:col-span-2"><NativeSelect value={f.service_id} onChange={(e) => pick(e.target.value)}><option value="">Select…</option>{svcs.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></Field>
          <Field label="Agreed Fee (₹) *"><Input type="number" min={0} value={f.agreed_fee} onChange={set("agreed_fee")} /></Field>
          <Field label="Frequency"><NativeSelect value={f.frequency} onChange={set("frequency")}>{Object.entries(FREQS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Field>
          <Field label="Start Date"><Input type="date" value={f.start_date} onChange={set("start_date")} /></Field>
          <Field label="End Date"><Input type="date" value={f.end_date} onChange={set("end_date")} /></Field>
          <Field label="Due (days after period end)"><Input type="number" value={f.due_days} onChange={set("due_days")} /></Field>
          <Field label="Assigned Staff"><NativeSelect value={f.assigned_staff} onChange={set("assigned_staff")}><option value="">—</option>{profiles?.map((p) => <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>)}</NativeSelect></Field>
          <div className="sm:col-span-2 flex items-center gap-2 rounded-md border p-2.5 bg-muted/20">
            <input
              type="checkbox"
              id="dialog_link_service_auto_invoice"
              checked={f.auto_invoice}
              onChange={(e) => setF((p) => ({ ...p, auto_invoice: e.target.checked }))}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="dialog_link_service_auto_invoice" className="text-xs font-medium cursor-pointer">
              Automatically raise invoice when recurring jobs for this service are marked Completed
            </label>
          </div>
          <Field label="Notes" className="sm:col-span-2"><Input value={f.notes} onChange={set("notes")} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save}>Link</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
