import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useReceivables(enabled: boolean) {
  return useQuery({
    queryKey: ["receivables"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select(
          "*, clients(id,name,assigned_staff), invoice_items(amount, description, jobs(job_code, service_id, services(name)))",
        )
        .in("status", ["unpaid", "partially_paid", "paid"])
        .order("due_date");
      if (error) throw error;
      return data;
    },
  });
}
