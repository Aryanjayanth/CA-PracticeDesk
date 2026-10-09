import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw, ArrowRight, Plus, Pencil } from "lucide-react";
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
import { ClientSelect, Field, NativeSelect, NoAccess, PageHeader } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { usePermissions } from "@/hooks/use-permissions";
import { useProfiles } from "@/hooks/use-roles";
import { readList } from "@/lib/supabase-read";
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

interface ClientServiceRow {
  id: string;
  client_id: string;
  service_id: string;
  client_name: string | null;
  service_name: string | null;
  auto_invoice: boolean | null;
  agreed_fee: number | null;
  frequency: string;
  start_date: string;
  end_date: string | null;
  due_days: number;
  assigned_staff: string | null;
  assigned_staff_name: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

function RecurringPage() {
  const navigate = useNavigate();
  const { canView, canEdit, canCreate, canSeeAmounts } = usePermissions();
  const qc = useQueryClient();
  const [upto, setUpto] = useState(today());
  const [busy, setBusy] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ClientServiceRow | null>(null);
  const [newScheduleOpen, setNewScheduleOpen] = useState(false);

  const q = useQuery({
    queryKey: ["client-services"],
    enabled: canView("recurring"),
    queryFn: () =>
      readList("recurring_list", {}, async () => {
        const { data, error } = await supabase
          .from("client_services")
          .select(
            "id,client_id,service_id,agreed_fee,frequency,start_date,end_date,due_days,assigned_staff,status,notes,created_at,clients(name),services(name),profiles!client_services_assigned_staff_fkey(full_name),services!client_services_service_id_fkey(auto_invoice)",
          )
          .order("created_at");
        if (error) return { data: null, error };
        return {
          data: (data ?? []).map((r) => ({
            id: r.id,
            client_id: r.client_id,
            service_id: r.service_id,
            client_name: r.clients?.name ?? null,
            service_name: r.services?.name ?? null,
            auto_invoice: r.services?.auto_invoice ?? null,
            agreed_fee: r.agreed_fee,
            frequency: r.frequency,
            start_date: r.start_date,
            end_date: r.end_date,
            due_days: r.due_days,
            assigned_staff: r.assigned_staff,
            assigned_staff_name: r.profiles?.full_name ?? null,
            status: r.status,
            notes: r.notes,
            created_at: r.created_at,
          })),
          error: null,
        };
      }),
  });

  if (!canView("recurring")) return <NoAccess />;

  const run = async () => {
    if (!canEdit("recurring")) return toast.error("You cannot generate jobs here");
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
    if (!canEdit("recurring")) return toast.error("You cannot change retainers here");
    const { error } = await supabase.from("client_services").update({ status }).eq("id", id);
    if (error) return toast.error(errMsg(error));
    toast.success(`Schedule status updated to ${status}`);
    qc.invalidateQueries({ queryKey: ["client-services"] });
  };

  const toggleAutoInvoice = async (id: string, current: boolean) => {
    if (!canEdit("recurring")) return toast.error("You cannot change auto-invoicing here");
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
          <div className="flex flex-wrap items-center gap-2">
            {canCreate("recurring") && (
              <Button onClick={() => setNewScheduleOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />
                Add Schedule
              </Button>
            )}
            {canEdit("recurring") && (
              <>
                <div className="flex items-center gap-1.5 border rounded-md px-2 py-1 bg-background">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Up to:</span>
                  <Input
                    type="date"
                    value={upto}
                    onChange={(e) => setUpto(e.target.value)}
                    className="h-7 w-32 text-xs border-0 p-0 focus-visible:ring-0"
                  />
                </div>
                <Button variant="outline" onClick={run} disabled={busy}>
                  <RefreshCw className={`mr-1 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
                  Generate Jobs
                </Button>
              </>
            )}
            <Button variant="ghost" asChild>
              <Link to="/jobs">
                View All Jobs
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        }
      />

      <DataTable
        rows={q.data}
        loading={q.isLoading}
        empty="No recurring schedules configured yet."
        search={(r) => `${r.client_name ?? ""} ${r.service_name ?? ""}`}
        exportFilename="recurring_schedules"
        exportTransform={(r) => ({
          "Client": r.client_name ?? "",
          "Service": r.service_name ?? "",
          "Agreed Fee": canSeeAmounts("recurring") && r.agreed_fee != null ? r.agreed_fee : "—",
          "Frequency": FREQS[r.frequency] ?? r.frequency,
          "Start Date": fmtDate(r.start_date),
          "End Date": fmtDate(r.end_date),
          "Due Days": r.due_days,
          "Assigned Staff": r.assigned_staff_name ?? "",
          "Auto-Invoice": r.auto_invoice ? "Yes" : "No",
          "Status": r.status,
          "Notes": r.notes ?? "",
        })}
        columns={[
          {
            key: "c",
            header: "Client",
            sort: (r) => r.client_name ?? "",
            render: (r) => (
              <Link
                to="/clients/$id"
                params={{ id: r.client_id }}
                className="font-medium text-primary hover:underline"
              >
                {r.client_name}
              </Link>
            ),
          },
          { key: "s", header: "Service", render: (r) => r.service_name },
          { key: "f", header: "Frequency", render: (r) => FREQS[r.frequency] ?? r.frequency },
          {
            key: "fee",
            header: "Agreed Fee",
            align: "right",
            render: (r) => (r.agreed_fee == null ? "—" : inr(r.agreed_fee)),
          },
          { key: "sd", header: "Start Date", render: (r) => fmtDate(r.start_date) },
          { key: "ed", header: "End Date", render: (r) => (r.end_date ? fmtDate(r.end_date) : "Ongoing") },
          {
            key: "ai",
            header: "Auto-Invoice",
            render: (r) =>
              canEdit("recurring") ? (
                <div className="flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => toggleAutoInvoice(r.id, r.auto_invoice ?? false)}
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
            key: "actions",
            header: "",
            render: (r) =>
              canEdit("recurring") && (
                <div className="flex items-center justify-end gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    onClick={() => setEditingSchedule(r)}
                    title="Edit Schedule"
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    Edit
                  </Button>
                  {r.status === "active" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2"
                      onClick={() => setStatus(r.id, "paused")}
                    >
                      Pause
                    </Button>
                  )}
                  {r.status === "paused" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2"
                      onClick={() => setStatus(r.id, "active")}
                    >
                      Resume
                    </Button>
                  )}
                  {r.status !== "stopped" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2 text-destructive hover:text-destructive"
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

      {/* Edit Recurring Schedule Dialog */}
      {editingSchedule && (
        <EditRecurringDialog
          schedule={editingSchedule}
          open={Boolean(editingSchedule)}
          onOpenChange={(o) => {
            if (!o) setEditingSchedule(null);
          }}
        />
      )}

      {/* Add Recurring Schedule Dialog */}
      {newScheduleOpen && (
        <NewRecurringDialog
          open={newScheduleOpen}
          onOpenChange={setNewScheduleOpen}
        />
      )}
    </div>
  );
}

function EditRecurringDialog({
  schedule,
  open,
  onOpenChange,
}: {
  schedule: ClientServiceRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const { data: profiles } = useProfiles();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    agreed_fee: String(schedule.agreed_fee ?? ""),
    frequency: schedule.frequency,
    start_date: schedule.start_date,
    end_date: schedule.end_date ?? "",
    due_days: String(schedule.due_days ?? "20"),
    assigned_staff: schedule.assigned_staff ?? "",
    status: schedule.status,
    notes: schedule.notes ?? "",
    auto_invoice: Boolean(schedule.auto_invoice),
  });

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSave = async () => {
    const feeNum = Number(form.agreed_fee);
    if (isNaN(feeNum) || feeNum < 0) return toast.error("Please enter a valid agreed fee");
    if (form.end_date && form.end_date < form.start_date) {
      return toast.error("End date cannot be earlier than start date");
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("client_services")
        .update({
          agreed_fee: feeNum,
          frequency: form.frequency,
          start_date: form.start_date,
          end_date: form.end_date || null,
          due_days: Number(form.due_days) || 0,
          assigned_staff: form.assigned_staff || null,
          status: form.status,
          notes: form.notes.trim() || null,
          auto_invoice: form.auto_invoice,
        })
        .eq("id", schedule.id);

      if (error) throw error;
      toast.success("Recurring schedule updated successfully");
      qc.invalidateQueries({ queryKey: ["client-services"] });
      onOpenChange(false);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Recurring Schedule</DialogTitle>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground flex flex-col gap-1">
          <div>
            Client: <span className="font-semibold text-foreground">{schedule.client_name}</span>
          </div>
          <div>
            Service: <span className="font-semibold text-foreground">{schedule.service_name}</span>
          </div>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Agreed Fee (₹) *">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.agreed_fee}
              onChange={set("agreed_fee")}
              className="font-mono"
            />
          </Field>

          <Field label="Frequency *">
            <NativeSelect value={form.frequency} onChange={set("frequency")}>
              {Object.entries(FREQS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field label="Start Date *">
            <Input type="date" value={form.start_date} onChange={set("start_date")} />
          </Field>

          <Field label="End Date (Optional)">
            <Input
              type="date"
              value={form.end_date}
              onChange={set("end_date")}
              placeholder="Leave blank for ongoing"
            />
          </Field>

          <Field label="Due (Days after period end)">
            <Input type="number" min={0} value={form.due_days} onChange={set("due_days")} />
          </Field>

          <Field label="Assigned Staff">
            <NativeSelect value={form.assigned_staff} onChange={set("assigned_staff")}>
              <option value="">Unassigned</option>
              {profiles?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name ?? p.email}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field label="Status">
            <NativeSelect value={form.status} onChange={set("status")}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="stopped">Stopped</option>
            </NativeSelect>
          </Field>

          <div className="flex items-center gap-2 pt-6">
            <input
              type="checkbox"
              id="edit_auto_invoice"
              checked={form.auto_invoice}
              onChange={(e) => setForm((p) => ({ ...p, auto_invoice: e.target.checked }))}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
            />
            <label htmlFor="edit_auto_invoice" className="text-xs font-medium cursor-pointer">
              Auto-raise invoice on job completion
            </label>
          </div>

          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} value={form.notes} onChange={set("notes")} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewRecurringDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const { data: profiles } = useProfiles();
  const [saving, setSaving] = useState(false);

  const servicesQuery = useQuery({
    queryKey: ["active-services"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("id, name, frequency, auto_invoice, active")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const [clientId, setClientId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [form, setForm] = useState({
    agreed_fee: "",
    frequency: "monthly",
    start_date: today(),
    end_date: "",
    due_days: "20",
    assigned_staff: "",
    notes: "",
    auto_invoice: false,
  });

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const handlePickService = (sid: string) => {
    setServiceId(sid);
    const svc = servicesQuery.data?.find((s) => s.id === sid);
    if (svc) {
      setForm((p) => ({
        ...p,
        frequency: svc.frequency === "one_time" ? "monthly" : svc.frequency || "monthly",
        auto_invoice: svc.auto_invoice ?? false,
      }));
    }
  };

  const handleCreate = async () => {
    if (!clientId) return toast.error("Please select a client");
    if (!serviceId) return toast.error("Please select a service");
    const feeNum = Number(form.agreed_fee);
    if (isNaN(feeNum) || feeNum < 0 || form.agreed_fee === "") {
      return toast.error("Please enter a valid agreed fee");
    }
    if (form.end_date && form.end_date < form.start_date) {
      return toast.error("End date cannot be earlier than start date");
    }

    setSaving(true);
    try {
      const { error } = await supabase.from("client_services").insert({
        client_id: clientId,
        service_id: serviceId,
        agreed_fee: feeNum,
        frequency: form.frequency,
        start_date: form.start_date,
        end_date: form.end_date || null,
        due_days: Number(form.due_days) || 0,
        assigned_staff: form.assigned_staff || null,
        status: "active",
        notes: form.notes.trim() || null,
        auto_invoice: form.auto_invoice,
      });

      if (error) throw error;
      try {
        await supabase.rpc("generate_recurring_jobs", { _upto: today() });
      } catch {
        // non-fatal
      }
      toast.success("Recurring schedule created & jobs populated");
      qc.invalidateQueries({ queryKey: ["client-services"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      onOpenChange(false);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Recurring Schedule</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Client *" className="sm:col-span-2">
            <ClientSelect
              value={clientId}
              onChange={(id) => setClientId(id)}
              placeholder="Search and select client…"
            />
          </Field>

          <Field label="Service *" className="sm:col-span-2">
            <NativeSelect value={serviceId} onChange={(e) => handlePickService(e.target.value)}>
              <option value="">Select service to automate…</option>
              {servicesQuery.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field label="Agreed Fee (₹) *">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.agreed_fee}
              onChange={set("agreed_fee")}
              placeholder="e.g. 5000"
              className="font-mono"
            />
          </Field>

          <Field label="Frequency *">
            <NativeSelect value={form.frequency} onChange={set("frequency")}>
              {Object.entries(FREQS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field label="Start Date *">
            <Input type="date" value={form.start_date} onChange={set("start_date")} />
          </Field>

          <Field label="End Date (Optional)">
            <Input
              type="date"
              value={form.end_date}
              onChange={set("end_date")}
              placeholder="Leave blank for ongoing"
            />
          </Field>

          <Field label="Due (Days after period end)">
            <Input type="number" min={0} value={form.due_days} onChange={set("due_days")} />
          </Field>

          <Field label="Assigned Staff">
            <NativeSelect value={form.assigned_staff} onChange={set("assigned_staff")}>
              <option value="">Unassigned</option>
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
              id="new_auto_invoice"
              checked={form.auto_invoice}
              onChange={(e) => setForm((p) => ({ ...p, auto_invoice: e.target.checked }))}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
            />
            <label htmlFor="new_auto_invoice" className="text-xs font-medium cursor-pointer">
              Automatically raise invoice when recurring jobs are marked Completed
            </label>
          </div>

          <Field label="Notes" className="sm:col-span-2">
            <Textarea
              rows={2}
              value={form.notes}
              onChange={set("notes")}
              placeholder="Optional notes or instructions..."
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? "Creating..." : "Create Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
