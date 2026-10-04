import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Role = "owner" | "admin" | "accountant" | "staff" | "cashier";

export function useRoles() {
  const q = useQuery({
    queryKey: ["my-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_roles");
      if (error) throw error;
      return (data ?? []) as Role[];
    },
  });
  const roles = q.data ?? [];
  const has = (...r: Role[]) => roles.some((x) => r.includes(x));
  return {
    roles,
    loading: q.isLoading,
    isManager: has("owner", "admin"),
    isFinance: has("owner", "admin", "accountant"),
    isStaff: has("owner", "admin", "accountant", "staff"),
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
