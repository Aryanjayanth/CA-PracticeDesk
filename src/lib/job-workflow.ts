/**
 * Job-centric workflow: JOB -> PAYMENT -> CLEARING -> SQUARE-OFF -> INVOICE.
 *
 * Every value here comes from the `job_workflow` RPC, which is the same code
 * path `create_invoice_for_job` validates against. The UI never decides for
 * itself whether an invoice is allowed -- it only renders the backend's answer.
 * That is what stops a stale or hand-edited client from bypassing the gate.
 */
import type { Json } from "@/integrations/supabase/types";

export type WorkflowStages = {
  created: boolean;
  completed: boolean;
  payment_created: boolean;
  payment_cleared: boolean;
  squared_off: boolean;
  invoiced: boolean;
};

export type JobWorkflow = {
  job_id: string;
  job_code: string;
  job_status: string;
  job_completed_at: string | null;
  due_date: string | null;
  overdue: boolean;
  gross_fee: number;
  job_discount: number;
  net_amount: number;
  advance: number;
  tds_tcs: number;
  clearing_discount: number;
  other_deduction: number;
  other_addition: number;
  clearing_status: "draft" | "cleared" | "squared_off";
  clearing_id: string | null;
  cleared_at: string | null;
  squared_off_at: string | null;
  final_amount: number;
  payment_count: number;
  payment_unallocated: number;
  invoice_id: string | null;
  invoice_no: string | null;
  invoice_status: string | null;
  invoice_available: boolean;
  blocked_reason: string | null;
  stages: WorkflowStages;
};

export const isWorkflow = (v: unknown): v is JobWorkflow =>
  !!v && typeof v === "object" && "invoice_available" in (v as object);

/** The stage list rendered on the job page, in workflow order (spec 16). */
export const STAGES: {
  key: keyof WorkflowStages;
  label: string;
  /** Which timestamp proves this stage, for the tooltip. */
  stamp?: (w: JobWorkflow) => string | null;
}[] = [
  { key: "created", label: "Job Created" },
  { key: "completed", label: "Job Completed", stamp: (w) => w.job_completed_at },
  { key: "payment_created", label: "Payment Created" },
  { key: "payment_cleared", label: "Payment Cleared", stamp: (w) => w.cleared_at },
  { key: "squared_off", label: "Payment Squared-off", stamp: (w) => w.squared_off_at },
  { key: "invoiced", label: "Invoice Created" },
];

/**
 * Mirrors `job_clearing_recalc` in Postgres. Deliberately duplicated rather than
 * imported: this is a live preview while typing, and Postgres remains the
 * authority that persists and re-checks the result. If the two ever disagree the
 * saved value wins, because the trigger overwrites what we send.
 */
export const computeFinal = (
  w: Pick<
    JobWorkflow,
    | "gross_fee"
    | "job_discount"
    | "advance"
    | "tds_tcs"
    | "clearing_discount"
    | "other_deduction"
    | "other_addition"
  >,
) =>
  Math.max(
    Number(w.gross_fee) -
      Number(w.job_discount) -
      Number(w.advance) -
      Number(w.tds_tcs) -
      Number(w.clearing_discount) -
      Number(w.other_deduction) +
      Number(w.other_addition),
    0,
  );

export const CLEARING_LINES = [
  {
    key: "advance",
    label: "Advance",
    hint: "Already received against this job before invoicing",
    sign: -1,
  },
  {
    key: "tds_tcs",
    label: "TDS / TCS",
    hint: "Withheld at source and deposited by the client",
    sign: -1,
  },
  {
    key: "clearing_discount",
    label: "Discount",
    hint: "Concessional reduction agreed for this job",
    sign: -1,
  },
  {
    key: "other_deduction",
    label: "Other Deduction",
    hint: "Any other amount withheld from the fee",
    sign: -1,
  },
  {
    key: "other_addition",
    label: "Other Addition",
    hint: "Any charge added on top of the fee",
    sign: 1,
  },
] as const;

/** Workflow status -> the label the app already uses elsewhere. */
export const clearingLabel = (s: JobWorkflow["clearing_status"]) =>
  s === "squared_off" ? "Squared-off" : s === "cleared" ? "Cleared" : "Draft";
