import { describe, expect, it } from "vitest";
import { blendPose, jointsAt, personParts, poseJoints, POSE_JOINTS } from "./person";
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
  it("figure spans about H and mirrors when facing left", () => {
    const H = 100, r = personParts(POSE_JOINTS.stand, H, "right"), l = personParts(POSE_JOINTS.stand, H, "left");
    const ys = r.parts.flat().map(p => p[1]);
    expect(Math.max(...ys) - Math.min(...ys) + r.headR).toBeGreaterThan(H * .85);
    expect(Math.max(...ys) - Math.min(...ys) + r.headR).toBeLessThan(H * 1.1);
    expect(l.parts[2][2][0]).toBeCloseTo(-r.parts[2][2][0]);
    expect(r.parts).toHaveLength(6);
  });
});
