import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RootStartupLoading, ZCodeStartupLogoBadge } from "@/root/RootStartupLoading.js";

describe("RootStartupLoading", () => {
  it("静态品牌图标不渲染呼吸动画", () => {
    const html = renderToStaticMarkup(createElement(ZCodeStartupLogoBadge, { animated: false }));
    // 品牌图标改为纸飞机品牌包的 SVG 资源（测试环境内联为 data URL）；
    // 静态态不得携带 SMIL 呼吸动画。
    expect(html).toContain("data:image/svg+xml");
    expect(html).not.toContain("<animate");
  });
  it("启动阻塞态使用品牌图标而不是可见 loading 文案", () => {
    const html = renderToStaticMarkup(createElement(RootStartupLoading, { label: "加载中..." }));

    expect(html).toContain('data-testid="root-startup-loading"');
    expect(html).toContain('aria-label="加载中..."');
    expect(html).toContain("data:image/svg+xml");
    expect(html).not.toContain(">加载中...<");
  });
});
