import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft02Icon } from "@hugeicons/core-free-icons";
import Icon from "@/components/Icon";
import Glass from "@/components/Glass";
import { resetGiphyKey } from "@/media/giphy";

// The only setting today: an optional GIPHY key (macOS Keychain). Without it, reactions render as framed cards.
export default function Settings({ onBack }: { onBack: () => void }) {
  const [has, setHas] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => { invoke<string | null>("get_secret", { name: "giphy" }).then(k => setHas(!!k), () => setHas(false)); }, []);
  const save = async (value: string) => {
    await invoke("set_secret", { name: "giphy", value });
    resetGiphyKey(); setHas(!!value); setKey(""); setSaved(true);
  };
  return (
    <main className="h-screen overflow-y-auto bg-bg px-8 py-10">
      <div className="mx-auto flex max-w-xl flex-col gap-8">
        <button type="button" aria-label="Back" onClick={onBack} className="grid size-11 place-items-center rounded-full text-muted hover:bg-fg/10 hover:text-fg"><Icon icon={ArrowLeft02Icon} /></button>
        <h1 className="text-4xl font-semibold tracking-tight">Settings</h1>
        <Glass className="flex flex-col gap-3 rounded-2xl p-5">
          <h2 className="text-lg font-semibold">Reaction gifs</h2>
          <p className="text-sm text-muted">Paste a free GIPHY API key (developers.giphy.com) to drop fitting reaction gifs into videos. It's stored in your Keychain. Without a key, reactions show as text cards.</p>
          <p className="text-sm text-subtle">{has === null ? "Checking…" : has ? "A key is saved." : "No key saved."}</p>
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (key.trim()) void save(key.trim()); }}>
            <input aria-label="GIPHY API key" type="password" value={key} onChange={e => { setKey(e.target.value); setSaved(false); }} placeholder="GIPHY API key"
              className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-fg placeholder:text-subtle" />
            <button type="submit" className="h-11 rounded-lg bg-fg px-4 text-bg disabled:opacity-40" disabled={!key.trim()}>Save</button>
          </form>
          {has && <button type="button" onClick={() => void save("")} className="self-start text-sm text-subtle hover:text-fg">Remove key</button>}
          {saved && <p role="status" className="text-sm text-muted">Saved.</p>}
        </Glass>
      </div>
    </main>
  );
}
