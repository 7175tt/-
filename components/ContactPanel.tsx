import React, { useEffect, useId, useRef } from 'react';
import Icon from './Icon';

export default function ContactPanel({ title, onClose, children, busy = false }: {
  title: string; onClose: () => void; children: React.ReactNode; busy?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const busyRef = useRef(busy); busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const targets = [...(ref.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary') || [])].filter(element => element.getClientRects().length);
      const first = targets[0], last = targets.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !ref.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !ref.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <section ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className="fixed inset-0 z-40 bg-gray-950 text-white overflow-y-auto">
    <div className="max-w-2xl mx-auto p-4 pb-12" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 mb-5 -mx-4 px-4 py-2 bg-gray-950/95 backdrop-blur"><h1 id={id} className="text-xl font-bold break-words">{title}</h1><button onClick={onClose} disabled={busy} aria-label="關閉面板" className="shrink-0 min-h-11 min-w-11 grid place-items-center rounded-xl bg-gray-800 disabled:opacity-50"><Icon name="x-mark" /></button></header>
      {children}
    </div>
  </section>;
}

export const contactInputClass = 'w-full min-w-0 min-h-11 bg-gray-900 border border-gray-700 text-white rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-500';
export const contactButtonClass = 'min-h-11 px-4 rounded-lg bg-blue-600 text-white disabled:opacity-50';
