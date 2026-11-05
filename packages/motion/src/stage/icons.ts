// Loose icon names -> Hugeicons. resolveIcon never throws; unknown names get a generic icon.
import * as all from "@hugeicons/core-free-icons";

export type IconNode = [string, Record<string, string>];
export type IconDef = readonly IconNode[];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

let index: [string, IconDef][] | undefined; // [normalized name without "Icon", icon], shortest first
const table = () => index ??= Object.entries(all as Record<string, unknown>)
  .filter(([k, v]) => k.endsWith("Icon") && !k.endsWith("FreeIcons") && Array.isArray(v))
  .map(([k, v]) => [norm(k.slice(0, -4)), v as IconDef] as [string, IconDef])
  .sort((a, b) => a[0].length - b[0].length || (a[0] < b[0] ? -1 : 1));
export const FALLBACK: IconDef = (all as Record<string, unknown>).HelpCircleIcon as IconDef ?? (all as Record<string, unknown>).CircleIcon as IconDef ?? [];

export function resolveIcon(name: string): IconDef {
  const n = norm(String(name ?? "").replace(/icon$/i, ""));
  if (!n) return FALLBACK;
  const t = table();
  const hit = (k: string) => t.find(([key]) => key === k)?.[1];
  return hit(n) ?? hit(n + "01") ?? t.find(([key]) => key.startsWith(n))?.[1] ?? t.find(([key]) => key.includes(n))?.[1] ?? FALLBACK;
}

/** SVG markup on a 24x24 viewBox with currentColor replaced by `color`. */
export function iconSvg(icon: IconDef, color: string): string {
  const kebab = (k: string) => k.replace(/[A-Z]/g, c => "-" + c.toLowerCase());
  const body = icon.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== "key")
    .map(([k, v]) => `${kebab(k)}="${String(v).replace(/currentColor/g, color)}"`).join(" ")}/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none">${body}</svg>`;
}

export const ICON_NAMES = [
  "computer", "laptop", "server", "database", "cpu", "chip", "memory", "cloud", "wifi", "lock", "key", "user", "users", "book", "pencil",
  "lightbulb", "rocket", "clock", "calendar", "chart", "graph", "code", "terminal", "bug", "folder", "file", "search", "settings", "globe",
  "phone", "mail", "heart", "star", "fire", "trophy", "warning", "check", "cancel", "plus", "minus", "arrow-right", "flash", "battery",
  "money", "cart", "home", "building", "car", "plane", "brain", "eye", "puzzle", "target", "gift", "coffee", "music", "camera", "image",
  "video", "mic", "shield", "bell", "bookmark", "link", "download", "upload", "share", "trash", "edit", "copy", "save", "print", "tag",
  "flag", "map", "compass", "location", "sun", "moon", "umbrella", "leaf", "tree", "water", "wind", "thermometer", "bike", "train", "ship",
  "bus", "truck", "school", "hospital", "bank", "store", "restaurant", "pizza", "apple", "tv", "monitor", "keyboard", "mouse", "headphones",
  "speaker", "bluetooth", "usb", "router", "network", "robot", "bot", "magnet", "scale", "hammer", "wrench", "scissors", "ruler", "calculator",
  "notebook", "newspaper", "message", "chat", "comment", "question", "info", "lamp", "diamond", "crown", "medal", "ticket", "filter", "layers",
  "grid", "list", "menu", "home", "refresh", "sync", "play", "pause", "stop", "camera", "bar-chart", "pie-chart", "analytics", "hourglass",
  "stopwatch", "alarm", "wallet", "credit-card", "bitcoin", "package", "box", "gamepad", "film", "paint", "palette", "pen", "microscope", "flask",
  "atom", "dna", "pill", "stethoscope", "dumbbell", "football", "basketball", "tent", "mountain", "anchor",
];
