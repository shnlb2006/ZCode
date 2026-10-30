import {
  normalizeRow,
  type DataDriverFactory,
  type DriverDescribeResult,
} from "./types.js";

/**
 * SQLite 驱动：node:sqlite（Node 22.5+/24 内置，实验性但可用）。
 * dsn 为数据库文件路径，由 config.ts 解析相对路径。
 *
 * 已知限制：无语句超时；见 spec 第 7 节验证范围。
 */
export const createSqliteDriver: DataDriverFactory = async (dsn, sourceName) => {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dsn);

  return {
    async describe() {
      const tables: DriverDescribeResult["tables"] = [];
      const tableRows = db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           ORDER BY name`,
        )
        .all() as { name: string }[];
      for (const table of tableRows) {
        // PRAGMA 不接受绑定参数，表名必须自行转义后插值。
        const columns = db
          .prepare(`PRAGMA table_info(${quoteIdentifier(table.name)})`)
          .all() as { name: string; type: string; notnull: number }[];
        tables.push({
          name: table.name,
          columns: columns.map((column) => ({
            name: column.name,
            type: column.type,
            nullable: column.notnull === 0,
          })),
        });
      }
      return { source: sourceName, tables };
    },

    async query(sql, params, rowCap) {
      const startedAt = performance.now();
      const statement = db.prepare(sql);
      // node:sqlite 只接受标量绑定值；对象/数组显式拒绝而不是静默字符串化。
      const rows = statement
        .all(...params.map((value) => normalizeBindValue(value)))
        .map((row) => normalizeRow(row as Record<string, unknown>));
      return {
        source: sourceName,
        columns: rows.length > 0 ? Object.keys(rows[0]!) : [],
        rows: rows.slice(0, rowCap),
        rowCount: rows.length,
        truncated: rows.length > rowCap,
        durationMs: Math.round(performance.now() - startedAt),
      };
    },

    async close() {
      db.close();
    },
  };
}

type SqliteBindValue = number | bigint | string | Uint8Array | null;

function normalizeBindValue(value: unknown): SqliteBindValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  throw new Error(
    `unsupported bind parameter type: ${typeof value}; use string, number, boolean, or null`,
  );
};

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
