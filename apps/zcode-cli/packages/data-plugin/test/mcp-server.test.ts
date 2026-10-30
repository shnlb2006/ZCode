import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDataMcpServer, main } from "../src/mcp/server.js";

interface ToolPayload {
  [key: string]: unknown;
}

describe("data MCP server (sqlite round trip)", () => {
  const packageVersion = (
    JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8")) as {
      version: string;
    }
  ).version;
  let root: string;
  let pluginDataDir: string;
  let projectDir: string;
  let databasePath: string;
  let client: Client;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "data-plugin-mcp-"));
    pluginDataDir = join(root, "plugin-data");
    projectDir = join(root, "project");
    databasePath = join(root, "fixture.sqlite");
    await mkdir(pluginDataDir, { recursive: true });
    await mkdir(projectDir, { recursive: true });

    const db = new DatabaseSync(databasePath);
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT);
      CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, amount INTEGER);
      INSERT INTO users (name, email) VALUES ('ada', 'ada@example.com'), ('linus', NULL);
      INSERT INTO orders (user_id, amount) VALUES (1, 10), (1, 20), (2, 30);
    `);
    db.close();

    await writeFile(
      join(pluginDataDir, "data-sources.json"),
      JSON.stringify({
        sources: [
          { name: "fixture", type: "sqlite", dsnEnv: "DATA_TEST_FIXTURE_DSN", rowCap: 2 },
          { name: "missing", type: "sqlite", dsnEnv: "DATA_TEST_MISSING_DSN" },
          {
            name: "writable",
            type: "sqlite",
            dsnEnv: "DATA_TEST_FIXTURE_DSN",
            readOnly: false,
          },
        ],
      }),
      "utf8",
    );

    const server = createDataMcpServer({
      ZCODE_PLUGIN_DATA: pluginDataDir,
      ZCODE_PROJECT_DIR: projectDir,
      DATA_TEST_FIXTURE_DSN: databasePath,
    } as NodeJS.ProcessEnv);
    client = new Client({ name: "data-plugin-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await rm(root, { recursive: true, force: true });
  });

  async function callTool(name: string, args: Record<string, unknown>): Promise<ToolPayload> {
    const result = await client.callTool({ name, arguments: args });
    const first = result.content[0];
    if (first?.type !== "text") throw new Error("expected text content");
    return JSON.parse(first.text) as ToolPayload;
  }

  it("exports the main entrypoint required by the packaged plugin host", () => {
    expect(main).toBeTypeOf("function");
    expect(client.getServerVersion()).toEqual({ name: "data", version: packageVersion });
  });

  it("lists sources with policy but without connection strings", async () => {
    const payload = await callTool("list_sources", {});
    const sources = payload.sources as Record<string, unknown>[];
    const fixture = sources.find((source) => source.name === "fixture");
    expect(fixture).toMatchObject({
      name: "fixture",
      type: "sqlite",
      readOnly: true,
      rowCap: 2,
      configured: true,
    });
    expect(Object.keys(fixture!)).not.toContain("dsnEnv");
    const missing = sources.find((source) => source.name === "missing");
    expect(missing).toMatchObject({
      configured: false,
      notConfiguredReason: "environment variable DATA_TEST_MISSING_DSN is not set",
    });
    expect(JSON.stringify(payload)).not.toContain(databasePath);
  });

  it("describes tables and columns", async () => {
    const payload = await callTool("describe", { source: "fixture" });
    const tables = payload.tables as { name: string; columns: { name: string }[] }[];
    expect(tables.map((table) => table.name).sort()).toEqual(["orders", "users"]);
    const users = tables.find((table) => table.name === "users");
    expect(users?.columns.map((column) => column.name)).toEqual(["id", "name", "email"]);
  });

  it("runs a read-only query and truncates at the row cap", async () => {
    const payload = await callTool("query", {
      source: "fixture",
      sql: "SELECT * FROM orders ORDER BY id",
    });
    expect(payload.rowCount).toBe(3);
    expect(payload.truncated).toBe(true);
    expect((payload.rows as unknown[]).length).toBe(2);
    expect(payload.columns).toEqual(["id", "user_id", "amount"]);
    expect(payload.limitAppended).toBe(true);
  });

  it("supports bind parameters", async () => {
    const payload = await callTool("query", {
      source: "fixture",
      sql: "SELECT name FROM users WHERE id = ?",
      params: [1],
    });
    expect(payload.rows).toEqual([{ name: "ada" }]);
    expect(payload.truncated).toBe(false);
  });

  it("rejects write statements on the read-only source", async () => {
    const result = await client.callTool({
      name: "query",
      arguments: { source: "fixture", sql: "INSERT INTO users (name) VALUES ('x')" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("not allowed on a read-only source");
  });

  it("rejects multi-statement input", async () => {
    const result = await client.callTool({
      name: "query",
      arguments: { source: "fixture", sql: "SELECT 1; SELECT 2" },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("multiple statements");
  });

  it("allows writes on a source declared writable", async () => {
    const payload = await callTool("query", {
      source: "writable",
      sql: "INSERT INTO users (name) VALUES ('grace')",
    });
    expect(payload.rowCount).toBeGreaterThanOrEqual(0);
    const after = await callTool("query", {
      source: "fixture",
      sql: "SELECT count(*) AS n FROM users",
    });
    expect((after.rows as { n: number }[])[0]?.n).toBe(3);
  });

  it("refuses unconfigured sources and unknown names", async () => {
    const unconfigured = await client.callTool({
      name: "query",
      arguments: { source: "missing", sql: "SELECT 1" },
    });
    expect(unconfigured.isError).toBe(true);
    expect((unconfigured.content[0] as { text: string }).text).toContain(
      "environment variable DATA_TEST_MISSING_DSN is not set",
    );

    const unknown = await client.callTool({
      name: "query",
      arguments: { source: "nope", sql: "SELECT 1" },
    });
    expect(unknown.isError).toBe(true);
    expect((unknown.content[0] as { text: string }).text).toContain("unknown source");
  });

  it("sanitizes driver errors that embed the connection string", async () => {
    const result = await client.callTool({
      name: "query",
      arguments: { source: "fixture", sql: "SELECT * FROM does_not_exist" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).not.toContain(databasePath);
  });
});
