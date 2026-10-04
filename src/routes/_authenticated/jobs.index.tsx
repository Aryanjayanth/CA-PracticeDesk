import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DataTable } from "@/components/app/DataTable";
import { Field, NativeSelect, PageHeader } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useClientLookup, useProfiles, useRoles } from "@/hooks/use-roles";
import { errMsg, fmtDate, inr, JOB_STATUSES, jobDisplayStatus, label, today } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/jobs/")({
  head: () => ({
    meta: [
      { title: "Jobs — CA PracticeDesk" },
      { name: "description", content: "Job work management." },
    ],
  }),
  component: JobsPage,
});

function JobsPage() {
  const { isFinance } = useRoles();
  const { data: profiles } = useProfiles();
  const [open, setOpen] = useState(false);
  const [fl, setFl] = useState({
    status: "",
    client: "",
    service: "",
    staff: "",
    from: "",
    to: "",
  });
  const q = useQuery({
    queryKey: ["jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select(
          "*, clients(name), services(name), invoice_items(invoice_id, invoices(id, invoice_no, status, total, amount_paid, outstanding))",
        )
        .order("due_date", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
  const all = q.data ?? [];
  const clients = [...new Map(all.map((j) => [j.client_id, j.clients?.name])).entries()];
  const services = [...new Map(all.map((j) => [j.service_id, j.services?.name])).entries()];
  const rows = all.filter(
    (j) =>
      (!fl.status || jobDisplayStatus(j) === fl.status) &&
      (!fl.client || j.client_id === fl.client) &&
      (!fl.service || j.service_id === fl.service) &&
      (!fl.staff || j.assigned_staff === fl.staff) &&
      (!fl.from || (j.due_date ?? "") >= fl.from) &&
      (!fl.to || (j.due_date ?? "") <= fl.to),
  );
  const s = (k: keyof typeof fl) => (e: { target: { value: string } }) =>
    setFl((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div>
      <PageHeader
        title="Jobs"
        subtitle="All compliance and engagement work"
        actions={
          isFinance && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Create Job
            </Button>
          )
        }
      />
      <DataTable
        rows={rows}
        loading={q.isLoading}
        empty="No jobs match these filters."
        search={(j) => `${j.job_code} ${j.title} ${j.clients?.name}`}
        toolbar={
          <>
            <NativeSelect value={fl.status} onChange={s("status")} className="w-36">
              <option value="">All statuses</option>
              {[...JOB_STATUSES, "overdue"].map((x) => (
                <option key={x} value={x}>
                  {label(x)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect value={fl.client} onChange={s("client")} className="w-40">
              <option value="">All clients</option>
              {clients.map(([id, n]) => (
                <option key={id} value={id}>
                  {n}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect value={fl.service} onChange={s("service")} className="w-40">
              <option value="">All services</option>
              {services.map(([id, n]) => (
                <option key={id} value={id}>
                  {n}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect value={fl.staff} onChange={s("staff")} className="w-36">
              <option value="">All staff</option>
              {profiles?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </NativeSelect>
            <span className="text-xs text-muted-foreground">Due</span>
            <Input type="date" value={fl.from} onChange={s("from")} className="h-9 w-36" />
            <Input type="date" value={fl.to} onChange={s("to")} className="h-9 w-36" />
          </>
        }
        columns={[
          {
            key: "job_code",
            header: "Job",
            sort: (j) => j.job_code,
            render: (j) => (
              <Link
                to="/jobs/$id"
                params={{ id: j.id }}
                className="font-mono text-xs text-primary hover:underline"
              >
                {j.job_code}
              </Link>
            ),
          },
          {
            key: "title",
            header: "Title",
            sort: (j) => j.title,
            render: (j) => <span className="font-medium">{j.title}</span>,
          },
          {
            key: "c",
            header: "Client",
            sort: (j) => j.clients?.name ?? "",
            render: (j) => j.clients?.name,
          },
          {
            key: "due",
            header: "Due",
            sort: (j) => j.due_date ?? "",
            render: (j) => fmtDate(j.due_date),
          },
          ...(isFinance
            ? [
                {
                  key: "net",
                  header: "Net",
                  align: "right" as const,
                  sort: (j: (typeof all)[number]) => Number(j.net_amount),
                  render: (j: (typeof all)[number]) => inr(j.net_amount),
                },
              ]
            : []),
          {
            key: "staff",
            header: "Staff",
            render: (j) => profiles?.find((p) => p.id === j.assigned_staff)?.full_name ?? "—",
          },
          {
            key: "st",
            header: "Status",
            render: (j) => <StatusBadge status={jobDisplayStatus(j)} />,
          },
          {
            key: "fs",
            header: "Billing",
            render: (j) => {
              const inv = (
                j.invoice_items as Array<{
                  invoice_id: string;
                  invoices: { id: string; invoice_no: string; status: string } | null;
                }> | null
              )?.[0]?.invoices;
              if (inv) {
                return (
                  <Link
                    to="/invoices/$id"
                    params={{ id: inv.id }}
                    className="group inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium bg-muted/60 hover:bg-muted border border-border/50 transition-colors"
                    title={`Click to open Invoice ${inv.invoice_no}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <StatusBadge
                      status={j.financial_status === "closed" ? "paid" : inv.status || "invoiced"}
                    />
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
                    <span
                      className="rounded bg-sky-500/10 px-1 py-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-400"
                      title="Auto-invoicing enabled on job completion"
                    >
                      Auto
                    </span>
                  )}
                </div>
              );
            },
          },
        ]}
      />
      <CreateJobDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function CreateJobDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const { data: clients } = useClientLookup();
  const { data: profiles } = useProfiles();
  const svcs = useQuery({
    queryKey: ["services"],
    queryFn: async () =>
      (await supabase.from("services").select("*").eq("active", true).order("name")).data ?? [],
  });
  const csRows =
    useQuery({
      queryKey: ["client-services"],
      queryFn: async () =>
        (await supabase.from("client_services").select("client_id, service_id, agreed_fee")).data ??
        [],
    }).data ?? [];
  const [f, setF] = useState({
    client_id: "",
    service_id: "",
    title: "",
    period_start: "",
    period_end: "",
    fee: "",
    discount: "0",
    due_date: today(),
    assigned_staff: "",
    notes: "",
    auto_invoice: false,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  const save = async () => {
    if (!f.client_id || !f.service_id) return toast.error("Client and service are required");
    const fee = Number(f.fee),
      disc = Number(f.discount || 0);
    if (!(fee >= 0)) return toast.error("Invalid fee");
    if (disc < 0 || disc > fee) return toast.error("Discount must be between 0 and the fee");
    const svc = svcs.data?.find((s) => s.id === f.service_id);
    const { error } = await supabase.from("jobs").insert({
      client_id: f.client_id,
      service_id: f.service_id,
      title: f.title.trim() || svc?.name || "Job",
      fee,
      discount: disc,
      period_start: f.period_start || null,
      period_end: f.period_end || null,
      due_date: f.due_date || null,
      assigned_staff: f.assigned_staff || null,
      notes: f.notes || null,
      auto_invoice: f.auto_invoice,
    });
    if (error) return toast.error(errMsg(error));
    toast.success("Job created");
    qc.invalidateQueries({ queryKey: ["jobs"] });
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Job</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client *">
            <NativeSelect value={f.client_id} onChange={set("client_id")}>
              <option value="">Select…</option>
              {clients?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Service *">
            <NativeSelect
              value={f.service_id}
              onChange={(e) => {
                const sid = e.target.value;
                const s = svcs.data?.find((x) => x.id === sid);
                // Services no longer carry a fee, so fall back to this client's
                // existing assignment for the same service, if there is one.
                const retainer = csRows.find(
                  (r) => r.service_id === sid && r.client_id === f.client_id,
                );
                setF((p) => ({
                  ...p,
                  service_id: sid,
                  fee: retainer ? String(retainer.agreed_fee) : "",
                  title: p.title || s?.name || "",
                  auto_invoice: s?.auto_invoice ?? false,
                }));
              }}
            >
              <option value="">Select…</option>
              {svcs.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Title" className="sm:col-span-2">
            <Input value={f.title} onChange={set("title")} />
          </Field>
          <Field label="Period Start">
            <Input type="date" value={f.period_start} onChange={set("period_start")} />
          </Field>
          <Field label="Period End">
            <Input type="date" value={f.period_end} onChange={set("period_end")} />
          </Field>
          <Field label="Fee (₹)">
            <Input type="number" min={0} value={f.fee} onChange={set("fee")} />
          </Field>
          <Field label="Discount (₹)">
            <Input type="number" min={0} value={f.discount} onChange={set("discount")} />
          </Field>
          <Field label="Due Date">
            <Input type="date" value={f.due_date} onChange={set("due_date")} />
          </Field>
          <Field label="Assigned Staff">
            <NativeSelect value={f.assigned_staff} onChange={set("assigned_staff")}>
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
              id="create_job_auto_invoice"
              checked={f.auto_invoice}
              onChange={(e) => setF((p) => ({ ...p, auto_invoice: e.target.checked }))}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="create_job_auto_invoice" className="text-xs font-medium cursor-pointer">
              Automatically raise invoice when this job is marked Completed
            </label>
          </div>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} value={f.notes} onChange={set("notes")} />
          </Field>
        </div>
        <div className="text-sm text-muted-foreground">
          Net amount:{" "}
          <span className="font-semibold text-foreground">
            {inr(Number(f.fee || 0) - Number(f.discount || 0))}
          </span>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
