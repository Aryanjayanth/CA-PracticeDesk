import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable } from "@/components/app/DataTable";
import { Field, NativeSelect, NoAccess, PageHeader } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useClientLookup, useRoles } from "@/hooks/use-roles";
import { errMsg, fmtDate, inr, invoiceDisplayStatus, label, today } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/invoices/")({
  head: () => ({ meta: [{ title: "Invoices — CA PracticeDesk" }, { name: "description", content: "Billing and invoices." }] }),
  component: InvoicesPage,
});

function InvoicesPage() {
  const { isFinance, loading } = useRoles();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["invoices"], enabled: isFinance,
    queryFn: async () => {
      const { data, error } = await supabase.from("invoices").select("*, clients(name)").order("invoice_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  if (loading) return null;
  if (!isFinance) return <NoAccess />;
  const rows = (q.data ?? []).filter((i) => !status || invoiceDisplayStatus(i) === status);
  return (
    <div>
      <PageHeader title="Invoices" subtitle="Bills raised to clients" actions={<Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />Create Invoice</Button>} />
      <DataTable rows={rows} loading={q.isLoading} empty="No invoices yet." search={(i) => `${i.invoice_no} ${i.clients?.name} ${i.description}`}
        onRowClick={(i) => navigate({ to: "/invoices/$id", params: { id: i.id } })}
        toolbar={<NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="w-40"><option value="">All statuses</option>{["draft", "unpaid", "partially_paid", "paid", "overdue", "cancelled"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</NativeSelect>}
        columns={[
          { key: "n", header: "Invoice", sort: (i) => i.invoice_no, render: (i) => <Link to="/invoices/$id" params={{ id: i.id }} className="font-mono text-xs text-primary">{i.invoice_no}</Link> },
          { key: "c", header: "Client", sort: (i) => i.clients?.name ?? "", render: (i) => <span className="font-medium">{i.clients?.name}</span> },
          { key: "d", header: "Date", sort: (i) => i.invoice_date, render: (i) => fmtDate(i.invoice_date) },
          { key: "dd", header: "Due", sort: (i) => i.due_date, render: (i) => fmtDate(i.due_date) },
          { key: "s", header: "Subtotal", align: "right", render: (i) => inr(i.subtotal) },
          { key: "disc", header: "Discount", align: "right", render: (i) => (Number(i.discount) ? inr(i.discount) : "—") },
          { key: "t", header: "Total", align: "right", sort: (i) => Number(i.total), render: (i) => inr(i.total) },
          { key: "p", header: "Paid", align: "right", render: (i) => inr(i.amount_paid) },
          { key: "o", header: "Outstanding", align: "right", sort: (i) => Number(i.outstanding), render: (i) => <span className="font-medium">{inr(i.outstanding)}</span> },
          { key: "st", header: "Status", render: (i) => <StatusBadge status={invoiceDisplayStatus(i)} /> },
        ]} />
      <CreateInvoice open={open} onOpenChange={setOpen} />
    </div>
  );
}

function CreateInvoice({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: clients } = useClientLookup();
  const settings = useQuery({ queryKey: ["settings"], queryFn: async () => (await supabase.from("settings").select("*").maybeSingle()).data });
  const [clientId, setClientId] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [f, setF] = useState({ invoice_date: today(), due_date: new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10), discount: "0", discount_reason: "", tax_rate: "", notes: "", extra_desc: "", extra_amount: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const jobs = useQuery({
    queryKey: ["uninvoiced-jobs", clientId], enabled: !!clientId,
    queryFn: async () => (await supabase.from("jobs").select("id,job_code,title,net_amount,status").eq("client_id", clientId).eq("financial_status", "open").neq("status", "cancelled").order("due_date")).data ?? [],
  });
  const taxRate = f.tax_rate === "" ? Number(settings.data?.default_tax_rate ?? 0) : Number(f.tax_rate);
  const sub = (jobs.data ?? []).filter((j) => sel.includes(j.id)).reduce((s, j) => s + Number(j.net_amount), 0) + Number(f.extra_amount || 0);
  const disc = Number(f.discount || 0);
  const tax = Math.round((sub - disc) * taxRate) / 100;
  const total = sub - disc + tax;

  const save = async () => {
    if (!clientId) return toast.error("Choose a client");
    if (sub <= 0) return toast.error("Select at least one job or add a line amount");
    if (disc < 0 || disc > sub) return toast.error("Discount must be between 0 and subtotal");
    if (disc > 0 && !f.discount_reason.trim()) return toast.error("Discount reason is required");
    if (f.due_date < f.invoice_date) return toast.error("Due date must be after invoice date");
    const { data, error } = await supabase.rpc("create_invoice", {
      _client_id: clientId, _job_ids: sel, _invoice_date: f.invoice_date, _due_date: f.due_date, _discount: disc, _discount_reason: f.discount_reason,
      _tax_rate: taxRate, _notes: f.notes, _extra_desc: f.extra_desc, _extra_amount: Number(f.extra_amount || 0),
    });
    if (error) return toast.error(errMsg(error));
    toast.success("Invoice created");
    qc.invalidateQueries();
    onOpenChange(false);
    setSel([]); setClientId("");
    if (data) navigate({ to: "/invoices/$id", params: { id: data } });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create Invoice</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Client *" className="sm:col-span-3"><NativeSelect value={clientId} onChange={(e) => { setClientId(e.target.value); setSel([]); }}><option value="">Select…</option>{clients?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
          <Field label="Invoice Date"><Input type="date" value={f.invoice_date} onChange={set("invoice_date")} /></Field>
          <Field label="Due Date"><Input type="date" value={f.due_date} onChange={set("due_date")} /></Field>
          <Field label="GST %"><Input type="number" placeholder={String(settings.data?.default_tax_rate ?? 0)} value={f.tax_rate} onChange={set("tax_rate")} /></Field>
        </div>
        {clientId && (
          <div className="rounded-md border">
            <div className="border-b bg-muted/50 px-3 py-2 text-xs font-medium uppercase text-muted-foreground">Uninvoiced jobs</div>
            {(jobs.data ?? []).length === 0 ? <div className="p-4 text-center text-sm text-muted-foreground">No uninvoiced jobs for this client.</div> :
              jobs.data!.map((j) => (
                <label key={j.id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-0 hover:bg-muted/40">
                  <Checkbox checked={sel.includes(j.id)} onCheckedChange={(c) => setSel((s) => (c ? [...s, j.id] : s.filter((x) => x !== j.id)))} />
                  <span className="font-mono text-xs text-muted-foreground">{j.job_code}</span><span className="flex-1">{j.title}</span><StatusBadge status={j.status} /><span className="tabular-nums">{inr(j.net_amount)}</span>
                </label>
              ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Additional line" className="sm:col-span-2"><Input placeholder="e.g. Consultation charges" value={f.extra_desc} onChange={set("extra_desc")} /></Field>
          <Field label="Amount (₹)"><Input type="number" min={0} value={f.extra_amount} onChange={set("extra_amount")} /></Field>
          <Field label="Discount (₹)"><Input type="number" min={0} value={f.discount} onChange={set("discount")} /></Field>
          <Field label="Discount Reason" className="sm:col-span-2"><Input value={f.discount_reason} onChange={set("discount_reason")} /></Field>
          <Field label="Notes" className="sm:col-span-3"><Input value={f.notes} onChange={set("notes")} /></Field>
        </div>
        <div className="ml-auto w-64 space-y-1 text-sm">
          <Row k="Subtotal" v={inr(sub)} /><Row k="Discount" v={`− ${inr(disc)}`} /><Row k={`GST @ ${taxRate}%`} v={inr(tax)} />
          <div className="flex justify-between border-t pt-1 font-semibold"><span>Total</span><span>{inr(total)}</span></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save}>Create Invoice</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
const Row = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between text-muted-foreground"><span>{k}</span><span className="tabular-nums">{v}</span></div>;
