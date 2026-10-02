import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { LayoutGrid, List, Mail, Phone, Plus, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/app/DataTable";
import { NativeSelect, PageHeader } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { ClientForm } from "@/components/app/ClientForm";
import { EntityAvatar } from "@/components/app/EntityAvatar";
import { useProfiles, useRoles } from "@/hooks/use-roles";
import { fmtDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/clients/")({
  head: () => ({ meta: [{ title: "Clients — CA PracticeDesk" }, { name: "description", content: "Client master." }] }),
  component: ClientsPage,
});

function ClientsPage() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [term, setTerm] = useState("");
  const [view, setView] = useState<"cards" | "table">("cards");
  const navigate = useNavigate();
  const { isManager } = useRoles();
  const { data: profiles } = useProfiles();
  const pname = (id: string | null) => profiles?.find((p) => p.id === id)?.full_name ?? "—";
  const q = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
  const rows = (q.data ?? []).filter((c) => !status || c.status === status);
  const cards = rows.filter((c) => `${c.name} ${c.client_code} ${c.pan} ${c.gstin} ${c.mobile} ${c.email}`.toLowerCase().includes(term.toLowerCase()));
  const go = (id: string) => navigate({ to: "/clients/$id", params: { id } });

  const statusSel = <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="w-40"><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option></NativeSelect>;
  const toggle = (
    <div className="flex rounded-md border p-0.5">
      <Button size="sm" variant={view === "cards" ? "secondary" : "ghost"} className="h-8 px-2" onClick={() => setView("cards")} aria-label="Card view"><LayoutGrid className="h-4 w-4" /></Button>
      <Button size="sm" variant={view === "table" ? "secondary" : "ghost"} className="h-8 px-2" onClick={() => setView("table")} aria-label="Table view"><List className="h-4 w-4" /></Button>
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Clients" subtitle={`${q.data?.length ?? 0} clients in your practice`}
        actions={<>{toggle}{isManager && <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />Add Client</Button>}</>} />
      {view === "cards" ? (
        <>
          <div className="mb-5 flex flex-wrap gap-3">
            <div className="relative w-full max-w-sm"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search clients…" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
            {statusSel}
          </div>
          {q.isLoading ? <div className="text-muted-foreground">Loading…</div> : cards.length === 0 ? (
            <Card><CardContent className="p-12 text-center text-muted-foreground">No clients found.</CardContent></Card>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {cards.map((c) => (
                <Card key={c.id} className="cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md" onClick={() => go(c.id)}>
                  <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
                    <EntityAvatar name={c.name} src={c.avatar_url} className="h-16 w-16 text-xl" />
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{c.client_type} · <span className="font-mono">{c.client_code}</span></div>
                    </div>
                    <StatusBadge status={c.status} />
                    <div className="w-full space-y-1 border-t pt-3 text-xs text-muted-foreground">
                      {c.mobile && <div className="flex items-center justify-center gap-1.5"><Phone className="h-3 w-3" />{c.mobile}</div>}
                      {c.email && <div className="flex items-center justify-center gap-1.5 truncate"><Mail className="h-3 w-3" />{c.email}</div>}
                      <div>Staff: {pname(c.assigned_staff)}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <DataTable rows={rows} loading={q.isLoading} empty="No clients yet — add your first client."
          search={(c) => `${c.name} ${c.client_code} ${c.pan} ${c.gstin} ${c.mobile} ${c.email}`}
          onRowClick={(c) => go(c.id)}
          toolbar={statusSel}
          columns={[
            { key: "name", header: "Client", sort: (c) => c.name, render: (c) => <span className="flex items-center gap-2 font-medium"><EntityAvatar name={c.name} src={c.avatar_url} className="h-7 w-7 text-xs" />{c.name}</span> },
            { key: "client_code", header: "ID", className: "font-mono text-xs" },
            { key: "client_type", header: "Type" },
            { key: "pan", header: "PAN", className: "font-mono text-xs" },
            { key: "mobile", header: "Mobile" },
            { key: "staff", header: "Staff", render: (c) => pname(c.assigned_staff) },
            { key: "status", header: "Status", render: (c) => <StatusBadge status={c.status} /> },
            { key: "created_at", header: "Created", sort: (c) => c.created_at, render: (c) => fmtDate(c.created_at) },
          ]} />
      )}
      <ClientForm open={open} onOpenChange={setOpen} />
    </div>
  );
}
