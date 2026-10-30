# 数据库调试网关（第一阶段：agent 侧受控查询）

## 交付物

一个官方 `data` 插件（本地 stdio MCP server），让 agent 能对已注册数据源执行受控查询。治理在插件内部强制，不依赖 agent 自觉；不碰 agent 核心、协议、宿主服务。

三个工具：
- `data__list_sources` — 列出已配置源及策略（只读标志、行数上限、schema 范围），**不含连接串**
- `data__describe` — 内省表/列结构，帮 agent 写对 SQL
- `data__query` — 执行查询，默认只读，返回行数/截断标记/耗时

默认支持 PostgreSQL（`pg`）、MySQL（`mysql2`）、SQLite（`node:sqlite` 内置，零依赖）。

## 核心设计决策（都有源码依据）

1. **只读由分类器强制，不靠声明**：`query` 默认只允许 SELECT / WITH…SELECT / EXPLAIN；多语句、写操作、DDL 一律拒绝，除非该源在 manifest 里显式 `writable: true`。这是插件内的硬门（MCP annotations 只是提示，宿主对 MCP 工具的权限硬编码在 `core/src/mcp/index.ts:129-148`）。
2. **连接串只走环境变量引用**：manifest 里只写 `dsnEnv: "DATABASE_URL"` 这样的引用名，运行时解析 `process.env`。配置文件零密钥——这是相对插件 userConfig（值明文落 `~/.zcode/cli/config.json`）的关键安全差异。
3. **两级 manifest**：用户级 `${ZCODE_PLUGIN_DATA}/data-sources.json` + 项目级 `${ZCODE_PROJECT_DIR}/.zcode/data-sources.json`，项目覆盖用户（沿用仓库既有 user < project 优先级惯例）。项目级可提交 git，实现“团队共享开发库配置、密钥仍走各自环境”。
4. **行数上限**：对无 LIMIT 的语句按 `rowCap` 追加强制 LIMIT（正则识别语句末尾 LIMIT，识别不清时追加最外层 LIMIT 是安全动作）；返回行数达上限时标记 `truncated`。PostgreSQL 连接时 `SET statement_timeout`；MySQL/SQLite 的超时为已知限制，二期补。
5. **审批与审计复用现有机制**：所有 MCP 工具每次调用都弹审批（`needsApproval` 恒真），项目 allow 规则可对只读源免确认（README 说明配法）。SQL 原文与结果已落会话转录 `part` 表，调用元数据落 `tool_usage` 表，行数由工具结果内容上报——一期不扩 schema。
6. **无状态设计**：stdio 插件 30 秒空闲即被进程池回收（`adapters/src/mcp/pool.ts:18`），因此插件按查询建连、不持有跨调用状态，接受冷启动。

## 改动清单

**新增插件包 `apps/zcode-cli/packages/data-plugin/`（照抄 android-emulator-plugin 范式）**
1. `package.json` / `tsconfig.json` — `@zcode/data-plugin`，main/bin 指向 `dist/mcp/server.js`，deps：`@modelcontextprotocol/server` + `zod` + `pg` + `mysql2`（驱动懒加载，仿 `office-runtime/src/adapters/parse/pdf.ts:25`）
2. `src/mcp/server.ts` — `McpServer` + `StdioServerTransport`，注册三个工具
3. `src/guards/sql.ts` — 语句分类器（单语句/只读判定/LIMIT 追加）+ 行数截断
4. `src/config.ts` — 两级 manifest 读取与 zod 校验 + `dsnEnv` 解析
5. `src/drivers/{pg,mysql,sqlite}.ts` — 懒加载连接、describe 内省、query 执行
6. `scripts/build-mcp.mjs` — esbuild bundle 产出 `dist/mcp/server.js`
7. `.zcode-plugin/plugin.json` — `mcpServers.data` stdio 声明；**不声明 userConfig**
8. `README.md` — manifest schema、env 约定、只读策略、已知限制
9. `test/` — 分类器/行数/LIMIT/manifest 合并单测；临时 sqlite 库走真实 stdio MCP 往返的集成测试

**注册点（4 处）**
10. `bootstrap/src/app/official-plugin-definitions.ts` — 加条目，`defaultEnabled: false`（用户按需启用）
11. `cli/scripts/sea-official-plugin-assets.mjs` — SEA 资产条目；版本号与 package.json / plugin.json / definition **四处对齐**（现有 build-sea 测试会强制这一点）
12. `docs/specs/data-debug-gateway.md` — 按 AGENTS.md 硬规则先写 spec：状态所有者（插件持有连接、宿主零状态）、只读判定规则、行数/超时语义、配置优先级、审批与审计边界、验收场景
13. 架构策略**无需改**（`architecture-policy.yaml:67-68` 的 `zcode-cli` 模块 roots 已覆盖整个 `apps/zcode-cli`），以 `architecture:check --changed` 实测为准

## 验证

- 插件包单测 + sqlite 集成测试（真实协议往返，零外部依赖）
- `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed` 真实执行并如实报告
- 手工验收：配一个 sqlite 源 → 三个工具全通；INSERT 被拒；无 LIMIT 查询被截断并标记；`dsnEnv` 未设置时报错可读

## 明确不做（二期，链路已探明）

- 宿主 `IDataSourceService` + 设置页 + `ICredentialService` 托管 DSN（约 15 个文件：channels → service → node.ts×4 → accessor → remoteServiceAccess → 桌面两个 collection → RPC policy → 设置页 4 处）
- `tool_usage` 加 data_source/sql_hash/rows 列做结构化审计
- MySQL 语句超时、LIMIT 识别的边界加固、组织级数据源共享策略

## 主要风险

- 每次查询都弹审批可能打断调试节奏——只读源可配项目 allow 规则免确认，yolo 模式直通（使用者知情）
- SEA 体积因内联 pg/mysql2 增加——懒加载缓解启动开销，体积增量可接受
- 分类器误判方向都安全（漏追加 LIMIT 只是不设上限，误追加只作用于最外层），但复杂语句仍需二期加固