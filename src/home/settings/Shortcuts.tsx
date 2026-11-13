import { useEffect, useState } from 'react';
import TextField from '@/components/ui/TextField';
import { actions, bindingConflicts, bindingFromEvent, defaultBindings, displayBinding, getBinding, resetBindings, setBinding, subscribeKeybinds, type ActionId } from '@/keybinds';

export default function ShortcutsSection() {
  const [, refresh] = useState(0);
  const [recording, setRecording] = useState<ActionId | null>(null);
  const [error, setError] = useState('');
  useEffect(() => subscribeKeybinds(() => refresh(v => v + 1)), []);
  const reset = (id?: ActionId) => { try { resetBindings(id); setError(''); } catch { setError("Couldn't save shortcuts on this computer."); } };
  return <section aria-label="Keyboard shortcuts" className="flex flex-col gap-4">
    <div className="flex items-center justify-between gap-4"><h2>Keyboard shortcuts</h2><button type="button" className="tl-quiet" onClick={() => reset()}>Reset all</button></div>
    <p className="text-sm text-subtle">Click a shortcut and press your new keys. Esc cancels. Shortcuts pause while you type.</p>
    {error && <p role="alert" className="text-sm text-muted">{error}</p>}
    {(['Playback', 'Panels', 'Library', 'App'] as const).map(group => <fieldset key={group} className="flex min-w-0 flex-col gap-1"><legend className="mb-2 text-sm font-medium text-subtle">{group}</legend>
      {(Object.keys(actions) as ActionId[]).filter(id => actions[id].group === group).map(id => {
        const bindings = getBinding(id), conflicts = bindingConflicts(id, bindings);
        return <div key={id} className="tl-setting-row flex-wrap gap-2"><span className="flex-1">{actions[id].label}{conflicts.length > 0 && <small role="status">Conflicts with {conflicts.map(other => actions[other].label).join(', ')}</small>}</span>
          {recording === id ? <TextField autoFocus readOnly aria-label={`New shortcut for ${actions[id].label}`} value="Press keys…" className="w-44" onBlur={() => setRecording(null)} onKeyDown={event => {
            event.preventDefault(); event.stopPropagation();
            if (event.key === 'Escape') { setRecording(null); setError(''); return; }
            const binding = bindingFromEvent(event.nativeEvent);
            if (!binding) return;
            try { setBinding(id, [binding]); setRecording(null); setError(''); }
            catch (e) { setError(e instanceof Error ? e.message : "Couldn't save shortcut."); }
          }} /> : <button type="button" className="ui-field w-auto min-w-28 text-sm" aria-label={`Change ${actions[id].label} shortcut`} onClick={() => { setRecording(id); setError(''); }}>{bindings.length ? bindings.map(displayBinding).join(' / ') : 'Unassigned'}</button>}
          <button type="button" className="tl-text-button text-sm disabled:opacity-30" aria-label={`Reset ${actions[id].label} shortcut`} disabled={JSON.stringify(bindings) === JSON.stringify(defaultBindings[id])} onClick={() => reset(id)}>Reset</button>
        </div>;
      })}
    </fieldset>)}
  </section>;
}
