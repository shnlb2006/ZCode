# data-plugin

受控数据库调试 MCP server（本地 stdio）。产品规则与验收场景见 `docs/specs/data-debug-gateway.md`；本文只写类型与测试表达不了的三样。

## 意图

让 agent 能查数据库辅助调试，同时把治理（只读、行数、零密钥、审计边界）做成插件内的硬门，而不是提示词里的请求。宿主（services/desktop/protocol）不参与数据访问，因此远程与本地 workspace 行为一致。

## 不变量

- **只读是分类器的结论，不是声明**：`guardSql` 对只读源只放行 `SELECT`/`WITH`/`VALUES`/`TABLE`/`EXPLAIN`/`SHOW`/`DESCRIBE` 首关键字，并继续分类 `EXPLAIN` 的目标语句（`ANALYZE` 会真正执行）；`FOR UPDATE`、`SELECT INTO`、`INTO OUTFILE` 等锁定与副作用子句拒绝。写操作需要源显式 `readOnly: false`。
- **配置文件零密钥**：manifest 只存 `dsnEnv` 引用名；连接串经环境变量解析。`toDataSourceView` 是工具可见投影，结构上不含 `dsnEnv`；驱动错误消息出口统一替换连接串（`sanitizeDriverMessage`）。
- **行数上限精确可判**：守卫对返回行语句追加 `LIMIT rowCap + 1`，驱动截断到 `rowCap`，用多取的那一行判定 `truncated`。不返回行的语句（写操作、`SHOW`、`DESCRIBE`、`EXPLAIN`）不追加——追加会产生语法错误或改变被解释的查询。
- **无状态**：连接按查询创建、用完即关。stdio 插件被 MCP 连接池 30 秒空闲回收，跨调用不持有任何句柄。

## 与其它模块的交集点

- **MCP 连接池与权限**：插件经 `resolvePluginMcpServers` → `runtimeConfig.mcp.servers` 进入工具表；每次调用由宿主 `PermissionService` 审批（MCP 工具硬编码 `needsApproval`），SQL 原文与结果落会话转录 `part` 表、调用元数据落 `tool_usage` 表。插件不自建审计。
- **官方 seed / SEA**：`dist/mcp/server.js` 是唯一运行时产物，版本号在 `package.json`、`.zcode-plugin/plugin.json`、`official-plugin-definitions.ts`、`sea-official-plugin-assets.mjs` 四处对齐；默认不启用，数据访问按需开启。
