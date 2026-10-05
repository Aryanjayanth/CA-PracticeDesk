import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/app/DataTable";
import { NativeSelect, NoAccess, PageHeader } from "@/components/app/common";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useRoles } from "@/hooks/use-roles";
import { fmtDate, inr, invoiceDisplayStatus, label } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/invoices/")({
  head: () => ({
    meta: [
      { title: "Invoices — CA PracticeDesk" },
      { name: "description", content: "Billing and invoices." },
    ],
  }),
  component: InvoicesPage,
});

function InvoicesPage() {
  const { isFinance, loading } = useRoles();
  const [status, setStatus] = useState("");
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["invoices"],
    enabled: isFinance,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, clients(name)")
        .order("invoice_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  if (loading) return null;
  if (!isFinance) return <NoAccess />;
  const rows = (q.data ?? []).filter((i) => !status || invoiceDisplayStatus(i) === status);
  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="Bills raised to clients"
        actions={
          <Button asChild>
            <Link to="/invoices/new">
              <Plus className="mr-1 h-4 w-4" />
              Create Invoice
            </Link>
          </Button>
        }
      />
      <DataTable
        rows={rows}
        loading={q.isLoading}
        empty="No invoices yet."
        search={(i) => `${i.invoice_no} ${i.clients?.name} ${i.description}`}
        onRowClick={(i) => navigate({ to: "/invoices/$id", params: { id: i.id } })}
        toolbar={
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            <option value="">All statuses</option>
            {["draft", "unpaid", "partially_paid", "paid", "overdue", "cancelled"].map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </NativeSelect>
        }
        columns={[
          {
            key: "n",
            header: "Invoice",
            sort: (i) => i.invoice_no,
            render: (i) => (
              <Link
                to="/invoices/$id"
                params={{ id: i.id }}
                className="font-mono text-xs text-primary"
              >
                {i.invoice_no}
              </Link>
            ),
          },
          {
            key: "c",
            header: "Client",
            sort: (i) => i.clients?.name ?? "",
            render: (i) => <span className="font-medium">{i.clients?.name}</span>,
          },
          {
            key: "d",
            header: "Date",
            sort: (i) => i.invoice_date,
            render: (i) => fmtDate(i.invoice_date),
          },
          { key: "dd", header: "Due", sort: (i) => i.due_date, render: (i) => fmtDate(i.due_date) },
          { key: "s", header: "Subtotal", align: "right", render: (i) => inr(i.subtotal) },
          {
            key: "disc",
            header: "Discount",
            align: "right",
            render: (i) => (Number(i.discount) ? inr(i.discount) : "—"),
          },
          {
            key: "t",
            header: "Total",
            align: "right",
            sort: (i) => Number(i.total),
            render: (i) => inr(i.total),
          },
          { key: "p", header: "Paid", align: "right", render: (i) => inr(i.amount_paid) },
          {
            key: "o",
            header: "Outstanding",
            align: "right",
            sort: (i) => Number(i.outstanding),
            render: (i) => <span className="font-medium">{inr(i.outstanding)}</span>,
          },
          {
            key: "st",
            header: "Status",
            render: (i) => <StatusBadge status={invoiceDisplayStatus(i)} />,
          },
        ]}
      />
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between text-muted-foreground">
    <span>{k}</span>
    <span className="tabular-nums">{v}</span>
  </div>
);
