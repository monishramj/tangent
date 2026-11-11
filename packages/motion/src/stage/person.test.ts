import { describe, expect, it } from "vitest";
import { blendPose, jointsAt, personParts, poseJoints, POSE_JOINTS, tangenterJoints } from "./person";
import { POSES } from "../dsl/schema";

describe("person", () => {
  it("defines every DSL pose", () => { for (const p of POSES) expect(POSE_JOINTS[p]).toBeDefined(); });
  it("unknown pose falls back to stand", () => expect(poseJoints("nope")).toBe(POSE_JOINTS.stand));
  it("blends endpoints and midpoint", () => {
    const a = POSE_JOINTS.stand, b = POSE_JOINTS.celebrate;
    expect(blendPose(a, b, 0)).toEqual(a);
    expect(blendPose(a, b, 1)).toEqual(b);
    expect(blendPose(a, b, .5)[2]).toBeCloseTo((a[2] + b[2]) / 2);
  });
  it("jointsAt at p=1 reaches the target (no animation for static poses at age 0)", () => {
    const j = jointsAt("point", "stand", 1, 0);
    POSE_JOINTS.point.forEach((v, i) => expect(j[i]).toBeCloseTo(v));
  });
  it("walk swings legs over time", () => {
    expect(jointsAt("walk", "walk", 1, .1)[6]).not.toBeCloseTo(jointsAt("walk", "walk", 1, .5)[6]);
  });
  it("presenter blends toward its target, walks in, then breathes deterministically", () => {
    const from = tangenterJoints("point", "stand", 0, 1, [1, -1]);
    const to = tangenterJoints("point", "stand", 1, 1, [1, -1]);
    const mid = tangenterJoints("point", "stand", .5, 1, [1, -1]);
    expect(from).toEqual(jointsAt("stand", "stand", 1, 1));
    expect(to[2]).toBeCloseTo(135);
    expect(mid[2]).toBeGreaterThan(from[2]); expect(mid[2]).toBeLessThan(to[2]);
    expect(tangenterJoints("point", "stand", 1, 0, [1, -1])).toEqual(jointsAt("walk", "walk", 1, 0));
    expect(tangenterJoints("stand", "stand", 1, .1)[6]).not.toBeCloseTo(tangenterJoints("stand", "stand", 1, .3)[6]);
    expect(tangenterJoints("stand", "stand", 1, 2)[0]).not.toBeCloseTo(tangenterJoints("stand", "stand", 1, 3)[0]);
    expect(tangenterJoints("point", "stand", .5, 1, [1, -1])).toEqual(mid);
  });
  it("figure spans about H and mirrors when facing left", () => {
    const H = 100, r = personParts(POSE_JOINTS.stand, H, "right"), l = personParts(POSE_JOINTS.stand, H, "left");
    const ys = r.parts.flat().map(p => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(H * .9); // head ring is in parts, so this is the full height
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(H * 1.06);
    expect(r.body.length).toBeGreaterThan(12); // the filled bean body
    expect(l.parts[2][2][0]).toBeCloseTo(-r.parts[2][2][0]);
    expect(r.parts).toHaveLength(6);
  });
});
it("gesture winds up, overshoots a little and lands exactly", async () => {
  const { gesture } = await import("./person");
  expect(gesture(0)).toBe(0); expect(gesture(1)).toBeCloseTo(1);
  expect(gesture(.08)).toBeLessThan(0); expect(gesture(.08)).toBeGreaterThan(-.1);
  const peak = Math.max(...Array.from({ length: 50 }, (_, i) => gesture(i / 49)));
  expect(peak).toBeGreaterThan(1.02); expect(peak).toBeLessThan(1.09);
});
it("wave waves twice from when the pose began, then rests", async () => {
  const { jointsAt, POSE_JOINTS } = await import("./person");
  const arm = (since: number) => jointsAt("wave", "wave", 1, since, since)[3];
  expect(arm(.2)).not.toBeCloseTo(POSE_JOINTS.wave[3]);
  expect(arm(2)).toBeCloseTo(POSE_JOINTS.wave[3]); expect(arm(5)).toBeCloseTo(POSE_JOINTS.wave[3]);
  expect(jointsAt("wave", "stand", 1, 30, .2)[3]).not.toBeCloseTo(POSE_JOINTS.wave[3]); // a late wave pose still waves
});
