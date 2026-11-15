import { useCallback, useEffect, useRef, useState } from "react";
import { checkRows, requiredOk, runLaunchChecks, type LaunchChecks } from "./checks";

export default function FirstLaunch({ check = runLaunchChecks, onContinue, heading = "h1" }: {
  check?: () => Promise<LaunchChecks>; onContinue: () => void; heading?: "h1" | "h2";
}) {
  const checkRef = useRef(check);
  checkRef.current = check;
  const [result, setResult] = useState<LaunchChecks | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const run = useCallback(async () => {
    setBusy(true); setError("");
    try { setResult(await checkRef.current()); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't run the checks."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void run(); }, [run]);
  const rows = result ? checkRows(result) : [];
  const ready = !!result && requiredOk(result);
  const Title = heading;
  return (
    <main className={heading === "h1" ? "fixed inset-0 overflow-auto bg-bg" : "min-w-0"}>
      <div className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
        <div>
          <Title className="text-3xl font-medium tracking-tight">Before you start</Title>
          <p className="mt-2 text-sm text-muted">Tangent writes the video with Claude Code on this computer. These checks don't send a prompt.</p>
        </div>
        <ul aria-label="Setup checks" className="flex flex-col gap-3">
          {busy && !result && <li className="text-sm text-subtle">Checking…</li>}
          {rows.map(row => (
            <li key={row.id} data-status={row.ok ? "ok" : "fail"} className="rounded-xl border border-line px-4 py-3">
              <p className="flex items-center gap-2 font-medium" style={{ color: row.ok ? "#3dd68c" : "#ff6b6b" }}>
                <span aria-hidden className="size-2.5 rounded-full" style={{ background: row.ok ? "#3dd68c" : "#ff6b6b" }} />
                {row.title}
                <span className="sr-only">{row.ok ? "Ready" : "Needs attention"}</span>
              </p>
              <p className="mt-1 text-sm text-muted">{row.detail}</p>
              {!row.ok && row.fix && <p className="mt-2 text-sm text-fg">{row.fix}</p>}
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="text-sm text-muted">{error}</p>}
        <div className="flex gap-3">
          <button type="button" className="h-11 rounded-lg border border-line px-4 disabled:opacity-40" disabled={busy} onClick={() => void run()}>Re-check</button>
          <button type="button" className="h-11 rounded-lg bg-fg px-4 font-medium text-bg disabled:opacity-40" disabled={!ready || busy} onClick={onContinue}>Continue</button>
        </div>
      </div>
    </main>
  );
}
