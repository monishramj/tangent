import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import RichText, { splitMath } from "./RichText";

afterEach(cleanup);

it("splits inline and display math; dollars in prose stay text", () => {
  expect(splitMath("so $x^2$ grows")).toEqual([{ kind: "text", text: "so " }, { kind: "math", tex: "x^2", display: false }, { kind: "text", text: " grows" }]);
  expect(splitMath("$$\\sum_i i$$")).toEqual([{ kind: "math", tex: "\\sum_i i", display: true }]);
  expect(splitMath("costs $5 and $10 total")).toEqual([{ kind: "text", text: "costs $5 and $10 total" }]);
  expect(splitMath("a \\$ sign")).toEqual([{ kind: "text", text: "a $ sign" }]);
  expect(splitMath("open $ never closed")).toEqual([{ kind: "text", text: "open $ never closed" }]);
});

it("renders $x^2$ with KaTeX", () => {
  const { container } = render(<RichText text="It is $x^2$ here" />);
  expect(container.querySelector("[data-math] .katex")).toBeTruthy();
  expect(container.textContent).toContain("It is ");
});

it("never turns message text into HTML: <script> and tags render as text", () => {
  const { container } = render(<RichText text={"<script>alert(1)</script> <img src=x onerror=alert(1)> and $x$"} />);
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("<script>alert(1)</script>");
});

it("math can't smuggle links or ids either (trust off)", () => {
  const { container } = render(<RichText text={"$\\href{javascript:alert(1)}{x}$ $\\htmlId{a}{b}$"} />);
  expect(container.querySelector("a")).toBeNull();
  expect(container.querySelector("#a")).toBeNull();
});

it("keeps line breaks", () => {
  const { container } = render(<RichText text={"one\ntwo"} />);
  expect(container.firstElementChild!.className).toContain("whitespace-pre-line");
  expect(container.textContent).toBe("one\ntwo");
});
