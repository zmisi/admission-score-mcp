import pg from "pg";

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl });
}

/** 在只读事务中执行查询，与 server-postgres 一致 */
export async function queryReadOnly<T extends pg.QueryResultRow>(
  pool: pg.Pool,
  text: string,
  values?: unknown[],
): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const result = await client.query<T>(text, values);
    return result.rows;
  } finally {
    await client.query("ROLLBACK").catch((err) => {
      console.warn("Could not roll back transaction:", err);
    });
    client.release();
  }
}
