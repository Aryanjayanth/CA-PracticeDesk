import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentFirm, useSuperAdmin } from "@/hooks/use-firm";
import { errMsg } from "@/lib/format";

export function FirmSwitcher() {
  const { isSuperAdmin } = useSuperAdmin();
  const { data: firm } = useCurrentFirm();
  const qc = useQueryClient();
  const firms = useQuery({
    queryKey: ["firms-list"], enabled: isSuperAdmin,
    queryFn: async () => (await supabase.from("firms").select("id, name").order("name")).data ?? [],
  });
  if (!isSuperAdmin) return null;
  return (
    <select
      aria-label="Switch firm"
      value={firm?.id ?? ""}
      onChange={async (e) => {
        const { error } = await supabase.rpc("set_acting_firm", { _firm_id: e.target.value || null as unknown as string });
        if (error) return toast.error(errMsg(error));
        await qc.invalidateQueries();
        toast.success("Switched firm");
      }}
      className="h-9 max-w-[200px] rounded-md border border-input bg-background px-2 text-sm"
    >
      <option value="">— Select firm —</option>
      {firms.data?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
    </select>
  );
}
