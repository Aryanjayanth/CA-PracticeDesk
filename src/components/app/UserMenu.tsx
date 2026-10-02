import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useRoles } from "@/hooks/use-roles";
import { label } from "@/lib/format";

export function UserMenu() {
  const { user } = useRouteContext({ from: "/_authenticated" });
  const { roles } = useRoles();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right text-xs sm:block">
        <div className="font-medium">{user.email}</div>
        <div className="text-muted-foreground">{roles.map(label).join(", ") || "No role"}</div>
      </div>
      <Button variant="outline" size="sm" onClick={signOut}><LogOut className="mr-1 h-4 w-4" />Sign out</Button>
    </div>
  );
}
