import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
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
import { useRoles } from "@/hooks/use-roles";
import { errMsg, FREQS, inr, label } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/services")({
  head: () => ({
    meta: [
      { title: "Services — CA PracticeDesk" },
      { name: "description", content: "Service master and retainer configuration." },
    ],
  }),
  component: ServicesPage,
});

const TYPES = [
  "GST",
  "TDS / TCS",
  "Income Tax",
  "Statutory Audit",
  "Tax Audit",
  "Internal Audit",
  "Accounting & Bookkeeping",
  "Payroll & PF / ESI",
  "ROC & MCA Compliance",
  "Company / LLP Incorporation",
  "GST Registration & Amendments",
  "Management Consultancy",
  "Appeals & Litigation",
  "Other",
];

const COMMON_SAC_CODES = [
  { code: "998221", label: "998221 — Accounting, Auditing & Bookkeeping" },
  { code: "998222", label: "998222 — Taxation Advisory & Return Filing" },
  { code: "998223", label: "998223 — Insolvency & Receivership Services" },
  { code: "998231", label: "998231 — Legal Representation & Tribunal Appeals" },
  { code: "998311", label: "998311 — Management Consulting & Advisory" },
];


const Req = () => <span className="text-red-500 font-semibold ml-0.5">*</span>;

type Svc = Tables<"services">;

function ServicesPage() {
  const { isManager, isFinance } = useRoles();
  const [edit, setEdit] = useState<Svc | null | "new">(null);
  const q = useQuery({
    queryKey: ["services-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  return (
    <div>
      <PageHeader
        title="Services"
        subtitle="Services your firm offers"
        actions={
          isManager && (
            <Button onClick={() => setEdit("new")}>
              <Plus className="mr-1 h-4 w-4" />
              Add Service
            </Button>
          )
        }
      />
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        empty="No services defined."
        search={(s) => `${s.name} ${s.service_type} ${s.service_code}`}
        onRowClick={isManager ? (s) => setEdit(s) : undefined}
        columns={[
          { key: "service_code", header: "ID", className: "font-mono text-xs" },
          {
            key: "name",
            header: "Service",
            sort: (s) => s.name,
            render: (s) => <span className="font-medium">{s.name}</span>,
          },
          { key: "service_type", header: "Type", sort: (s) => s.service_type },
          { key: "f", header: "Frequency", render: (s) => FREQS[s.frequency] },
          { key: "b", header: "Billing", render: (s) => label(s.billing_type) },
          {
            key: "fee",
            header: "Default Fee",
            align: "right",
            sort: (s) => Number(s.default_fee),
            render: (s) =>
              isFinance || isManager ? inr(s.default_fee) : "—",
          },
          {
            key: "due",
            header: "Due Rule",
            render: (s) => `${s.due_days} days after period`,
          },
          {
            key: "sac",
            header: "SAC",
            className: "font-mono text-xs",
            render: (s) => s.sac_code || "998221",
          },
          {
            key: "a",
            header: "Status",
            render: (s) => (
              <StatusBadge status={s.active ? "active" : "inactive"} />
            ),
          },
        ]}
      />
      {edit && (
        <ServiceDialog
          svc={edit === "new" ? null : edit}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}

function ServiceDialog({
  svc,
  onClose,
}: {
  svc: Svc | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: svc?.name ?? "",
    service_type: svc?.service_type ?? "GST",
    description: svc?.description ?? "",
    frequency: svc?.frequency ?? "monthly",
    billing_type: svc?.billing_type ?? "recurring",
    default_fee: String(svc?.default_fee ?? ""),
    due_days: String(svc?.due_days ?? 20),
    sac_code: svc?.sac_code ?? "998221",
    active: svc?.active ?? true,
  });

  const [sacChoice, setSacChoice] = useState(() => {
    const code = svc?.sac_code ?? "998221";
    return COMMON_SAC_CODES.some((c) => c.code === code) ? code : "custom";
  });

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const handleBillingTypeChange = (val: string) => {
    setF((prev) => ({
      ...prev,
      billing_type: val,
      frequency: val === "one_time" ? "one_time" : prev.frequency === "one_time" ? "monthly" : prev.frequency,
    }));
  };

  const handleSacChoiceChange = (choice: string) => {
    setSacChoice(choice);
    if (choice !== "custom") {
      setF((p) => ({ ...p, sac_code: choice }));
    }
  };

  const save = async () => {
    if (f.name.trim().length < 2) return toast.error("Service name is required (min 2 characters)");
    if (!(Number(f.default_fee) >= 0)) return toast.error("Invalid default fee");

    const payload = {
      ...f,
      name: f.name.trim(),
      default_fee: Number(f.default_fee || 0),
      due_days: Number(f.due_days || 0),
      sac_code: (sacChoice === "custom" ? f.sac_code.trim() : sacChoice) || "998221",
    };

    const { error } = svc
      ? await supabase.from("services").update(payload).eq("id", svc.id)
      : await supabase.from("services").insert(payload);

    if (error) return toast.error(errMsg(error));
    toast.success("Service saved successfully");
    qc.invalidateQueries();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{svc ? "Edit Service" : "Add Service"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3.5 sm:grid-cols-2">
          {/* Service Name */}
          <Field label={<>Service Name <Req /></>} className="sm:col-span-2">
            <Input
              required
              value={f.name}
              onChange={set("name")}
              placeholder="e.g. GSTR-3B Monthly Return Filing"
            />
          </Field>

          {/* Type & Status */}
          <Field label="Service Type">
            <NativeSelect value={f.service_type} onChange={set("service_type")}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Status">
            <NativeSelect
              value={f.active ? "1" : "0"}
              onChange={(e) =>
                setF((p) => ({ ...p, active: e.target.value === "1" }))
              }
            >
              <option value="1">Active</option>
              <option value="0">Inactive</option>
            </NativeSelect>
          </Field>

          {/* Billing Type & Frequency */}
          <Field label="Billing Type">
            <NativeSelect
              value={f.billing_type}
              onChange={(e) => handleBillingTypeChange(e.target.value)}
            >
              <option value="recurring">Recurring Retainer</option>
              <option value="one_time">One-Time Assignment</option>
            </NativeSelect>
          </Field>
          <Field label="Frequency">
            <NativeSelect
              value={f.frequency}
              disabled={f.billing_type === "one_time"}
              onChange={set("frequency")}
            >
              {f.billing_type === "one_time" ? (
                <option value="one_time">One-time</option>
              ) : (
                Object.entries(FREQS)
                  .filter(([k]) => k !== "one_time")
                  .map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))
              )}
            </NativeSelect>
          </Field>

          {/* Default Fee */}
          <Field label="Default Fee (₹)">
            <Input
              type="number"
              min={0}
              value={f.default_fee}
              onChange={set("default_fee")}
              placeholder="e.g. 2500"
            />
          </Field>

          {/* Due Rule */}
          <Field label="Due (days after period end)">
            <Input
              type="number"
              min={0}
              value={f.due_days}
              onChange={set("due_days")}
              placeholder="e.g. 20"
            />
          </Field>

          {/* SAC Code */}
          <Field label="SAC Code" className="sm:col-span-2">
            <div className="space-y-1.5">
              <NativeSelect
                value={sacChoice}
                onChange={(e) => handleSacChoiceChange(e.target.value)}
              >
                {COMMON_SAC_CODES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
                <option value="custom">Other / Custom SAC Code...</option>
              </NativeSelect>

              {sacChoice === "custom" && (
                <Input
                  value={f.sac_code}
                  onChange={set("sac_code")}
                  placeholder="Enter 6-digit SAC Code (e.g. 998211)"
                  maxLength={10}
                />
              )}
            </div>
          </Field>

          {/* Description & Scope of Work */}
          <Field
            label="Scope of Work / Description"
            className="sm:col-span-2"
          >
            <Textarea
              rows={2}
              value={f.description}
              onChange={set("description")}
              placeholder="e.g. Scope of work: Computation of output tax liability, ITC reconciliation against GSTR-2B, tax challan preparation and GSTR-3B filing."
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save Service</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
