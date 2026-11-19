import { useEffect, useRef } from 'react';
import { readerName } from '../gen/transcribe';

export default function PhotoConfirm({ count, onConfirm, onCancel }: { count: number; onConfirm: () => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="tl-form tl-photo-confirm" aria-labelledby="photo-confirm-title" onCancel={e => { e.preventDefault(); onCancel(); }}>
    <h2 id="photo-confirm-title">Read {count} {count === 1 ? 'photo' : 'photos'}?</h2>
    <p>{readerName()} will read {count} {count === 1 ? 'photo' : 'photos'}. This uses your {readerName()} limit.</p>
    <div className="tl-form-actions"><button autoFocus className="tl-primary" onClick={onConfirm}>Read photos</button><button className="tl-text-button" onClick={onCancel}>Cancel</button></div>
  </dialog>;
}
