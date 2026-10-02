import { createFileRoute } from "@tanstack/react-router";
import { Check, Minus } from "lucide-react";
import { NoAccess, PageHeader } from "@/components/app/common";
import { useRoles } from "@/hooks/use-roles";

export const Route = createFileRoute("/_authenticated/roles")({
  head: () => ({ meta: [{ title: "Roles & Permissions — CA PracticeDesk" }, { name: "description", content: "What each role can do." }] }),
  component: RolesPage,
});

const ROLES = ["Owner", "Admin", "Accountant", "Staff", "Cashier"];
const MATRIX: [string, (0 | 1 | 2)[]][] = [
  ["Dashboard & financial figures", [1, 1, 1, 0, 0]],
  ["Clients — view", [1, 1, 1, 2, 0]],
  ["Clients — add / edit", [1, 1, 0, 0, 0]],
  ["Services & client-service links — manage", [1, 1, 0, 0, 0]],
  ["Jobs — view", [1, 1, 1, 2, 0]],
  ["Jobs — create / edit", [1, 1, 1, 0, 0]],
  ["Jobs — update status", [1, 1, 1, 2, 0]],
  ["Invoices, discounts, cancellation", [1, 1, 1, 0, 0]],
  ["Payment Entry", [1, 1, 1, 0, 1]],
  ["Payment history", [1, 1, 1, 0, 2]],
  ["Payment Clearing & reversal", [1, 1, 1, 0, 0]],
  ["Receivables, Ageing, Reconciliation, Reports", [1, 1, 1, 0, 0]],
  ["Users & Roles", [1, 1, 0, 0, 0]],
  ["Audit Trail & Settings", [1, 1, 0, 0, 0]],
];

function RolesPage() {
  const { isManager, loading } = useRoles();
  if (loading) return null;
  if (!isManager) return <NoAccess />;
  return (
    <div>
      <PageHeader title="Roles & Permissions" subtitle="Enforced by the database itself, not only by hiding screens." />
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2.5">Capability</th>{ROLES.map((r) => <th key={r} className="px-3 text-center">{r}</th>)}</tr></thead>
          <tbody>
            {MATRIX.map(([cap, v]) => (
              <tr key={cap} className="border-t"><td className="px-4 py-2.5">{cap}</td>
                {v.map((x, i) => <td key={i} className="text-center">{x === 1 ? <Check className="mx-auto h-4 w-4 text-success" /> : x === 2 ? <span className="text-xs text-warning-foreground">Own only</span> : <Minus className="mx-auto h-4 w-4 text-muted-foreground/50" />}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">"Own only": Staff see only clients/jobs assigned to them; Cashiers see only payments they entered and never see invoice amounts, fees, receivables or reports.</p>
    </div>
  );
}
