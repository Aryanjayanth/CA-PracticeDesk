import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, ChipSelect, NativeSelect, type ChipOption } from "./common";
import { AvatarPicker } from "./EntityAvatar";
import { useProfiles } from "@/hooks/use-roles";
import {
  CLIENT_STATUSES,
  CLIENT_TYPES,
  CONCERN_ROLES,
  GST_TYPES,
  STANDARD_INDUSTRIES,
} from "@/lib/client-options";
import { errMsg } from "@/lib/format";

type Client = Tables<"clients">;

const opts = <T extends string>(xs: readonly T[]): ChipOption<T>[] =>
  xs.map((x) => ({ value: x, label: x }));

const Req = () => <span className="ml-0.5 font-semibold text-destructive">*</span>;

// Mandatory set per the practice's client-onboarding policy. Mirrored by the
// clients_validate_required trigger in Postgres — keep the two in sync.
// The concerned-person block is entirely optional: leave it blank to skip.
const schema = z.object({
  name: z.string().trim().min(2, "Client Name is required (minimum 2 characters)").max(200),
  client_type: z.string().trim().min(1, "Client Type is required"),
  address: z.string().trim().min(5, "Address is required (minimum 5 characters)"),
  mobile: z
    .string()
    .trim()
    .min(10, "Phone Number is required (at least 10 digits)")
    .regex(/^[0-9+\- ]{10,15}$/, "Please enter a valid phone number (e.g. 98765 43210)"),
  secondary_phone: z
    .string()
    .trim()
    .regex(
      /^$|^[0-9+\- ]{10,15}$/,
      "Please enter a valid phone number (e.g. 98765 43210), or leave it blank",
    ),
  contact_person_name: z.string().trim().max(120, "Name is too long"),
  contact_person_phone: z
    .string()
    .trim()
    .regex(
      /^$|^[0-9+\- ]{10,15}$/,
      "Please enter a valid phone number (e.g. 98765 43210), or leave it blank",
    ),
  email: z
    .string()
    .trim()
    .regex(
      /^$|^[^@\s]+@[^@\s]+\.[^@\s]+$/,
      "Please enter a valid email address (e.g. client@company.com)",
    ),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z]{5}[0-9]{4}[A-Z]$/,
      "PAN must be 10 characters in valid format: 5 letters, 4 numbers, 1 letter (e.g. ABCDE1234F)",
    ),
  tan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^([A-Z]{4}[0-9]{5}[A-Z])?$/,
      "TAN must be 10 characters in valid format: 4 letters, 5 numbers, 1 letter (e.g. DELA12345B)",
    ),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([0-9]{2}[A-Z0-9]{13})?$/, "GSTIN must be 15 characters (e.g. 27ABCDE1234F1Z5)"),
});

const empty = {
  name: "",
  client_type: "Company",
  mobile: "",
  secondary_phone: "",
  email: "",
  address: "",
  contact_person_name: "",
  contact_person_phone: "",
  contact_person_role: "",
  pan: "",
  tan: "",
  gstin: "",
  gst_type: "",
  business_type: "",
  industry: "",
  assigned_staff: "",
  status: "active",
  notes: "",
};

export function ClientForm({
  open,
  onOpenChange,
  client,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  client?: Client | null;
}) {
  const [f, setF] = useState<Record<string, string>>(empty);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [industrySelect, setIndustrySelect] = useState<string>("");
  const [customIndustry, setCustomIndustry] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const { data: profiles } = useProfiles();

  useEffect(() => {
    if (!open) return;
    setF(
      client
        ? Object.fromEntries(
            Object.keys(empty).map((k) => [
              k,
              String((client as Record<string, unknown>)[k] ?? ""),
            ]),
          )
        : empty,
    );
    setAvatar(client?.avatar_url ?? null);

    const existingInd = client?.industry || client?.business_type || "";
    if (existingInd && (STANDARD_INDUSTRIES as readonly string[]).includes(existingInd)) {
      setIndustrySelect(existingInd);
      setCustomIndustry("");
    } else if (existingInd) {
      setIndustrySelect("Others");
      setCustomIndustry(existingInd);
    } else {
      setIndustrySelect("");
      setCustomIndustry("");
    }
  }, [open, client]);

  // Close on Escape. Body scroll is intentionally NOT locked — the form scrolls
  // with the page so long forms stay reachable.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onOpenChange]);

  const set = (k: string) => (e: { target: { value: string } }) => {
    const val = ["pan", "tan", "gstin"].includes(k) ? e.target.value.toUpperCase() : e.target.value;
    setF((p) => ({ ...p, [k]: val }));
  };
  const pick = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const save = async () => {
    const merged = { ...f, industry: industrySelect, business_type: industrySelect };
    const v = schema.safeParse(merged);
    if (!v.success) return toast.error(v.error.issues[0].message);

    const resolvedIndustry =
      industrySelect === "Others" ? customIndustry.trim() || "Others" : industrySelect.trim();

    setBusy(true);
    const payload = {
      ...f,
      name: f.name.trim(),
      client_type: f.client_type.trim(),
      address: f.address.trim(),
      mobile: f.mobile.trim(),
      secondary_phone: f.secondary_phone.trim() || null,
      contact_person_name: f.contact_person_name.trim() || null,
      contact_person_phone: f.contact_person_phone.trim() || null,
      contact_person_role: f.contact_person_role.trim() || null,
      email: f.email.trim() || null,
      avatar_url: avatar,
      pan: f.pan.toUpperCase().trim() || null,
      gst_type: f.gst_type.trim() || null,
      gstin: f.gstin.toUpperCase().trim() || null,
      tan: f.tan.toUpperCase().trim() || null,
      assigned_staff: f.assigned_staff || null,
      industry: resolvedIndustry || null,
      business_type: resolvedIndustry || null,
    };

    const { error } = client
      ? await supabase
          .from("clients")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", client.id)
      : await supabase.from("clients").insert(payload);

    setBusy(false);
    if (error) return toast.error(errMsg(error));
    toast.success(client ? "Client updated" : "Client added");
    qc.invalidateQueries();
    onOpenChange(false);
  };

  if (!open) return null;

  // Full-bleed within the page content area: negative margins cancel <main>'s
  // padding so the form fills the space beside the sidebar, which stays visible.
  return (
    <div
      className="-m-5 flex min-h-[calc(100svh-4rem)] flex-col bg-background md:-m-8"
      role="dialog"
      aria-label={client ? `Edit ${client.name}` : "Add Client"}
    >
      {/* Header — sticky below the app header so it stays put while the page scrolls */}
      <div className="sticky top-16 z-10 flex shrink-0 items-center justify-between gap-4 border-b bg-card px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {client ? `Edit ${client.name}` : "Add Client"}
          </h2>
          <p className="text-xs text-muted-foreground">
            Fields marked <span className="font-semibold text-destructive">*</span> are mandatory.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onOpenChange(false)}
          disabled={busy}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Body — grows with content; the page scrolls, never a trapped inner box */}
      <div className="mx-auto w-full max-w-5xl flex-1 space-y-8 px-6 py-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <AvatarPicker name={f.name} value={avatar} onChange={setAvatar} />
          <p className="text-xs text-muted-foreground">
            Client logo or photo. Stored as a small resized image inside the database.
          </p>
        </div>

        {/* 1 — Identity */}
        <Section title="Client Identity" hint="Who this client entity is.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label={
                <>
                  Client Name <Req />
                </>
              }
              className="sm:col-span-2"
            >
              <Input
                required
                value={f.name}
                onChange={set("name")}
                placeholder="Enter client name"
              />
            </Field>
            <Field
              label={
                <>
                  Phone Number <Req />
                </>
              }
            >
              <Input
                required
                value={f.mobile}
                onChange={set("mobile")}
                placeholder="Enter phone number"
              />
            </Field>
          </div>
          <Field
            label={
              <>
                Client Type <Req />
              </>
            }
          >
            <ChipSelect
              ariaLabel="Client Type"
              value={f.client_type}
              onChange={(v) => pick("client_type", v || "Company")}
              options={opts(CLIENT_TYPES)}
            />
          </Field>
          <Field
            label={
              <>
                Address <Req />
              </>
            }
          >
            <Textarea
              required
              rows={2}
              value={f.address}
              onChange={set("address")}
              placeholder="Enter address"
            />
          </Field>
        </Section>

        {/* 2 — Contacts */}
        <Section
          title="Contacts"
          hint="Who you speak to at this client. The concerned person is optional."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label={
                <>
                  Secondary Phone{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </>
              }
            >
              <Input
                value={f.secondary_phone}
                onChange={set("secondary_phone")}
                placeholder="Enter secondary phone"
              />
            </Field>
            <Field label="Name of Concerned Person" hint="Optional">
              <Input
                value={f.contact_person_name}
                onChange={set("contact_person_name")}
                placeholder="Enter name"
              />
            </Field>
            <Field label="Concerned Person's Phone" hint="Optional">
              <Input
                value={f.contact_person_phone}
                onChange={set("contact_person_phone")}
                placeholder="Enter phone number"
              />
            </Field>
          </div>
          <Field
            label="Role of Concerned Person"
            hint="Owner, accountant, director — whoever signs off on your behalf."
          >
            <ChipSelect
              allowEmpty
              emptyLabel="— Not set —"
              ariaLabel="Role of Concerned Person"
              value={f.contact_person_role}
              onChange={(v) => pick("contact_person_role", v)}
              options={opts(CONCERN_ROLES)}
            />
          </Field>
          <Field label="Email" hint="Optional">
            <Input
              type="email"
              value={f.email}
              onChange={set("email")}
              placeholder="Enter email address"
            />
          </Field>
        </Section>

        {/* 3 — Tax identifiers */}
        <Section
          title="Tax Identifiers"
          hint="PAN is mandatory; TAN and GSTIN apply where relevant."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label={
                <>
                  PAN <Req />
                </>
              }
            >
              <Input
                required
                value={f.pan}
                onChange={set("pan")}
                className="uppercase font-mono"
                placeholder="Enter PAN"
                maxLength={10}
              />
            </Field>
            <Field label="TAN">
              <Input
                value={f.tan}
                onChange={set("tan")}
                className="uppercase font-mono"
                placeholder="Enter TAN"
                maxLength={10}
              />
            </Field>
            <Field label="GSTIN">
              <Input
                value={f.gstin}
                onChange={set("gstin")}
                className="uppercase font-mono"
                placeholder="Enter GSTIN"
                maxLength={15}
              />
            </Field>
          </div>
          <Field label="GST Type" hint="Optional">
            <ChipSelect
              allowEmpty
              emptyLabel="— Not set —"
              ariaLabel="GST Type"
              value={f.gst_type}
              onChange={(v) => pick("gst_type", v)}
              options={opts(GST_TYPES)}
            />
          </Field>
        </Section>

        {/* 4 — Practice setup */}
        <Section title="Practice Setup" hint="How this client is serviced and billed.">
          <Field label="Industry / Business Type">
            <ChipSelect
              ariaLabel="Industry"
              allowEmpty
              emptyLabel="— Not set —"
              value={industrySelect === "Others" ? "" : industrySelect}
              onChange={(v) => {
                setIndustrySelect(v);
                if (v !== "Others") setCustomIndustry("");
              }}
              options={opts(STANDARD_INDUSTRIES)}
            />
          </Field>
          {industrySelect === "Others" && (
            <Field label="Specify Custom Business Nature">
              <Input
                value={customIndustry}
                onChange={(e) => setCustomIndustry(e.target.value)}
                placeholder="Enter business nature"
              />
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Assigned Staff" hint="Leave unassigned to pick it up later.">
              <NativeSelect value={f.assigned_staff} onChange={set("assigned_staff")}>
                <option value="">— Unassigned —</option>
                {profiles?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name ?? p.email}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Status">
              <ChipSelect
                ariaLabel="Status"
                value={f.status}
                onChange={(v) => pick("status", v || "active")}
                options={CLIENT_STATUSES.map((s) => ({ ...s }))}
              />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea
              rows={2}
              value={f.notes}
              onChange={set("notes")}
              placeholder="Enter any internal notes"
            />
          </Field>
        </Section>
      </div>

      {/* Footer — sticky to the bottom of the viewport while the page scrolls */}
      <div className="sticky bottom-0 z-10 mt-auto flex shrink-0 items-center justify-end gap-2 border-t bg-card px-6 py-3">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : client ? "Save Changes" : "Add Client"}
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
