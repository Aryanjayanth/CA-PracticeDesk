import { supabase } from "@/integrations/supabase/client";
import type { TableName } from "./entities";

/**
 * Entity-driven reads and writes go through here.
 *
 * The generated Supabase types bind insert/update payloads to a single table's
 * shape. Because this module loops over a union of tables, that relationship is
 * lost at the call site — so the cast is made once, in this file, rather than
 * scattered through the UI. Row content itself is still checked by
 * `validateValue` / the database constraints before it gets here.
 */

type DbError = { message: string } | null;

export async function fetchRows(table: TableName): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase.from(table).select("*");
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

type LooseTable = {
  select: (cols: string) => {
    toPromise: () => PromiseLike<{ data: Record<string, unknown>[] | null; error: DbError }>;
  };
  insert: (payload: Record<string, unknown>) => PromiseLike<{ error: DbError }>;
  update: (payload: Record<string, unknown>) => {
    eq: (column: string, value: string) => PromiseLike<{ error: DbError }>;
  };
};

const loose = (table: TableName) => supabase.from(table) as unknown as LooseTable;

export async function insertRow(
  table: TableName,
  payload: Record<string, unknown>,
): Promise<DbError> {
  const { error } = await loose(table).insert(payload);
  return error;
}

export async function updateRow(
  table: TableName,
  id: string,
  payload: Record<string, unknown>,
): Promise<DbError> {
  const { error } = await loose(table).update(payload).eq("id", id);
  return error;
}

export async function fetchSimple(
  table: TableName,
  cols: string,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await loose(table).select(cols).toPromise();
  if (error) throw new Error(error.message);
  return data ?? [];
}
