import type { CallToolResult } from "@modelcontextprotocol/server";

function text(value: string): CallToolResult {
  return { content: [{ type: "text", text: value }] };
}

export function json(value: unknown): CallToolResult {
  return text(JSON.stringify(value, null, 2));
}

export function fail(value: unknown): CallToolResult {
  return {
    isError: true,
    content: [
      { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
    ],
  };
}

/**
 * 修复原因：驱动错误消息可能携带连接串（主机名、库名、用户），直接回显等于把
 * dsnEnv 指向的机密写进会话转录。统一在出口替换，调用方无法绕过。
 */
export function sanitizeDriverMessage(message: string, dsn: string): string {
  if (!dsn) return message;
  return message.split(dsn).join("[redacted-dsn]");
}
