import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/app/DataTable";
import { NoAccess, PageHeader } from "@/components/app/common";
import { useRoles, type Role } from "@/hooks/use-roles";
import { errMsg, fmtDate, label } from "@/lib/format";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCurrentFirm } from "@/hooks/use-firm";
import { InviteDialog } from "@/components/app/InviteDialog";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({
    meta: [
      { title: "Users — CA PracticeDesk" },
      { name: "description", content: "Manage team members and roles." },
    ],
  }),
  component: UsersPage,
});

const ALL: Role[] = ["owner", "admin", "accountant", "staff", "cashier"];

function UsersPage() {
  const { isManager, has, loading } = useRoles();
  const { data: firm } = useCurrentFirm();
  const [invite, setInvite] = useState(false);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["users-roles"],
    enabled: isManager,
    queryFn: async () => {
      const [p, r] = await Promise.all([
        supabase.from("profiles").select("*").not("firm_id", "is", null).order("created_at"),
        supabase.from("user_roles").select("*"),
      ]);
      if (p.error) throw p.error;
      return (p.data ?? []).map((u) => ({
        ...u,
        roles: (r.data ?? []).filter((x) => x.user_id === u.id).map((x) => x.role as Role),
      }));
    },
  });
  if (loading) return null;
  if (!isManager) return <NoAccess />;
  const isOwner = has("owner");

  const toggle = async (userId: string, role: Role, on: boolean) => {
    if (
      !on &&
      role === "owner" &&
      (q.data ?? []).filter((u) => u.roles.includes("owner")).length <= 1
    )
      return toast.error("At least one Owner is required");
    const { error } = on
      ? await supabase.from("user_roles").insert({ user_id: userId, role })
      : await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
    if (error) return toast.error(errMsg(error));
    toast.success(`${label(role)} ${on ? "granted" : "removed"}`);
    qc.invalidateQueries();
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Users"
        subtitle="Invite team members by email and assign their roles."
        actions={
          <Button onClick={() => setInvite(true)}>
            <UserPlus className="mr-1 h-4 w-4" />
            Invite user
          </Button>
        }
      />
      <InviteDialog
        firm={invite && firm ? { id: firm.id, name: firm.name } : null}
        onClose={() => setInvite(false)}
        allowOwner={isOwner}
      />
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        empty="No users yet."
        search={(u) => `${u.full_name} ${u.email}`}
        columns={[
          {
            key: "full_name",
            header: "Name",
            render: (u) => <span className="font-medium">{u.full_name}</span>,
          },
          { key: "email", header: "Email" },
          { key: "c", header: "Joined", render: (u) => fmtDate(u.created_at) },
          ...ALL.map((r) => ({
            key: r,
            header: label(r),
            render: (u: { id: string; roles: Role[] }) => (
              <Checkbox
                checked={u.roles.includes(r)}
                disabled={r === "owner" && !isOwner}
                onCheckedChange={(c) => toggle(u.id, r, !!c)}
              />
            ),
          })),
        ]}
      />
    </div>
  );
}
