/** Shared read of the OS reduced-motion preference for JS-driven motion (CSS has its own media query). */
export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
