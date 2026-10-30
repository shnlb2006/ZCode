# data

受控的数据库调试插件。以本地 stdio MCP server 形式向 agent 暴露三个工具，治理规则在插件内部强制，不依赖 agent 自觉。产品规则与验收场景见 [`docs/specs/data-debug-gateway.md`](../../../../docs/specs/data-debug-gateway.md)。

## 工具

| 工具 | 作用 |
| --- | --- |
| `data__list_sources` | 列出已配置数据源及其策略（只读标志、行数上限、schema 范围）。**从不返回连接串**；未配置的源只报告缺失的环境变量名 |
| `data__describe` | 内省表/列结构，受源声明的 schema 范围限制 |
| `data__query` | 执行单条 SQL；只读源只接受 `SELECT` / `WITH` / `VALUES` / `TABLE` / `EXPLAIN` / `SHOW` / `DESCRIBE`；结果按行数上限截断并标记 `truncated` |

支持 PostgreSQL（`pg`）、MySQL（`mysql2`）与 SQLite（Node 内置 `node:sqlite`，零额外依赖）。

## 数据源配置（manifest）

两级 JSON manifest，同名源**项目级覆盖用户级**：

- 用户级：`<plugin-data>/data-sources.json`（`ZCODE_PLUGIN_DATA`）
- 项目级：`<project>/.zcode/data-sources.json`（`ZCODE_PROJECT_DIR`），可提交 git，团队共享开发库配置

```jsonc
{
  "sources": [
    {
      "name": "dev-main",              // 唯一名，工具入参引用
      "type": "postgres",              // postgres | mysql | sqlite
      "dsnEnv": "DEV_MAIN_DSN",        // 环境变量名；sqlite 时为数据库文件路径
      "readOnly": true,                // 默认 true；false 才允许写操作
      "rowCap": 500,                   // 默认 500，最大 10000
      "schemas": ["public"]            // 可选；限定 describe/query 的 schema 范围
    }
  ]
}
```

### 连接串只走环境变量

manifest 是纯配置、**零密钥**：连接串由 `dsnEnv` 指向的环境变量提供，例如

```bash
export DEV_MAIN_DSN="postgres://user:password@localhost:5432/dev_main"
```

- 变量未设置时，`list_sources` 将该源标记为 `unconfigured` 并给出变量名，`describe` / `query` 拒绝执行；错误信息不含变量值。
- SQLite 的相对路径按项目目录解析。
- manifest 非法（JSON 解析失败、schema 校验失败、同级重名）时该层整体拒绝加载，错误经 `list_sources` 的 `errors` 段可见，不静默跳过条目。

## 只读与行数策略

- **只读是硬门**：分类器只允许读语句首关键字；`EXPLAIN ANALYZE <写操作>` 会被继续分类目标语句后拒绝；`FOR UPDATE` / `INTO OUTFILE` / `SELECT INTO` 等锁定与副作用子句同样拒绝。写操作需要源显式 `readOnly: false`。
- **多语句拒绝**：顶层分号（字符串、注释、dollar-quote 内的分号不算）出现即拒绝，每调用一条语句。
- **行数上限**：对末尾无 `LIMIT` 的返回行语句追加 `LIMIT rowCap + 1`，驱动截断到 `rowCap` 并以多取的那一行精确判定 `truncated`。
- 每个 MCP 工具调用都经宿主 `PermissionService` 审批（MCP 工具硬编码 `needsApproval`）。想对只读源免确认，可在项目规则里 allow `mcp__data__query`；yolo 模式直通（使用者知情）。

## 已知限制（一期）

- MySQL / SQLite 无服务端语句超时；PostgreSQL 使用 15 秒 `statement_timeout`。
- 行数上限的 `LIMIT` 追加是保守正则：语句末尾已带 `LIMIT`（数字 / `ALL` / 占位符）时不追加，其余情况一律追加——误判方向安全（漏追加只不设上限，误追加只作用于最外层）。
- 连接按查询创建、用完即关：stdio 插件被 MCP 连接池 30 秒空闲回收，无跨调用状态，冷启动可预期。
- 结构化查询审计（数据源、SQL、行数落 `tool_usage` 表）与宿主侧数据源管理 UI 为二期；一期 SQL 原文与结果已存在于会话转录。

## 开发

```bash
pnpm --filter @zcode/data-plugin build     # tsc + esbuild 产出 dist/mcp/server.js
pnpm --filter @zcode/data-plugin test      # 守卫/配置单测 + sqlite 协议往返集成测试
```
