import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, Receipt } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, NativeSelect } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useProfiles, useRoles } from "@/hooks/use-roles";
import {
  errMsg,
  fmtDate,
  fmtDateTime,
  inr,
  JOB_STATUSES,
  jobDisplayStatus,
  label,
} from "@/lib/format";

export const Route = createFileRoute("/_authenticated/jobs/$id")({
  head: () => ({
    meta: [
      { title: "Job — CA PracticeDesk" },
      { name: "description", content: "Job details and status history." },
    ],
  }),
  component: JobDetail,
});

function JobDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isFinance } = useRoles();
  const { data: profiles } = useProfiles();
  const pname = (u: string | null) => profiles?.find((p) => p.id === u)?.full_name ?? "System";
  const q = useQuery({
    queryKey: ["job", id],
    queryFn: async () => {
      const [j, h] = await Promise.all([
        supabase
          .from("jobs")
          .select(
            "*, clients(name), services(name), invoice_items(invoice_id, invoices(id, invoice_no, status, total, amount_paid, outstanding, invoice_date))",
          )
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("job_status_history")
          .select("*")
          .eq("job_id", id)
          .order("changed_at", { ascending: false }),
      ]);
      if (j.error) throw j.error;
      return { job: j.data, history: h.data ?? [] };
    },
  });
  const [status, setStatus] = useState("");
  const [reason, setReason] = useState("");
  const [edit, setEdit] = useState({
    due_date: "",
    assigned_staff: "",
    notes: "",
    fee: "",
    discount: "",
    auto_invoice: false,
  });
  const [raising, setRaising] = useState(false);
  const job = q.data?.job;
  useEffect(() => {
    if (job) {
      setStatus(job.status);
      setEdit({
        due_date: job.due_date ?? "",
        assigned_staff: job.assigned_staff ?? "",
        notes: job.notes ?? "",
        fee: String(job.fee),
        discount: String(job.discount),
        auto_invoice: job.auto_invoice ?? false,
      });
    }
  }, [job]);

  if (q.isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!job)
    return (
      <div className="space-y-4">
        <Link
          to="/jobs"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Jobs</span>
        </Link>
        <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">
          Job not found or not accessible.
        </div>
      </div>
    );

  const updateStatus = async () => {
    if (status === job.status) return;
    const { error } = await supabase.rpc("update_job_status", {
      _job_id: id,
      _status: status,
      _reason: reason,
    });
    if (error) return toast.error(errMsg(error));
    toast.success("Status updated");
    setReason("");
    qc.invalidateQueries();
  };

  const raiseInvoiceNow = async () => {
    setRaising(true);
    const { data: invId, error } = await supabase.rpc("auto_invoice_job", { _job_id: id });
    setRaising(false);
    if (error) return toast.error(errMsg(error));
    toast.success("Invoice generated successfully!", {
      action: invId
        ? {
            label: "Open Invoice",
            onClick: () => navigate({ to: "/invoices/$id", params: { id: invId } }),
          }
        : undefined,
    });
    qc.invalidateQueries();
  };

  const saveEdit = async () => {
    const fee = Number(edit.fee),
      disc = Number(edit.discount);
    if (
      job.financial_status !== "open" &&
      (fee !== Number(job.fee) || disc !== Number(job.discount))
    )
      return toast.error("Fee can't change after invoicing — adjust via the invoice");
    if (disc > fee || disc < 0) return toast.error("Discount must be between 0 and fee");
    const { error } = await supabase
      .from("jobs")
      .update({
        due_date: edit.due_date || null,
        assigned_staff: edit.assigned_staff || null,
        notes: edit.notes || null,
        fee,
        discount: disc,
        auto_invoice: edit.auto_invoice,
      })
      .eq("id", id);
    if (error) return toast.error(errMsg(error));
    toast.success("Job saved");
    qc.invalidateQueries();
  };

  const inv = (
    job.invoice_items as Array<{
      invoice_id: string;
      invoices: {
        id: string;
        invoice_no: string;
        status: string;
        total: number;
        amount_paid: number;
        outstanding: number;
        invoice_date: string;
      } | null;
    }> | null
  )?.[0]?.invoices;

  return (
    <div>
      <div className="mb-4">
        <Link
          to="/jobs"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Jobs</span>
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="shadow-none">
            <CardContent className="p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">{job.job_code}</span>
                <StatusBadge status={jobDisplayStatus(job)} />
                {inv ? (
                  <Link
                    to="/invoices/$id"
                    params={{ id: inv.id }}
                    className="group inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium bg-muted/70 hover:bg-muted border border-border/60 transition-colors"
                    title="Click to view linked invoice"
                  >
                    <StatusBadge
                      status={job.financial_status === "closed" ? "paid" : inv.status || "invoiced"}
                    />
                    <span className="font-mono text-[11px] text-primary underline underline-offset-2">
                      {inv.invoice_no}
                    </span>
                    <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-primary" />
                  </Link>
                ) : (
                  <div className="inline-flex items-center gap-1.5">
                    <StatusBadge status={job.financial_status} />
                    {job.auto_invoice && (
                      <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-400">
                        Auto-Invoice ON
                      </span>
                    )}
                  </div>
                )}
              </div>
              <h1 className="mt-1 text-2xl font-semibold">{job.title}</h1>
              <Link
                to="/clients/$id"
                params={{ id: job.client_id }}
                className="text-sm text-primary hover:underline"
              >
                {job.clients?.name}
              </Link>

              {inv && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Linked Invoice
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-foreground">
                        {inv.invoice_no}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        · Date: {fmtDate(inv.invoice_date)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        · Total:{" "}
                        <span className="font-medium text-foreground">{inr(inv.total)}</span>
                      </span>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/invoices/$id" params={{ id: inv.id }}>
                      Open Invoice
                      <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              )}

              {!inv && job.financial_status === "open" && isFinance && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
                  <div className="space-y-0.5">
                    <div className="text-xs font-medium text-muted-foreground">
                      {job.auto_invoice
                        ? "⚡ Auto-invoicing is enabled for this job. Marking it completed will instantly generate an invoice."
                        : "This job is currently unbilled."}
                    </div>
                  </div>
                  {job.status === "completed" && (
                    <Button size="sm" onClick={raiseInvoiceNow} disabled={raising}>
                      <Receipt className="mr-1.5 h-4 w-4" />
                      {raising ? "Raising..." : "Generate Invoice Now"}
                    </Button>
                  )}
                </div>
              )}

              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
                <div>
                  <div className="text-xs text-muted-foreground">Service</div>
                  {job.services?.name}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Period</div>
                  {fmtDate(job.period_start)} → {fmtDate(job.period_end)}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Due</div>
                  {fmtDate(job.due_date)}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Created</div>
                  {fmtDate(job.created_at)}
                </div>
                {isFinance && (
                  <>
                    <div>
                      <div className="text-xs text-muted-foreground">Fee</div>
                      {inr(job.fee)}
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Discount</div>
                      {inr(job.discount)}
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Net Amount</div>
                      <span className="font-semibold">{inr(job.net_amount)}</span>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
          {isFinance && (
            <Card className="shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Edit Job</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <Field label="Fee (₹)">
                  <Input
                    type="number"
                    value={edit.fee}
                    disabled={job.financial_status !== "open"}
                    onChange={(e) => setEdit({ ...edit, fee: e.target.value })}
                  />
                </Field>
                <Field label="Discount (₹)">
                  <Input
                    type="number"
                    value={edit.discount}
                    disabled={job.financial_status !== "open"}
                    onChange={(e) => setEdit({ ...edit, discount: e.target.value })}
                  />
                </Field>
                <Field label="Due Date">
                  <Input
                    type="date"
                    value={edit.due_date}
                    onChange={(e) => setEdit({ ...edit, due_date: e.target.value })}
                  />
                </Field>
                <Field label="Assigned Staff">
                  <NativeSelect
                    value={edit.assigned_staff}
                    onChange={(e) => setEdit({ ...edit, assigned_staff: e.target.value })}
                  >
                    <option value="">—</option>
                    {profiles?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name ?? p.email}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <div className="sm:col-span-2 flex items-center gap-2 rounded-md border p-2.5 bg-muted/20">
                  <input
                    type="checkbox"
                    id="edit_job_auto_invoice"
                    checked={edit.auto_invoice}
                    onChange={(e) => setEdit({ ...edit, auto_invoice: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <label
                    htmlFor="edit_job_auto_invoice"
                    className="text-xs font-medium cursor-pointer"
                  >
                    Automatically raise invoice when this job is marked Completed
                  </label>
                </div>
                <Field label="Notes" className="sm:col-span-2">
                  <Textarea
                    rows={2}
                    value={edit.notes}
                    onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Button onClick={saveEdit}>Save changes</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card className="shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Update Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)}>
                {JOB_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ))}
              </NativeSelect>
              <Textarea
                placeholder="Reason (optional)"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <Button className="w-full" disabled={status === job.status} onClick={updateStatus}>
                Update
              </Button>
            </CardContent>
          </Card>
          <Card className="shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Status History</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="relative ml-2 border-l">
                {q.data!.history.map((h) => (
                  <li key={h.id} className="mb-4 ml-4">
                    <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-card bg-primary" />
                    <div className="text-sm">
                      {h.old_status ? <>{label(h.old_status)} → </> : null}
                      <span className="font-medium">{label(h.new_status)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {pname(h.changed_by)} · {fmtDateTime(h.changed_at)}
                    </div>
                    {h.reason && (
                      <div className="text-xs italic text-muted-foreground">{h.reason}</div>
                    )}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
