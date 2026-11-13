import { useState } from "react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import Icon from "@/components/Icon";
import TextField from "@/components/ui/TextField";
import Select from "@/components/ui/Select";
import { hasGiphyKey, saveGiphyKey } from "@/media/giphy";
import { LibraryShell } from "./LibraryView";
import { version } from "../../package.json";

const speeds = [0.75, 1, 1.25, 1.5, 1.75, 2];
function read(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

export default function Settings({ onBack }: { onBack: () => void }) {
  const [speed, setSpeed] = useState(() => { const value = read('tangent.speed', '1'); return speeds.includes(Number(value)) ? value : '1'; });
  const [cc, setCc] = useState(() => read('tangent.cc', 'on') !== 'off');
  const [error, setError] = useState('');
  const save = (key: string, value: string) => {
    try { localStorage.setItem(key, value); setError(''); return true; }
    catch { setError("Couldn't save playback defaults on this computer."); return false; }
  };
  return <LibraryShell onHome={onBack}>
    <button className="tl-back" onClick={onBack}><Icon icon={ArrowLeft01Icon} size={16} />Home</button>
    <div className="tl-heading"><div><h1>Settings</h1><p>Make yourself at home.</p></div></div>
    <div className="tl-settings">
      <GiphySetting />
      <section aria-labelledby="playback-heading"><h2 id="playback-heading">Playback defaults</h2>
        <label className="tl-setting-row" htmlFor="default-speed"><span>Speed<small>Used when a video opens.</small></span><Select id="default-speed" value={speed} onChange={e => { if (save('tangent.speed', e.target.value)) setSpeed(e.target.value); }}>{speeds.map(s => <option key={s} value={s}>{s === 1 ? 'Normal' : `${s}×`}</option>)}</Select></label>
        <label className="tl-setting-row" htmlFor="default-cc"><span>Captions<small>Show narration while watching.</small></span><Select id="default-cc" value={cc ? 'on' : 'off'} onChange={e => { if (save('tangent.cc', e.target.value)) setCc(e.target.value === 'on'); }}><option value="on">On</option><option value="off">Off</option></Select></label>
        {error && <p role="alert">{error}</p>}
      </section>
      <section aria-labelledby="about-heading"><h2 id="about-heading">About</h2><div className="tl-setting-row"><span>Tangent</span><span className="text-subtle">Version {version}</span></div></section>
      <section aria-labelledby="updates-heading"><h2 id="updates-heading">Updates</h2>{/* TODO: Wire checkForUpdate() when src/update.ts lands. */}<p className="text-sm text-subtle">Update checks are coming soon.</p></section>
    </div>
  </LibraryShell>;
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
    <section aria-label="Reaction gifs" className="flex flex-col gap-3">
      <h2 className="font-medium">Reaction gifs · {has ? "on" : "off"}</h2>
      <p className="text-sm text-muted">Paste a free GIPHY API key (developers.giphy.com) to drop reaction gifs into videos. It's stored only on this computer, in a file only you can read.</p>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (key.trim()) void save(key.trim()); }}>
        <TextField aria-label="GIPHY API key" type="password" value={key} onChange={e => { setKey(e.target.value); setMsg(""); }} placeholder={has ? "Replace key" : "GIPHY API key"}
          className="flex-1" />
        <button type="submit" className="h-11 rounded-lg bg-fg px-4 font-medium text-bg disabled:opacity-40" disabled={!key.trim()}>Save</button>
      </form>
      {has && <button type="button" onClick={() => void save("")} className="self-start text-sm text-subtle hover:text-fg">Remove key</button>}
      {msg && <p role="status" className="text-sm text-muted">{msg}</p>}
    </section>
  );
}
