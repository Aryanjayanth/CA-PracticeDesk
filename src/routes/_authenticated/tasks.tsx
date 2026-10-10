import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Plus,
  Check,
  Clock,
  Download,
  ListChecks,
  CheckCircle2,
  Circle,
  AlertCircle,
  Calendar,
  User,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  ExternalLink,
  LayoutGrid,
  List,
  Sparkles,
  Receipt,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DataTable } from "@/components/app/DataTable";
import { ClientSelect, Field, NativeSelect, PageHeader } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { JobForm } from "@/components/app/JobForm";
import { useProfiles } from "@/hooks/use-roles";
import { usePermissions } from "@/hooks/use-permissions";
import { readList } from "@/lib/supabase-read";
import { downloadCsv, errMsg, fmtDate, inr, label } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Json } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({
    meta: [
      { title: "Tasks & Jobs — CA PracticeDesk" },
      { name: "description", content: "Expanded, detailed job-level and compliance subtask management." },
    ],
  }),
  component: TasksPage,
});

interface SubtaskItem {
  id: string;
  label: string;
  done: boolean;
  fee?: number | null;
  advance?: number | null;
  deductions?: number | null;
  net?: number | null;
}

interface DetailedJobTask {
  id: string;
  job_code: string;
  title: string;
  client_id: string;
  client_name: string | null;
  client_code: string | null;
  client_mobile: string | null;
  service_id: string;
  service_name: string | null;
  service_type: string | null;
  assigned_staff: string | null;
  assigned_staff_name: string | null;
  status: string;
  financial_status: string;
  due_date: string | null;
  period_start: string | null;
  period_end: string | null;
  created_at: string | null;
  notes: string | null;
  auto_invoice: boolean;
  fee: number;
  advance: number;
  deductions: number;
  net: number;
  checklist: SubtaskItem[];
  done: boolean;
}

function getDueStatus(dueDateStr: string | null, isCompleted: boolean) {
  if (!dueDateStr) return null;
  if (isCompleted) {
    return { label: `Due ${fmtDate(dueDateStr)}`, colorClass: "text-muted-foreground bg-muted/50 border-muted" };
  }
  const due = new Date(dueDateStr);
  const now = new Date();
  due.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    return {
      label: `Overdue by ${Math.abs(diffDays)}d`,
      colorClass: "text-destructive bg-destructive/10 border-destructive/30 font-semibold",
      isOverdue: true,
    };
  }
  if (diffDays === 0) {
    return {
      label: "Due Today",
      colorClass: "text-amber-600 bg-amber-500/10 border-amber-500/30 font-semibold",
      isDueToday: true,
    };
  }
  if (diffDays <= 3) {
    return {
      label: `Due in ${diffDays}d`,
      colorClass: "text-amber-600 bg-amber-500/10 border-amber-500/30",
    };
  }
  return {
    label: `Due ${fmtDate(dueDateStr)}`,
    colorClass: "text-muted-foreground bg-muted/30 border-border",
  };
}

function TasksPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canCreate, canEdit, canSeeAmounts } = usePermissions();
  const { data: profiles } = useProfiles();

  const [createJobOpen, setCreateJobOpen] = useState(false);
  const [addSubtaskOpen, setAddSubtaskOpen] = useState(false);
  const [targetJobForSubtask, setTargetJobForSubtask] = useState<string>("");
  const [viewMode, setViewMode] = useState<"expanded" | "table">("expanded");
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(new Set());

  const [fl, setFl] = useState({
    status: "", // "pending", "completed", "overdue", or ""
    client: "",
    staff: "",
    search: "",
    from: "",
    to: "",
  });

  const jobsQuery = useQuery({
    queryKey: ["jobs", "tasks"],
    queryFn: async (): Promise<DetailedJobTask[]> => {
      const { data, error } = await supabase
        .from("jobs")
        .select(
          "id,job_code,client_id,service_id,title,checklist,fee,discount,net_amount,due_date,period_start,period_end,assigned_staff,status,financial_status,notes,auto_invoice,created_at,clients(id,name,client_code,mobile),services(id,name,service_type),profiles!jobs_assigned_staff_fkey(id,full_name),job_clearing(id,status,advance,tds_tcs,discount,other_deduction,other_addition,final_amount)",
        )
        .neq("status", "cancelled")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Failed to fetch jobs for tasks:", error);
        throw error;
      }

      return (data ?? []).map((j: any) => {
        const clearing = Array.isArray(j.job_clearing) ? j.job_clearing[0] : j.job_clearing;
        const advance = Number(clearing?.advance) || 0;
        const deductions = Number(clearing?.other_deduction) || 0;
        const fee = Number(j.fee) || 0;
        const net = Math.max(0, fee - advance - deductions);

        const rawChecklist = Array.isArray(j.checklist) ? (j.checklist as any[]) : [];
        const checklist: SubtaskItem[] = rawChecklist.map((it: any, idx: number) => ({
          id: typeof it?.id === "string" ? it.id : `step-${idx}`,
          label: typeof it?.label === "string" ? it.label : `Step ${idx + 1}`,
          done: it?.done === true,
          fee: typeof it?.fee === "number" ? it.fee : null,
          advance: typeof it?.advance === "number" ? it.advance : null,
          deductions: typeof it?.deductions === "number" ? it.deductions : null,
          net: typeof it?.net === "number" ? it.net : null,
        }));

        const isCompleted = j.status === "completed";

        return {
          id: j.id,
          job_code: j.job_code ?? "",
          title: j.title ?? "",
          client_id: j.client_id ?? "",
          client_name: j.clients?.name ?? null,
          client_code: j.clients?.client_code ?? null,
          client_mobile: j.clients?.mobile ?? null,
          service_id: j.service_id ?? "",
          service_name: j.services?.name ?? null,
          service_type: j.services?.service_type ?? null,
          assigned_staff: j.assigned_staff ?? null,
          assigned_staff_name: j.profiles?.full_name ?? null,
          status: j.status ?? "pending",
          financial_status: j.financial_status ?? "open",
          due_date: j.due_date ?? null,
          period_start: j.period_start ?? null,
          period_end: j.period_end ?? null,
          created_at: j.created_at ?? null,
          notes: j.notes ?? null,
          auto_invoice: Boolean(j.auto_invoice),
          fee,
          advance,
          deductions,
          net,
          checklist,
          done: isCompleted,
        };
      });
    },
  });

  const jobsList = jobsQuery.data ?? [];

  // Toggle row expand in table view
  const toggleRowExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Toggle whole job completion
  const handleToggleJob = async (job: DetailedJobTask, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canEdit("jobs")) {
      toast.error("You are not authorised to update jobs");
      return;
    }

    const nextStatus = job.done ? "in_progress" : "completed";
    try {
      const { error } = await supabase.rpc("update_job_status", {
        _job_id: job.id,
        _status: nextStatus,
        _reason: `Status toggled to ${nextStatus} via Tasks view`,
      });
      if (error) throw error;

      toast.success(
        nextStatus === "completed"
          ? `Marked "${job.title}" as Completed!`
          : `Re-opened "${job.title}" to In Progress`,
      );
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["jobs", "tasks"] });
      qc.invalidateQueries({ queryKey: ["job", job.id] });
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  // Toggle specific checklist step within a job
  const handleToggleSubtask = async (
    jobId: string,
    subtaskId: string,
    currentDone: boolean,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    if (!canEdit("jobs")) {
      toast.error("You are not authorised to update tasks");
      return;
    }

    const job = jobsList.find((j) => j.id === jobId);
    if (!job) return;

    const nextChecklist = job.checklist.map((st) =>
      st.id === subtaskId ? { ...st, done: !currentDone } : st,
    );

    try {
      const { error } = await supabase
        .from("jobs")
        .update({ checklist: nextChecklist as unknown as Json })
        .eq("id", jobId);
      if (error) throw error;

      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["jobs", "tasks"] });
      qc.invalidateQueries({ queryKey: ["job", jobId] });
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  // Filter jobs
  const filteredJobs = useMemo(() => {
    return jobsList.filter((j) => {
      const isOverdue =
        !j.done && j.due_date && new Date(j.due_date).setHours(0, 0, 0, 0) < new Date().setHours(0, 0, 0, 0);

      if (fl.status === "pending" && j.done) return false;
      if (fl.status === "completed" && !j.done) return false;
      if (fl.status === "overdue" && !isOverdue) return false;
      if (fl.client && j.client_id !== fl.client) return false;
      if (fl.staff && j.assigned_staff !== fl.staff) return false;
      if (fl.from && j.created_at && j.created_at.slice(0, 10) < fl.from) return false;
      if (fl.to && j.created_at && j.created_at.slice(0, 10) > fl.to) return false;

      if (fl.search) {
        const q = fl.search.toLowerCase();
        const matches =
          j.job_code.toLowerCase().includes(q) ||
          j.title.toLowerCase().includes(q) ||
          (j.client_name ?? "").toLowerCase().includes(q) ||
          (j.service_name ?? "").toLowerCase().includes(q) ||
          (j.checklist ?? []).some((st) => st.label.toLowerCase().includes(q));
        if (!matches) return false;
      }

      return true;
    });
  }, [jobsList, fl]);

  // Bulk actions in table view
  const handleBulkStatus = async (
    selected: DetailedJobTask[],
    done: boolean,
    clearSelection: () => void,
  ) => {
    if (!canEdit("jobs")) {
      toast.error("You are not authorised to update jobs");
      return;
    }
    const toastId = toast.loading(`Updating ${selected.length} jobs…`);
    try {
      const nextStatus = done ? "completed" : "in_progress";
      for (const j of selected) {
        await supabase.rpc("update_job_status", {
          _job_id: j.id,
          _status: nextStatus,
          _reason: "Bulk task update",
        });
      }
      toast.dismiss(toastId);
      toast.success(`Successfully updated ${selected.length} jobs`);
      clearSelection();
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["jobs", "tasks"] });
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(errMsg(err));
    }
  };

  // Metrics
  const totalCount = jobsList.length;
  const pendingCount = jobsList.filter((j) => !j.done).length;
  const completedCount = jobsList.filter((j) => j.done).length;
  const overdueCount = jobsList.filter(
    (j) => !j.done && j.due_date && new Date(j.due_date).setHours(0, 0, 0, 0) < new Date().setHours(0, 0, 0, 0),
  ).length;
  const totalNetReceivable = jobsList.reduce((sum, j) => sum + (j.done ? 0 : j.net), 0);

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle="Detailed job-level tracking, service breakdown, advance clearing, and granular subtask progress."
        actions={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border bg-muted/30 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewMode("expanded")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-all",
                  viewMode === "expanded"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Detailed View
              </button>
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-all",
                  viewMode === "table"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <List className="h-3.5 w-3.5" />
                Table View
              </button>
            </div>

            <Button
              variant="outline"
              onClick={() => {
                setTargetJobForSubtask("");
                setAddSubtaskOpen(true);
              }}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add Subtask
            </Button>

            {canCreate("jobs") && (
              <Button onClick={() => setCreateJobOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />
                Create Job
              </Button>
            )}
          </div>
        }
      />

      {/* KPI Stats Cards */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-none">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ListChecks className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Total Jobs &amp; Tasks</div>
            <div className="text-xl font-bold">{totalCount}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-none">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">In Progress / Pending</div>
            <div className="text-xl font-bold">{pendingCount}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-none">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Overdue</div>
            <div className="text-xl font-bold text-rose-600">{overdueCount}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-none">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Completed</div>
            <div className="text-xl font-bold text-emerald-600">{completedCount}</div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-lg border bg-card p-2.5">
        <Input
          placeholder="Search by job code, service, client, or step…"
          value={fl.search}
          onChange={(e) => setFl((p) => ({ ...p, search: e.target.value }))}
          className="h-9 w-64 text-xs"
        />

        <NativeSelect
          value={fl.status}
          onChange={(e) => setFl((p) => ({ ...p, status: e.target.value }))}
          className="h-9 w-36 text-xs"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="overdue">Overdue only</option>
          <option value="completed">Completed</option>
        </NativeSelect>

        <ClientSelect
          value={fl.client}
          onChange={(id) => setFl((p) => ({ ...p, client: id }))}
          placeholder="All clients"
          className="h-9 w-44 text-xs"
          allowClear
        />

        <NativeSelect
          value={fl.staff}
          onChange={(e) => setFl((p) => ({ ...p, staff: e.target.value }))}
          className="h-9 w-36 text-xs"
        >
          <option value="">All staff</option>
          {profiles?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </NativeSelect>

        <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          Showing <span className="font-semibold text-foreground">{filteredJobs.length}</span> of{" "}
          <span>{totalCount}</span>
        </div>
      </div>

      {/* View Mode 1: Detailed Expanded Cards */}
      {viewMode === "expanded" && (
        <div>
          {jobsQuery.isLoading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Loading tasks &amp; jobs…</div>
          ) : filteredJobs.length === 0 ? (
            <div className="rounded-lg border border-dashed p-12 text-center">
              <ListChecks className="mx-auto h-8 w-8 text-muted-foreground opacity-50" />
              <h3 className="mt-2 text-sm font-semibold">No jobs or tasks match these filters</h3>
              <p className="mt-1 text-xs text-muted-foreground">Try clearing your filters or create a new job.</p>
            </div>
          ) : (
            <div className="grid gap-3.5">
              {filteredJobs.map((j) => {
                const dueInfo = getDueStatus(j.due_date, j.done);
                const subtasks = j.checklist ?? [];
                const subtasksTotal = subtasks.length;
                const subtasksDone = subtasks.filter((s) => s.done).length;

                return (
                  <div
                    key={j.id}
                    className={cn(
                      "rounded-xl border bg-card p-4 transition-all hover:border-primary/40 shadow-sm",
                      j.done && "bg-muted/15 border-muted opacity-80",
                    )}
                  >
                    {/* Top Row: Done Toggle, Job Code, Badges, Due Date */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                      <div className="flex items-center gap-3">
                        {/* Quick One-Click Complete Button */}
                        <button
                          type="button"
                          onClick={(e) => handleToggleJob(j, e)}
                          className={cn(
                            "inline-flex h-7 w-7 items-center justify-center rounded-lg border transition-all cursor-pointer",
                            j.done
                              ? "border-emerald-600 bg-emerald-500 text-white dark:bg-emerald-600"
                              : "border-muted-foreground/30 bg-background text-muted-foreground hover:border-primary hover:text-primary",
                          )}
                          title={j.done ? "Completed! Click to reopen" : "Click to mark job as complete"}
                        >
                          {j.done ? <Check className="h-4 w-4 stroke-[3]" /> : <Circle className="h-3.5 w-3.5 opacity-40" />}
                        </button>

                        <div className="flex items-center gap-2">
                          <Link
                            to="/jobs/$id"
                            params={{ id: j.id }}
                            className="font-mono text-xs font-bold text-primary hover:underline flex items-center gap-1"
                          >
                            {j.job_code}
                            <ArrowUpRight className="h-3 w-3 opacity-60" />
                          </Link>

                          <StatusBadge status={j.status} />

                          {j.service_type && (
                            <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-semibold">
                              {j.service_type}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-xs">
                        {dueInfo && (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium text-[11px]",
                              dueInfo.colorClass,
                            )}
                          >
                            <Calendar className="h-3 w-3" />
                            {dueInfo.label}
                          </span>
                        )}

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs px-2 gap-1"
                          onClick={() => navigate({ to: "/jobs/$id", params: { id: j.id } })}
                        >
                          Details
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Middle Row: Title, Client, Staff, and Financial Summary */}
                    <div className="grid gap-3 pt-3 sm:grid-cols-12 sm:items-center">
                      <div className="sm:col-span-6 space-y-1">
                        <h4
                          className={cn(
                            "text-base font-semibold leading-tight",
                            j.done && "line-through text-muted-foreground",
                          )}
                        >
                          {j.title}
                        </h4>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {j.client_name && (
                            <Link
                              to="/clients/$id"
                              params={{ id: j.client_id }}
                              className="font-medium text-foreground hover:text-primary hover:underline flex items-center gap-1"
                            >
                              <User className="h-3 w-3 text-muted-foreground" />
                              {j.client_name}
                              {j.client_code && <span className="text-muted-foreground">({j.client_code})</span>}
                            </Link>
                          )}

                          {j.assigned_staff_name && (
                            <span>
                              Assigned: <strong className="text-foreground">{j.assigned_staff_name}</strong>
                            </span>
                          )}

                          {j.notes && (
                            <span className="italic text-[11px] truncate max-w-xs">“{j.notes}”</span>
                          )}
                        </div>
                      </div>

                      {/* Financial Breakdown (Gross, Advance, Deduction, Net) */}
                      {canSeeAmounts("jobs") && (
                        <div className="sm:col-span-6 flex flex-wrap items-center justify-start sm:justify-end gap-2 text-xs">
                          <div className="rounded-md border bg-muted/20 px-2.5 py-1 text-right">
                            <div className="text-[10px] uppercase text-muted-foreground font-medium">Gross Fee</div>
                            <div className="font-semibold">{inr(j.fee)}</div>
                          </div>

                          {j.advance > 0 && (
                            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-right text-emerald-700 dark:text-emerald-300">
                              <div className="text-[10px] uppercase font-medium">Advance</div>
                              <div className="font-semibold">− {inr(j.advance)}</div>
                            </div>
                          )}

                          {j.deductions > 0 && (
                            <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-right text-amber-700 dark:text-amber-300">
                              <div className="text-[10px] uppercase font-medium">Deductions</div>
                              <div className="font-semibold">− {inr(j.deductions)}</div>
                            </div>
                          )}

                          <div className="rounded-md border bg-primary/10 border-primary/30 px-3 py-1 text-right text-primary">
                            <div className="text-[10px] uppercase font-bold tracking-wider">Net Due</div>
                            <div className="text-sm font-extrabold">{inr(j.net)}</div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Subtasks Section if Job has Checklist items */}
                    <div className="mt-3.5 border-t pt-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                          <span>Checklist &amp; Subtasks</span>
                          {subtasksTotal > 0 && (
                            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                              {subtasksDone} / {subtasksTotal} completed
                            </Badge>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setTargetJobForSubtask(j.id);
                            setAddSubtaskOpen(true);
                          }}
                          className="text-xs text-primary hover:underline font-medium inline-flex items-center gap-1"
                        >
                          <Plus className="h-3 w-3" />
                          Add Step
                        </button>
                      </div>

                      {subtasksTotal > 0 && (
                        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                          {(j.checklist ?? []).map((st) => (
                            <div
                              key={st.id}
                              onClick={(e) => handleToggleSubtask(j.id, st.id, st.done, e)}
                              className={cn(
                                "flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs cursor-pointer transition-colors hover:bg-muted/40",
                                st.done && "bg-muted/30 border-muted-foreground/20 text-muted-foreground",
                              )}
                            >
                              <div className="flex items-center gap-2">
                                <span
                                  className={cn(
                                    "inline-flex h-4 w-4 items-center justify-center rounded border",
                                    st.done
                                      ? "border-emerald-600 bg-emerald-600 text-white"
                                      : "border-muted-foreground/40 bg-background",
                                  )}
                                >
                                  {st.done && <Check className="h-2.5 w-2.5" />}
                                </span>
                                <span className={cn(st.done && "line-through opacity-75 font-normal")}>
                                  {st.label}
                                </span>
                              </div>

                              {st.fee != null && st.fee > 0 && canSeeAmounts("jobs") && (
                                <span className="font-mono text-[11px] text-muted-foreground">
                                  {inr(st.fee)}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* View Mode 2: Compact Table with Expandable Rows */}
      {viewMode === "table" && (
        <DataTable
          rows={filteredJobs}
          loading={jobsQuery.isLoading}
          selectable
          bulkActions={(selected, clearSelection) => (
            <div className="flex items-center gap-2">
              {canEdit("jobs") && (
                <>
                  <Button
                    size="sm"
                    variant="default"
                    className="h-8 text-xs font-medium gap-1.5"
                    onClick={() => handleBulkStatus(selected, true, clearSelection)}
                  >
                    <Check className="h-3.5 w-3.5" />
                    Mark as Completed
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs font-medium gap-1.5 bg-background"
                    onClick={() => handleBulkStatus(selected, false, clearSelection)}
                  >
                    <Clock className="h-3.5 w-3.5" />
                    Mark as Pending
                  </Button>
                </>
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5 font-medium bg-background"
                onClick={() => {
                  const dataToExport = selected.map((j) => ({
                    "Job Code": j.job_code,
                    "Service / Title": j.title,
                    "Client": j.client_name ?? "",
                    "Status": j.status,
                    "Assigned Staff": j.assigned_staff_name ?? "",
                    "Due Date": fmtDate(j.due_date),
                    "Gross Fee": canSeeAmounts("jobs") ? j.fee : "—",
                    "Advance": canSeeAmounts("jobs") ? j.advance : "—",
                    "Deductions": canSeeAmounts("jobs") ? j.deductions : "—",
                    "Net Amount": canSeeAmounts("jobs") ? j.net : "—",
                  }));
                  const stamp = new Date().toISOString().slice(0, 10);
                  downloadCsv(`jobs_tasks_${stamp}.csv`, dataToExport);
                }}
              >
                <Download className="h-3.5 w-3.5" />
                Export Selected ({selected.length})
              </Button>
            </div>
          )}
          onRowClick={(j) => navigate({ to: "/jobs/$id", params: { id: j.id } })}
          empty="No tasks or jobs match these filters."
          search={(j) => `${j.job_code} ${j.title} ${j.client_name ?? ""} ${j.service_name ?? ""}`}
          exportFilename="tasks_jobs"
          exportTransform={(j) => ({
            "Job Code": j.job_code,
            "Service / Title": j.title,
            "Client": j.client_name ?? "",
            "Status": j.status,
            "Assigned Staff": j.assigned_staff_name ?? "",
            "Due Date": fmtDate(j.due_date),
            "Gross Fee": canSeeAmounts("jobs") ? j.fee : "—",
            "Advance": canSeeAmounts("jobs") ? j.advance : "—",
            "Deductions": canSeeAmounts("jobs") ? j.deductions : "—",
            "Net Due": canSeeAmounts("jobs") ? j.net : "—",
          })}
          columns={[
            {
              key: "done",
              header: "Done",
              render: (j) => (
                <button
                  type="button"
                  onClick={(e) => handleToggleJob(j, e)}
                  className={cn(
                    "inline-flex h-6 w-6 items-center justify-center rounded border transition-all cursor-pointer",
                    j.done
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-muted-foreground/30 bg-background text-muted-foreground hover:border-primary",
                  )}
                  title={j.done ? "Completed! Click to reopen" : "Click to mark done"}
                >
                  {j.done ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3 w-3 opacity-30" />}
                </button>
              ),
            },
            {
              key: "job_code",
              header: "Job Code",
              sort: (j) => j.job_code,
              render: (j) => (
                <span className="font-mono text-xs font-bold text-primary">
                  {j.job_code}
                </span>
              ),
            },
            {
              key: "title",
              header: "Job / Service",
              sort: (j) => j.title,
              render: (j) => (
                <div className="flex flex-col">
                  <span className={cn("font-medium text-sm", j.done && "line-through text-muted-foreground")}>
                    {j.title}
                  </span>
                  {(j.checklist ?? []).length > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      {(j.checklist ?? []).filter((s) => s.done).length}/{(j.checklist ?? []).length} subtasks done
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: "client",
              header: "Client",
              sort: (j) => j.client_name ?? "",
              render: (j) => <span className="font-medium text-muted-foreground">{j.client_name}</span>,
            },
            {
              key: "staff",
              header: "Assigned Staff",
              render: (j) => j.assigned_staff_name ?? "—",
            },
            {
              key: "due_date",
              header: "Due Date",
              sort: (j) => j.due_date ?? "",
              render: (j) => {
                const dueInfo = getDueStatus(j.due_date, j.done);
                return dueInfo ? (
                  <span className={cn("inline-flex rounded px-1.5 py-0.5 text-xs border", dueInfo.colorClass)}>
                    {dueInfo.label}
                  </span>
                ) : (
                  "—"
                );
              },
            },
            ...(canSeeAmounts("jobs")
              ? [
                  {
                    key: "fee",
                    header: "Fee",
                    sort: (j: DetailedJobTask) => j.fee,
                    render: (j: DetailedJobTask) => <span className="font-mono text-xs">{inr(j.fee)}</span>,
                  },
                  {
                    key: "advance",
                    header: "Advance",
                    sort: (j: DetailedJobTask) => j.advance,
                    render: (j: DetailedJobTask) => (
                      <span className="font-mono text-xs text-emerald-600">
                        {j.advance > 0 ? inr(j.advance) : "—"}
                      </span>
                    ),
                  },
                  {
                    key: "net",
                    header: "Net Due",
                    sort: (j: DetailedJobTask) => j.net,
                    render: (j: DetailedJobTask) => (
                      <span className="font-mono text-xs font-bold text-primary">{inr(j.net)}</span>
                    ),
                  },
                ]
              : []),
            {
              key: "status",
              header: "Status",
              render: (j) => <StatusBadge status={j.status} />,
            },
          ]}
        />
      )}

      {/* Add Subtask Dialog */}
      {addSubtaskOpen && (
        <AddSubtaskDialog
          open={addSubtaskOpen}
          onOpenChange={setAddSubtaskOpen}
          jobs={jobsList}
          defaultJobId={targetJobForSubtask}
        />
      )}

      {/* Create Job Form Dialog */}
      {createJobOpen && (
        <JobForm open={createJobOpen} onOpenChange={setCreateJobOpen} />
      )}
    </div>
  );
}

function AddSubtaskDialog({
  open,
  onOpenChange,
  jobs,
  defaultJobId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobs: DetailedJobTask[];
  defaultJobId?: string;
}) {
  const qc = useQueryClient();
  const [selectedJobId, setSelectedJobId] = useState(defaultJobId || "");
  const [taskText, setTaskText] = useState("");
  const [taskFee, setTaskFee] = useState("");
  const [saving, setSaving] = useState(false);

  const activeJobs = useMemo(() => {
    return (jobs ?? []).filter((j) => j.status !== "completed" && j.status !== "cancelled");
  }, [jobs]);

  const handleCreate = async () => {
    if (!selectedJobId) return toast.error("Please select a job to attach this subtask to");
    if (!taskText.trim()) return toast.error("Please enter a step or subtask description");

    setSaving(true);
    try {
      const job = jobs.find((j) => j.id === selectedJobId);
      if (!job) throw new Error("Job not found");

      const rawChecklist = [...job.checklist];
      const newTask = {
        id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
        label: taskText.trim(),
        fee: Number(taskFee) || 0,
        done: false,
      };

      rawChecklist.push(newTask);

      const { error } = await supabase
        .from("jobs")
        .update({ checklist: rawChecklist as unknown as Json })
        .eq("id", selectedJobId);

      if (error) throw error;

      toast.success("Subtask added to job successfully");
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["jobs", "tasks"] });
      qc.invalidateQueries({ queryKey: ["job", selectedJobId] });
      onOpenChange(false);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Subtask / Step to Job</DialogTitle>
        </DialogHeader>

        <div className="space-y-3.5">
          <Field label="Target Job *">
            <NativeSelect
              value={selectedJobId}
              onChange={(e) => setSelectedJobId(e.target.value)}
            >
              <option value="">Select target job…</option>
              {activeJobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.job_code} — {j.title} ({j.client_name})
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field label="Subtask / Step Description *">
            <Input
              value={taskText}
              onChange={(e) => setTaskText(e.target.value)}
              placeholder="e.g. Verify Form 26AS, Prepare Challan, File Return"
            />
          </Field>

          <Field label="Fee Allocation (₹, Optional)">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={taskFee}
              onChange={(e) => setTaskFee(e.target.value)}
              placeholder="0.00"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? "Adding…" : "Add Subtask"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
