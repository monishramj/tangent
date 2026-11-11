import { useState } from "react";
import { Settings01Icon } from "@hugeicons/core-free-icons";
import Icon from "@/components/Icon";
import Panel from "@/Panel";
import { hasGiphyKey, saveGiphyKey } from "@/media/giphy";

// Settings side panel (reuses the player's Panel). Only setting: an optional GIPHY key kept in an owner-only file in
// the app data dir. Without it, reactions render as framed text cards. On/off comes from a non-secret localStorage flag.
export default function Settings() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-label="Settings" aria-expanded={open} onClick={() => setOpen(true)} className="grid size-11 place-items-center rounded-full text-subtle transition-colors hover:text-fg">
        <Icon icon={Settings01Icon} size={20} />
      </button>
      {open && <Panel title="Settings" onClose={() => setOpen(false)}><GiphySetting /></Panel>}
    </>
  );
}

function GiphySetting() {
  const [has, setHas] = useState(hasGiphyKey);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  const save = async (value: string) => {
    try {
      await saveGiphyKey(value);
      setHas(!!value); setKey(""); setMsg(value ? "Saved." : "Removed.");
    } catch (e) { setMsg(`Couldn't save: ${e}`); }
  };
  return (
    <section aria-label="Reaction gifs" className="flex flex-col gap-3 px-3">
      <h3 className="font-medium">Reaction gifs · {has ? "on" : "off"}</h3>
      <p className="text-sm text-muted">Paste a free GIPHY API key (developers.giphy.com) to drop reaction gifs into videos. It's stored only on this computer, in a file only you can read.</p>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (key.trim()) void save(key.trim()); }}>
        <input aria-label="GIPHY API key" type="password" value={key} onChange={e => { setKey(e.target.value); setMsg(""); }} placeholder={has ? "Replace key" : "GIPHY API key"}
          className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-fg placeholder:text-subtle" />
        <button type="submit" className="h-11 rounded-lg bg-fg px-4 font-medium text-bg disabled:opacity-40" disabled={!key.trim()}>Save</button>
      </form>
      {has && <button type="button" onClick={() => void save("")} className="self-start text-sm text-subtle hover:text-fg">Remove key</button>}
      {msg && <p role="status" className="text-sm text-muted">{msg}</p>}
    </section>
  );
}
