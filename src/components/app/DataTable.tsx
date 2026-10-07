import { useMemo, useState, type ReactNode } from "react";
import { ArrowUpDown, ChevronLeft, ChevronRight, Download, Inbox, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadCsv } from "@/lib/format";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  sort?: (row: T) => string | number;
  align?: "right" | "left";
  className?: string;
};

export function DataTable<T extends { id: string | number }>({
  rows,
  columns,
  search,
  loading,
  empty = "No records found",
  toolbar,
  pageSize = 15,
  onRowClick,
  footer,
  exportFilename,
  exportTransform,
}: {
  rows: T[] | undefined;
  columns: Column<T>[];
  search?: (row: T) => string;
  loading?: boolean;
  empty?: string;
  toolbar?: ReactNode;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  footer?: ReactNode;
  exportFilename?: string;
  exportTransform?: (row: T) => Record<string, unknown>;
}) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [dir, setDir] = useState<1 | -1>(1);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    let r = rows ?? [];
    if (q && search) {
      const s = q.toLowerCase();
      r = r.filter((x) => search(x).toLowerCase().includes(s));
    }
    const col = columns.find((c) => c.key === sortKey);
    if (col?.sort) {
      const f = col.sort;
      r = [...r].sort((a, b) => (f(a) > f(b) ? dir : f(a) < f(b) ? -dir : 0));
    }
    return r;
  }, [rows, q, search, sortKey, dir, columns]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const slice = filtered.slice(cur * pageSize, cur * pageSize + pageSize);

  return (
    <div className="rounded-lg border bg-card">
      {(search || toolbar || exportFilename) && (
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          {search && (
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(0);
                }}
                placeholder="Search…"
                className="pl-8 h-9"
              />
            </div>
          )}
          {toolbar}
          {exportFilename && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 ml-auto text-xs gap-1.5 font-medium"
              onClick={() => {
                const dataToExport = exportTransform
                  ? filtered.map(exportTransform)
                  : filtered.map((r) => {
                      const out: Record<string, unknown> = {};
                      for (const col of columns) {
                        if (!col.header || col.key === "x" || col.key === "actions") continue;
                        const val = (r as Record<string, unknown>)[col.key];
                        out[col.header] = val ?? "";
                      }
                      return out;
                    });
                const stamp = new Date().toISOString().slice(0, 10);
                downloadCsv(`${exportFilename}_${stamp}.csv`, dataToExport);
              }}
              disabled={!filtered.length}
              title="Export current filtered data to CSV"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "px-3 py-2.5 font-medium whitespace-nowrap",
                    c.align === "right" && "text-right",
                    c.className,
                  )}
                >
                  {c.sort ? (
                    <button
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => {
                        if (sortKey === c.key) setDir((d) => (d === 1 ? -1 : 1));
                        else {
                          setSortKey(c.key);
                          setDir(1);
                        }
                      }}
                    >
                      {c.header}
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-t">
                  <td colSpan={columns.length} className="px-3 py-2">
                    <Skeleton className="h-5 w-full" />
                  </td>
                </tr>
              ))
            ) : slice.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-12 text-center text-muted-foreground"
                >
                  <Inbox className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  {empty}
                </td>
              </tr>
            ) : (
              slice.map((r) => (
                <tr
                  key={r.id}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={cn("border-t hover:bg-muted/40", onRowClick && "cursor-pointer")}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "px-3 py-2.5",
                        c.align === "right" && "text-right tabular-nums",
                        c.className,
                      )}
                    >
                      {c.render
                        ? c.render(r)
                        : String((r as Record<string, unknown>)[c.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {footer}
        </table>
      </div>
      <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
        <span>
          {filtered.length} record{filtered.length === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={cur === 0}
            onClick={() => setPage(cur - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span>
            Page {cur + 1} / {pages}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={cur >= pages - 1}
            onClick={() => setPage(cur + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
