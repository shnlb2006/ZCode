/**
 * SQL 守卫：只读分类、多语句拒绝、行数上限。
 *
 * 设计约束（见 docs/specs/data-debug-gateway.md 第 2、4 节）：
 * - 只读是硬门，不依赖源的 readOnly 标注被信任之外的一切——标注只决定"拒绝还是放行写操作"。
 * - 分类器宁可保守：识别不清的关键字按拒绝处理，放行的分支必须显式枚举。
 * - 误判方向都安全：漏追加 LIMIT 只是不设上限（源仍受 rowCap 截断），
 *   误追加 LIMIT 只作用于最外层语句。
 */

/** 只读源允许的语句首关键字（大小写不敏感）。 */
const READ_ONLY_LEADING_KEYWORDS = new Set([
  "select",
  "with",
  "values",
  "table", // postgres: TABLE t 等价 SELECT * FROM t
  "explain",
  "show", // mysql 元数据
  "describe", // mysql 元数据
  "desc", // mysql 元数据
]);

/** 会返回行、因此可以安全追加 LIMIT 的语句首关键字。 */
const ROW_RETURNING_KEYWORDS = new Set(["select", "with", "values", "table"]);

/** 只读源禁止的锁定/副作用子句。 */
const FORBIDDEN_CLAUSES: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /\bfor\s+update\b/i, label: "FOR UPDATE" },
  { pattern: /\bfor\s+share\b/i, label: "FOR SHARE" },
  { pattern: /lock\s+in\s+share\s+mode/i, label: "LOCK IN SHARE MODE" },
  { pattern: /\binto\s+(outfile|dumpfile)\b/i, label: "INTO OUTFILE/DUMPFILE" },
  // postgres/sqlite 的 SELECT ... INTO newtable 会建表。
  { pattern: /^select\b[\s\S]*\binto\s+[A-Za-z_"]/i, label: "SELECT INTO" },
];

export interface SqlGuardInput {
  sql: string;
  /** 源是否只读。false 时写操作放行（仍由 PermissionService 审批）。 */
  readOnly: boolean;
  rowCap: number;
}

export type SqlGuardResult =
  | { ok: true; sql: string; limitAppended: boolean }
  | { ok: false; reason: string };

export function guardSql(input: SqlGuardInput): SqlGuardResult {
  const trimmed = input.sql.trim();
  if (trimmed === "") {
    return { ok: false, reason: "empty sql statement" };
  }

  // 修复原因：尾部多余分号必须先剥掉再做顶层分号判定，否则 "SELECT 1;"
  // 这种单语句会被误判成多语句而拒绝。
  const statement = stripTrailingSemicolons(trimmed);
  if (statement === "") {
    return { ok: false, reason: "empty sql statement" };
  }

  if (hasTopLevelSemicolon(statement)) {
    return {
      ok: false,
      reason: "multiple statements are rejected; submit one statement per call",
    };
  }

  const keyword = leadingKeyword(statement);
  // EXPLAIN 需要看被解释的语句：ANALYZE 会真正执行，且 LIMIT 只能加在内层查询上。
  const effectiveKeyword = keyword === "explain" ? explainTargetKeyword(statement) : keyword;

  if (input.readOnly) {
    if (keyword === undefined || effectiveKeyword === undefined) {
      return {
        ok: false,
        reason: keyword === undefined
          ? "cannot determine the statement's leading keyword"
          : "cannot determine what EXPLAIN targets",
      };
    }
    if (!READ_ONLY_LEADING_KEYWORDS.has(effectiveKeyword)) {
      return {
        ok: false,
        reason: `statement starts with ${effectiveKeyword.toUpperCase()}, which is not allowed on a read-only source; allowed: SELECT, WITH, VALUES, TABLE, EXPLAIN, SHOW, DESCRIBE`,
      };
    }
    for (const clause of FORBIDDEN_CLAUSES) {
      if (clause.pattern.test(statement)) {
        return {
          ok: false,
          reason: `${clause.label} is not allowed on a read-only source`,
        };
      }
    }
  }

  // 只有返回行的语句才追加 LIMIT：INSERT/UPDATE/DELETE 与 SHOW/DESCRIBE 带 LIMIT
  // 是语法错误；EXPLAIN 也不能追加——LIMIT 会加进被解释的内层查询，改变
  // EXPLAIN 实际分析的对象。判定用语句自身的首关键字，不用 EXPLAIN 的目标关键字。
  const returnsRows = keyword !== undefined && ROW_RETURNING_KEYWORDS.has(keyword);
  if (!returnsRows || hasTrailingLimit(statement)) {
    return { ok: true, sql: statement, limitAppended: false };
  }
  // 修复原因：多取一行（rowCap + 1）让驱动能精确判断"还有更多行"，
  // 用 LIMIT rowCap 会把"刚好这么多数"误报成未截断。
  return { ok: true, sql: `${statement}\nLIMIT ${input.rowCap + 1}`, limitAppended: true };
}

export function truncateRows<T>(rows: readonly T[], rowCap: number): { rows: T[]; truncated: boolean } {
  if (rows.length <= rowCap) return { rows: [...rows], truncated: false };
  return { rows: rows.slice(0, rowCap), truncated: true };
}

function stripTrailingSemicolons(sql: string): string {
  let end = sql.length;
  while (end > 0) {
    const char = sql[end - 1];
    if (char === " " || char === "\t" || char === "\n" || char === "\r" || char === ";") {
      end -= 1;
      continue;
    }
    break;
  }
  return sql.slice(0, end);
}

function leadingKeyword(statement: string): string | undefined {
  const match = /^[A-Za-z]+/.exec(statement);
  return match ? match[0].toLowerCase() : undefined;
}

/**
 * EXPLAIN 在 postgres 带 ANALYZE 时会真正执行语句，因此只读源必须继续分类
 * 被解释的语句；无法解析目标时按拒绝处理。
 */
function explainTargetKeyword(statement: string): string | undefined {
  let rest = statement.replace(/^explain\s+/i, "");
  // 循环剥离 explain 选项：ANALYZE / VERBOSE / BUFFERS / FORMAT ... / ( option ... )
  for (;;) {
    const option = /^(analyze|verbose|buffers|settings|costs|timing|summary|memory)\b\s*/i.exec(rest);
    if (option) {
      rest = rest.slice(option[0].length);
      continue;
    }
    const format = /^format\s*=\s*[A-Za-z]+\s*/i.exec(rest);
    if (format) {
      rest = rest.slice(format[0].length);
      continue;
    }
    if (rest.startsWith("(")) {
      const close = rest.indexOf(")");
      if (close === -1) return undefined;
      rest = rest.slice(close + 1).trimStart();
      continue;
    }
    break;
  }
  return leadingKeyword(rest);
}

function hasTrailingLimit(statement: string): boolean {
  return /\blimit\s+(all|\d+|\?|\$\d+)\s*$/i.test(statement);
}

/**
 * 顶层分号扫描：处于字符串、标识符引号、行/块注释或 dollar-quote 内的分号
 * 不算语句边界。这是"多语句拒绝"判定的全部依据，宁可漏判（放行一个
 * 实际是多语句的输入）也不误判——但注意驱动层本身也会拒绝多语句执行。
 */
export function hasTopLevelSemicolon(sql: string): boolean {
  let index = 0;
  while (index < sql.length) {
    const char = sql[index]!;
    const next = sql[index + 1];

    if (char === "-" && next === "-") {
      const newline = sql.indexOf("\n", index + 2);
      index = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (char === "#") {
      const newline = sql.indexOf("\n", index + 1);
      index = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const close = sql.indexOf("*/", index + 2);
      index = close === -1 ? sql.length : close + 2;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      index = skipQuoted(sql, index, char);
      continue;
    }
    if (char === "$") {
      const dollarEnd = matchDollarQuote(sql, index);
      if (dollarEnd !== undefined) {
        index = dollarEnd;
        continue;
      }
    }
    if (char === ";") return true;
    index += 1;
  }
  return false;
}

/** 跳过引号字符串/标识符；同字符双写（''、""、``）是转义。 */
function skipQuoted(sql: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < sql.length) {
    const char = sql[index]!;
    if (char === quote) {
      if (sql[index + 1] === quote) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return sql.length;
}

/** dollar-quote：$tag$ ... $tag$（postgres）。返回结束后的下标，非 dollar-quote 返回 undefined。 */
function matchDollarQuote(sql: string, start: number): number | undefined {
  const open = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(start));
  if (!open) return undefined;
  const tag = open[0];
  const close = sql.indexOf(tag, start + tag.length);
  return close === -1 ? sql.length : close + tag.length;
}
