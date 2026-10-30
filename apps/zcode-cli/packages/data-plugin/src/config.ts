import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

export const DATA_SOURCE_TYPES = ["postgres", "mysql", "sqlite"] as const;
export type DataSourceType = (typeof DATA_SOURCE_TYPES)[number];

export const DEFAULT_ROW_CAP = 500;
export const MAX_ROW_CAP = 10000;

const dataSourceSchema = z.object({
  name: z.string().min(1),
  type: z.enum(DATA_SOURCE_TYPES),
  // 连接串只以环境变量引用存在：配置文件零密钥，团队可共享 manifest。
  dsnEnv: z.string().min(1),
  readOnly: z.boolean().default(true),
  rowCap: z.number().int().positive().max(MAX_ROW_CAP).default(DEFAULT_ROW_CAP),
  schemas: z.array(z.string().min(1)).optional(),
});

const manifestSchema = z.object({
  sources: z.array(dataSourceSchema),
});

export type DataSource = z.infer<typeof dataSourceSchema> & {
  /** 项目级同名源覆盖用户级时的来源标注，仅用于工具可见视图。 */
  overriddenBy?: "project";
};

export interface DataSourcePaths {
  /** ZCODE_PLUGIN_DATA：用户级 manifest 所在目录。 */
  pluginDataDir?: string | undefined;
  /** ZCODE_PROJECT_DIR：项目级 manifest 的 <dir>/.zcode/data-sources.json。 */
  projectDir?: string | undefined;
}

export interface LoadedDataSources {
  sources: DataSource[];
  /** 加载/校验失败的可读原因；manifest 非法时整份拒绝，不静默跳过条目。 */
  errors: string[];
}

export function userManifestPath(paths: DataSourcePaths): string | null {
  return paths.pluginDataDir ? join(paths.pluginDataDir, "data-sources.json") : null;
}

export function projectManifestPath(paths: DataSourcePaths): string | null {
  return paths.projectDir ? join(paths.projectDir, ".zcode", "data-sources.json") : null;
}

async function readManifest(
  filePath: string | null,
  scope: "user" | "project",
): Promise<{ sources: DataSource[]; errors: string[] }> {
  if (!filePath) return { sources: [], errors: [] };
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    // 文件不存在是正常状态（用户未配置或项目未共享），不是错误。
    return { sources: [], errors: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      sources: [],
      errors: [`${scope} manifest ${filePath} is not valid JSON: ${describeError(error)}`],
    };
  }
  const result = manifestSchema.safeParse(parsed);
  if (!result.success) {
    return {
      sources: [],
      errors: [`${scope} manifest ${filePath} failed validation: ${result.error.issues.map(formatIssue).join("; ")}`],
    };
  }
  const seen = new Set<string>();
  for (const source of result.data.sources) {
    if (seen.has(source.name)) {
      return {
        sources: [],
        errors: [`${scope} manifest ${filePath} declares duplicate source name "${source.name}"`],
      };
    }
    seen.add(source.name);
  }
  return { sources: result.data.sources, errors: [] };
}

function formatIssue(issue: { path: PropertyKey[]; message: string }): string {
  const path = issue.path.join(".") || "(root)";
  return `${path}: ${issue.message}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 两级 manifest 合并：项目级同名源覆盖用户级。任一层校验失败只记录错误，
 * 不拖垮另一层；但该层自身不贡献任何源。
 */
export async function loadDataSources(
  paths: DataSourcePaths,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LoadedDataSources> {
  void env;
  const user = await readManifest(userManifestPath(paths), "user");
  const project = await readManifest(projectManifestPath(paths), "project");
  const byName = new Map<string, DataSource>();
  for (const source of user.sources) byName.set(source.name, source);
  for (const source of project.sources) byName.set(source.name, source);
  const duplicates = new Set<string>();
  for (const name of collectDuplicateNames(user.sources, project.sources)) duplicates.add(name);
  const sources = [...byName.values()];
  if (duplicates.size > 0) {
    // 同名覆盖是既定语义，这里只标注来源，不视为错误。
    for (const source of sources) {
      if (duplicates.has(source.name)) source.overriddenBy = "project";
    }
  }
  return { sources, errors: [...user.errors, ...project.errors] };
}

function collectDuplicateNames(user: DataSource[], project: DataSource[]): string[] {
  const userNames = new Set(user.map((source) => source.name));
  return project.filter((source) => userNames.has(source.name)).map((source) => source.name);
}

export function findDataSource(sources: readonly DataSource[], name: string): DataSource | undefined {
  return sources.find((source) => source.name === name);
}

export interface ResolvedDsn {
  configured: boolean;
  dsn?: string;
  reason?: string;
}

/**
 * 解析 dsnEnv 指向的连接串。sqlite 的相对路径按项目目录解析，
 * 便于 manifest 在团队成员间共享。
 */
export function resolveSourceDsn(
  source: DataSource,
  env: NodeJS.ProcessEnv,
  projectDir?: string,
): ResolvedDsn {
  const value = env[source.dsnEnv];
  if (value === undefined || value.trim() === "") {
    return {
      configured: false,
      reason: `environment variable ${source.dsnEnv} is not set`,
    };
  }
  if (source.type === "sqlite" && !isAbsolute(value)) {
    const base = projectDir ?? process.cwd();
    return { configured: true, dsn: resolve(base, value) };
  }
  return { configured: true, dsn: value };
}

/** 工具可见视图：刻意不含 dsnEnv 与解析后的连接串。 */
export interface DataSourceView {
  name: string;
  type: DataSourceType;
  readOnly: boolean;
  rowCap: number;
  schemas?: string[];
  configured: boolean;
  notConfiguredReason?: string;
  overriddenBy?: "project";
}

export function toDataSourceView(
  source: DataSource,
  env: NodeJS.ProcessEnv,
  projectDir?: string,
): DataSourceView {
  const resolved = resolveSourceDsn(source, env, projectDir);
  return {
    name: source.name,
    type: source.type,
    readOnly: source.readOnly,
    rowCap: source.rowCap,
    ...(source.schemas ? { schemas: source.schemas } : {}),
    configured: resolved.configured,
    ...(resolved.configured ? {} : { notConfiguredReason: resolved.reason }),
    ...(source.overriddenBy ? { overriddenBy: source.overriddenBy } : {}),
  };
}
