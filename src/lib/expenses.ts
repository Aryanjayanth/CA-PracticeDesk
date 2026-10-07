import type { Module } from "@/lib/permissions";

/**
 * The three kinds of money that leave the firm, kept apart because they mean
 * different things and only one of them is a real cost.
 *
 * - `overhead` is the firm's own spending: rent, stationery, travel.
 * - `tax` is TDS withheld from a client and deposited to the government on their
 *   behalf. It leaves the bank but was never the firm's money, so it must not
 *   be added to a profit figure.
 * - `reimbursement` is money paid out on a client's behalf and rebilled to them,
 *   so it is a receivable rather than an expense.
 *
 * The `kind` column and this list are the same enum; a mismatch would let a
 * report silently misclassify, so keep them together when editing.
 */
export type ExpenseKind = "overhead" | "tax" | "reimbursement";

export const EXPENSE_KINDS: ExpenseKind[] = ["overhead", "tax", "reimbursement"];

export const KIND_LABEL: Record<ExpenseKind, string> = {
  overhead: "Firm Overhead",
  tax: "Tax Paid on Behalf",
  reimbursement: "Reimbursement",
};

export const KIND_BLURB: Record<ExpenseKind, string> = {
  overhead: "The firm's own cost — rent, utilities, stationery, travel.",
  tax: "Withheld from a client and deposited to the government. Not firm income.",
  reimbursement: "Paid out on a client's behalf and rebilled to them.",
};

/** Whether this kind counts against the firm's profit. */
export const KIND_IS_COST: Record<ExpenseKind, boolean> = {
  overhead: true,
  tax: false,
  reimbursement: false,
};

/**
 * Starting points for the category field. Free text in the database, so this is
 * a shortcut list rather than a constraint: anything typed that is not on the
 * list is still accepted, otherwise a firm with an unusual cost would be stuck.
 */
export const CATEGORY_SUGGESTIONS: Record<ExpenseKind, string[]> = {
  overhead: [
    "Professional Charges",
    "Consultancy Fees",
    "Audit & Legal Expenses",
    "Software & Subscriptions",
    "Printing & Stationery",
    "Office Expenses",
    "Staff Welfare",
    "Travel & Conveyance",
    "Bank Charges",
    "Miscellaneous",
    "Other",
  ],
  tax: [
    "TDS Remittance",
    "TCS Remittance",
    "GST Payment",
    "Advance Tax",
    "Challan Payment",
    "Other Statutory",
    "Other",
  ],
  reimbursement: [
    "ROC / MCA Filing Fees",
    "Stamp Duty",
    "Government Portal Fees",
    "Court & Registration Fees",
    "Courier & Postage",
    "Out-of-Pocket Expenses",
    "Other",
  ],
};

export type ExpenseRow = {
  id: string;
  kind: ExpenseKind;
  expense_date: string;
  category: string;
  description: string;
  /** Null when the caller lacks the module's "amounts" grant. */
  amount: number | null;
  mode: string;
  reference: string | null;
  paid_to: string | null;
  notes: string | null;
  client_id: string | null;
  client_name: string | null;
  job_id: string | null;
  job_code: string | null;
  created_at: string;
};

export type ExpenseDraft = {
  kind: ExpenseKind;
  expense_date: string;
  category: string;
  description: string;
  amount: string;
  mode: string;
  reference: string;
  paid_to: string;
  notes: string;
  client_id: string;
  job_id: string;
};

export const MODULE: Module = "expenses";
