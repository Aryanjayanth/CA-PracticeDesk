import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useSuperAdmin() {
  const q = useQuery({
    queryKey: ["is-super-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_super_admin");
      if (error) throw error;
      return !!data;
    },
  });
  return { isSuperAdmin: !!q.data, loading: q.isLoading };
}

export function useCurrentFirm() {
  return useQuery({
    queryKey: ["current-firm"],
    queryFn: async () => {
      const { data: id } = await supabase.rpc("current_firm_id");
      if (!id) return null;
      const { data } = await supabase.from("firms").select("*").eq("id", id as string).maybeSingle();
      return data;
    },
  });
}
