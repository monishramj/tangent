import { useEffect, useRef } from 'react';
import { dispatchKeybind, type KeybindHandlers } from '@/keybinds';

export default function useKeybinds(actions: KeybindHandlers, enabled = true, capture = false) {
  const current = useRef(actions);
  current.current = actions;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => dispatchKeybind(event, current.current);
    window.addEventListener('keydown', onKey, capture);
    return () => window.removeEventListener('keydown', onKey, capture);
  }, [enabled, capture]);
}
