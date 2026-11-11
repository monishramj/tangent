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
  const raw = String(name ?? "").trim().replace(/Icon$/i, "").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase().replace(/[\s_]+/g, "-");
  const t = table();
  const hit = (word: string): IconDef | undefined => {
    const alias = Object.prototype.hasOwnProperty.call(SYNONYMS, word) ? SYNONYMS[word] : undefined;
    const n = norm(alias ?? word);
    return t.find(([key]) => key === n)?.[1] ?? t.find(([key]) => key === n + "01")?.[1];
  };
  // Inflect only whole words; substring matching turned "insert" into InsertPi and "fail" into StructureFail.
  const forms = (word: string) => [word, word.replace(/ies$/, "y"), word.replace(/s$/, ""), word.replace(/es$/, ""), word.replace(/ing$/, ""), word.replace(/ing$/, "e"), word.replace(/ed$/, ""), word.replace(/ed$/, "e")];
  const direct = hit(raw);
  if (direct) return direct;
  for (const word of forms(raw).slice(1)) {
    if (word === raw || (!Object.prototype.hasOwnProperty.call(SYNONYMS, word) && !ICON_NAMES.includes(word))) continue;
    const icon = hit(word);
    if (icon) return icon;
  }
  // Unknown compounds can still use a meaningful curated word/category, never an arbitrary library substring.
  for (const word of raw.split("-")) {
    if (Object.prototype.hasOwnProperty.call(SYNONYMS, word) || ICON_NAMES.includes(word)) {
      const icon = hit(word);
      if (icon) return icon;
    }
  }
  return FALLBACK;
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
  graph: "hierarchy", question: "help-square", help: "help-square",
  win: "trophy", goal: "target", plan: "strategy", exam: "quiz", test: "quiz", homework: "notebook", study: "book-open",
  math: "calculator", formula: "function-square", equation: "function-square", sum: "sigma", wow: "shocked", surprised: "surprise",
  cool: "star-face", love: "heart", celebrate: "party", celebration: "party", magic: "magic-wand", sleepy: "sleeping", cry: "crying",
  scared: "ghost", dead: "skull", loop: "repeat", cycle: "refresh", swap: "shuffle", hide: "eye-off", world: "globe", planet: "earth",
  water: "droplet", hot: "fire", cold: "snowflake", weather: "cloud", document: "file",
  heap: "hierarchy", linked: "link", pointer: "arrow-right",
  // Course vocabulary: use recognizable category silhouettes where no literal icon exists.
  "array": "grid", "pixel": "grid", "raster": "grid", "rasterization": "grid", "quantization": "grid",
  "quantile": "chart-histogram", "quartile": "chart-histogram", "sampling": "grid", "aliasing": "grid", "antialiasing": "grid",
  "recursion": "repeat", "iteration": "repeat", "recursive": "repeat", "retry": "repeat", "cache": "memory-stick",
  "buffer": "memory-stick", "cache-hit": "memory-stick", "cache-miss": "memory-stick", "latency": "clock", "timeout": "clock",
  "duration": "clock", "second": "clock", "minute": "clock", "hour": "clock", "day": "clock",
  "week": "clock", "month": "clock", "year": "clock", "bandwidth": "network", "throughput": "network",
  "protocol": "network", "socket": "network", "port": "network", "connection": "network", "packet": "network",
  "http": "network", "concurrency": "network", "parallel": "network", "dependency": "link", "deadlock": "lock",
  "mutex": "lock", "semaphore": "lock", "synchronization": "lock", "authentication": "lock", "permission": "lock",
  "encapsulation": "lock", "compiler": "code", "program": "code", "software": "code", "firmware": "code",
  "assembly": "code", "opcode": "code", "operand": "code", "callback": "code", "closure": "code",
  "scope": "code", "module": "code", "import": "code", "export": "code", "class": "code",
  "object": "code", "interface": "code", "inheritance": "code", "polymorphism": "code", "abstraction": "code",
  "constructor": "code", "method": "code", "field": "code", "property": "code", "source-code": "code",
  "debugging": "bug", "debug": "bug", "process": "cpu", "core": "cpu", "instruction": "cpu",
  "datapath": "cpu", "alu": "cpu", "multiplexer": "cpu", "gate": "cpu", "circuit": "cpu",
  "transistor": "cpu", "register": "cpu", "branch-prediction": "cpu", "fail": "cancel-circle", "failure": "cancel-circle",
  "lose": "cancel-circle", "miss": "cancel-circle", "underflow": "cancel-circle", "overflow": "cancel-circle", "exception": "cancel-circle",
  "probability": "dice", "random": "dice", "randomness": "dice", "trial": "dice", "outcome": "dice",
  "likelihood": "dice", "coin": "coins", "currency": "coins", "revenue": "coins", "cost": "coins",
  "expense": "coins", "budget": "coins", "sample": "chart-scatter", "population": "chart-scatter", "dataset": "chart-scatter",
  "data": "chart-scatter", "point": "chart-scatter", "correlation": "chart-scatter", "regression": "chart-scatter", "prediction": "chart-scatter",
  "estimate": "chart-scatter", "estimator": "chart-scatter", "precision": "chart-scatter", "accuracy": "chart-scatter", "recall": "chart-scatter",
  "confidence": "chart-scatter", "hypothesis": "chart-scatter", "significance": "chart-scatter", "node": "hierarchy", "vertex": "hierarchy",
  "root": "hierarchy", "traversal": "hierarchy", "bfs": "hierarchy", "dfs": "hierarchy", "heapify": "hierarchy",
  "quicksort": "sorting", "mergesort": "sorting", "binary-search": "search", "sorting-network": "sorting", "linked-list": "link",
  "reference": "link", "chain": "link", "join": "link", "edge": "line", "path": "line",
  "ray": "line", "axis": "line", "tangent": "line", "slope": "line", "insert": "plus-sign",
  "insertion": "plus-sign", "inserting": "plus-sign", "addition": "plus-sign", "enqueue": "plus-sign", "push": "plus-sign",
  "add": "plus-sign", "deletion": "delete", "dequeue": "delete", "pop": "delete", "update": "refresh",
  "recovery": "refresh", "restore": "refresh", "rollback": "refresh", "rotation": "refresh", "lookup": "search",
  "peek": "search", "searching": "search", "collision": "alert", "danger": "alert", "caution": "alert",
  "bottleneck": "alert", "warnings": "alert", "hash-table": "table", "row": "table", "column": "table",
  "index": "table", "value": "tag", "constant": "tag", "parameter": "tag", "argument": "tag",
  "label": "tag", "return": "arrow-turn-backward", "pointer-device": "mouse", "address": "location", "coordinate": "location",
  "origin": "location", "allocation": "package", "resource": "package", "capacity": "package", "garbage-collection": "trash",
  "binary": "binary-code", "bit": "binary-code", "byte": "binary-code", "word": "binary-code", "boolean": "binary-code",
  "encoding": "binary-code", "decoding": "binary-code", "integer": "calculator", "float": "calculator", "arithmetic": "calculator",
  "logic": "calculator", "mathematics": "calculator", "calculus": "calculator", "scalar": "calculator", "factor": "calculator",
  "product": "calculator", "difference": "calculator", "fraction": "calculator", "ratio": "calculator", "string": "variable",
  "character": "variable", "tensor": "variable", "integral": "function-square", "derivative": "function-square", "gradient": "function-square",
  "variance": "chart-histogram", "deviation": "chart-histogram", "distribution": "chart-histogram", "normal": "chart-histogram", "gaussian": "chart-histogram",
  "binomial": "chart-histogram", "poisson": "chart-histogram", "uniform": "chart-histogram", "density": "chart-histogram", "cumulative": "chart-histogram",
  "frequency": "chart-histogram", "histogram": "chart-histogram", "average": "chart-line", "mean": "chart-line", "median": "chart-line",
  "mode": "chart-line", "statistic": "chart-line", "statistics": "chart-line", "entropy": "chart-line", "information": "chart-line",
  "trend": "chart-line", "interpolation": "chart-line", "division": "divide-sign", "multiplication": "multiplication-sign", "determinant": "matrix",
  "inverse": "matrix", "transpose": "matrix", "subtraction": "minus-sign", "percentage": "percent", "percentile": "percent",
  "rectangle": "square", "geometry": "square", "plane": "square", "area": "square",
  "space": "cube", "dimension": "cube", "volume": "cube", "depth": "cube",
  "mesh": "cube",
  "distance": "ruler", "length": "ruler", "width": "ruler", "height": "ruler", "radius": "ruler",
  "diameter": "ruler", "circumference": "ruler", "vector": "arrow-right", "direction": "arrow-right",
  "translation": "arrow-right", "scaling": "expand", "transform": "expand", "expansion": "expand", "projection": "camera",
  "perspective": "camera", "orthographic": "camera", "lens": "camera",
  "photograph": "camera", "photo": "camera", "texture": "image", "shader": "image", "rendering": "image",
  "color": "image", "colour": "image", "red": "image", "green": "image",
  "blue": "image", "contrast": "image", "brightness": "image", "shadow": "image", "reflection": "image",
  "refraction": "image", "animation": "play", "open": "play", "compression": "file-archive", "backup": "file-archive",
  "checkpoint": "file-archive", "hit": "checkmark-circle", "reliability": "checkmark-circle", "availability": "checkmark-circle", "transaction": "checkmark-circle",
  "commit": "checkmark-circle", "check": "checkmark-circle", "speedup": "arrow-up", "increase": "arrow-up", "decrease": "arrow-down",
  "comparison": "scale", "balance": "scale", "university": "school", "college": "school", "classroom": "school",
  "education": "school", "lecture": "book-open", "lesson": "book-open", "knowledge": "book-open", "learning": "book-open",
  "reader": "book-open", "graduation": "graduation-cap", "diploma": "graduation-cap", "paper": "file", "task": "briefcase",
  "work": "briefcase", "job": "briefcase", "business": "briefcase", "company": "building", "city": "building",
  "profit": "money", "alarm": "timer", "race": "rocket", "slow": "turtle", "friend": "user",
  "family": "user", "scientist": "user", "engineer": "user", "programmer": "user", "artist": "user",
  "designer": "user", "writer": "user", "author": "user", "running": "user", "walking": "user",
  "happy": "smile", "laugh": "smile", "feelings": "smile", "thought": "brain", "thinking": "brain",
  "molecule": "molecules", "ice": "snowflake", "ocean": "wave", "river": "wave", "forest": "tree",
  "seed": "plant", "fruit": "apple", "food": "apple", "journey": "map", "tool": "hammer",
  "toolbox": "hammer", "gear": "settings", "ui": "settings", "zoom": "zoom-in", "answer": "checkmark-circle",
  "solution": "lightbulb", "problem": "puzzle", "tech": "laptop", "cs": "laptop", "hardware": "laptop",
  "stats": "chart", "nature": "leaf",
  "light": "lightbulb",
  "branch": "git-branch",
  "client": "computer",
  "request": "send",
  "response": "inbox",
  "encryption": "encrypt",
  "hacker": "shield",
  "breakpoint": "pause",
  "voltage": "flash",
  "current": "flash",
  "screen": "monitor",
  "display": "monitor",
  "scanner": "scan",
  "microphone": "mic",
  "automation": "robot",
  "query": "search",
  "count": "calculator",
  "event": "calendar",
  "noise": "wave",
  "scatterplot": "chart-scatter",
  "customer": "user",
  "applause": "clapping",
  "universe": "galaxy",
  "arrow": "arrow-right",
  "thread": "workflow",
  "bus": "network",
  trees: "tree",
};

/** Compact prompt guide: a few names per category (any curated name or plain noun also works). */
export const ICON_GUIDE = Object.entries(ICON_CATEGORIES).map(([k, v]) => `${k}: ${v.split(" ").slice(0, 6).join(", ")}`).join("; ");
/** Emoji packs by mood/topic for the prompt (emoji render in colour; use sparingly as punctuation). */
export const EMOJI_PACKS: Record<string, string> = {
  hype: "🔥 🚀 ⚡ 💥 🎉 🏆", aha: "💡 🤯 ✨ 👀 🎯", confused: "🤔 ❓ 😵 😮", oops: "😬 😱 💀 🐛 ❌", good: "✅ 👍 🙌 😌 💯",
  speed: "⏱️ 🐢 🐇 🚀", cs: "💻 🧠 🌳 🔗 📦 🔁", hardware: "🖥️ ⌨️ 🖱️ 🔋 🔌 💾", stats: "🎲 🪙 📊 📈 🎯", math: "🧮 ➕ ➖ ✖️ ➗ ♾️",
  time: "⏰ ⏳ ⌛ 📅", warning: "⚠️ 🚨 🛑 🔒", fail: "❌ 👎 💔 🐛", reactions: "😂 😍 😴 😎 🤔 😱", science: "🧪 🔬 🧬 🌍", school: "📚 ✏️ 🎓 📝", money: "💰 📉 💸",
};
export const EMOJI_GUIDE = Object.entries(EMOJI_PACKS).map(([k, v]) => `${k} ${v}`).join("; ");
