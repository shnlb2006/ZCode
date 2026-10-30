#!/usr/bin/env node
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import {
  findDataSource,
  loadDataSources,
  resolveSourceDsn,
  toDataSourceView,
  type DataSourcePaths,
} from "../config.js";
import { createDriver } from "../drivers/index.js";
import { guardSql } from "../guards/sql.js";
import { fail, json, sanitizeDriverMessage } from "../lib/result.js";

const SERVER_VERSION = "0.1.0";

/**
 * data 插件：受控数据库调试入口。
 *
 * 治理规则（docs/specs/data-debug-gateway.md）：
 * - 只读由 SQL 分类器强制，不由 MCP annotations 声明——工具对可写源同样可用，
 *   声明 readOnlyHint 会是假陈述，因此不声明 annotations。
 * - 审批与审计完全复用宿主 PermissionService 与会话转录，插件不自建审计。
 */
export function createDataMcpServer(env: NodeJS.ProcessEnv = process.env): McpServer {
  const server = new McpServer({
    name: "data",
    version: SERVER_VERSION,
  });

  const paths: DataSourcePaths = {
    pluginDataDir: env.ZCODE_PLUGIN_DATA,
    projectDir: env.ZCODE_PROJECT_DIR ?? process.cwd(),
  };

  server.registerTool(
    "list_sources",
    {
      title: "List Data Sources",
      description:
        "List configured database sources with their policy (read-only flag, row cap, schema scope). Connection strings are never returned; unconfigured sources report which environment variable is missing.",
      inputSchema: {},
    },
    async () =>
      run(async () => {
        const loaded = await loadDataSources(paths, env);
        return json({
          sources: loaded.sources.map((source) => toDataSourceView(source, env, paths.projectDir)),
          ...(loaded.errors.length > 0 ? { errors: loaded.errors } : {}),
        });
      }),
  );

  server.registerTool(
    "describe",
    {
      title: "Describe Data Source",
      description:
        "Introspect tables and columns of a configured source, restricted to the source's declared schema scope. Use it before writing SQL.",
      inputSchema: {
        source: z.string().min(1).describe("Source name from list_sources."),
      },
    },
    async (args) =>
      run(async () => {
        const source = await requireConfiguredSource(args.source, paths, env);
        const driver = await createDriver(source.entry, source.dsn);
        try {
          return json(await driver.describe(source.entry.schemas));
        } finally {
          await driver.close();
        }
      }),
  );

  server.registerTool(
    "query",
    {
      title: "Query Data Source",
      description:
        "Run one SQL statement against a configured source. Read-only sources accept only SELECT/WITH/VALUES/TABLE/EXPLAIN/SHOW/DESCRIBE statements; writes require a source declared writable. Results are capped at the source row cap and flagged when truncated.",
      inputSchema: {
        source: z.string().min(1).describe("Source name from list_sources."),
        sql: z.string().min(1).describe("A single SQL statement."),
        params: z.array(z.unknown()).optional().describe("Positional bind parameters."),
      },
    },
    async (args) =>
      run(async () => {
        const source = await requireConfiguredSource(args.source, paths, env);
        const guard = guardSql({
          sql: args.sql,
          readOnly: source.entry.readOnly,
          rowCap: source.entry.rowCap,
        });
        if (!guard.ok) return fail(guard.reason);
        const driver = await createDriver(source.entry, source.dsn);
        try {
          const result = await driver.query(guard.sql, args.params ?? [], source.entry.rowCap);
          return json({ ...result, limitAppended: guard.limitAppended });
        } catch (error) {
          // 修复原因：pg/mysql 的错误消息可能携带连接串主机与库名，
          // 回显等于把 dsnEnv 的机密写进会话转录。
          return fail(sanitizeDriverMessage(describeError(error), source.dsn));
        } finally {
          await driver.close();
        }
      }),
  );

  return server;
}

async function requireConfiguredSource(
  name: string,
  paths: DataSourcePaths,
  env: NodeJS.ProcessEnv,
): Promise<{ entry: NonNullable<ReturnType<typeof findDataSource>>; dsn: string }> {
  const loaded = await loadDataSources(paths, env);
  const entry = findDataSource(loaded.sources, name);
  if (!entry) {
    const available = loaded.sources.map((source) => source.name);
    throw new Error(
      available.length > 0
        ? `unknown source "${name}"; available: ${available.join(", ")}`
        : `unknown source "${name}"; no data sources are configured`,
    );
  }
  const resolved = resolveSourceDsn(entry, env, paths.projectDir);
  if (!resolved.configured) {
    // 只报告缺失的环境变量名，不回显其值。
    throw new Error(`source "${name}" is not configured: ${resolved.reason}`);
  }
  return { entry, dsn: resolved.dsn! };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function run(work: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await work();
  } catch (error) {
    return fail(describeError(error));
  }
}

export async function main(): Promise<void> {
  const server = createDataMcpServer();
  await server.connect(new StdioServerTransport());
}

if (import.meta.main) {
  await main();
}
