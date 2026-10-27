import { cn } from "@/components/lib/utils.js";
import appLogoUrl from "@/assets/provider-icons/app-logo-dark.svg";
import wordmarkWhiteUrl from "@/assets/provider-icons/logo-wordmark-white.svg";

/** 应用品牌图标：纸飞机品牌包 app-dark（墨蓝圆角方块 + 双翼纸飞机，自带底色）。 */
export function ZCodeAboutLogo({ className }: { className?: string }) {
  return (
    <img
      src={appLogoUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("shrink-0 select-none object-contain", className)}
    />
  );
}

/** 品牌字标：纸飞机品牌包 wordmark-white（深色背景分享卡使用）。 */
export function ZCodeWordmarkLogo({ className }: { className?: string }) {
  return (
    <img
      src={wordmarkWhiteUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("shrink-0 select-none object-contain", className)}
    />
  );
}
