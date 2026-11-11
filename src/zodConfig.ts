// Imported first in main.tsx. Zod 4 probes `new Function` for a faster parser; the CSP has no 'unsafe-eval', so skip the probe.
import { z } from "zod";
z.config({ jitless: true });
