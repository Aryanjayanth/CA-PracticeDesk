import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const roleEnum = z.enum(["owner", "admin", "accountant", "staff", "cashier"]);

const inviteSchema = z.object({
  firmId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(255),
  fullName: z.string().trim().max(120).optional(),
  role: roleEnum,
  redirectTo: z.string().url(),
});


async function doInvite(input: z.infer<typeof inviteSchema>) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error: invErr } = await supabaseAdmin.from("firm_invites").insert({
    firm_id: input.firmId, email: input.email, role: input.role, full_name: input.fullName || null,
  });
  if (invErr) throw new Error(invErr.message);

  let inviteLink: string | null = null;
  try {
    const linkRes = await supabaseAdmin.auth.admin.generateLink({
      type: "invite",
      email: input.email,
      options: {
        redirectTo: input.redirectTo,
        data: { full_name: input.fullName },
      },
    });
    if (linkRes.data?.properties?.action_link) {
      inviteLink = linkRes.data.properties.action_link;
    }
  } catch (linkErr) {
    console.warn("[doInvite] generateLink fallback:", linkErr);
  }

  const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(input.email, {
    redirectTo: input.redirectTo,
    data: { full_name: input.fullName },
  });

  if (!error) return { status: "invited" as const, inviteLink };

  // Account already exists: attach it to the firm if it isn't in one yet.
  const { data: prof } = await supabaseAdmin.from("profiles").select("id, firm_id").ilike("email", input.email).maybeSingle();
  if (!prof) throw new Error(error.message);
  if (prof.firm_id && prof.firm_id !== input.firmId) throw new Error("This email already belongs to another firm");
  await supabaseAdmin.from("profiles").update({ firm_id: input.firmId }).eq("id", prof.id);
  await supabaseAdmin.from("user_roles").upsert({ user_id: prof.id, role: input.role }, { onConflict: "user_id,role" });
  await supabaseAdmin.from("firm_invites").update({ accepted: true }).ilike("email", input.email).eq("firm_id", input.firmId);
  return { status: "linked" as const, inviteLink: null };
}

export const inviteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => inviteSchema.parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: isSuper } = await sb.rpc("is_super_admin");
    if (!isSuper) {
      const [{ data: mgr }, { data: firm }] = await Promise.all([sb.rpc("is_manager"), sb.rpc("current_firm_id")]);
      if (!mgr || firm !== data.firmId) throw new Error("Not authorised");
      if (data.role === "owner") {
        const { data: own } = await sb.rpc("has_role", { _user_id: context.userId, _role: "owner" });
        if (!own) throw new Error("Only an Owner can invite another Owner");
      }
    }
    return doInvite(data);
  });

export const createFirm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    name: z.string().trim().min(2).max(150),
    ownerEmail: z.string().trim().toLowerCase().email().max(255),
    ownerName: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(20).optional(),
    city: z.string().trim().max(80).optional(),
    logoUrl: z.string().max(200000).nullable().optional(),
    redirectTo: z.string().url(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: isSuper } = await sb.rpc("is_super_admin");
    if (!isSuper) throw new Error("Not authorised");
    const { data: firmId, error } = await sb.rpc("create_firm", {
      _name: data.name, _owner_email: data.ownerEmail, _phone: data.phone ?? "", _city: data.city ?? "", _logo_url: data.logoUrl ?? "",
    });
    if (error) throw new Error(error.message);
    const r = await doInvite({ firmId: firmId as string, email: data.ownerEmail, fullName: data.ownerName, role: "owner", redirectTo: data.redirectTo });
    return { firmId: firmId as string, ...r };
  });

export const deleteFirm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ firmId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: isSuper } = await sb.rpc("is_super_admin");
    if (!isSuper) throw new Error("Not authorised: Only Super Admin can delete firms");

    // Try calling delete_firm RPC
    const { error: rpcErr } = await (sb.rpc as any)("delete_firm", { _firm_id: data.firmId });
    if (!rpcErr) return { success: true };

    // Fallback: check status and delete
    const { data: firm, error: fErr } = await sb
      .from("firms")
      .select("id, status, name")
      .eq("id", data.firmId)
      .maybeSingle();

    if (fErr || !firm) throw new Error("Firm not found");
    if (firm.status !== "suspended") {
      throw new Error("Firm must be suspended before it can be deleted.");
    }

    const { error: delErr } = await sb.from("firms").delete().eq("id", data.firmId);
    if (delErr) throw new Error(delErr.message || rpcErr?.message);

    return { success: true };
  });
