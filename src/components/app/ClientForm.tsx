import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, NativeSelect } from "./common";
import { AvatarPicker } from "./EntityAvatar";
import { useProfiles } from "@/hooks/use-roles";
import { errMsg } from "@/lib/format";

type Client = Tables<"clients">;

const STANDARD_INDUSTRIES = [
  "Information Technology (IT / Software)",
  "Manufacturing & Engineering",
  "Retail & Wholesale Trade",
  "Real Estate & Construction",
  "Financial Services & Banking",
  "Healthcare & Pharmaceuticals",
  "Hospitality, Food & Restaurants",
  "Professional & Consulting Services",
  "Transportation & Logistics",
  "Education & Training",
  "Agriculture & Agro-processing",
  "Automobile & Auto Parts",
  "Textiles & Garments",
  "Others",
] as const;

const Req = () => <span className="text-red-500 font-semibold ml-0.5">*</span>;

const schema = z.object({
  name: z.string().trim().min(2, "Client Name is required (minimum 2 characters)").max(200),
  mobile: z
    .string()
    .trim()
    .min(10, "Mobile number is required (at least 10 digits)")
    .regex(/^[0-9+\- ]{10,15}$/, "Please enter a valid mobile number (e.g. 98765 43210)"),
  email: z.string().trim().min(1, "Email address is required").email("Please enter a valid email address (e.g. client@company.com)"),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN must be 10 characters in valid format: 5 letters, 4 numbers, 1 letter (e.g. ABCDE1234F)"),
  tan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z]{4}[0-9]{5}[A-Z])?$/, "TAN must be 10 characters in valid format: 4 letters, 5 numbers, 1 letter (e.g. DELA12345B)")
    .optional(),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([0-9]{2}[A-Z0-9]{13})?$/, "GSTIN must be 15 characters (e.g. 27ABCDE1234F1Z5)")
    .optional(),
});

const empty = {
  name: "",
  client_type: "Company",
  mobile: "",
  email: "",
  address: "",
  pan: "",
  tan: "",
  gstin: "",
  gst_type: "Regular",
  business_type: "",
  industry: "",
  financial_year: "2026-27",
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
    if (open) {
      setF(
        client
          ? Object.fromEntries(
              Object.keys(empty).map((k) => [
                k,
                String((client as Record<string, unknown>)[k] ?? ""),
              ])
            )
          : empty
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
    }
  }, [open, client]);

  const set = (k: string) => (e: { target: { value: string } }) => {
    const val = ["pan", "tan", "gstin"].includes(k)
      ? e.target.value.toUpperCase()
      : e.target.value;
    setF((p) => ({ ...p, [k]: val }));
  };

  const save = async () => {
    const v = schema.safeParse(f);
    if (!v.success) return toast.error(v.error.issues[0].message);

    const resolvedIndustry =
      industrySelect === "Others"
        ? customIndustry.trim() || "Others"
        : industrySelect.trim();

    setBusy(true);
    const payload = {
      ...f,
      name: f.name.trim(),
      mobile: f.mobile.trim(),
      email: f.email.trim(),
      avatar_url: avatar,
      pan: f.pan.toUpperCase().trim() || null,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{client ? `Edit ${client.name}` : "Add Client"}</DialogTitle>
        </DialogHeader>

        <div className="mb-2">
          <AvatarPicker name={f.name} value={avatar} onChange={setAvatar} />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {/* Row 1 */}
          <Field label={<>Client Name <Req /></>} className="sm:col-span-2">
            <Input
              required
              value={f.name}
              onChange={set("name")}
              placeholder="e.g. Acme Corporation Pvt Ltd"
            />
          </Field>
          <Field label="Client Type">
            <NativeSelect value={f.client_type} onChange={set("client_type")}>
              {[
                "Company",
                "Partnership",
                "LLP",
                "Proprietorship",
                "Individual",
                "HUF",
                "Trust",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </NativeSelect>
          </Field>

          {/* Row 2 */}
          <Field label={<>Mobile <Req /></>}>
            <Input
              required
              value={f.mobile}
              onChange={set("mobile")}
              placeholder="e.g. 98765 43210"
            />
          </Field>
          <Field label={<>Email <Req /></>}>
            <Input
              required
              type="email"
              value={f.email}
              onChange={set("email")}
              placeholder="e.g. accounts@acme.com"
            />
          </Field>
          <Field label="Status">
            <NativeSelect value={f.status} onChange={set("status")}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </NativeSelect>
          </Field>

          {/* Row 3 - Tax IDs */}
          <Field label={<>PAN <Req /></>}>
            <Input
              required
              value={f.pan}
              onChange={set("pan")}
              className="uppercase font-mono"
              placeholder="e.g. ABCDE1234F"
              maxLength={10}
            />
          </Field>
          <Field label="TAN">
            <Input
              value={f.tan}
              onChange={set("tan")}
              className="uppercase font-mono"
              placeholder="e.g. DELA12345B"
              maxLength={10}
            />
          </Field>
          <Field label="GSTIN">
            <Input
              value={f.gstin}
              onChange={set("gstin")}
              className="uppercase font-mono"
              placeholder="e.g. 27ABCDE1234F1Z5"
              maxLength={15}
            />
          </Field>

          {/* Row 4 - GST & Period */}
          <Field label="GST Type">
            <NativeSelect value={f.gst_type} onChange={set("gst_type")}>
              {["Regular", "Composition", "Unregistered", "SEZ"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Financial Year">
            <Input
              value={f.financial_year}
              onChange={set("financial_year")}
              placeholder="e.g. 2026-27"
            />
          </Field>
          <Field label="Assigned Staff">
            <NativeSelect
              value={f.assigned_staff}
              onChange={set("assigned_staff")}
            >
              <option value="">— Unassigned —</option>
              {profiles?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name ?? p.email}
                </option>
              ))}
            </NativeSelect>
          </Field>

          {/* Row 5 - Unified Industry / Business Nature */}
          <Field
            label="Industry / Business Type"
            className={industrySelect === "Others" ? "sm:col-span-1" : "sm:col-span-3"}
          >
            <NativeSelect
              value={industrySelect}
              onChange={(e) => setIndustrySelect(e.target.value)}
            >
              <option value="">— Select Industry / Sector —</option>
              {STANDARD_INDUSTRIES.map((ind) => (
                <option key={ind} value={ind}>
                  {ind}
                </option>
              ))}
            </NativeSelect>
          </Field>

          {industrySelect === "Others" && (
            <Field label="Specify Custom Business Nature" className="sm:col-span-2">
              <Input
                value={customIndustry}
                onChange={(e) => setCustomIndustry(e.target.value)}
                placeholder="e.g. Solar Energy Installation, Event Management"
              />
            </Field>
          )}

          {/* Row 6 - Address & Notes */}
          <Field label="Address" className="sm:col-span-3">
            <Textarea
              rows={2}
              value={f.address}
              onChange={set("address")}
              placeholder="Registered business address..."
            />
          </Field>
          <Field label="Notes" className="sm:col-span-3">
            <Textarea
              rows={2}
              value={f.notes}
              onChange={set("notes")}
              placeholder="Internal firm notes regarding this client..."
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
