import { useCallback, useEffect, useRef, useState } from "react";
import { getChoice, setChoice, type ProviderName } from "@/llm/registry";
import ProviderSelect from "./ProviderSelect";
import { checkRows, requiredOk, runLaunchChecks, type LaunchChecks } from "./checks";

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { void navigator.clipboard?.writeText(command).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); };
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-sm">{command}</code>
      <button type="button" className="shrink-0 rounded-md border border-line px-3 py-1 text-xs" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}

export default function FirstLaunch({ check = runLaunchChecks, onContinue, heading = "h1" }: {
  check?: (provider: ProviderName) => Promise<LaunchChecks>; onContinue: () => void; heading?: "h1" | "h2";
}) {
  const checkRef = useRef(check);
  checkRef.current = check;
  const [provider, setProvider] = useState(getChoice);
  const [checked, setChecked] = useState<{ provider: ProviderName; result: LaunchChecks }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const request = useRef(0);
  const run = useCallback(async () => {
    const id = ++request.current;
    setBusy(true); setError("");
    try {
      const result = await checkRef.current(provider);
      if (id === request.current) setChecked({ provider, result });
    }
    catch (e) { if (id === request.current) setError(e instanceof Error ? e.message : "Couldn't run the checks."); }
    finally { if (id === request.current) setBusy(false); }
  }, [provider]);
  useEffect(() => {
    void run();
    return () => { request.current++; };
  }, [run]);
  const selectProvider = (name: ProviderName) => {
    try { setChoice(name); setBusy(true); setProvider(name); }
    catch { setError("Couldn't save the AI provider on this computer."); }
  };
  const result = checked?.provider === provider ? checked.result : null;
  const rows = result ? checkRows(result, provider) : [];
  const ready = !!result && requiredOk(result);
  const Title = heading;
  return (
    <main className={heading === "h1" ? "fixed inset-0 overflow-auto bg-bg" : "min-w-0"}>
      <div className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
        <div>
          <Title className="text-3xl font-medium tracking-tight">Before you start</Title>
          <p className="mt-2 text-sm text-muted">Choose the AI provider Tangent uses to write your videos. These checks don't send a prompt.</p>
        </div>
        {heading === "h1" && <ProviderSelect value={provider} onChange={selectProvider} installations={checked?.result.installations} />}
        <ul aria-label="Setup checks" className="flex flex-col gap-3">
          {busy && !result && <li className="text-sm text-subtle">Checking…</li>}
          {rows.map(row => (
            <li key={row.id} data-status={row.ok ? "ok" : row.pending ? "pending" : "fail"} className="rounded-xl border border-line px-4 py-3">
              <p className={`flex items-center gap-2 font-medium ${row.pending ? "text-muted" : ""}`}>
                <span aria-hidden className={`size-2.5 rounded-full border border-fg ${row.ok ? "bg-fg" : ""}`} />
                {row.title}
                <span className="sr-only">{row.ok ? "Ready" : row.pending ? "Not checked yet" : "Needs attention"}</span>
                {!row.ok && !row.pending && <span aria-hidden className="ml-auto text-xs font-normal text-muted">Needs attention</span>}
              </p>
              <p className="mt-1 text-sm text-muted">{row.detail}</p>
              {!row.ok && row.fix && <p className="mt-2 text-sm text-fg">{row.fix}</p>}
              {!row.ok && row.command && <CopyCommand command={row.command} />}
              {!row.ok && row.link && <p className="mt-2 text-sm text-muted">Install guide: <a className="text-fg underline" href={row.link} target="_blank" rel="noreferrer">{row.link}</a></p>}
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
