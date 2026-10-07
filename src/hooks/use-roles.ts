import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * The three firm roles. Admin is the firm's top role and always passes
 * has_capability() in Postgres, so it can never lock itself out; what Staff and
 * Cashier may do is decided per module by the Admin. See usePermissions().
 */
export type Role = "admin" | "staff" | "cashier";

export const ROLES: Role[] = ["admin", "staff", "cashier"];

export function useRoles() {
  const q = useQuery({
    queryKey: ["my-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_roles");
      if (error) throw error;
      // Until the permissions migration is applied, my_roles() still returns the
      // old enum labels. Fold them into the three current roles here so the rest
      // of the app only ever sees admin/staff/cashier — this is the same mapping
      // the migration performs in SQL.
      const raw = (data ?? []) as string[];
      return [
        ...new Set(raw.map((r) => (r === "owner" || r === "accountant" ? "admin" : (r as Role)))),
      ].filter((r): r is Role => r === "admin" || r === "staff" || r === "cashier");
    },
  });
  const roles = q.data ?? [];
  const has = (...r: Role[]) => roles.some((x) => r.includes(x));
  return {
    roles,
    loading: q.isLoading,
    isManager: has("admin"),
    // Invoicing, receivables and reports are not part of the configurable
    // matrix: they stay with Admin so money is never edited by a Cashier.
    isFinance: has("admin"),
    isStaff: has("admin", "staff"),
    isCashierOnly: roles.length > 0 && roles.every((r) => r === "cashier"),
    has,
  };
}

export function useProfiles() {
  return useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, active")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });
}

export function useClientLookup() {
  return useQuery({
    queryKey: ["client-lookup"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("client_lookup");
      if (error) throw error;
      return data ?? [];
    },
  });
}
