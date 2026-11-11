// UI package: auto-follow / free scroll / Back to current, and overlay geometry (docs/textbook-follow.md).
import { describe, expect, it } from "vitest";
import { renderBucket, fitColumn, scrollTargetX, followReducer, initialFollow, overlayRect, scrollTarget, showBackButton } from "./follow";
import type { BBox } from "./types";

describe("followReducer", () => {
  it("starts following; a new beat with boxes asks for a scroll (seq bumps)", () => {
    const s0 = initialFollow;
    expect(s0.following).toBe(true);
    const s1 = followReducer(s0, { type: "beat", beat: 0, hasBoxes: true });
    expect(s1).toMatchObject({ following: true, beat: 0 });
    expect(s1.seq).toBe(s0.seq + 1);
    const s2 = followReducer(s1, { type: "beat", beat: 1, hasBoxes: true });
    expect(s2.seq).toBe(s1.seq + 1);
  });

  it("the same beat again is a no-op (same object, so no re-render or re-scroll)", () => {
    const s1 = followReducer(initialFollow, { type: "beat", beat: 4, hasBoxes: true });
    expect(followReducer(s1, { type: "beat", beat: 4, hasBoxes: true })).toBe(s1);
  });

  it("a beat with no boxes does not scroll (keeps the last highlight's place)", () => {
    const s1 = followReducer(initialFollow, { type: "beat", beat: 0, hasBoxes: true });
    const s2 = followReducer(s1, { type: "beat", beat: 1, hasBoxes: false });
    expect(s2).toMatchObject({ following: true, beat: 1, seq: s1.seq });
  });

  it("a user scroll stops following; later beats update the beat but never scroll", () => {
    const s1 = followReducer(initialFollow, { type: "beat", beat: 0, hasBoxes: true });
    const s2 = followReducer(s1, { type: "userScroll" });
    expect(s2.following).toBe(false);
    const s3 = followReducer(s2, { type: "beat", beat: 1, hasBoxes: true });
    expect(s3).toMatchObject({ following: false, beat: 1, seq: s2.seq });
    expect(followReducer(s3, { type: "userScroll" })).toBe(s3);
  });

  it("Back to current resumes following and scrolls now", () => {
    const off = followReducer(followReducer(initialFollow, { type: "beat", beat: 2, hasBoxes: true }), { type: "userScroll" });
    const on = followReducer(off, { type: "backToCurrent" });
    expect(on).toMatchObject({ following: true, beat: 2 });
    expect(on.seq).toBe(off.seq + 1);
  });

  it("shows Back to current only when not following and there is something to go back to", () => {
    expect(showBackButton(initialFollow, true)).toBe(false);
    const off = followReducer(initialFollow, { type: "userScroll" });
    expect(showBackButton(off, true)).toBe(true);
    expect(showBackButton(off, false)).toBe(false); // old bundle / beat without passages: nothing to return to
  });
});

describe("overlayRect", () => {
  const bbox: BBox = [0.1, 0.25, 0.6, 0.3];
  it("maps page fractions to pixels of the rendered page, padded and clamped to the page", () => {
    expect(overlayRect(bbox, { width: 600, height: 800 }, 0)).toEqual({ left: 60, top: 200, width: 300, height: 40 });
    expect(overlayRect(bbox, { width: 600, height: 800 }, 4)).toEqual({ left: 56, top: 196, width: 308, height: 48 });
    expect(overlayRect([0, 0, 1, 1], { width: 600, height: 800 }, 4)).toEqual({ left: 0, top: 0, width: 600, height: 800 });
  });

  it("scales with the rendered page size (zoom / panel resize)", () => {
    const a = overlayRect(bbox, { width: 300, height: 400 }, 0), b = overlayRect(bbox, { width: 900, height: 1200 }, 0);
    expect(b.left / a.left).toBeCloseTo(3);
    expect(b.top / a.top).toBeCloseTo(3);
    expect(b.width / a.width).toBeCloseTo(3);
    expect(b.height / a.height).toBeCloseTo(3);
  });
});

describe("scrollTarget", () => {
  it("puts the highlight's top a third of the way down the viewport, never above 0", () => {
    // Page starts 1000 px into the scroller, rendered 800 px tall; highlight top at 0.5 → 1400 px.
    expect(scrollTarget(1000, 800, [0, 0.5, 1, 0.6], 600)).toBe(1400 - 200);
    expect(scrollTarget(0, 800, [0, 0.05, 1, 0.1], 600)).toBe(0);
  });
});


describe("fitColumn", () => {
  it("fits a single text column and ignores narrow formula boxes", () => {
    const boxes: BBox[] = Array.from({ length: 20 }, () => [0.2, 0.1, 0.8, 0.2]);
    expect(fitColumn([...boxes, [0, 0, 0.1, 1]])).toMatchObject({ x0: 0.2 });
    expect(fitColumn([...boxes, [0, 0, 0.1, 1]]).zoom).toBeCloseTo(0.94 / 0.6);
  });
  it("fits one column of a two-column book, rather than their union", () => {
    expect(fitColumn([[0.08, 0, 0.48, 1], [0.52, 0, 0.92, 1]]).zoom).toBeCloseTo(2.35);
  });
  it("ignores outlier margins and clamps zoom", () => {
    const boxes: BBox[] = Array.from({ length: 20 }, () => [0.2, 0.1, 0.8, 0.2]);
    expect(fitColumn([...boxes, [0, 0, 1, 1]]).zoom).toBeCloseTo(0.94 / 0.6);
    expect(fitColumn([[0, 0, 1, 1]]).zoom).toBe(1);
    expect(fitColumn([[0.1, 0, 0.3, 1]]).zoom).toBe(3);
  });
  it("defaults to full page without usable boxes", () => {
    expect(fitColumn([])).toEqual({ zoom: 1, x0: 0 });
    expect(fitColumn([[NaN, 0, 0.8, 1], [0, 0, 0.1, 1]])).toEqual({ zoom: 1, x0: 0 });
  });
});

describe("scrollTargetX", () => {
  it("centers each column and clamps at the left page edge", () => {
    expect(scrollTargetX(12, 1000, [0.1, 0, 0.45, 1], 400)).toBe(87);
    expect(scrollTargetX(12, 1000, [0.55, 0, 0.9, 1], 400)).toBeCloseTo(537);
    expect(scrollTargetX(12, 400, [0, 0, 1, 1], 400)).toBe(0);
  });
  it("keeps the left edge visible when the box is wider than the viewport", () => {
    expect(scrollTargetX(12, 1000, [0.2, 0, 0.9, 1], 400)).toBe(200);
  });
});

it("render buckets upgrade in capped 400px steps and retain sharper loaded images", () => {
  expect(renderBucket(401, 2)).toBe(1200);
  expect(renderBucket(200, 2, 1600)).toBe(1600);
  expect(renderBucket(801, 2, 1600)).toBe(2000);
  expect(renderBucket(3000, 2, 3200)).toBe(4000);
});
