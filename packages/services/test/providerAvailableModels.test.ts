import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProviderAvailableModels } from "../src/model-provider/providerSettingsConnectivity.js";

const okJson = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(""),
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchProviderAvailableModels", () => {
  it("openai 协议在 baseUrl 下拼接 /models 并携带 Bearer 头", async () => {
    const fetchMock = vi.fn(() =>
      okJson({ object: "list", data: [{ id: "MiniMax-M3.1" }, { id: "MiniMax-M2" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProviderAvailableModels({
      apiType: "openai-chat-completions",
      baseUrl: "https://api.example.com/v1/",
      apiKey: "sk-test",
    });

    expect(result.models).toEqual(["MiniMax-M2", "MiniMax-M3.1"]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe("https://api.example.com/v1/models");
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer sk-test");
  });

  it("anthropic 协议补齐 /v1 前缀并同时携带 Bearer 与 x-api-key", async () => {
    const fetchMock = vi.fn(() => okJson({ data: [{ id: "claude-x" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProviderAvailableModels({
      apiType: "anthropic-messages",
      baseUrl: "https://api.example.com/anthropic",
      apiKey: "key-test",
    });

    expect(result.models).toEqual(["claude-x"]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe("https://api.example.com/anthropic/v1/models");
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer key-test");
    expect(headers.get("x-api-key")).toBe("key-test");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
  });

  it("anthropic baseUrl 已含 /v1 时不重复补前缀", async () => {
    const fetchMock = vi.fn(() => okJson({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchProviderAvailableModels({
      apiType: "anthropic-messages",
      baseUrl: "https://api.example.com/v1",
      apiKey: "key-test",
    });

    const [url] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(url.href).toBe("https://api.example.com/v1/models");
  });

  it("对字符串数组响应、去重并排序", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okJson(["b-model", "a-model", "b-model"])));

    const result = await fetchProviderAvailableModels({
      apiType: "openai-responses",
      baseUrl: "https://api.example.com/v1",
    });

    expect(result.models).toEqual(["a-model", "b-model"]);
  });

  it("非 2xx 抛出带状态码的错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({ ok: false, status: 401, json: () => Promise.reject(new Error("x")), text: () => Promise.resolve("unauthorized") }),
      ),
    );

    await expect(
      fetchProviderAvailableModels({
        apiType: "openai-chat-completions",
        baseUrl: "https://api.example.com/v1",
        apiKey: "bad",
      }),
    ).rejects.toThrow("HTTP 401");
  });

  it("baseUrl 为空直接报错，不发起请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchProviderAvailableModels({
        apiType: "openai-chat-completions",
        baseUrl: "  ",
      }),
    ).rejects.toThrow("baseUrl");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
