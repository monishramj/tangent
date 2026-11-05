// Dev showcase samples: the shared per-template fixtures (one say for every beat).
import { SAMPLE_SAY, TEMPLATE_SAMPLES } from "@motion/dsl/fixtures/samples";
export const SAMPLES = Object.fromEntries(Object.entries(TEMPLATE_SAMPLES).map(([k, data]) => [k, { say: SAMPLE_SAY, data }])) as Record<string, { say: string; data: unknown }>;
