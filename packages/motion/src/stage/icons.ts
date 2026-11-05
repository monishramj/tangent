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
  const raw = String(name ?? "").toLowerCase().trim().replace(/[\s_]+/g, "-");
  const n = norm((SYNONYMS[raw] ?? SYNONYMS[norm(raw)] ?? raw).replace(/icon$/i, ""));
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

// Curated names by category (each resolves to an exact Hugeicons name); the guide shows a few per category.
export const ICON_CATEGORIES: Record<string, string> = {
  tech: "laptop server database cpu chip cloud wifi router lock key code terminal bug robot api github git-branch smartphone keyboard monitor "
    + "computer microchip ai-chip cloud-server wireless network internet bluetooth usb mouse tablet printer headphones speaker battery plug hard-drive "
    + "memory-stick ram-memory sd-card server-stack server-crash graphic-card webhook git-commit git-merge git-pull-request source-code function algorithm "
    + "binary-code bot neural-network artificial-intelligence ai-brain brain-circuit browser javascript python java qr-code barcode fingerprint firewall "
    + "shield encrypt satellite signal cloud-off wifi-error lock-password",
  data: "chart bar-chart pie-chart table filter layers hierarchy flowchart queue sorting "
    + "chart-line analytics chart-histogram chart-scatter chart-bubble chart-increase chart-decrease chart-area trending-up trending-down percent funnel "
    + "csv xml database-sync grid matrix tree workflow structure sigma infinity abacus folder file search cube package package-open link list",
  people: "user users user-group student teacher developer doctor handshake thumbs-up brain "
    + "profile manager customer-support baby child man woman user-add user-check user-love thumbs-down eye ear voice speech heart-check "
    + "teamwork clapping hand graduate-male",
  science: "atom dna microscope test-tube telescope magnet rocket planet earth galaxy "
    + "sun moon star chemistry physics thermometer fire flash battery-charging bacteria pill medicine stethoscope syringe heart-pulse droplet "
    + "molecules labs flask-round radioactive-alert danger",
  math: "calculator plus-sign minus-sign multiplication-sign divide-sign equal pi sigma function-square ruler "
    + "math percent-circle compass triangle circle square hexagon infinity-01 angle variable square-root-square less-than",
  school: "school book book-open notebook pencil graduation-cap lightbulb quiz award trophy "
    + "pen eraser backpack library certificate medal note bookmark highlighter idea bulb study-desk paperclip clipboard",
  business: "money coins wallet bank briefcase target presentation calendar clock megaphone "
    + "dollar credit-card building office store shopping-cart shopping-bag invoice receipt tag discount gift timer hourglass stopwatch alarm-clock "
    + "chart-up profit mail inbox send signature stamp strategy goal flag milestone puzzle chess crown diamond scale vote",
  nature: "tree leaf plant flower cloud rain snow mountain wave recycle "
    + "wind apple fish bird cat turtle rabbit horse feather mushroom cactus rainbow umbrella snowflake tornado paw-print globe house car "
    + "bicycle bus train airplane ship truck map location coffee pizza",
  ui: "arrow-right arrow-up refresh repeat shuffle play pause check cancel search "
    + "arrow-left arrow-down arrow-up-right arrow-expand arrow-shrink undo redo stop next previous forward rewind plus minus tick menu more home "
    + "settings zoom-in zoom-out download upload share edit delete trash copy save expand collapse maximize minimize view bell notification alert "
    + "info question help-circle checkmark-circle cancel-circle eye-off hammer wrench scissors magnet lamp camera image video mic music film palette gamepad",
  feelings: "happy sad smile angry confused surprise shocked party sparkles heart "
    + "laugh wink neutral sleeping tired crying kissing smile-dizzy sad-dizzy star-face ghost alien skull mask-love fire-02 rocket-02 "
    + "magic-wand fireworks hand-heart",
};
export const ICON_NAMES = [...new Set(Object.values(ICON_CATEGORIES).flatMap(s => s.split(" ")))];
/** Loose words a model reaches for -> a curated name. */
export const SYNONYMS: Record<string, string> = {
  ram: "ram-memory", memory: "memory-stick", "server-rack": "server-stack", rack: "server-stack", db: "database", sql: "database", storage: "hard-drive",
  disk: "hard-drive", ssd: "hard-drive", hdd: "hard-drive", gpu: "graphic-card", processor: "cpu", idea: "lightbulb", "light-bulb": "lightbulb",
  email: "mail", warning: "alert", error: "cancel-circle", success: "checkmark-circle", ok: "checkmark-circle", done: "checkmark-circle", x: "cancel",
  close: "cancel", time: "clock", deadline: "alarm-clock", cash: "money", price: "tag", growth: "chart-increase", decline: "chart-decrease",
  ai: "ai-brain", ml: "neural-network", "machine-learning": "neural-network", web: "globe", website: "browser", app: "smartphone", mobile: "smartphone",
  team: "user-group", people: "users", person: "user", mind: "brain", think: "brain", science: "atom", lab: "test-tube", experiment: "flask-round",
  biology: "dna", virus: "bacteria", germ: "bacteria", energy: "flash", lightning: "flash", electricity: "flash", power: "flash",
  speed: "dashboard-speed", fast: "rocket", security: "shield", secure: "lock", password: "key", stack: "layers", sort: "sorting",
  graph: "hierarchy", question: "help-circle", help: "help-circle", 
  win: "trophy", goal: "target", plan: "strategy", exam: "quiz", test: "quiz", homework: "notebook", study: "book-open",
  math: "calculator", formula: "function-square", equation: "function-square", sum: "sigma", wow: "shocked", surprised: "surprise",
  cool: "star-face", love: "heart", celebrate: "party", celebration: "party", magic: "magic-wand", sleepy: "sleeping", cry: "crying",
  scared: "ghost", dead: "skull", loop: "repeat", cycle: "refresh", swap: "shuffle", hide: "eye-off", world: "globe", planet: "earth",
  water: "droplet", hot: "fire", cold: "snowflake", weather: "cloud", document: "file",
  heap: "hierarchy", linked: "link", pointer: "arrow-right",
};

/** Compact prompt guide: a few names per category (any curated name or plain noun also works). */
export const ICON_GUIDE = Object.entries(ICON_CATEGORIES).map(([k, v]) => `${k}: ${v.split(" ").slice(0, 6).join(", ")}`).join("; ");
