# 模型设置：自动获取供应商模型列表（fetchAvailableModels）

## 背景

设置页添加/编辑模型此前只能手动输入模型 ID；供应商普遍提供标准的模型清单端点（OpenAI 风格 `GET {base}/models`、Anthropic 风格 `GET {base}/v1/models`），应支持一键拉取并点选填入。

## 产品规则

- 入口：模型列表区头部「同步模型」按钮，位于「添加模型」按钮**左侧**；点击即拉取供应商全部可用模型，把列表中还没有的模型按推荐配置批量加入，一次点击完成同步。（2026-10-26 调整：原先位于添加模型对话框内的点选回填入口已移除。）
- 输入为连接草稿（当前表单的 `api.type` / `baseUrl` / `apiKey`），**未保存即可探测**；修改连接信息后需重新点击同步。
- 探测是纯只读 GET；结果去重排序后与现有成员做差集，逐个经 `resolveModelConfig` 取推荐基线并走与手动添加相同的 `onAddModel` 保存事务；无新增时提示已是最新，结果通过 Provider Detail Feedback 呈现（pending 进度 / success / failure）。
- 端点拼接：openai 系 `{base}/models`；anthropic-messages 若 base 未以 `/v1` 结尾则补 `/v1/models`（与执行链 `normalizeAnthropicBaseURL` 同一边界约定）。
- 鉴权头：`Authorization: Bearer <key>` 恒带；anthropic-messages 额外带 `x-api-key` 与 `anthropic-version: 2023-06-01`，覆盖 MiniMax（Bearer）与 Anthropic 官方（x-api-key）两类网关。
- 响应兼容 `{ data: [{ id }] }` 与字符串数组；超时 15s；非 2xx 抛出带状态码错误并展示在反馈条内。

## 接口与所有者

- 服务：`IProviderSettingsService.fetchAvailableModels(input): Promise<{ models: readonly string[] }>`（`packages/services/src/model-provider/providerFacadeServices.ts`）。
- 实现：`packages/services/src/model-provider/providerAvailableModels.ts`，纯函数、无 facade 依赖；传输由 services RPC 按 descriptor 代理（与 `testModelConnectivity` 同层）。
- UI 状态：`ProviderModelsSection` 组件内局部同步状态（syncingModels），不属于任何全局 store；结果反馈走 `ProviderDetailFeedback`。

## MiniMax M3.1 自适应思考适配（随本特性一并修复）

- 现象：`modelApiRules` 的 anthropic-messages 全局兜底映射在思考等级为 disabled 时注入 `thinking.type="disabled"`；MiniMax-M3.1 系列强制自适应思考，收到该字段返回 400（错误码 2013）。
- 修复：`zcode-builtin.json`（revision 33 → 34）在兜底规则后新增 `.*MiniMax-M3\.1.*` + `apiTypeMatch: anthropic-messages` 覆盖规则：disabled → 以 JSON Merge Patch `null` 删除 `thinking` / `output_config` 字段（模型默认自适应）；非 disabled → `thinking.type=adaptive` + `output_config.effort`（enabled → high，其余档位原样），与 MiniMax 官方「Anthropic 兼容：output_config.effort 控制思考深度」一致。
- 用户侧注意：若手动添加 M3.1 模型时已把兜底映射保存为个人覆盖，需在「编辑模型配置 → 高级配置」清空推理参数映射（或删除模型重加）后才能吃到内置规则修复。

## 验收场景

1. openai 兼容供应商填 baseUrl + Key → 点「同步模型」→ 供应商返回的全部缺失模型一次性出现在模型列表。
2. 再次点击同步 → 无新增模型时提示「已是最新」，不重复添加。
3. MiniMax（anthropic-messages，base 不含 /v1）→ 同步命中 `{base}/v1/models`。
4. Key 错误 → 反馈条展示 HTTP 401 错误，已添加的模型保留（部分成功部分失败时失败前缀不回滚）。
5. MiniMax-M3.1-Flash 思考关 → 请求体不含 `thinking` 字段，不再 400。
