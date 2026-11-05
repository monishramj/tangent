import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { resetGiphyKey } from "@/media/giphy";

// The only setting: an optional GIPHY key (macOS Keychain). Without it, reactions render as framed text cards.
export default function GiphyKey() {
  const [open, setOpen] = useState(false);
  const [has, setHas] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { invoke<string | null>("get_secret", { name: "giphy" }).then(k => setHas(!!k), () => setHas(false)); }, []);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const save = async (value: string) => {
    try {
      await invoke("set_secret", { name: "giphy", value });
      resetGiphyKey(); setHas(!!value); setKey(""); setMsg(value ? "Saved." : "Removed.");
    } catch (e) { setMsg(`Couldn't save: ${e}`); }
  };
  return (
    <div ref={box} className="relative">
      <button type="button" aria-expanded={open} onClick={() => { setOpen(o => !o); setMsg(""); }} className="min-h-11 rounded-lg px-3 text-sm whitespace-nowrap text-subtle transition-colors hover:text-fg">
        Reaction gifs{has === null ? "" : has ? " · on" : " · off"}
      </button>
      {open && (
        <div role="dialog" aria-label="Reaction gifs" className="fade-up glass-solid absolute top-full right-0 z-20 mt-2 flex w-80 flex-col gap-3 rounded-2xl p-4">
          <p className="text-sm text-muted">Paste a free GIPHY API key (developers.giphy.com) to drop reaction gifs into videos. It's kept in your Keychain.</p>
          <p className="text-sm text-subtle">{has === null ? "Checking…" : has ? "A key is saved." : "No key saved."}</p>
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (key.trim()) void save(key.trim()); }}>
            <input aria-label="GIPHY API key" type="password" value={key} autoFocus onChange={e => { setKey(e.target.value); setMsg(""); }} placeholder="GIPHY API key"
              className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-fg placeholder:text-subtle" />
            <button type="submit" className="h-11 rounded-lg bg-fg px-4 font-medium text-bg disabled:opacity-40" disabled={!key.trim()}>Save</button>
          </form>
          {has && <button type="button" onClick={() => void save("")} className="self-start text-sm text-subtle hover:text-fg">Remove key</button>}
          {msg && <p role="status" className="text-sm text-muted">{msg}</p>}
        </div>
      )}
    </div>
  );
}
