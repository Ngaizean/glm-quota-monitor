/**
 * UI 共享工具 — 状态色判定、头像渐变、级别徽章
 * 统一颜色阈值来源，消除各组件重复的 85/60 魔法数字
 */

/** 状态色阈值（百分比） */
export const STATUS_THRESHOLDS = {
  warning: 60,
  danger: 85,
} as const;

/** 状态级别 */
export type StatusLevel = "success" | "warning" | "danger";

/** 根据使用率百分比返回状态级别 */
export function getStatusLevel(pct: number): StatusLevel {
  if (pct > STATUS_THRESHOLDS.danger) return "danger";
  if (pct > STATUS_THRESHOLDS.warning) return "warning";
  return "success";
}

/** 状态级别 → CSS var 颜色字符串 */
export function statusColorVar(level: StatusLevel): string {
  return `var(--color-${level})`;
}

/** 状态级别 → 渐变 CSS var（用于进度条填充） */
export function statusGradientVar(level: StatusLevel): string {
  return `var(--gradient-${level})`;
}

/** 状态级别 → 单色 CSS 类（用于小圆点/文本） */
export function statusBgClass(level: StatusLevel): string {
  return `bg-[var(--color-${level})]`;
}

export function statusTextClass(level: StatusLevel): string {
  return `text-[var(--color-${level})]`;
}

/** 头像渐变 — 多色调色板（头像适合多色，不跟随 accent） */
const AVATAR_GRADIENTS = [
  "from-blue-400 to-indigo-500",
  "from-purple-400 to-pink-500",
  "from-emerald-400 to-teal-500",
  "from-amber-400 to-orange-500",
  "from-cyan-400 to-blue-500",
  "from-rose-400 to-red-500",
  "from-violet-400 to-purple-500",
] as const;

/** 根据名称哈希返回稳定的头像渐变 */
export function getAvatarGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

export type PlanLevel = "lite" | "pro" | "max" | string;

/** 计划级别徽章样式 — max 级别跟随 accent 主题 */
export function getLevelStyle(level: PlanLevel | null | undefined): string {
  if (!level) return "hidden";
  const lv = level.toLowerCase();
  if (lv === "max") {
    return "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]";
  }
  if (lv === "pro") {
    return "bg-violet-500/10 text-violet-400";
  }
  return "bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)]";
}
