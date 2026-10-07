import { supabase } from "@/integrations/supabase/client";

/**
 * Postgres/PostgREST error code for "this function does not exist".
 * PGRST202 is what Supabase returns when the SQL function is missing from the
 * schema cache, which for us means the permissions migration is not applied yet.
 */
export const UNDEFINED_FUNCTION = "PGRST202";

export function isUndefinedFunction(error: { code?: string; message?: string } | null) {
  return (
    !!error &&
    (error.code === UNDEFINED_FUNCTION || /could not find the function/i.test(error.message ?? ""))
  );
}

/**
 * Read a list through a masking RPC, but fall back to reading the table
 * directly when that RPC does not exist yet.
 *
 * The list RPCs (jobs_list, payments_list, recurring_list, client_*_list) exist
 * so the server can blank money columns for users without the "amounts" grant.
 * They only exist once the permissions migration has been applied. Without this
 * fallback the list pages would throw on a pre-migration database and the app
 * would look broken rather than merely unconfigured.
 *
 * The fallback is safe in the sense that it does not over-grant: it returns
 * whatever the *current* RLS policies allow, which is the pre-migration
 * behaviour. It does mean that on an un-migrated database the amounts masking
 * is not in effect — which is why the migration should be applied rather than
 * relying on this path.
 */
export async function readList<T>(
  rpcName: string,
  args: Record<string, unknown>,
  tableFallback: () => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  // rpcName is a string rather than a generated key union because this helper
  // exists precisely for the case where the RPC is absent from the database,
  // which is also why it would not typecheck against the generated types.
  const { data, error } = await supabase.rpc(rpcName as "client_lookup", args as never);
  if (!error) return (data ?? []) as T[];
  if (isUndefinedFunction(error)) {
    const fb = await tableFallback();
    if (fb.error) throw new Error(fb.error.message);
    return (fb.data ?? []) as T[];
  }
  throw error;
}
