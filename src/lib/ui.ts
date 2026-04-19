const avatarColors = [
  "from-blue-400 to-indigo-500",
  "from-violet-400 to-purple-500",
  "from-emerald-400 to-teal-500",
  "from-amber-400 to-orange-500",
  "from-rose-400 to-pink-500",
];

export function getAvatarGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

export function getLevelStyle(level: string | null): string {
  const styles: Record<string, string> = {
    lite: "bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)]",
    pro: "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]",
    max: "bg-violet-500/10 text-violet-400",
  };
  return styles[level || ""] || "bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)]";
}
