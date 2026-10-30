import { describe, expect, it } from "vitest";

import { exampleGuardedQuery, exampleTruncate } from "./contract.example.js";
import { guardSql, MAX_ROW_CAP, toDataSourceView } from "./contract.js";
import { dataPluginModule } from "./module.js";

// 契约测试只 import contract 与 module，不知道实现是谁；同一份测试应同时跑真实现与跨进程代理。
describe("data-plugin contract", () => {
  it("declares its module manifest", () => {
    expect(dataPluginModule.id).toBe("data-plugin");
    expect(dataPluginModule.requires).toEqual([]);
  });

  it("guards a read-only query by appending the row cap", () => {
    const guarded = exampleGuardedQuery("SELECT * FROM orders", 50);
    expect(guarded.sql).toBe("SELECT * FROM orders\nLIMIT 51");
    expect(guarded.limitAppended).toBe(true);
    expect(guarded.rejected).toBeUndefined();
  });

  it("rejects writes on read-only sources with a readable reason", () => {
    const guarded = exampleGuardedQuery("DELETE FROM orders");
    expect(guarded.rejected).toContain("not allowed on a read-only source");
  });

  it("truncates rows above the cap and flags them", () => {
    const result = exampleTruncate([1, 2, 3], 2);
    expect(result.rows).toEqual([1, 2]);
    expect(result.truncated).toBe(true);
  });

  it("never leaks the dsn environment reference into the tool-visible view", () => {
    const view = toDataSourceView(
      { name: "dev", type: "postgres", dsnEnv: "DEV_DSN", readOnly: true, rowCap: 10 },
      { DEV_DSN: "postgres://u:p@h/db" },
    );
    expect(view).toEqual({
      name: "dev",
      type: "postgres",
      readOnly: true,
      rowCap: 10,
      configured: true,
    });
  });

  it("keeps the row cap within the documented maximum", () => {
    const guard = guardSql({ sql: "SELECT 1", readOnly: true, rowCap: MAX_ROW_CAP });
    expect(guard.ok).toBe(true);
    if (guard.ok) expect(guard.sql).toContain(`LIMIT ${MAX_ROW_CAP + 1}`);
  });
});
