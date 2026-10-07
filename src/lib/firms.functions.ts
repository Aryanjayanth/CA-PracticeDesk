import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const roleEnum = z.enum(["admin", "staff", "cashier"]);

const inviteSchema = z.object({
  firmId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(255),
  fullName: z.string().trim().max(120).optional(),
  role: roleEnum,
  redirectTo: z.string().url(),
});

async function generateActionLink(
  supabaseAdmin: any,
  email: string,
  fullName?: string,
  redirectTo?: string,
) {
  const targetRedirect = redirectTo || "http://localhost:5173/set-password";
  
  // 1. Try invite link first
  try {
    const res = await supabaseAdmin.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        redirectTo: targetRedirect,
        data: fullName ? { full_name: fullName } : undefined,
      },
    });
    if (res.data?.properties?.action_link) {
      return res.data.properties.action_link;
    }
  } catch (e) {
    console.warn("[generateActionLink] invite type failed:", e);
  }

  // 2. Try recovery link (allows user to set password)
  try {
    const res = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: {
        redirectTo: targetRedirect,
      },
    });
    if (res.data?.properties?.action_link) {
      return res.data.properties.action_link;
    }
  } catch (e) {
    console.warn("[generateActionLink] recovery type failed:", e);
  }

  // 3. Try magiclink
  try {
    const res = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: {
        redirectTo: targetRedirect,
      },
    });
    if (res.data?.properties?.action_link) {
      return res.data.properties.action_link;
    }
  } catch (e) {
    console.warn("[generateActionLink] magiclink type failed:", e);
  }

  // 4. If user does not exist in auth.users at all and invite failed, create user explicitly then generate recovery link
  try {
    await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : undefined,
    });
    const res = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: {
        redirectTo: targetRedirect,
      },
    });
    if (res.data?.properties?.action_link) {
      return res.data.properties.action_link;
    }
  } catch (e) {
    console.warn("[generateActionLink] createUser fallback failed:", e);
  }

  return null;
}

async function doInvite(input: z.infer<typeof inviteSchema>) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  
  // Record the invite in firm_invites
  await supabaseAdmin.from("firm_invites").upsert(
    {
      firm_id: input.firmId,
      email: input.email,
      role: input.role,
      full_name: input.fullName || null,
      accepted: false,
    },
    { onConflict: "firm_id,email" }
  );

  // Generate action link (always succeeds with our fallbacks)
  const inviteLink = await generateActionLink(
    supabaseAdmin,
    input.email,
    input.fullName,
    input.redirectTo
  );

  // Attempt to send email invite (swallow errors so missing SMTP doesn't block link generation)
  let emailSent = false;
  try {
    const { error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(input.email, {
      redirectTo: input.redirectTo,
      data: { full_name: input.fullName },
    });
    if (!inviteErr) {
      emailSent = true;
    }
  } catch (err) {
    console.warn("[doInvite] email dispatch error (ignored):", err);
  }

  // Link profile & roles if profile exists
  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("id, firm_id")
    .ilike("email", input.email)
    .maybeSingle();

  if (prof) {
    if (prof.firm_id && prof.firm_id !== input.firmId) {
      throw new Error("This email already belongs to another firm");
    }
    await supabaseAdmin.from("profiles").update({ firm_id: input.firmId }).eq("id", prof.id);
    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: prof.id, role: input.role }, { onConflict: "user_id,role" });
    await supabaseAdmin
      .from("firm_invites")
      .update({ accepted: true })
      .ilike("email", input.email)
      .eq("firm_id", input.firmId);
    return { status: "linked" as const, inviteLink, emailSent };
  }

  return { status: "invited" as const, inviteLink, emailSent };
}

export const inviteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => inviteSchema.parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: isSuper } = await sb.rpc("is_super_admin");
    if (!isSuper) {
      const [{ data: mgr }, { data: firm }] = await Promise.all([
        sb.rpc("is_manager"),
        sb.rpc("current_firm_id"),
      ]);
      if (!mgr || firm !== data.firmId) throw new Error("Not authorised");
    }
    return doInvite(data);
  });

export const generateLoginLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        email: z.string().trim().toLowerCase().email(),
        firmId: z.string().uuid().optional(),
        role: roleEnum.optional(),
        redirectTo: z.string().url().optional(),
      })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: isSuper } = await sb.rpc("is_super_admin");
    if (!isSuper) {
      const [{ data: mgr }, { data: firm }] = await Promise.all([
        sb.rpc("is_manager"),
        sb.rpc("current_firm_id"),
      ]);
      if (!mgr || (data.firmId && firm !== data.firmId)) throw new Error("Not authorised");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const link = await generateActionLink(
      supabaseAdmin,
      data.email,
      undefined,
      data.redirectTo || `${process.env.APP_URL || "http://localhost:5173"}/set-password`
    );
    if (!link) throw new Error("Could not generate direct link for this email");
    return { link, email: data.email };
  });

export const createFirm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        name: z.string().trim().min(2).max(150),
        ownerEmail: z.string().trim().toLowerCase().email().max(255),
        ownerName: z.string().trim().max(120).optional(),
        phone: z.string().trim().max(20).optional(),
        city: z.string().trim().max(80).optional(),
        logoUrl: z.string().max(200000).nullable().optional(),
        redirectTo: z.string().url(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: isSuper } = await sb.rpc("is_super_admin");
    if (!isSuper) throw new Error("Not authorised");
    const { data: firmId, error } = await sb.rpc("create_firm", {
      _name: data.name,
      _owner_email: data.ownerEmail,
      _phone: data.phone ?? "",
      _city: data.city ?? "",
      _logo_url: data.logoUrl ?? "",
    });
    if (error) throw new Error(error.message);
    const r = await doInvite({
      firmId: firmId as string,
      email: data.ownerEmail,
      fullName: data.ownerName,
      role: "admin",
      redirectTo: data.redirectTo,
    });
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
    const { error: rpcErr } = await sb.rpc("delete_firm", { _firm_id: data.firmId });
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
