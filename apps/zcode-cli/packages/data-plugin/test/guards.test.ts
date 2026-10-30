import { describe, expect, it } from "vitest";
import { guardSql, hasTopLevelSemicolon, truncateRows } from "../src/guards/sql.js";

describe("guardSql read-only classification", () => {
  const guard = (sql: string, readOnly = true, rowCap = 500) =>
    guardSql({ sql, readOnly, rowCap });

  it("allows SELECT / WITH / VALUES / TABLE on read-only sources", () => {
    for (const sql of [
      "SELECT 1",
      "with recent as (select 1) select * from recent",
      "values (1), (2)",
      "table users",
      "select * from t where id = $1",
    ]) {
      const result = guard(sql);
      expect(result.ok, sql).toBe(true);
    }
  });

  it("rejects write and DDL statements on read-only sources", () => {
    for (const sql of [
      "INSERT INTO t VALUES (1)",
      "UPDATE t SET a = 1",
      "DELETE FROM t",
      "DROP TABLE t",
      "CREATE TABLE t (a int)",
      "ALTER TABLE t ADD COLUMN b int",
      "TRUNCATE t",
      "GRANT ALL ON t TO public",
      "COPY t FROM stdin",
      "CALL do_thing()",
      "PRAGMA writable_schema = ON",
    ]) {
      const result = guard(sql);
      expect(result.ok, sql).toBe(false);
      if (!result.ok) expect(result.reason).toContain("not allowed on a read-only source");
    }
  });

  it("allows writes on sources declared writable", () => {
    const result = guard("INSERT INTO t VALUES (1)", false);
    expect(result.ok).toBe(true);
  });

  it("rejects multi-statement input", () => {
    const result = guard("SELECT 1; SELECT 2");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("multiple statements");
  });

  it("treats semicolons inside strings and comments as data, not boundaries", () => {
    expect(hasTopLevelSemicolon("SELECT 'a;b'")).toBe(false);
    expect(hasTopLevelSemicolon('SELECT "col;name" FROM t')).toBe(false);
    expect(hasTopLevelSemicolon("SELECT 1 -- trailing; comment")).toBe(false);
    expect(hasTopLevelSemicolon("SELECT 1 /* block; comment */")).toBe(false);
    expect(hasTopLevelSemicolon("SELECT 1; ")).toBe(true);
    expect(hasTopLevelSemicolon("SELECT $$ a; b $$")).toBe(false);
  });

  it("rejects locking and file-output clauses on read-only sources", () => {
    for (const sql of [
      "SELECT * FROM t FOR UPDATE",
      "SELECT * FROM t FOR SHARE",
      "SELECT * FROM t LOCK IN SHARE MODE",
      "SELECT * FROM t INTO OUTFILE '/tmp/x'",
      "SELECT * INTO new_table FROM t",
    ]) {
      const result = guard(sql);
      expect(result.ok, sql).toBe(false);
    }
  });

  it("classifies what EXPLAIN targets so ANALYZE cannot smuggle writes", () => {
    const ok = guard("EXPLAIN ANALYZE SELECT count(*) FROM t");
    expect(ok.ok).toBe(true);
    const rejected = guard("EXPLAIN ANALYZE DELETE FROM t");
    expect(rejected.ok).toBe(false);
    const options = guard("EXPLAIN (ANALYZE, VERBOSE, FORMAT TEXT) SELECT 1");
    expect(options.ok).toBe(true);
    const unknown = guard("EXPLAIN (BROKEN SELECT 1");
    expect(unknown.ok).toBe(false);
  });

  it("rejects empty statements", () => {
    expect(guard("   ").ok).toBe(false);
  });
});

describe("guardSql row cap", () => {
  it("appends LIMIT rowCap + 1 so truncation is exact", () => {
    const result = guardSql({ sql: "SELECT * FROM t", readOnly: true, rowCap: 50 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.limitAppended).toBe(true);
      expect(result.sql).toBe("SELECT * FROM t\nLIMIT 51");
    }
  });

  it("does not append LIMIT to statements that do not return rows", () => {
    for (const sql of [
      "INSERT INTO t VALUES (1)",
      "UPDATE t SET a = 1",
      "DELETE FROM t",
      "SHOW TABLES",
      "DESCRIBE t",
      "EXPLAIN SELECT 1",
    ]) {
      const result = guardSql({ sql, readOnly: false, rowCap: 50 });
      expect(result.ok, sql).toBe(true);
      if (result.ok) {
        expect(result.limitAppended, sql).toBe(false);
        expect(result.sql, sql).toBe(sql);
      }
    }
  });

  it("does not append when the statement already ends with LIMIT", () => {
    for (const sql of [
      "SELECT * FROM t LIMIT 10",
      "select * from t limit all",
      "SELECT * FROM t LIMIT $1",
      "with c as (select 1) select * from c limit 3",
    ]) {
      const result = guardSql({ sql, readOnly: true, rowCap: 50 });
      expect(result.ok, sql).toBe(true);
      if (result.ok) {
        expect(result.limitAppended, sql).toBe(false);
        expect(result.sql).toBe(sql);
      }
    }
  });

  it("strips a trailing semicolon before classification", () => {
    const result = guardSql({ sql: "SELECT 1;", readOnly: true, rowCap: 10 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sql).toBe("SELECT 1\nLIMIT 11");
  });
});

describe("truncateRows", () => {
  it("passes through rows within the cap", () => {
    const result = truncateRows([1, 2, 3], 5);
    expect(result.rows).toEqual([1, 2, 3]);
    expect(result.truncated).toBe(false);
  });

  it("truncates and flags rows above the cap", () => {
    const result = truncateRows([1, 2, 3, 4], 2);
    expect(result.rows).toEqual([1, 2]);
    expect(result.truncated).toBe(true);
  });
});
