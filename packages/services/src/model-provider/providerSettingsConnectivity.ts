import type { ModelConnectivityResult } from "@zcode/shared";
import type {
  ProviderAvailableModelsRequest,
  ProviderAvailableModelsResult,
  ProviderSettingsConnectivityTester,
} from "./providerFacadeServices.js";

interface FormalModelConnectivityInput {
  readonly workspacePath: string;
  readonly workspaceIdentity?: string;
  readonly selection: {
    readonly providerId: string;
    readonly modelId: string;
  };
}

type FormalModelConnectivityExecutor = (
  input: FormalModelConnectivityInput,
) => Promise<{ readonly success: true }>;

const FETCH_TIMEOUT_MS = 15_000;
const ANTHROPIC_VERSION_HEADER = "2023-06-01";

/**
 * 设置页只负责把已经落盘并进入 Registry 的 ModelSelection 交给目标 Environment。
 * Provider 鉴权、headers、reasoning 映射和流消费全部由正式 Model 执行链负责。
 */
export function createProviderSettingsConnectivityTester(dependencies: {
  readonly testModelConnectivity: FormalModelConnectivityExecutor;
}): ProviderSettingsConnectivityTester {
  return async (input) => {
    try {
      await dependencies.testModelConnectivity({
        workspacePath: input.workspacePath,
        ...(input.workspaceIdentity ? { workspaceIdentity: input.workspaceIdentity } : {}),
        selection: {
          providerId: input.providerId,
          modelId: input.modelId,
        },
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  };
}

/**
 * 供应商开放的标准模型清单端点探测。
 *
 * 输入是设置页的草稿值（未保存也可用），只做只读 GET，不触碰任何落盘状态：
 * - anthropic-messages：GET {base}/models（base 按 Anthropic 约定含 /v1，缺省时补齐）
 * - openai-chat-completions / openai-responses：GET {base}/models
 * 两族响应同为 { data: [{ id }] }；鉴权头同时带 Bearer 与 x-api-key，
 * 覆盖 MiniMax（Bearer）与 Anthropic 官方（x-api-key）两类网关。
 */
export async function fetchProviderAvailableModels(
  input: ProviderAvailableModelsRequest,
): Promise<ProviderAvailableModelsResult> {
  const baseUrl = input.baseUrl.trim();
  if (!baseUrl) {
    throw new Error("baseUrl 不能为空");
  }
  let endpoint: URL;
  try {
    endpoint = resolveModelsEndpoint(new URL(baseUrl), input.apiType);
  } catch {
    throw new Error(`baseUrl 无效: ${baseUrl}`);
  }

  const headers = new Headers({ "Content-Type": "application/json" });
  const apiKey = input.apiKey?.trim();
  if (apiKey) {
    headers.set("Authorization", `Bearer ${apiKey}`);
    if (input.apiType === "anthropic-messages") {
      headers.set("x-api-key", apiKey);
      headers.set("anthropic-version", ANTHROPIC_VERSION_HEADER);
    }
  }

  const response = await fetch(endpoint, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(
      `获取模型列表失败（HTTP ${response.status}）${detail ? `: ${detail}` : ""}`,
    );
  }
  const payload: unknown = await response.json().catch(() => {
    throw new Error("模型列表响应不是有效 JSON");
  });
  return { models: extractModelIds(payload) };
}

function resolveModelsEndpoint(
  base: URL,
  apiType: ProviderAvailableModelsRequest["apiType"],
): URL {
  const url = new URL(base.href);
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/models`;
  // Anthropic 协议的网关根允许省略 /v1（与执行链 normalizeAnthropicBaseURL 同一边界约定）；
  // models 端点同样挂在这段前缀下，这里在探测侧补齐，避免用户按官方示例填根地址时探测失败。
  if (apiType === "anthropic-messages" && !url.pathname.toLowerCase().endsWith("/v1/models")) {
    url.pathname = `${url.pathname.replace(/\/models$/u, "")}/v1/models`;
  }
  return url;
}

function extractModelIds(payload: unknown): readonly string[] {
  const list = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : [];
  const ids = list
    .map((item) => {
      if (typeof item === "string") return item;
      if (isRecord(item) && typeof item.id === "string") return item.id;
      return null;
    })
    .filter((id): id is string => Boolean(id?.trim()))
    .map((id) => id.trim());
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type { ModelConnectivityResult };
