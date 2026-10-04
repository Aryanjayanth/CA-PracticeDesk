/**
 * Canonical option sets for the client module.
 *
 * Shared so the client form and the clients-list filters can never drift apart.
 * The list filters render the FULL canonical set (not just values that happen to
 * exist in the data) so a newly added option is visible before any client uses
 * it — why: filters should advertise every choice, not just the ones in use.
 */

export const CLIENT_TYPES = [
  "Company",
  "Partnership",
  "LLP",
  "Proprietorship",
  "Individual",
  "HUF",
  "Trust",
  "Society",
  "NPO",
  "Others",
] as const;

export const GST_TYPES = ["Regular", "Composition", "Unregistered", "SEZ"] as const;

export const CLIENT_STATUSES = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "suspended", label: "Suspended" },
] as const;

/** Who the concerned person is to the client entity. */
export const CONCERN_ROLES = [
  "Owner",
  "Partner",
  "Director",
  "Promoter",
  "Accountant",
  "Company Secretary",
  "Office Manager",
  "Others",
] as const;

export const STANDARD_INDUSTRIES = [
  "Information Technology (IT / Software)",
  "Manufacturing & Engineering",
  "Retail & Wholesale Trade",
  "Real Estate & Construction",
  "Financial Services & Banking",
  "Healthcare & Pharmaceuticals",
  "Hospitality, Food & Restaurants",
  "Professional & Consulting Services",
  "Transportation & Logistics",
  "Education & Training",
  "Agriculture & Agro-processing",
  "Automobile & Auto Parts",
  "Textiles & Garments",
  "Others",
] as const;

/** Distinct, non-blank values, sorted. */
export const uniqSorted = (vals: Array<string | null | undefined>): string[] =>
  [...new Set(vals.map((v) => String(v ?? "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );

/**
 * The canonical list first, in its declared order, then any value that exists in
 * the data but isn't in the list (e.g. a custom industry someone typed in).
 */
export const optionValues = (
  canonical: readonly string[],
  actual: Array<string | null | undefined>,
): string[] => {
  const extras = uniqSorted(actual).filter((v) => !canonical.includes(v));
  return [...canonical, ...extras];
};
