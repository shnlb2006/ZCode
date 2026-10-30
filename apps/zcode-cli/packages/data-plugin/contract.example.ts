/**
 * data-plugin 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 * 这里展示守卫与行数截断这两个纯函数契约——最常见的调用形态；
 * 带 IO 的完整链路（manifest 加载 + 驱动执行）见 test/mcp-server.test.ts。
 */
import { guardSql, truncateRows } from "./contract.js";

interface ExampleGuardedQuery {
  readonly sql: string;
  readonly limitAppended: boolean;
  readonly rejected?: string;
}

/** 对只读源的一条查询做守卫，返回可执行语句或拒绝原因。 */
export function exampleGuardedQuery(sql: string, rowCap = 500): ExampleGuardedQuery {
  const guard = guardSql({ sql, readOnly: true, rowCap });
  if (!guard.ok) return { sql, limitAppended: false, rejected: guard.reason };
  return { sql: guard.sql, limitAppended: guard.limitAppended };
}

/** 行数截断：超过 rowCap 时只保留前 rowCap 行并标记。 */
export function exampleTruncate<T>(rows: readonly T[], rowCap: number): {
  rows: T[];
  truncated: boolean;
} {
  return truncateRows(rows, rowCap);
}
