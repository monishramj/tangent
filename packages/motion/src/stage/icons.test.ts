import { describe, expect, it } from "vitest";
import * as all from "@hugeicons/core-free-icons";
import { applyEventsAt } from "./scene";
import { Scene } from "../dsl/schema";
import { compile } from "../dsl/compile";
import { ctx, visualAt } from "../dsl/tplkit";
import { FALLBACK, ICON_GUIDE, ICON_NAMES, SYNONYMS, iconSvg, resolveIcon } from "./icons";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const exact = new Set(Object.keys(all).filter(k => k.endsWith("Icon")).map(k => norm(k.slice(0, -4))));
const isExact = (n: string) => exact.has(norm(n)) || exact.has(norm(n) + "01");


const AUDIT_NOUNS = `
algorithm array pointer recursion cache latency bandwidth thread lock deadlock compiler bug test money
time speed idea warning success fail student teacher probability dice coin sample graph matrix
triangle pixel camera light heap stack queue tree linked-list node edge vertex root leaf
branch traversal search searching searches sort sorting swaps swap insert inserting delete deletion update
lookup hash hash-table collision bucket key value index loop iteration cycle function variable constant
parameter argument return call callback closure scope module package import export class object interface
inheritance polymorphism abstraction encapsulation constructor method field property reference address allocation garbage-collection memory ram
disk storage database server client network internet router packet protocol socket port connection request
response api http encryption security password authentication permission firewall shield hacker virus process program
instruction register cpu gpu processor core chip microchip hardware software firmware binary bit byte
word integer float boolean string character buffer overflow underflow exception error debug debugging breakpoint
terminal code source-code assembly opcode operand arithmetic logic gate circuit transistor voltage current power
energy signal clock pipeline datapath multiplexer alu bus keyboard mouse monitor screen display printer
scanner microphone speaker headphones battery plug usb bluetooth wifi cloud laptop computer smartphone tablet
robot automation neural-network machine-learning ai brain dataset data table row column grid filter query
join group count sum average mean median mode variance deviation distribution normal gaussian binomial
poisson uniform random randomness experiment trial outcome event population statistic statistics math mathematics calculus
integral derivative gradient slope tangent vector scalar tensor determinant inverse transpose multiplication division addition
subtraction equation formula fraction ratio percent percentage factor product difference square cube circle rectangle
polygon angle geometry coordinate axis origin point line plane space dimension distance length width
height area volume radius diameter circumference rotation translation scaling transform projection perspective orthographic ray
raster texture shader rendering animation frame image photo photograph video film color colour red
green blue contrast brightness shadow reflection refraction lens aperture focus depth sphere cylinder cone
pyramid torus mesh interpolation sampling aliasing antialiasing frequency wave noise entropy information compression encoding
decoding quantization accuracy precision recall confidence hypothesis significance correlation regression prediction estimate estimator likelihood
density cumulative quantile percentile quartile histogram scatterplot bar-chart pie-chart trend growth decline increase decrease
comparison balance weight scale ruler compass calculator infinity pi sigma school university college classroom
lecture lesson book notebook pencil pen eraser paper document file folder library homework exam
quiz graduation diploma certificate trophy medal award goal target plan strategy checklist task work
job office company business bank wallet cash currency dollar cost price profit revenue expense
budget invoice receipt shopping-cart gift calendar timer stopwatch hourglass deadline duration second minute hour
day week month year alarm fast slow turtle rabbit rocket race running walking person
people user users team teamwork friend family child baby man woman doctor scientist engineer
developer programmer artist designer writer reader author manager customer happy sad angry confused surprise
surprised shocked smile laugh crying sleepy tired love heart celebration party applause win lose
failure danger caution alert info question help answer solution problem puzzle thought thinking mind
knowledge learning education science atom molecule dna biology chemistry physics microscope telescope magnet planet
earth world globe sun moon star galaxy universe fire water droplet ice snow snowflake
rain wind weather mountain ocean river forest plant flower seed apple fruit food coffee
pizza house home building city road car bicycle train airplane ship truck map location
journey path direction arrow link chain anchor hammer wrench scissors tool toolbox settings gear
refresh repeat shuffle play pause stop check cancel close open save download upload share
copy edit zoom expansion collapse push pop peek enqueue dequeue bfs dfs heapify quicksort
mergesort binary-search sorting-network speedup bottleneck parallel concurrency synchronization semaphore mutex timeout retry availability reliability
recovery backup restore checkpoint transaction commit rollback dependency hierarchy workflow structure resource capacity throughput
cache-hit cache-miss hit miss branch-prediction
`.trim().split(/\s+/);

describe("resolveIcon", () => {
  it("curates ~400 names, each an exact Hugeicons match (directly or through a synonym)", () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(350);
    expect(ICON_NAMES.filter(n => !isExact(SYNONYMS[n] ?? n))).toEqual([]);
  });
  it("maps synonyms to exact icons", () => {
    expect(Object.entries(SYNONYMS).filter(([, v]) => !isExact(v))).toEqual([]);
    expect(resolveIcon("RAM")).toBe(resolveIcon("ram-memory"));
    expect(resolveIcon("server rack")).toBe(resolveIcon("server-stack"));
    expect(resolveIcon("db")).toBe(resolveIcon("database"));
    expect(resolveIcon("idea")).toBe(resolveIcon("lightbulb"));
  });
  it("normalizes loose names", () => {
    expect(resolveIcon("Laptop")).toBe(resolveIcon("laptop"));
    expect(resolveIcon("laptop-01")).toBe(resolveIcon("LAPTOP_01"));
  });
  it("resolves every course/everyday audit noun without fallback", () => {
    expect(AUDIT_NOUNS.length).toBe(635);
    expect(AUDIT_NOUNS.filter(n => resolveIcon(n) === FALLBACK)).toEqual([]);
  });
  it.each([
    ["algorithm", "AlgorithmIcon"], ["array", "GridIcon"], ["pointer", "ArrowRightIcon"],
    ["heap", "HierarchyIcon"], ["node", "HierarchyIcon"], ["recursion", "RepeatIcon"],
    ["cache", "MemoryStickIcon"], ["latency", "ClockIcon"], ["bandwidth", "NetworkIcon"],
    ["thread", "WorkflowIcon"], ["deadlock", "LockIcon"], ["compiler", "CodeIcon"],
    ["constructor", "CodeIcon"], ["insert", "PlusSignIcon"], ["fail", "CancelCircleIcon"],
    ["probability", "DiceIcon"], ["coin", "CoinsIcon"], ["sample", "ChartScatterIcon"],
    ["matrix", "MatrixIcon"], ["triangle", "TriangleIcon"], ["pixel", "GridIcon"],
    ["camera", "CameraIcon"], ["light", "LightbulbIcon"], ["swaps", "ShuffleIcon"],
    ["searching", "SearchIcon"], ["searches", "SearchIcon"], ["trees", "TreeIcon"],
    ["arrays", "GridIcon"], ["inserting", "PlusSignIcon"], ["tech-concept", "LaptopIcon"],
  ])("maps %s to %s", (noun, key) => {
    expect(resolveIcon(noun)).toBe((all as Record<string, unknown>)[key]);
  });
  it("never throws and falls back", () => {
    for (const n of ["", "   ", "zzzzqqq", "💥", "__proto__", "heapless", "coinvented", undefined as unknown as string]) expect(resolveIcon(n)).toBe(FALLBACK);
    expect(FALLBACK.length).toBeGreaterThan(0);
  });
  it("has a compact guide of ~60 names", () => {
    const names = ICON_GUIDE.split(/[;:,]\s*/).filter(s => !/^[a-z]+$/.test(s) || ICON_NAMES.includes(s));
    expect(names.length).toBeGreaterThan(50);
    expect(ICON_GUIDE.length).toBeLessThan(900);
  });
});
describe("iconSvg", () => {
  it("emits kebab-case attributes with the color and no key", () => {
    const svg = iconSvg(resolveIcon("laptop"), "#ffffff");
    expect(svg).toContain('stroke-width="1.5"');
    expect(svg).toContain('stroke="#ffffff"');
    expect(svg).not.toContain("key=");
    expect(svg).not.toContain("currentColor");
  });
});


describe("visual entrances", () => {
  const c = ctx(0, "hello", new Set());
  visualAt(c, "icon", { icon: "cpu" }, .3, .5, .15, "@0");
  visualAt(c, "emoji", { emoji: "🤯" }, .7, .5, .15, "@0");
  const scene = Scene.parse({ scene: "entrances", objects: c.objects, beats: [{ say: "hello", actions: c.actions }] });
  const tl = compile(scene, [{ words: [{ word: "hello", start: 0, end: 1 }], duration: 2 }]);
  const state = (t: number, id: string) => applyEventsAt(scene, tl, t).objects.get(id)!;
  it("icons draw on, emoji land with a soft settle; no tilt or squash, no residual motion, seek-stable", () => {
    expect(c.actions.map(a => (a as { style: string }).style)).toEqual(["draw", "pop"]);
    const mid = state(.2, "emoji");
    expect(mid.sx).toBeUndefined();
    expect(mid.rotation).toBe(0);
    expect(mid.scale).toBeGreaterThan(.82);
    expect(Math.max(...[.1, .15, .2, .25, .3].map(t => state(t, "emoji").scale))).toBeLessThan(1.07); // soft overshoot only
    expect(state(.2, "icon")).toMatchObject({ scale: 1, rotation: 0 });
    expect(state(.2, "icon").reveal).toBeLessThan(1);
    for (const id of ["icon", "emoji"]) {
      expect(state(1, id)).toMatchObject({ x: id === "icon" ? .3 : .7, y: .5, scale: 1, rotation: 0, opacity: 1 });
      expect(state(8, id)).toMatchObject({ y: .5, scale: 1, rotation: 0, opacity: 1 });
    }
    expect(state(.2, "emoji")).toEqual(mid);
  });
});
