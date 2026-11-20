import { useEffect, useRef } from 'react';
import type { WhatsNewItem } from '../whatsNewItems';
import { Logo } from './Logo';
import { Button } from './settings/ui';
import './WhatsNew.css';

/** Once after an update (and from Settings › About): a short list of what's new in this version. */
export function WhatsNew({ version, items, syncOn = false, onAction, onClose }: {
  version: string;
  items: WhatsNewItem[];
  /** This computer is syncing: the Sync item's chip says on (live, so it's right after Settings closes) */
  syncOn?: boolean;
  onAction: (to: 'add-computer' | 'open-transfer') => void;
  onClose: () => void;
}) {
  const done = useRef<HTMLButtonElement>(null);
  // Focus moves into the drawer, so the keyboard and screen readers start here
  useEffect(() => { done.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <aside className="whats-new" role="dialog" aria-label="What's new">
      <header className="whats-new__top">
        <Logo className="whats-new__logo" height={22} />
        <span className="whats-new__heading">Updated to {version} · What's new</span>
      </header>
      <ul className="whats-new__list">
        {items.map((it) => (
          <li key={it.id} className="whats-new__item">
            <div className="whats-new__title">
              {it.title}
              {it.state === 'sync' && <span className={`whats-new__state${syncOn ? ' is-on' : ''}`}>{syncOn ? 'on' : 'off'}</span>}
            </div>
            <p className="whats-new__text">{it.text}</p>
            {it.action && <Button onClick={() => onAction(it.action!.to)}>{it.action.label}</Button>}
          </li>
        ))}
      </ul>
      <footer className="whats-new__foot">
        <span className="whats-new__notes">Full notes in Settings › About</span>
        <Button ref={done} variant="primary" onClick={onClose}>Done</Button>
      </footer>
    </aside>
  );
}
