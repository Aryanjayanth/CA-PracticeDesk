import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Printer, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { NoAccess, ReasonDialog } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useRoles } from "@/hooks/use-roles";
import { errMsg, fmtDate, inr, invoiceDisplayStatus, MODES } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/invoices/$id")({
  head: () => ({ meta: [{ title: "Invoice — CA PracticeDesk" }, { name: "description", content: "Invoice preview." }] }),
  component: InvoiceView,
});

function words(n: number): string {
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number) => (x < 20 ? a[x] : `${b[Math.floor(x / 10)]} ${a[x % 10]}`.trim());
  const three = (x: number) => (x >= 100 ? `${a[Math.floor(x / 100)]} Hundred ${two(x % 100)}`.trim() : two(x));
  n = Math.floor(n);
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const cr = Math.floor(n / 1e7); n %= 1e7;
  const lk = Math.floor(n / 1e5); n %= 1e5;
  const th = Math.floor(n / 1e3); n %= 1e3;
  if (cr) parts.push(`${three(cr)} Crore`);
  if (lk) parts.push(`${two(lk)} Lakh`);
  if (th) parts.push(`${two(th)} Thousand`);
  if (n) parts.push(three(n));
  return parts.join(" ");
}

function InvoiceView() {
  const { id } = Route.useParams();
  const { isFinance, loading } = useRoles();
  const qc = useQueryClient();
  const [cancel, setCancel] = useState(false);
  const q = useQuery({
    queryKey: ["invoice", id], enabled: isFinance,
    queryFn: async () => {
      const [i, items, al, disc, s] = await Promise.all([
        supabase.from("invoices").select("*, clients(*)").eq("id", id).maybeSingle(),
        supabase.from("invoice_items").select("*, jobs(job_code, services(sac_code))").eq("invoice_id", id),
        supabase.from("payment_allocations").select("*, payments(payment_code, payment_date, mode, reference)").eq("invoice_id", id).order("created_at"),
        supabase.from("discounts").select("*").eq("invoice_id", id),
        supabase.from("settings").select("*").maybeSingle(),
      ]);
      if (i.error) throw i.error;
      return { inv: i.data, items: items.data ?? [], allocs: al.data ?? [], discounts: disc.data ?? [], settings: s.data };
    },
  });
  if (loading) return null;
  if (!isFinance) return <NoAccess />;
  if (q.isLoading) return <div className="text-muted-foreground">Loading…</div>;
  const d = q.data;
  if (!d?.inv) return <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">Invoice not found.</div>;
  const { inv, settings } = d;
  const c = inv.clients!;

  const doCancel = async (reason: string) => {
    const { error } = await supabase.rpc("cancel_invoice", { _invoice_id: id, _reason: reason });
    if (error) { toast.error(errMsg(error)); throw error; }
    toast.success("Invoice cancelled");
    qc.invalidateQueries();
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><Link to="/invoices" className="text-sm text-primary hover:underline">← Invoices</Link><StatusBadge status={invoiceDisplayStatus(inv)} /></div>
        <div className="flex gap-2">
          {inv.status !== "cancelled" && <Button variant="outline" className="text-destructive" onClick={() => setCancel(true)}><XCircle className="mr-1 h-4 w-4" />Cancel Invoice</Button>}
          <Button onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />Print / PDF</Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-8 text-sm print:border-0 print:p-0">
        <div className="flex justify-between border-b pb-4">
          <div>
            <div className="text-lg font-bold">{settings?.firm_name}</div>
            <div className="whitespace-pre-line text-muted-foreground">{settings?.address}</div>
            {settings?.gstin && <div>GSTIN: {settings.gstin}</div>}
            {settings?.pan && <div>PAN: {settings.pan}</div>}
          </div>
          <div className="text-right">
            <div className="text-xl font-semibold tracking-wide">TAX INVOICE</div>
            <div className="mt-1">No: <span className="font-mono">{inv.invoice_no}</span></div>
            <div>Date: {fmtDate(inv.invoice_date)}</div>
            <div>Due: {fmtDate(inv.due_date)}</div>
            {inv.status === "cancelled" && <div className="mt-1 font-bold text-destructive">CANCELLED</div>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 border-b py-4">
          <div>
            <div className="text-xs uppercase text-muted-foreground">Bill To</div>
            <div className="font-semibold">{c.name}</div>
            <div className="text-muted-foreground">{c.address}</div>
            {c.gstin && <div>GSTIN: {c.gstin}</div>}{c.pan && <div>PAN: {c.pan}</div>}
          </div>
          <div className="text-right text-muted-foreground">{c.email}<br />{c.mobile}</div>
        </div>
        <table className="my-4 w-full">
          <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="py-2">#</th><th>Description</th><th>SAC</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {d.items.map((it, idx) => (
              <tr key={it.id} className="border-b"><td className="py-2">{idx + 1}</td><td>{it.description}{it.jobs?.job_code && <span className="ml-2 text-xs text-muted-foreground">({it.jobs.job_code})</span>}</td><td>{it.jobs?.services?.sac_code ?? "998221"}</td><td className="text-right tabular-nums">{inr(it.amount)}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="ml-auto w-72 space-y-1">
          <R k="Subtotal" v={inr(inv.subtotal)} />
          {Number(inv.discount) > 0 && <R k="Less: Discount" v={`− ${inr(inv.discount)}`} />}
          {Number(inv.tax_rate) > 0 && <><R k={`CGST @ ${Number(inv.tax_rate) / 2}%`} v={inr(Number(inv.tax_amount) / 2)} /><R k={`SGST @ ${Number(inv.tax_rate) / 2}%`} v={inr(Number(inv.tax_amount) / 2)} /></>}
          <div className="flex justify-between border-t pt-1 text-base font-bold"><span>Total</span><span>{inr(inv.total)}</span></div>
          <R k="Amount Paid" v={inr(inv.amount_paid)} />
          <div className="flex justify-between font-semibold"><span>Balance Due</span><span>{inr(inv.outstanding)}</span></div>
        </div>
        <div className="mt-4 text-xs"><span className="text-muted-foreground">Amount in words:</span> Rupees {words(Number(inv.total))} Only</div>
        {inv.notes && <div className="mt-2 text-xs text-muted-foreground">Notes: {inv.notes}</div>}
        {settings?.bank_details && <div className="mt-2 whitespace-pre-line text-xs">Bank: {settings.bank_details}</div>}
        <div className="mt-6 flex justify-between text-xs text-muted-foreground"><span /><span>For {settings?.firm_name}<br /><br />Authorised Signatory</span></div>
      </div>

      <div className="no-print mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold">Payments applied</h3>
          {d.allocs.length === 0 ? <p className="text-sm text-muted-foreground">No payments applied yet.</p> : d.allocs.map((a) => (
            <div key={a.id} className="flex justify-between border-b py-1.5 text-sm last:border-0">
              <span className={a.reversed ? "line-through text-muted-foreground" : ""}>{a.payments?.payment_code} · {fmtDate(a.payments?.payment_date)} · {MODES[a.payments?.mode ?? "other"]}</span>
              <span className="tabular-nums">{inr(a.amount)}{a.reversed && <span className="ml-1 text-xs text-destructive">reversed</span>}</span>
            </div>
          ))}
        </div>
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold">Discount record</h3>
          {d.discounts.length === 0 ? <p className="text-sm text-muted-foreground">No discount applied.</p> : d.discounts.map((x) => (
            <div key={x.id} className="text-sm">Original {inr(x.original_amount)} − Discount {inr(x.discount_amount)} = Net {inr(x.net_amount)}<div className="text-xs text-muted-foreground">{x.reason} · {fmtDate(x.created_at)}</div></div>
          ))}
          {inv.cancel_reason && <div className="mt-2 text-sm text-destructive">Cancelled: {inv.cancel_reason}</div>}
        </div>
      </div>
      <ReasonDialog open={cancel} onOpenChange={setCancel} title="Cancel invoice?" description="The invoice stays on record as Cancelled and its jobs become billable again." confirmLabel="Cancel Invoice" destructive onConfirm={doCancel} />
    </div>
  );
}
const R = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between"><span className="text-muted-foreground">{k}</span><span className="tabular-nums">{v}</span></div>;
