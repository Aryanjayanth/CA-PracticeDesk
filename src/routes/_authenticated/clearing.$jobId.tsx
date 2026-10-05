import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Section, Field, PageHeader, ReasonDialog } from "@/components/app/common";
import { useRoles } from "@/hooks/use-roles";
import { errMsg, fmtDate, fmtDateTime, inr, MODES } from "@/lib/format";
import {
  CLEARING_LINES,
  clearingLabel,
  computeFinal,
  isWorkflow,
  STAGES,
  type JobWorkflow,
} from "@/lib/job-workflow";

export const Route = createFileRoute("/_authenticated/clearing/$jobId")({
  head: () => ({
    meta: [
      { title: "Payment Clearing — CA PracticeDesk" },
      {
        name: "description",
        content: "Clear and square off a job payment before invoicing.",
      },
    ],
  }),
  component: JobClearingPage,
});

type Draft = {
  advance: string;
  tds_tcs: string;
  discount: string;
  other_deduction: string;
  other_addition: string;
  notes: string;
};

const num = (v: string) => (Number.isFinite(Number(v)) && v !== "" ? Number(v) : 0);
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** CLEARING_LINES names the discount "clearing_discount"; the draft calls it "discount". */
const draftKey = (k: string) => (k === "clearing_discount" ? "discount" : k) as keyof Draft;

const fromWorkflow = (w: JobWorkflow): Draft => ({
  advance: str(w.advance),
  tds_tcs: str(w.tds_tcs),
  discount: str(w.clearing_discount),
  other_deduction: str(w.other_deduction),
  other_addition: str(w.other_addition),
  notes: "",
});

function JobClearingPage() {
  const { jobId } = Route.useParams();
  const { isFinance } = useRoles();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [reopen, setReopen] = useState(false);

  const wq = useQuery({
    queryKey: ["job-workflow", jobId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("job_workflow", {
        _job_id: jobId,
      });
      if (error) throw error;
      if (!isWorkflow(data)) throw new Error("Unexpected workflow response");
      return data;
    },
  });

  const jobQ = useQuery({
    queryKey: ["job", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,job_code,title,status,due_date,fee,discount")
        .eq("id", jobId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const clientQ = useQuery({
    queryKey: ["job-client", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("client:clients(id,client_code,name)")
        .eq("id", jobId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const payQ = useQuery({
    queryKey: ["job-payments", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("id,payment_code,amount,mode,payment_date,status,allocated_amount,reference")
        .eq("job_id", jobId)
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const historyQ = useQuery({
    queryKey: ["job-history", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_status_history")
        .select("id,old_status,new_status,reason,changed_at")
        .eq("job_id", jobId)
        .order("changed_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  const w = wq.data;

  // Seed the form once, then leave the user's edits alone.
  useEffect(() => {
    if (w && draft === null) setDraft(fromWorkflow(w));
  }, [w, draft]);

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const { error } = await supabase.rpc("save_job_clearing", {
        _job_id: jobId,
        _advance: num(d.advance),
        _tds_tcs: num(d.tds_tcs),
        _discount: num(d.discount),
        _other_deduction: num(d.other_deduction),
        _other_addition: num(d.other_addition),
        _notes: d.notes.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Clearing saved");
      setDraft(null);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) return toast.error(errMsg(error));
    toast.success(ok);
    setDraft(null);
    qc.invalidateQueries();
  };

  if (wq.isLoading || jobQ.isLoading || !w || !jobQ.data || !draft)
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        Loading payment clearing…
      </div>
    );

  if (wq.isError)
    return <div className="py-10 text-center text-sm text-destructive">{errMsg(wq.error)}</div>;

  const job = jobQ.data;
  const locked = w.clearing_status !== "draft" || !isFinance;
  const client = (clientQ.data as { client?: { client_code: string; name: string } } | null)
    ?.client;

  const preview = computeFinal({
    gross_fee: Number(w.gross_fee),
    job_discount: Number(w.job_discount),
    advance: num(draft.advance),
    tds_tcs: num(draft.tds_tcs),
    clearing_discount: num(draft.discount),
    other_deduction: num(draft.other_deduction),
    other_addition: num(draft.other_addition),
  });

  return (
    <div>
      <PageHeader
        title={`Payment Clearing — ${w.job_code}`}
        subtitle={client ? `${client.client_code} · ${client.name} · ${job.title}` : job.title}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => navigate({ to: "/jobs/$id", params: { id: jobId } })}
            >
              Back to job
            </Button>
            {w.invoice_available && (
              <Button onClick={() => navigate({ to: "/invoices", search: { job: jobId } })}>
                Create invoice
              </Button>
            )}
          </div>
        }
      />

      {w.invoice_id ? (
        <div className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950/40">
          Invoice <span className="font-mono font-semibold">{w.invoice_no}</span> already exists for
          this job. Further clearing changes are blocked to keep the raised document and its ledger
          consistent.
        </div>
      ) : w.overdue ? (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          <span className="font-semibold">Payment overdue.</span> The due date was{" "}
          {fmtDate(w.due_date)} and the job has not been squared off.
        </div>
      ) : null}

      {/* ---- A. Workflow position ------------------------------------------ */}
      <Section
        title="Workflow"
        hint="An invoice can only be raised once the last two stages are done."
      >
        <ol className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {STAGES.map((s, i) => {
            const done = w.stages[s.key];
            const stamp = s.stamp?.(w);
            return (
              <li
                key={s.key}
                className={`rounded-lg border p-3 text-xs ${
                  done
                    ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                    : "bg-muted/40 text-muted-foreground"
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  <span
                    className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                      done ? "bg-emerald-600 text-white" : "bg-muted-foreground/30"
                    }`}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  {s.label}
                </div>
                {stamp && <div className="mt-1 opacity-70">{fmtDate(stamp)}</div>}
              </li>
            );
          })}
        </ol>
        {!w.invoice_available && w.blocked_reason && (
          <p className="text-sm text-muted-foreground">{w.blocked_reason}</p>
        )}
      </Section>

      {/* ---- B. Clearing sheet --------------------------------------------- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section
            title="Clearing"
            hint="Adjustments are applied to the gross job fee. The server recomputes the total on save, so these figures cannot drift."
          >
            {w.clearing_status !== "draft" && (
              <div className="mb-3 rounded-lg border bg-muted/40 p-3 text-xs">
                This clearing is{" "}
                <span className="font-semibold">{clearingLabel(w.clearing_status)}</span>{" "}
                {w.squared_off_at
                  ? `on ${fmtDateTime(w.squared_off_at)}`
                  : w.cleared_at
                    ? `on ${fmtDateTime(w.cleared_at)}`
                    : ""}
                . Reopen it from the audit trail to make changes.
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() => setReopen(true)}
                >
                  Reopen
                </Button>
              </div>
            )}

            <div className="space-y-4">
              <div className="flex items-baseline justify-between border-b pb-2">
                <span className="text-sm">Gross job fee</span>
                <span className="font-mono text-lg">{inr(w.gross_fee)}</span>
              </div>

              {CLEARING_LINES.map((line) => (
                <Field key={line.key} label={line.label} hint={line.hint}>
                  <div className="flex items-center gap-2">
                    <span className="w-4 font-mono text-muted-foreground">
                      {line.sign === -1 ? "(–)" : "(+)"}
                    </span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      disabled={locked}
                      value={draft[draftKey(line.key)]}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          [draftKey(line.key)]: e.target.value,
                        })
                      }
                      className="text-right font-mono"
                    />
                  </div>
                </Field>
              ))}

              {Number(w.job_discount) > 0 && (
                <div className="flex items-baseline justify-between text-sm text-muted-foreground">
                  <span>Job-level discount (fixed at job creation)</span>
                  <span className="font-mono">(–) {inr(w.job_discount)}</span>
                </div>
              )}

              <div className="flex items-baseline justify-between border-t pt-3">
                <span className="font-semibold">Final amount payable</span>
                <span className="font-mono text-xl font-semibold">{inr(preview)}</span>
              </div>

              <Field label="Clearing notes">
                <Input
                  disabled={locked}
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  placeholder="Reference to the bank advice or settlement note"
                />
              </Field>

              {!locked && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={save.isPending}
                    onClick={() => save.mutate(draft)}
                  >
                    Save draft
                  </Button>
                  {w.clearing_status === "draft" && (
                    <Button
                      disabled={busy || save.isPending || preview <= 0}
                      onClick={() =>
                        run(async () => {
                          await save.mutateAsync(draft);
                          return supabase.rpc("mark_job_cleared", {
                            _job_id: jobId,
                            _notes: draft.notes.trim(),
                          });
                        }, "Payment cleared")
                      }
                    >
                      Mark payment cleared
                    </Button>
                  )}
                  {w.clearing_status === "cleared" && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        run(
                          () =>
                            supabase.rpc("sq_off_job_clearing", {
                              _job_id: jobId,
                              _notes: draft.notes.trim(),
                            }),
                          "Payment squared off — invoice is now unlocked",
                        )
                      }
                    >
                      Square off payment
                    </Button>
                  )}
                </div>
              )}
              {!isFinance && (
                <p className="text-xs text-muted-foreground">
                  Only finance users can clear or square off a payment.
                </p>
              )}
            </div>
          </Section>
        </div>

        {/* ---- C. Side column ---------------------------------------------- */}
        <div className="space-y-4">
          <Section title="Related records">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Job</dt>
                <dd className="font-mono">{w.job_code}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Due date</dt>
                <dd>{fmtDate(w.due_date)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Job status</dt>
                <dd>{w.job_status.replace(/_/g, " ")}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Clearing</dt>
                <dd>{clearingLabel(w.clearing_status)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Invoice</dt>
                <dd className="font-mono">
                  {w.invoice_no ?? <span className="text-muted-foreground">Not yet created</span>}
                </dd>
              </div>
            </dl>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => navigate({ to: "/jobs/$id", params: { id: jobId } })}
            >
              Open job
            </Button>
          </Section>

          <Section
            title={`Payments (${w.payment_count})`}
            hint="Payments are recorded against the job, then cleared here."
          >
            {payQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !payQ.data?.length ? (
              <p className="text-sm text-muted-foreground">
                No payment recorded against this job yet.
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {payQ.data.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2">
                    <div>
                      <div className="font-mono text-xs">{p.payment_code}</div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDate(p.payment_date)} · {MODES[p.mode] ?? p.mode}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono">{inr(p.amount)}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.status.replace(/_/g, " ")}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => navigate({ to: "/payments" })}
            >
              Record a payment
            </Button>
          </Section>

          <Section title="Audit trail">
            {historyQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !historyQ.data?.length ? (
              <p className="text-sm text-muted-foreground">No status changes yet.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {historyQ.data.map((h) => (
                  <li key={h.id} className="border-l-2 pl-2">
                    <div className="font-medium">
                      {h.old_status ?? "new"} → {h.new_status}
                    </div>
                    <div className="text-muted-foreground">
                      {fmtDateTime(h.changed_at)}
                      {h.reason ? ` · ${h.reason}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      <div className="mt-6" />
      <ReasonDialog
        open={reopen}
        onOpenChange={setReopen}
        title="Reopen clearing"
        description="Reopening discards the cleared/squared-off state so the figures can be edited. The reason is written to the audit log."
        confirmLabel="Reopen clearing"
        onConfirm={async (reason) => {
          const { error } = await supabase.rpc("reopen_job_clearing", {
            _job_id: jobId,
            _reason: reason,
          });
          if (error) {
            toast.error(errMsg(error));
            return;
          }
          toast.success("Clearing reopened");
          setReopen(false);
          qc.invalidateQueries();
        }}
      />
    </div>
  );
}
