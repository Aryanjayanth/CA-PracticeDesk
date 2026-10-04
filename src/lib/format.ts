export const inr = (n: number | string | null | undefined) => {
  const v = Number(n ?? 0);
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

export const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const s = d.slice(0, 10).split("-");
  if (s.length !== 3) return d;
  return `${s[2]}-${s[1]}-${s[0]}`;
};

export const fmtDateTime = (d: string | null | undefined) => {
  if (!d) return "—";
  const dt = new Date(d);
  return `${fmtDate(d)} ${dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
};

export const today = () => new Date().toISOString().slice(0, 10);

export const daysBetween = (from: string, to: string = today()) =>
  Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 86400000);

export const ageingBucket = (dueDate: string) => {
  const d = daysBetween(dueDate);
  if (d <= 0) return "Current";
  if (d <= 30) return "1–30 Days";
  if (d <= 60) return "31–60 Days";
  if (d <= 90) return "61–90 Days";
  return "90+ Days";
};
export const BUCKETS = ["Current", "1–30 Days", "31–60 Days", "61–90 Days", "90+ Days"];

export const label = (s: string | null | undefined) =>
  (s ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export const MODES: Record<string, string> = {
  cash: "Cash",
  bank: "Bank Transfer",
  upi: "UPI",
  cheque: "Cheque",
  card: "Card",
  other: "Other",
};
export const FREQS: Record<string, string> = {
  one_time: "One Time",
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Half-Yearly",
  yearly: "Yearly",
};
export const JOB_STATUSES = ["pending", "in_progress", "completed", "on_hold", "cancelled"];

export type InvoiceLike = { status: string; due_date: string; outstanding: number | null };
export const invoiceDisplayStatus = (i: InvoiceLike) =>
  (i.status === "unpaid" || i.status === "partially_paid") &&
  Number(i.outstanding) > 0 &&
  i.due_date < today()
    ? "overdue"
    : i.status;

export type JobLike = { status: string; due_date: string | null };
export const jobDisplayStatus = (j: JobLike) =>
  j.due_date && j.due_date < today() && !["completed", "cancelled"].includes(j.status)
    ? "overdue"
    : j.status;

export const errMsg = (e: unknown) =>
  e && typeof e === "object" && "message" in e
    ? String((e as { message: string }).message)
    : "Something went wrong";

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [
    headers.map(esc).join(","),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(",")),
  ].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
}
