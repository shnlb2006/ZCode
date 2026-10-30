import type { DataSource } from "../config.js";
import { createMySqlDriver } from "./mysql.js";
import { createPgDriver } from "./pg.js";
import { createSqliteDriver } from "./sqlite.js";
import type { DataDriver, DataDriverFactory } from "./types.js";

const factories: Record<DataSource["type"], DataDriverFactory> = {
  postgres: createPgDriver,
  mysql: createMySqlDriver,
  sqlite: createSqliteDriver,
};

/** 按源类型惰性创建驱动；驱动依赖（pg/mysql2）在工厂内动态 import。 */
export async function createDriver(source: DataSource, dsn: string): Promise<DataDriver> {
  return factories[source.type](dsn, source.name);
}
