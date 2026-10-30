import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findDataSource,
  loadDataSources,
  resolveSourceDsn,
  toDataSourceView,
  userManifestPath,
  projectManifestPath,
  type DataSourcePaths,
} from "../src/config.js";

let pluginDataDir: string;
let projectDir: string;
let paths: DataSourcePaths;

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "data-plugin-config-"));
  pluginDataDir = join(root, "plugin-data");
  projectDir = join(root, "project");
  await mkdir(pluginDataDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  paths = { pluginDataDir, projectDir };
});

afterEach(async () => {
  await rm(join(pluginDataDir, ".."), { recursive: true, force: true });
});

async function writeManifest(scope: "user" | "project", content: unknown): Promise<void> {
  const file = scope === "user" ? userManifestPath(paths)! : projectManifestPath(paths)!;
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, JSON.stringify(content), "utf8");
}

describe("loadDataSources", () => {
  it("returns no sources and no errors when no manifest exists", async () => {
    const loaded = await loadDataSources(paths, {});
    expect(loaded.sources).toEqual([]);
    expect(loaded.errors).toEqual([]);
  });

  it("loads user and project manifests with project overriding same-named sources", async () => {
    await writeManifest("user", {
      sources: [
        { name: "shared", type: "sqlite", dsnEnv: "USER_SHARED_DSN", rowCap: 100 },
        { name: "user-only", type: "postgres", dsnEnv: "USER_ONLY_DSN" },
      ],
    });
    await writeManifest("project", {
      sources: [{ name: "shared", type: "sqlite", dsnEnv: "PROJECT_SHARED_DSN", rowCap: 7 }],
    });

    const loaded = await loadDataSources(paths, {});
    expect(loaded.errors).toEqual([]);
    const shared = findDataSource(loaded.sources, "shared");
    expect(shared?.dsnEnv).toBe("PROJECT_SHARED_DSN");
    expect(shared?.rowCap).toBe(7);
    expect(shared?.overriddenBy).toBe("project");
    expect(findDataSource(loaded.sources, "user-only")?.dsnEnv).toBe("USER_ONLY_DSN");
  });

  it("records validation errors without silently dropping the other level", async () => {
    await writeManifest("user", { sources: [{ name: "ok", type: "sqlite", dsnEnv: "OK_DSN" }] });
    await writeManifest("project", { sources: [{ name: "bad", type: "oracle", dsnEnv: "X" }] });

    const loaded = await loadDataSources(paths, {});
    expect(loaded.sources.map((source) => source.name)).toEqual(["ok"]);
    expect(loaded.errors).toHaveLength(1);
    expect(loaded.errors[0]).toContain("project manifest");
  });

  it("rejects invalid JSON with a readable error", async () => {
    await writeFile(userManifestPath(paths)!, "{ not json", "utf8");
    const loaded = await loadDataSources(paths, {});
    expect(loaded.sources).toEqual([]);
    expect(loaded.errors[0]).toContain("not valid JSON");
  });

  it("rejects duplicate names inside one manifest", async () => {
    await writeManifest("user", {
      sources: [
        { name: "dup", type: "sqlite", dsnEnv: "A" },
        { name: "dup", type: "sqlite", dsnEnv: "B" },
      ],
    });
    const loaded = await loadDataSources(paths, {});
    expect(loaded.sources).toEqual([]);
    expect(loaded.errors[0]).toContain("duplicate source name");
  });

  it("applies defaults: readOnly true and rowCap 500", async () => {
    await writeManifest("user", { sources: [{ name: "s", type: "sqlite", dsnEnv: "S_DSN" }] });
    const loaded = await loadDataSources(paths, {});
    const source = findDataSource(loaded.sources, "s");
    expect(source?.readOnly).toBe(true);
    expect(source?.rowCap).toBe(500);
  });

  it("rejects rowCap above the maximum", async () => {
    await writeManifest("user", {
      sources: [{ name: "s", type: "sqlite", dsnEnv: "S_DSN", rowCap: 999999 }],
    });
    const loaded = await loadDataSources(paths, {});
    expect(loaded.sources).toEqual([]);
    expect(loaded.errors[0]).toContain("rowCap");
  });
});

describe("resolveSourceDsn", () => {
  const source = { name: "s", type: "sqlite" as const, dsnEnv: "S_DSN", readOnly: true, rowCap: 10 };

  it("reports the missing variable name without its value", () => {
    const resolved = resolveSourceDsn(source, {});
    expect(resolved.configured).toBe(false);
    expect(resolved.reason).toBe("environment variable S_DSN is not set");
    expect(JSON.stringify(resolved)).not.toContain("secret");
  });

  it("treats blank values as unconfigured", () => {
    expect(resolveSourceDsn(source, { S_DSN: "  " }).configured).toBe(false);
  });

  it("resolves relative sqlite paths against the project dir", () => {
    const resolved = resolveSourceDsn(source, { S_DSN: "db/dev.sqlite" }, "/repo/root");
    expect(resolved.dsn).toMatch(/[/\\]repo[/\\]root[/\\]db[/\\]dev\.sqlite$/);
  });

  it("keeps absolute paths as-is", () => {
    const resolved = resolveSourceDsn(source, { S_DSN: "/abs/dev.sqlite" }, "/repo/root");
    expect(resolved.dsn).toBe("/abs/dev.sqlite");
  });

  it("passes non-sqlite dsn values through untouched", () => {
    const pgSource = { ...source, type: "postgres" as const };
    const dsn = "postgres://user:pw@localhost:5432/db";
    expect(resolveSourceDsn(pgSource, { S_DSN: dsn }, "/repo").dsn).toBe(dsn);
  });
});

describe("toDataSourceView", () => {
  it("never exposes dsnEnv or the resolved connection string", () => {
    const source = {
      name: "s",
      type: "postgres" as const,
      dsnEnv: "SECRET_DSN",
      readOnly: false,
      rowCap: 42,
      schemas: ["public"],
    };
    const view = toDataSourceView(source, { SECRET_DSN: "postgres://u:p@h/db" }, "/repo");
    expect(view).toEqual({
      name: "s",
      type: "postgres",
      readOnly: false,
      rowCap: 42,
      schemas: ["public"],
      configured: true,
    });
    expect(Object.keys(view)).not.toContain("dsnEnv");
    expect(JSON.stringify(view)).not.toContain("SECRET_DSN");
  });

  it("marks unconfigured sources with the reason", () => {
    const source = { name: "s", type: "sqlite" as const, dsnEnv: "MISSING", readOnly: true, rowCap: 1 };
    const view = toDataSourceView(source, {}, "/repo");
    expect(view.configured).toBe(false);
    expect(view.notConfiguredReason).toContain("MISSING");
  });
});
