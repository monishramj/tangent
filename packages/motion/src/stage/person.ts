// Stick figure: poses are joint angles (degrees, 0 = hanging down, + swings toward the facing side, 180 = straight up).
// Pure geometry: blendPose interpolates, personParts turns joints into polylines (px, figure centred on 0,0).
import { clamp01, type Point } from "./motion";

//            lean tilt  arm1 up,fore  arm2 up,fore  leg1 thigh,shin  leg2 thigh,shin
export type Joints = [number, number, number, number, number, number, number, number, number, number];
const J = (lean: number, tilt: number, a1: [number, number], a2: [number, number], l1: [number, number] = [11, -4], l2: [number, number] = [-11, 4]): Joints =>
  [lean, tilt, ...a1, ...a2, ...l1, ...l2];
export const POSE_JOINTS: Record<string, Joints> = {
  stand: J(0, 0, [10, 6], [-10, -6]),
  point: J(3, 0, [82, 4], [-10, -8]),
  think: J(2, 8, [40, 120], [-10, -8]),
  shrug: J(0, 6, [35, 90], [-35, -90]),
  celebrate: J(-3, 0, [135, 10], [-135, -10], [12, -4], [-12, 4]),
  wave: J(0, 0, [150, 20], [-10, -6]),
  confused: J(-2, -10, [60, 110], [-14, -10]),
  walk: J(2, 0, [10, 6], [-10, -6]),
  explain: J(2, 0, [60, -20], [-50, 30]),
};
export const poseJoints = (name: string | undefined): Joints => POSE_JOINTS[name ?? ""] ?? POSE_JOINTS.stand;

/** k may leave 0..1: a gesture winds up slightly the other way, then overshoots and settles. */
export function blendPose(from: Joints, to: Joints, k: number): Joints {
  return from.map((v, i) => v + (to[i] - v) * k) as Joints;
}

/** Looping motion added on top of a pose (weight w fades it in/out while blending). */
export function animate(j: Joints, pose: string, age: number, w: number): Joints {
  const out = [...j] as Joints;
  out[0] += Math.sin(age * 2) * 1 * w; // breathing
  if (pose === "wave") out[3] += Math.sin(age * 7) * 24 * w;
  if (pose === "walk") {
    const s = Math.sin(age * 5);
    out[6] += s * 30 * w; out[7] += (Math.max(0, -s) * -35) * w; out[8] -= s * 30 * w; out[9] += (Math.max(0, s) * -35) * w;
    out[2] -= s * 25 * w; out[4] += s * 25 * w;
  }
  return out;
}

/** The gesture curve for pose changes (linear progress in): 15% anticipation the other way (8% of the travel),
 * then out with a 6% overshoot that settles. Exact at 0 and 1. */
export function gesture(p: number) {
  p = clamp01(p);
  if (p <= 0) return 0;
  if (p < .15) return -.08 * Math.sin(Math.PI * p / .15);
  const u = (p - .15) / .85, s = 1.3;
  return 1 + (s + 1) * (u - 1) ** 3 + s * (u - 1) ** 2;
}
/** Joints for a (possibly mid-blend) pose state at time `age`. p is the blend (may overshoot 0..1 slightly). */
export function jointsAt(pose: string | undefined, from: string | undefined, p: number, age: number): Joints {
  const k = clamp01(p);
  return blendPose(animate(poseJoints(from), from ?? "stand", age, 1 - k), animate(poseJoints(pose), pose ?? "stand", age, k), p);
}

/** Presenter motion uses the same walk, breathing and pose blend as the full-size stickman. */
export function tangenterJoints(pose: string | undefined, from: string | undefined, p: number, age: number, aim?: Point): Joints {
  let joints = jointsAt(pose, from, p, age);
  if (aim) {
    const k = clamp01(p);
    const pointing = (name: string | undefined) => name === "point" || name === "explain";
    const weight = (pointing(pose) ? k : 0) + (pointing(from) ? 1 - k : 0);
    const angle = Math.atan2(aim[0], aim[1]) / (Math.PI / 180);
    joints[2] += (angle - joints[2]) * weight; joints[3] *= 1 - weight;
  }
  if (age < WALK_IN) joints = blendPose(jointsAt("walk", "walk", 1, age * 2.4), joints, clamp01((age - WALK_IN * .7) / (WALK_IN * .3))); // two steps, then settle into the pose
  return joints;
}

export const WALK_IN = .6; // seconds the presenter takes to walk in from the edge
export const PERSON_PARTS = 6; // head, torso, arm1, arm2, leg1, leg2 (draw order)
const rad = Math.PI / 180;

/** Polylines for each part, figure height H, centred at (0,0). Head is a ring of points. */
export function personParts(j: Joints, H: number, facing: "left" | "right" = "right"): { parts: Point[][]; head: Point; headR: number; bob: number; body: Point[] } {
  const dir = facing === "left" ? -1 : 1, r = H * .095;
  const hip: Point = [0, H * .08], lean = j[0] * rad;
  const neck: Point = [hip[0] + Math.sin(lean) * H * .42, hip[1] - Math.cos(lean) * H * .42];
  const shoulder: Point = [hip[0] + Math.sin(lean) * H * .33, hip[1] - Math.cos(lean) * H * .33];
  const limb = (from: Point, a: number, b: number, l1: number, l2: number): Point[] => {
    const e: Point = [from[0] + Math.sin(a * rad) * l1, from[1] + Math.cos(a * rad) * l1];
    return [from, e, [e[0] + Math.sin((a + b) * rad) * l2, e[1] + Math.cos((a + b) * rad) * l2]];
  };
  const tilt = (j[0] + j[1]) * rad;
  const head: Point = [neck[0] + Math.sin(tilt) * (r + H * .01), neck[1] - Math.cos(tilt) * (r + H * .01)];
  const ring: Point[] = Array.from({ length: 25 }, (_, i) => [head[0] + Math.cos(i / 24 * Math.PI * 2) * r, head[1] + Math.sin(i / 24 * Math.PI * 2) * r]);
  const parts = [ring, [hip, neck], limb(shoulder, j[2], j[3], H * .17, H * .15), limb(shoulder, j[4], j[5], H * .17, H * .15),
    limb(hip, j[6], j[7], H * .21, H * .21), limb(hip, j[8], j[9], H * .21, H * .21)]
    .map(p => p.map(([x, y]) => [x * dir, y] as Point));
  // Body: a bean (tapered capsule) from hip to shoulders, wider at the shoulders.
  const ux = Math.sin(lean), uy = -Math.cos(lean), rs = H * .088, rh = H * .066, ch: Point = [hip[0] + ux * H * .04, hip[1] + uy * H * .04];
  const cap = (c: Point, rr: number, a0: number): Point[] => Array.from({ length: 13 }, (_, i) => { const a = a0 + i / 12 * Math.PI; return [c[0] + rr * (Math.cos(a) * -uy + Math.sin(a) * ux), c[1] + rr * (Math.cos(a) * ux + Math.sin(a) * uy)] as Point; });
  const body = [...cap(shoulder, rs, 0), ...cap(ch, rh, Math.PI)].map(([x, y]) => [x * dir, y] as Point);
  return { parts, head: [head[0] * dir, head[1]], headR: r, bob: 0, body };
}
