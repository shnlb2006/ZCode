export interface DriverColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export interface DriverTable {
  name: string;
  columns: DriverColumn[];
}

export interface DriverDescribeResult {
  source: string;
  tables: DriverTable[];
}

export interface DriverQueryResult {
  source: string;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
}

export interface DataDriver {
  /** 内省表/列结构；schemas 为源上声明的 schema 白名单。 */
  describe(schemas?: string[]): Promise<DriverDescribeResult>;
  /** 执行已通过守卫的语句；行数截断到 rowCap 并标记 truncated。 */
  query(sql: string, params: readonly unknown[], rowCap: number): Promise<DriverQueryResult>;
  close(): Promise<void>;
}

export type DataDriverFactory = (dsn: string, sourceName: string) => Promise<DataDriver>;

/**
 * 归一化驱动返回的行：pg 的 int8 返回 BigInt（JSON.stringify 会抛），
 * bytea 返回 Buffer。统一转成可序列化形态，避免把原始类型泄漏给协议层。
 */
export function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key] = normalizeValue(value);
  }
  return normalized;
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return { base64: value.toString("base64") };
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object") {
    const plain = value as Record<string, unknown>;
    if (plain.constructor === Object || plain.constructor === undefined) {
      return normalizeRow(plain);
    }
  }
  return value;
}
