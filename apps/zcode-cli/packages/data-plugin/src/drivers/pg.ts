import type { Client } from "pg";
import {
  normalizeRow,
  type DataDriverFactory,
  type DriverDescribeResult,
} from "./types.js";

/**
 * PostgreSQL 驱动：每次操作新建连接、用完即关。
 *
 * 修复原因：stdio 插件被 MCP 连接池 30 秒空闲回收（adapters/src/mcp/pool.ts），
 * 持有跨调用的连接池会在回收时整体丢失且无恢复语义；按查询建连接受冷启动，
 * 换来无状态与可预期的失败面。
 */
export const createPgDriver: DataDriverFactory = async (dsn, sourceName) => {
  const { Client: PgClient } = await import("pg");

  const withClient = async <T>(work: (client: Client) => Promise<T>): Promise<T> => {
    const client = new PgClient({
      connectionString: dsn,
      statement_timeout: 15000,
    });
    await client.connect();
    try {
      return await work(client);
    } finally {
      await client.end().catch(() => undefined);
    }
  };

  return {
    async describe(schemas) {
      return withClient(async (client) => {
        const result = await client.query(
          `SELECT table_schema, table_name, column_name, data_type, is_nullable
           FROM information_schema.columns
           WHERE ($1::text[] IS NULL OR table_schema = ANY($1))
             AND table_schema NOT IN ('pg_catalog', 'information_schema')
             AND table_schema NOT LIKE 'pg_toast%'
           ORDER BY table_schema, table_name, ordinal_position`,
          [schemas ?? null],
        );
        return groupColumns(result.rows as DescribeRow[], sourceName);
      });
    },

    async query(sql, params, rowCap) {
      const startedAt = performance.now();
      return withClient(async (client) => {
        const result = await client.query(sql, [...params]);
        const rows = result.rows.map((row) => normalizeRow(row as Record<string, unknown>));
        const columns = result.fields.map((field) => field.name);
        return {
          source: sourceName,
          columns,
          rows: rows.slice(0, rowCap),
          rowCount: result.rowCount ?? rows.length,
          truncated: rows.length > rowCap,
          durationMs: Math.round(performance.now() - startedAt),
        };
      });
    },

    async close() {
      // 连接按操作生命周期管理，无持久句柄可关。
    },
  };
};

interface DescribeRow {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
}

function groupColumns(rows: readonly DescribeRow[], sourceName: string): DriverDescribeResult {
  const tables = new Map<string, { name: string; columns: { name: string; type: string; nullable: boolean }[] }>();
  for (const row of rows) {
    const key = `${row.table_schema}.${row.table_name}`;
    const table = tables.get(key) ?? { name: key, columns: [] };
    table.columns.push({
      name: row.column_name,
      type: row.data_type,
      nullable: row.is_nullable === "YES",
    });
    tables.set(key, table);
  }
  return { source: sourceName, tables: [...tables.values()] };
}
