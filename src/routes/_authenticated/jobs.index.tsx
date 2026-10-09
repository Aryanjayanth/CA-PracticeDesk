import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, CheckCircle2, Check, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/app/DataTable";
import { ClientSelect, NativeSelect, PageHeader } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useProfiles } from "@/hooks/use-roles";
import { usePermissions } from "@/hooks/use-permissions";
import { JobForm } from "@/components/app/JobForm";
import { readList } from "@/lib/supabase-read";
import { errMsg, fmtDate, inr, JOB_STATUSES, jobDisplayStatus, label } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canCreate, canEdit, canSeeAmounts } = usePermissions();
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

  const handleQuickComplete = async (e: React.MouseEvent, j: { id: string; job_code: string; status: string }) => {
    e.stopPropagation();
    if (!canEdit("jobs")) {
      toast.error("You are not authorised to update job status");
      return;
    }
    const newStatus = j.status === "completed" ? "in_progress" : "completed";
    try {
      const { error } = await supabase.rpc("update_job_status", {
        _job_id: j.id,
        _status: newStatus,
        _reason: `Status changed to ${newStatus} via Jobs list quick checkbox`,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["job", j.id] });
      qc.invalidateQueries({ queryKey: ["job-workflow", j.id] });
      toast.success(
        newStatus === "completed"
          ? `Job ${j.job_code} marked as Completed!`
          : `Job ${j.job_code} status set to In Progress`,
      );
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  // Read through the RPC rather than the table: it blanks fee/discount/net_amount
  // server-side unless this user holds the jobs "amounts" grant, so a Staff
  // member who can work jobs without seeing fees never receives the figures.
  const q = useQuery({
    queryKey: ["jobs"],
    queryFn: () =>
      readList("jobs_list", {}, async () => {
        const { data, error } = await supabase
          .from("jobs")
          .select(
            "id,job_code,client_id,service_id,client_service_id,title,period_start,period_end,fee,discount,net_amount,due_date,assigned_staff,status,financial_status,notes,auto_invoice,created_at,clients(name),services(name),profiles!jobs_assigned_staff_fkey(full_name),invoice_items(invoice_id,invoices(id,invoice_no,status))",
          )
          .order("created_at", { ascending: false });
        if (error) return { data: null, error };
        // Flatten the nested joins into the same shape jobs_list returns, so the
        // table columns do not have to care which path produced the row.
        return {
          data: (data ?? []).map((j) => {
            const inv = (
              j.invoice_items as Array<{
                invoice_id: string;
                invoices: { id: string; invoice_no: string; status: string } | null;
              }> | null
            )?.[0]?.invoices;
            return {
              ...j,
              client_name: j.clients?.name ?? null,
              service_name: j.services?.name ?? null,
              assigned_staff_name: j.profiles?.full_name ?? null,
              invoice_id: inv?.id ?? null,
              invoice_no: inv?.invoice_no ?? null,
              invoice_status: inv?.status ?? null,
            };
          }),
          error: null,
        };
      }),
  });
  const all = q.data ?? [];
  const clients = [...new Map(all.map((j) => [j.client_id, j.client_name])).entries()];
  const services = [...new Map(all.map((j) => [j.service_id, j.service_name])).entries()];
  const rows = all.filter(
    (j) =>
      (!fl.status || jobDisplayStatus(j) === fl.status) &&
      (!fl.client || j.client_id === fl.client) &&
      (!fl.service || j.service_id === fl.service) &&
      (!fl.staff || j.assigned_staff === fl.staff) &&
      (!fl.from || (j.created_at ? j.created_at.slice(0, 10) >= fl.from : false)) &&
      (!fl.to || (j.created_at ? j.created_at.slice(0, 10) <= fl.to : false)),
  );
  const s = (k: keyof typeof fl) => (e: { target: { value: string } }) =>
    setFl((p) => ({ ...p, [k]: e.target.value }));

  if (open) {
    return <JobForm open={open} onOpenChange={setOpen} />;
  }

  return (
    <div>
      <PageHeader
        title="Jobs"
        subtitle="All compliance and engagement work"
        actions={
          canCreate("jobs") && (
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
        onRowClick={(j) => navigate({ to: "/jobs/$id", params: { id: j.id } })}
        empty="No jobs match these filters."
        search={(j) => `${j.job_code} ${j.title} ${j.client_name ?? ""}`}
        exportFilename="jobs"
        exportTransform={(j) => ({
          "Job Code": j.job_code,
          "Title": j.title,
          "Client": j.client_name ?? "",
          "Service": j.service_name ?? "",
          "Status": label(jobDisplayStatus(j)),
          "Period Start": fmtDate(j.period_start),
          "Period End": fmtDate(j.period_end),
          "Created Date": fmtDate(j.created_at),
          "Due Date": fmtDate(j.due_date),
          "Fee": canSeeAmounts("jobs") && j.fee != null ? j.fee : "—",
          "Net Amount": canSeeAmounts("jobs") && j.net_amount != null ? j.net_amount : "—",
          "Assigned Staff": j.assigned_staff_name ?? "",
          "Auto-Invoice": j.auto_invoice ? "Yes" : "No",
        })}
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
            <ClientSelect
              value={fl.client}
              onChange={(id) => setFl((p) => ({ ...p, client: id }))}
              placeholder="All clients"
              className="w-44"
              allowClear
            />
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
            <span className="text-xs text-muted-foreground">Date</span>
            <Input type="date" value={fl.from} onChange={s("from")} className="h-9 w-36" />
            <Input type="date" value={fl.to} onChange={s("to")} className="h-9 w-36" />
          </>
        }
        columns={[
          {
            key: "done_action",
            header: "Done",
            render: (j) => {
              const isDone = j.status === "completed";
              return (
                <button
                  type="button"
                  onClick={(e) => handleQuickComplete(e, j)}
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center rounded-md border transition-all",
                    isDone
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "border-muted-foreground/30 bg-background text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5",
                  )}
                  title={
                    isDone
                      ? "Job Completed — Click to reopen as In Progress"
                      : "Click to mark Job as Completed"
                  }
                >
                  {isDone ? <CheckCircle2 className="h-4 w-4" /> : <Check className="h-3.5 w-3.5 opacity-60 hover:opacity-100" />}
                </button>
              );
            },
          },
          {
            key: "job_code",
            header: "Job",
            sort: (j) => j.job_code,
            render: (j) => (
              <span className="font-mono text-xs font-semibold text-primary">
                {j.job_code}
              </span>
            ),
          },
          {
            key: "title",
            header: "Title",
            sort: (j) => j.title,
            render: (j) => {
              const isDone = j.status === "completed";
              return (
                <span
                  className={cn(
                    "font-medium transition-all",
                    isDone
                      ? "line-through text-muted-foreground opacity-60"
                      : "text-foreground",
                  )}
                >
                  {j.title}
                </span>
              );
            },
          },
          {
            key: "c",
            header: "Client",
            sort: (j) => j.client_name ?? "",
            render: (j) => <span className="font-medium text-muted-foreground">{j.client_name}</span>,
          },
          {
            key: "created_at",
            header: "Created Date",
            sort: (j) => j.created_at ?? "",
            render: (j) => (
              <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                {fmtDate(j.created_at)}
              </span>
            ),
          },
          {
            key: "net",
            header: "Net Fee",
            align: "right" as const,
            sort: (j: (typeof all)[number]) => Number(j.net_amount ?? 0),
            render: (j: (typeof all)[number]) => (j.net_amount == null ? "—" : inr(j.net_amount)),
          },
          {
            key: "staff",
            header: "Staff",
            render: (j) => j.assigned_staff_name ?? "—",
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
              if (j.invoice_id && j.invoice_no) {
                return (
                  <Link
                    to="/invoices/$id"
                    params={{ id: j.invoice_id }}
                    className="group inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium bg-muted/60 hover:bg-muted border border-border/50 transition-colors"
                    title={`Click to open Invoice ${j.invoice_no}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <StatusBadge
                      status={
                        j.financial_status === "closed" ? "paid" : j.invoice_status || "invoiced"
                      }
                    />
                    <span className="font-mono text-[11px] text-primary underline underline-offset-2 group-hover:text-primary/80">
                      {j.invoice_no}
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
    </div>
  );
}
