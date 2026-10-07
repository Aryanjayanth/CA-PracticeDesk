import { createFileRoute, Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/app/DataTable";
import { ClientSelect, Field, NativeSelect, PageHeader, ReasonDialog } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useClientLookup } from "@/hooks/use-roles";
import { usePermissions } from "@/hooks/use-permissions";
import { readList } from "@/lib/supabase-read";
import { errMsg, fmtDate, inr, MODES, today } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/payments")({
  head: () => ({
    meta: [
      { title: "Payment Entry — CA PracticeDesk" },
      { name: "description", content: "Record payments received." },
    ],
  }),
  component: PaymentsPage,
});

const empty = {
  job_id: "",
  amount: "",
  mode: "upi",
  payment_date: today(),
  reference: "",
  narration: "",
};

function PaymentsPage() {
  const navigate = useNavigate();
  const { user } = useRouteContext({ from: "/_authenticated" });
  const { canCreate, canEdit, canSeeAmounts } = usePermissions();
  const qc = useQueryClient();
  const { data: clients } = useClientLookup();
  const { data: jobs } = useQuery({
    queryKey: ["job-lookup"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,job_code,title,client_id,status,due_date")
        .neq("status", "cancelled")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const [clientId, setClientId] = useState("");
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [rev, setRev] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const clientJobs = useMemo(() => {
    if (!clientId) return [];
    return (jobs ?? []).filter((j) => j.client_id === clientId);
  }, [jobs, clientId]);

  const handleClientChange = (id: string) => {
    setClientId(id);
    setF((prev) => ({ ...prev, job_id: "" }));
  };

  // Read through the RPC rather than the table: it blanks `amount` server-side
  // unless this user holds the payments "amounts" grant, so the figure never
  // reaches the browser for someone who may record but not read money.
  const q = useQuery({
    queryKey: ["payments"],
    queryFn: () =>
      readList("payments_list", {}, () =>
        supabase
          .from("payments")
          .select(
            "id,payment_code,client_id,job_id,amount,mode,payment_date,reference,narration,status,created_at",
          )
          .order("created_at", { ascending: false }),
      ),
  });
  const cname = (id: string) => clients?.find((c) => c.id === id)?.name ?? "—";
  const jcode = (id: string | null) => (id ? jobs?.find((j) => j.id === id)?.job_code ?? "—" : null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate("payments")) return toast.error("You do not have permission to record payments");
    if (!clientId) return toast.error("Please select a client first");
    const amt = Number(f.amount);
    if (!(amt > 0)) return toast.error("Amount must be greater than zero");
    if (f.payment_date > today()) return toast.error("Payment date can't be in the future");
    if (f.mode !== "cash" && !f.reference.trim())
      return toast.error("Reference number is required for non-cash payments");
    const dup = q.data?.find(
      (p) =>
        p.status !== "reversed" &&
        p.client_id === clientId &&
        (f.job_id ? p.job_id === f.job_id : !p.job_id) &&
        Number(p.amount) === amt &&
        (p.payment_date === f.payment_date || (f.reference && p.reference === f.reference)),
    );
    if (
      dup &&
      !confirm(
        `Possible duplicate of ${dup.payment_code} (${inr(dup.amount)} on ${fmtDate(dup.payment_date)}). Save anyway?`,
      )
    )
      return;
    setBusy(true);
    const { error } = await supabase.from("payments").insert({
      client_id: clientId,
      job_id: f.job_id || null,
      amount: amt,
      mode: f.mode,
      payment_date: f.payment_date,
      reference: f.reference.trim() || null,
      narration: f.narration.trim() || null,
      created_by: user.id,
    });
    setBusy(false);
    if (error) return toast.error(errMsg(error));
    toast.success("Payment recorded successfully", {
      description: f.job_id
        ? "You can now clear and square off this payment under Payment Clearing."
        : "Recorded as Client Balance. Settle or clear it against jobs under Payment Clearing.",
      action: f.job_id
        ? {
            label: "Open Clearing",
            onClick: () => navigate({ to: "/clearing/$jobId", params: { jobId: f.job_id }, search: {} }),
          }
        : undefined,
    });
    setF(empty);
    setClientId("");
    qc.invalidateQueries();
  };

  const reverse = async (reason: string) => {
    const { error } = await supabase.rpc("reverse_payment", { _payment_id: rev!, _reason: reason });
    if (error) {
      toast.error(errMsg(error));
      throw error;
    }
    toast.success("Payment reversed; allocations undone");
    qc.invalidateQueries();
  };

  return (
    <div>
      <PageHeader
        title="Payment Entry"
        subtitle="Record money received. New payments start as Unallocated."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">New Payment</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="space-y-3">
              <Field label="Client *">
                <ClientSelect
                  value={clientId}
                  onChange={handleClientChange}
                  placeholder="Search and select client…"
                />
              </Field>

              {clientId && (
                <Field label="Specific Job (Optional)">
                  <NativeSelect
                    value={f.job_id}
                    onChange={(e) => setF((prev) => ({ ...prev, job_id: e.target.value }))}
                  >
                    <option value="">General Client Payment (No specific job)</option>
                    {clientJobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.job_code} — {j.title}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              )}

              {clientId && (
                <p className="text-xs text-muted-foreground bg-muted/30 p-2.5 rounded-lg border border-border/40">
                  {f.job_id
                    ? "Recorded for this specific job. You can settle fees, TDS, and deductions on Payment Clearing."
                    : "Recorded at client level as advance/unallocated balance. You can allocate and square it off on any job's Payment Clearing sheet."}
                </p>
              )}

              <Field label="Amount (₹) *">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={f.amount}
                  onChange={set("amount")}
                  placeholder="0.00"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Mode">
                  <NativeSelect value={f.mode} onChange={set("mode")}>
                    {Object.entries(MODES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Date">
                  <Input
                    type="date"
                    max={today()}
                    value={f.payment_date}
                    onChange={set("payment_date")}
                  />
                </Field>
              </div>

              <Field label="Reference No.">
                <Input
                  value={f.reference}
                  onChange={set("reference")}
                  placeholder="UPI / UTR / Cheque no."
                />
              </Field>

              <Field label="Narration">
                <Input
                  value={f.narration}
                  onChange={set("narration")}
                  placeholder="Optional remarks…"
                />
              </Field>

              <Button className="w-full font-medium" disabled={busy}>
                {busy ? "Saving…" : "Save Payment"}
              </Button>
            </form>
          </CardContent>
        </Card>
        <div className="lg:col-span-2">
          <DataTable
            rows={q.data}
            loading={q.isLoading}
            onRowClick={(p) => {
              if (p.job_id) {
                navigate({ to: "/clearing/$jobId", params: { jobId: p.job_id }, search: {} });
              } else {
                navigate({ to: "/clients/$id", params: { id: p.client_id } });
              }
            }}
            empty="No payments recorded yet."
            search={(p) =>
              `${p.payment_code} ${p.reference} ${cname(p.client_id)} ${jcode(p.job_id) ?? "Client Balance"}`
            }
            exportFilename="payments"
            exportTransform={(p) => ({
              "Payment Code": p.payment_code,
              "Client": cname(p.client_id),
              "Job": jcode(p.job_id) ?? "Client Balance",
              "Payment Date": fmtDate(p.payment_date),
              "Mode": MODES[p.mode] ?? p.mode,
              "Reference": p.reference ?? "",
              "Amount": canSeeAmounts("payments") && p.amount != null ? p.amount : "—",
              "Status": p.status,
              "Narration": p.narration ?? "",
            })}
            columns={[
              {
                key: "payment_code",
                header: "Receipt",
                sort: (p) => p.payment_code,
                className: "font-mono text-xs font-semibold text-primary",
              },
              {
                key: "c",
                header: "Client",
                render: (p) => (
                  <span className="font-medium text-foreground">{cname(p.client_id)}</span>
                ),
              },
              {
                key: "j",
                header: "Job / Allocation",
                sort: (p) => jcode(p.job_id) ?? "",
                className: "font-mono text-xs",
                render: (p) => (
                  p.job_id ? (
                    <span className="font-mono text-xs font-medium text-muted-foreground">
                      {jcode(p.job_id)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                      Client Balance
                    </span>
                  )
                ),
              },
              {
                key: "d",
                header: "Date",
                sort: (p) => p.payment_date,
                render: (p) => fmtDate(p.payment_date),
              },
              { key: "m", header: "Mode", render: (p) => MODES[p.mode] },
              { key: "reference", header: "Reference" },
              {
                key: "a",
                header: "Amount",
                align: "right",
                sort: (p) => Number(p.amount),
                render: (p) => (canSeeAmounts("payments") ? inr(p.amount) : "—"),
              },
              { key: "s", header: "Status", render: (p) => <StatusBadge status={p.status} /> },
              {
                key: "clearing",
                header: "Clearing",
                render: (p) => (
                  p.job_id ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs font-medium"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate({ to: "/clearing/$jobId", params: { jobId: p.job_id! }, search: {} });
                      }}
                    >
                      Clearing
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs font-medium text-muted-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate({ to: "/clients/$id", params: { id: p.client_id } });
                      }}
                    >
                      View Client
                    </Button>
                  )
                ),
              },
              ...(canEdit("payments")
                ? [
                    {
                      key: "x",
                      header: "",
                      render: (p: { id: string; status: string }) =>
                        p.status !== "reversed" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive h-7 px-2 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRev(p.id);
                            }}
                          >
                            Reverse
                          </Button>
                        ),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </div>
      <ReasonDialog
        open={!!rev}
        onOpenChange={(o) => !o && setRev(null)}
        title="Reverse payment?"
        description="The payment stays on record as Reversed. Any allocations are undone and invoice balances restored."
        confirmLabel="Reverse"
        destructive
        onConfirm={reverse}
      />
    </div>
  );
}
