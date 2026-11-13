import { useEffect, useState } from "react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import Icon from "@/components/Icon";
import TextField from "@/components/ui/TextField";
import Select from "@/components/ui/Select";
import { hasGiphyKey, saveGiphyKey } from "@/media/giphy";
import { LibraryShell } from "./LibraryView";
import { getVersion } from "@tauri-apps/api/app";
import { checkForUpdate, installUpdate } from "@/update";
import { version } from "../../package.json";

import logo from "../../assets/tangent-icon.png";
import ShortcutsSection from "./settings/Shortcuts";

const sections = ["General", "Playback", "Keyboard shortcuts", "Updates & About"] as const;
const speeds = [0.75, 1, 1.25, 1.5, 1.75, 2];
function read(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

export default function Settings({ onBack }: { onBack: () => void }) {
  const [section, setSection] = useState<typeof sections[number]>("General");
  const [speed, setSpeed] = useState(() => { const value = read('tangent.speed', '1'); return speeds.includes(Number(value)) ? value : '1'; });
  const [cc, setCc] = useState(() => read('tangent.cc', 'on') !== 'off');
  const [error, setError] = useState('');
  const save = (key: string, value: string) => {
    try { localStorage.setItem(key, value); setError(''); return true; }
    catch { setError("Couldn't save playback defaults on this computer."); return false; }
  };
  return <LibraryShell onHome={onBack} wide>
    <button className="tl-back" onClick={onBack}><Icon icon={ArrowLeft01Icon} size={16} />Home</button>
    <div className="tl-heading"><div><h1>Settings</h1><p>Make yourself at home.</p></div></div>
    <div className="tl-settings-layout">
      <nav className="tl-settings-nav" aria-label="Settings sections">{sections.map(name => <button type="button" key={name} aria-current={section === name ? 'page' : undefined} aria-controls={`settings-${sections.indexOf(name)}`} onClick={() => setSection(name)}>{name}</button>)}</nav>
      <div className="tl-settings">
      <div id="settings-0" hidden={section !== 'General'}><h2>General</h2><GiphySetting /></div>
      <div id="settings-1" hidden={section !== 'Playback'}><section aria-labelledby="playback-heading"><h2 id="playback-heading">Playback defaults</h2>
        <label className="tl-setting-row" htmlFor="default-speed"><span>Speed<small>Used when a video opens.</small></span><Select id="default-speed" value={speed} onChange={e => { if (save('tangent.speed', e.target.value)) setSpeed(e.target.value); }}>{speeds.map(s => <option key={s} value={s}>{s === 1 ? 'Normal' : `${s}×`}</option>)}</Select></label>
        <label className="tl-setting-row" htmlFor="default-cc"><span>Captions<small>Show narration while watching.</small></span><Select id="default-cc" value={cc ? 'on' : 'off'} onChange={e => { if (save('tangent.cc', e.target.value)) setCc(e.target.value === 'on'); }}><option value="on">On</option><option value="off">Off</option></Select></label>
        {error && <p role="alert">{error}</p>}
      </section></div>
      <div id="settings-2" hidden={section !== 'Keyboard shortcuts'}><ShortcutsSection /></div>
      <div id="settings-3" hidden={section !== 'Updates & About'}><Updates /></div>
      </div>
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


function Updates() {
  const desktop = '__TAURI_INTERNALS__' in window;
  const [currentVersion, setCurrentVersion] = useState(version);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [available, setAvailable] = useState('');
  const [state, setState] = useState<'idle' | 'checking' | 'current' | 'available' | 'installing' | 'restarting'>('idle');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!desktop) return;
    let live = true;
    void getVersion().then(value => { if (live) setCurrentVersion(value); })
      .catch(e => { if (live) setError(`Couldn't read the app version: ${String(e)}`); });
    return () => { live = false; };
  }, [desktop]);
  const check = async () => {
    setState('checking'); setError('');
    try {
      const update = await checkForUpdate();
      setAvailable(update?.version ?? ''); setState(update ? 'available' : 'current'); setLastChecked(new Date());
    } catch (e) { setState('idle'); setError(`Couldn't check for updates: ${String(e)}`); }
  };
  const install = async () => {
    setState('installing'); setError('');
    try { setState(await installUpdate() ? 'restarting' : 'available'); }
    catch (e) { setState('available'); setError(`Couldn't install the update: ${String(e)}`); }
  };
  const busy = state === 'checking' || state === 'installing' || state === 'restarting';
  return <section aria-labelledby="updates-heading"><h2 id="updates-heading">Updates &amp; About</h2>
    <div className="tl-about"><img src={logo} alt="Tangent logo" /><div><h3>Tangent</h3><p className="text-subtle">Version {currentVersion}</p></div></div>
    {desktop ? <>
      <p role="status" className="text-sm text-subtle">{state === 'checking' ? 'Checking for updates…' : state === 'current' ? 'Tangent is up to date.' : state === 'installing' ? 'Installing update…' : state === 'restarting' ? 'Restarting…' : available ? `Tangent ${available} is available.` : 'Check for the latest version of Tangent.'}</p>
      <p className="tl-last-checked">{lastChecked ? <>Last checked <time dateTime={lastChecked.toISOString()}>{lastChecked.toLocaleString()}</time></> : 'Not checked yet this visit.'}</p>
      <div className="tl-update-actions">
        <button type="button" className="tl-quiet" disabled={busy} onClick={() => void check()}>Check for updates</button>
        {available && <button type="button" className="tl-primary" disabled={busy} onClick={() => void install()}>Install and restart</button>}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-muted">{error}</p>}
    </> : <p className="text-sm text-subtle">Updates are available in the installed app</p>}
  </section>;
}
