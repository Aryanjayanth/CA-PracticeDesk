import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/app/DataTable";
import { NoAccess, PageHeader } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useRoles } from "@/hooks/use-roles";
import { errMsg, fmtDate, FREQS, inr, today } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/recurring")({
  head: () => ({
    meta: [
      { title: "Recurring Jobs — CA PracticeDesk" },
      { name: "description", content: "Client retainer schedules and automated job generation." },
    ],
  }),
  component: RecurringPage,
});

function RecurringPage() {
  const navigate = useNavigate();
  const { isFinance, isManager, isStaff, loading } = useRoles();
  const qc = useQueryClient();
  const [upto, setUpto] = useState(today());
  const [busy, setBusy] = useState(false);
  const canView = isFinance || isManager || isStaff;

  const q = useQuery({
    queryKey: ["client-services"],
    enabled: canView,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_services")
        .select("*, clients(name), services(name)")
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });
  if (loading) return null;
  if (!canView) return <NoAccess />;

  const run = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("generate_recurring_jobs", { _upto: upto });
    setBusy(false);
    if (error) return toast.error(errMsg(error));
    if (data && data > 0) {
      toast.success(`${data} new job(s) created successfully!`, {
        action: {
          label: "View Jobs",
          onClick: () => navigate({ to: "/jobs" }),
        },
      });
    } else {
      toast.info("All recurring jobs up to this date already exist — nothing to create.");
    }
    qc.invalidateQueries();
  };
  const setStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("client_services").update({ status }).eq("id", id);
    if (error) return toast.error(errMsg(error));
    qc.invalidateQueries({ queryKey: ["client-services"] });
  };
  const toggleAutoInvoice = async (id: string, current: boolean) => {
    const { error } = await supabase
      .from("client_services")
      .update({ auto_invoice: !current })
      .eq("id", id);
    if (error) return toast.error(errMsg(error));
    toast.success(
      !current ? "Auto-invoicing enabled on job completion" : "Auto-invoicing disabled",
    );
    qc.invalidateQueries({ queryKey: ["client-services"] });
  };

  return (
    <div>
      <PageHeader
        title="Recurring Jobs"
        subtitle="Client retainer schedules that automatically generate periodic compliance jobs without duplicates."
        actions={
          isFinance && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Generate up to</span>
              <Input
                type="date"
                value={upto}
                onChange={(e) => setUpto(e.target.value)}
                className="h-9 w-40"
              />
              <Button onClick={run} disabled={busy}>
                <RefreshCw className={`mr-1 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
                Generate Jobs
              </Button>
              <Button variant="outline" asChild>
                <Link to="/jobs">
                  View All Jobs
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
            </div>
          )
        }
      />
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        empty="No services linked to clients yet."
        search={(r) => `${r.clients?.name} ${r.services?.name}`}
        columns={[
          {
            key: "c",
            header: "Client",
            sort: (r) => r.clients?.name ?? "",
            render: (r) => (
              <Link
                to="/clients/$id"
                params={{ id: r.client_id }}
                className="font-medium text-primary hover:underline"
              >
                {r.clients?.name}
              </Link>
            ),
          },
          { key: "s", header: "Service", render: (r) => r.services?.name },
          { key: "f", header: "Frequency", render: (r) => FREQS[r.frequency] },
          { key: "fee", header: "Fee", align: "right", render: (r) => inr(r.agreed_fee) },
          { key: "sd", header: "Start", render: (r) => fmtDate(r.start_date) },
          { key: "ed", header: "End", render: (r) => fmtDate(r.end_date) },
          {
            key: "ai",
            header: "Auto-Invoice",
            render: (r) =>
              isManager ? (
                <div className="flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => toggleAutoInvoice(r.id, r.auto_invoice)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${r.auto_invoice ? "bg-primary" : "bg-muted-foreground/30"}`}
                    title={
                      r.auto_invoice
                        ? "Auto-invoicing ON: click to turn off"
                        : "Auto-invoicing OFF: click to turn on"
                    }
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-lg ring-0 transition duration-200 ease-in-out ${r.auto_invoice ? "translate-x-4" : "translate-x-0"}`}
                    />
                  </button>
                </div>
              ) : (
                <span
                  className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${r.auto_invoice ? "bg-sky-500/10 text-sky-600" : "text-muted-foreground"}`}
                >
                  {r.auto_invoice ? "Yes" : "No"}
                </span>
              ),
          },
          { key: "st", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          {
            key: "a",
            header: "",
            render: (r) =>
              isManager && (
                <div className="flex gap-1">
                  {r.status === "active" && (
                    <Button size="sm" variant="ghost" onClick={() => setStatus(r.id, "paused")}>
                      Pause
                    </Button>
                  )}
                  {r.status === "paused" && (
                    <Button size="sm" variant="ghost" onClick={() => setStatus(r.id, "active")}>
                      Resume
                    </Button>
                  )}
                  {r.status !== "stopped" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setStatus(r.id, "stopped")}
                    >
                      Stop
                    </Button>
                  )}
                </div>
              ),
          },
        ]}
      />
    </div>
  );
}
