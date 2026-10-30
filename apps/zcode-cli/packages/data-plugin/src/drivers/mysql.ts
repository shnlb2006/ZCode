import {
  normalizeRow,
  type DataDriverFactory,
  type DriverDescribeResult,
} from "./types.js";

const SYSTEM_SCHEMAS = ["mysql", "information_schema", "performance_schema", "sys"];

/**
 * MySQL 驱动：每次操作新建连接、用完即关（同 pg 的无状态理由）。
 *
 * 已知限制：MySQL 无服务端语句超时的通用注入点（MAX_EXECUTION_TIME 提示
 * 只能加在 SELECT 上且会改写语句），一期不强制；见 spec 第 7 节验证范围。
 */
export const createMySqlDriver: DataDriverFactory = async (dsn, sourceName) => {
  const mysql = await import("mysql2/promise");

  const withConnection = async <T>(work: (connection: Awaited<ReturnType<typeof mysql.createConnection>>) => Promise<T>): Promise<T> => {
    const connection = await mysql.createConnection(dsn);
    try {
      return await work(connection);
    } finally {
      await connection.end().catch(() => undefined);
    }
  };

  return {
    async describe(schemas) {
      return withConnection(async (connection) => {
        const where = schemas?.length
          ? `WHERE table_schema IN (${schemas.map(() => "?").join(", ")})`
          : `WHERE table_schema NOT IN (${SYSTEM_SCHEMAS.map(() => "?").join(", ")})`;
        const binds = schemas?.length ? schemas : SYSTEM_SCHEMAS;
        const [rows] = (await connection.query(
          `SELECT table_schema, table_name, column_name, data_type, is_nullable
           FROM information_schema.columns
           ${where}
           ORDER BY table_schema, table_name, ordinal_position`,
          binds,
        )) as [DescribeRow[], unknown];
        return groupColumns(rows, sourceName);
      });
    },

    async query(sql, params, rowCap) {
      const startedAt = performance.now();
      return withConnection(async (connection) => {
        // multipleStatements 默认关闭：驱动层再次拒绝多语句，与守卫双保险。
        const [rows] = (await connection.query(sql, [...params])) as [
          Record<string, unknown>[],
          unknown,
        ];
        const list = rows.map((row) => normalizeRow(row));
        return {
          source: sourceName,
          columns: list.length > 0 ? Object.keys(list[0]!) : [],
          rows: list.slice(0, rowCap),
          rowCount: list.length,
          truncated: list.length > rowCap,
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
