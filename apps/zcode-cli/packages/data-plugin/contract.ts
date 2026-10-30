/**
 * data-plugin 对外契约：包内其余部分（MCP server、测试）与未来宿主侧集成要想正确
 * 调用就必须知道的一切都写在这里；实现细节（驱动内省 SQL、连接管理）对外不可见。
 * 实现位于 src/，本文件只是它的公共投影面。
 */

export {
  DATA_SOURCE_TYPES,
  DEFAULT_ROW_CAP,
  MAX_ROW_CAP,
  findDataSource,
  loadDataSources,
  projectManifestPath,
  resolveSourceDsn,
  toDataSourceView,
  userManifestPath,
} from "./src/config.js";
export type {
  DataSource,
  DataSourcePaths,
  DataSourceType,
  DataSourceView,
  LoadedDataSources,
  ResolvedDsn,
} from "./src/config.js";

export { guardSql, hasTopLevelSemicolon, truncateRows } from "./src/guards/sql.js";
export type { SqlGuardInput, SqlGuardResult } from "./src/guards/sql.js";

export { createDriver } from "./src/drivers/index.js";
export type {
  DataDriver,
  DataDriverFactory,
  DriverColumn,
  DriverDescribeResult,
  DriverQueryResult,
  DriverTable,
} from "./src/drivers/types.js";
