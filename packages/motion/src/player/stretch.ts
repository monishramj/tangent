/**
 * WSOLA time-stretch: output is `rate`× shorter (longer below 1) at the same pitch. Speech-grade, not music-grade.
 * Output sample i corresponds to input sample ≈ i·rate (drift ≤ the ±10 ms search window), so the audio clock stays linear.
 */
export function stretch(x: Float32Array, rate: number, sampleRate: number): Float32Array<ArrayBuffer> {
  if (rate === 1) return Float32Array.from(x);
  const N = 2 * Math.round(sampleRate * 0.02); // 40 ms frames
  const hop = N / 2; // synthesis hop; Hann at 50% overlap sums to 1
  const tol = Math.round(sampleRate * 0.01);
  const outLen = Math.ceil(x.length / rate);
  const at = (i: number) => (i >= 0 && i < x.length ? x[i] : 0);
  const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const y = new Float32Array(outLen + N);
  const w = new Float32Array(outLen + N);
  let next = 0; // input position that would continue the previous frame seamlessly
  for (let k = 0, os = 0; os < outLen; k++, os += hop) {
    const nominal = Math.round(os * rate);
    let best = nominal;
    if (k > 0) {
      // Pick the frame start near `nominal` whose first half best matches the natural continuation.
      // ponytail: brute-force correlation (every 8th sample, 2-sample lag steps), ~0.1 s per minute of audio; FFT if it ever shows up in a profile.
      let bestC = -Infinity;
      for (let d = -tol; d <= tol; d += 2) {
        const p = nominal + d;
        if (p < 0) continue;
        let c = 0;
        for (let i = 0; i < hop; i += 8) c += at(p + i) * at(next + i);
        if (c > bestC) { bestC = c; best = p; }
      }
    }
    for (let i = 0; i < N; i++) { y[os + i] += at(best + i) * win[i]; w[os + i] += win[i]; }
    next = best + hop;
  }
  for (let i = 0; i < outLen; i++) if (w[i] > 1e-3) y[i] /= w[i];
  return y.subarray(0, outLen);
}
