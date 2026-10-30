import { defineConfig } from "vitest/config";

// 与 office-runtime 同一理由：官方插件 seed 测试会把每个内置插件（含 dist 产物）
// 复制并哈希进临时存储根，插件数量增长后 5s 默认超时会出现负载相关的假失败。
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
