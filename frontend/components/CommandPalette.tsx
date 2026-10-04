'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './Icons';

type Action = { id: string; label: string; hint: string; group: string; href?: string; run?: () => void; icon: 'grid' | 'bulb' | 'sparkles' | 'gauge' | 'calendar' | 'zap' | 'inbox' | 'link' | 'chart' | 'plus' | 'search' | 'sun' | 'moon' };

export default function CommandPalette({ open, onClose, onToggleTheme, dark }: { open: boolean; onClose: () => void; onToggleTheme: () => void; dark: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const actions: Action[] = useMemo(() => [
    { id: 'ov', label: 'Go to Overview', hint: 'Workspace', group: 'Navigate', href: '/', icon: 'grid' },
    { id: 'pl', label: 'Go to Planner', hint: 'Calendar', group: 'Navigate', href: '/planner', icon: 'calendar' },
    { id: 'id', label: 'Go to Ideas', hint: 'AI content ideas', group: 'Navigate', href: '/ideas', icon: 'bulb' },
    { id: 'hk', label: 'Go to Hook library', hint: 'Opening lines', group: 'Navigate', href: '/hooks', icon: 'sparkles' },
    { id: 'pf', label: 'Go to Pre-flight check', hint: 'Predict reactions before posting', group: 'Navigate', href: '/preflight', icon: 'gauge' },
    { id: 'au', label: 'Go to Automations', hint: 'Engagement', group: 'Navigate', href: '/automations', icon: 'zap' },
    { id: 'in', label: 'Go to Inbox', hint: '12 unread', group: 'Navigate', href: '/comments', icon: 'inbox' },
    { id: 'co', label: 'Go to Connections', hint: 'Channels', group: 'Navigate', href: '/connect', icon: 'link' },
    { id: 'an', label: 'Go to Analytics', hint: 'Reports', group: 'Navigate', href: '/analytics', icon: 'chart' },
    { id: 'new', label: 'Create post', hint: 'Composer', group: 'Actions', href: '/?compose=true', icon: 'plus' },
    { id: 'theme', label: dark ? 'Switch to light mode' : 'Switch to dark mode', hint: 'Theme', group: 'Actions', run: onToggleTheme, icon: dark ? 'sun' : 'moon' },
  ], [dark, onToggleTheme]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => `${a.label} ${a.hint} ${a.group}`.toLowerCase().includes(q));
  }, [actions, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open ]);

  useEffect(() => setIndex(0), [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, results.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
      if (e.key === 'Enter') {
        const item = results[index];
        if (!item) return;
        onClose();
        if (item.run) item.run();
        else if (item.href) router.push(item.href);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, results, index, onClose, router]);

  if (!open) return null;

  let lastGroup = '';
  return (
    <div className="cmdk-backdrop" onClick={onClose} role="presentation">
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command menu" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-input-row">
          <Icon name="search" size={17} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search…"
            aria-label="Type a command or search"
            aria-expanded="true"
            aria-controls="cmdk-list"
            role="combobox"
            aria-autocomplete="list"
            aria-activedescendant={results[index] ? `cmdk-${results[index].id}` : undefined}
          />
          <kbd>esc</kbd>
        </div>
        <div className="cmdk-list" id="cmdk-list" role="listbox" aria-label="Results" ref={listRef}>
          {results.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {header && <div className="cmdk-group-label">{header}</div>}
                <button
                  id={`cmdk-${item.id}`}
                  role="option"
                  aria-selected={i === index}
                  className={`cmdk-item ${i === index ? 'selected' : ''}`}
                  type="button"
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => {
                    onClose();
                    if (item.run) item.run();
                    else if (item.href) router.push(item.href);
                  }}
                >
                  <span className="cmdk-icon"><Icon name={item.icon} size={15} /></span>
                  <span className="cmdk-label">{item.label}</span>
                  <span className="cmdk-hint">{item.hint}</span>
                </button>
              </div>
            );
          })}
          {!results.length && <div className="cmdk-empty">No results for “{query}”. Try “planner” or “inbox”.</div>}
        </div>
        <div className="cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
