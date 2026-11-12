import { useEffect } from 'react';
import type { ToastKind } from '../context';

export interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

function Toast({ item, onDone }: { item: ToastItem; onDone: (id: number) => void }) {
  useEffect(() => {
    const t = window.setTimeout(() => onDone(item.id), 4200);
    return () => window.clearTimeout(t);
  }, [item.id, onDone]);

  return (
    <div className={`toast ${item.kind}`} role={item.kind === 'err' ? 'alert' : 'status'}>
      <span className="t-dot" aria-hidden="true" />
      <span className="t-text">{item.text}</span>
      <i className="t-bar" aria-hidden="true" />
    </div>
  );
}

export function ToastHost({
  toasts,
  onDone,
}: {
  toasts: ToastItem[];
  onDone: (id: number) => void;
}) {
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <Toast key={t.id} item={t} onDone={onDone} />
      ))}
    </div>
  );
}
