'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from './Icons';
import CommandPalette from './CommandPalette';

const primaryLinks = [
  { href: '/', label: 'Overview', icon: 'grid' as const },
  { href: '/planner', label: 'Planner', icon: 'calendar' as const },
  { href: '/ideas', label: 'Ideas', icon: 'bulb' as const },
  { href: '/hooks', label: 'Hook library', icon: 'sparkles' as const },
  { href: '/automations', label: 'Automations', icon: 'zap' as const, badge: '3' },
  { href: '/comments', label: 'Inbox', icon: 'inbox' as const, badge: '12' },
];

const manageLinks = [
  { href: '/connect', label: 'Connections', icon: 'link' as const },
  { href: '/analytics', label: 'Analytics', icon: 'chart' as const },
];

const titles: Record<string, { eyebrow: string; title: string }> = {
  '/': { eyebrow: 'Workspace', title: 'Overview' },
  '/planner': { eyebrow: 'Workspace', title: 'Content planner' },
  '/ideas': { eyebrow: 'Create', title: 'Content ideas' },
  '/hooks': { eyebrow: 'Create', title: 'Hook library' },
  '/automations': { eyebrow: 'Engagement', title: 'Automations' },
  '/comments': { eyebrow: 'Engagement', title: 'Inbox' },
  '/connect': { eyebrow: 'Workspace', title: 'Connections' },
  '/analytics': { eyebrow: 'Workspace', title: 'Analytics' },
};

function initialTheme(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = window.localStorage.getItem('motion-theme');
  if (stored) return stored === 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const page = titles[pathname] || titles['/'];
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const isCurrent = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  useEffect(() => {
    setDark(initialTheme());
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try { window.localStorage.setItem('motion-theme', dark ? 'dark' : 'light'); } catch { /* ignore */ }
  }, [dark]);

  const toggleTheme = useCallback(() => setDark((d) => !d), []);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [navOpen]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>

      {navOpen && (
        <button className="scrim" type="button" aria-label="Close navigation" onClick={() => setNavOpen(false)} />
      )}

      <aside className={`sidebar ${navOpen ? 'open' : ''}`} aria-label="Primary">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true"><span /></div>
          <span className="brand-name">motion</span>
          <span className="brand-beta">BETA</span>
        </div>

        <button className="workspace-switcher" type="button" aria-haspopup="listbox" aria-expanded="false" title="Switch workspace">
          <span className="workspace-avatar" aria-hidden="true">R</span>
          <span className="workspace-copy"><strong>Rothenhall Studio</strong><small>Personal workspace</small></span>
          <Icon name="chevron-down" size={15} />
        </button>

        <nav className="sidebar-nav" aria-label="Main navigation">
          <div className="nav-label">Workspace</div>
          {primaryLinks.map((link) => (
            <Link
              className={`nav-item ${isCurrent(link.href) ? 'active' : ''}`}
              href={link.href}
              key={link.href}
              aria-current={isCurrent(link.href) ? 'page' : undefined}
            >
              <Icon name={link.icon} size={18} />
              <span>{link.label}</span>
              {link.badge && <span className="nav-badge" aria-label={`${link.badge} unread`}>{link.badge}</span>}
            </Link>
          ))}
          <div className="nav-label nav-label-manage">Manage</div>
          {manageLinks.map((link) => (
            <Link
              className={`nav-item ${isCurrent(link.href) ? 'active' : ''}`}
              href={link.href}
              key={link.href}
              aria-current={isCurrent(link.href) ? 'page' : undefined}
            >
              <Icon name={link.icon} size={18} />
              <span>{link.label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="upgrade-card" role="complementary" aria-label="Upgrade to Pro">
            <div className="upgrade-icon"><Icon name="sparkles" size={16} /></div>
            <strong>Unlock your momentum</strong>
            <p>You&apos;ve used 72% of your free posts. Get unlimited automations and analytics.</p>
            <div className="upgrade-progress" role="progressbar" aria-valuenow={72} aria-valuemin={0} aria-valuemax={100} aria-label="Free plan usage">
              <i />
            </div>
            <button type="button">Explore Pro <Icon name="arrow-up-right" size={14} /></button>
          </div>
          <button className="sidebar-footer-link" type="button">
            <Icon name="help" size={16} /><span>Help center</span><span className="shortcut">?</span>
          </button>
          <button className="user-row" type="button" aria-label="Account settings for Nitish">
            <div className="user-avatar" aria-hidden="true">N</div>
            <div className="user-copy"><strong>Nitish</strong><small>nitish@rothenhall.com</small></div>
            <Icon name="more" size={17} />
          </button>
          <div className="version-tag">motion 0.1.0 · Beta</div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button
            className="icon-button menu-btn"
            type="button"
            aria-label={navOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((v) => !v)}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <div className="mobile-brand"><div className="brand-mark" aria-hidden="true"><span /></div><span>motion</span></div>
          <div className="page-heading">
            <span className="crumb">{page.eyebrow}</span>
            <h1>{page.title}</h1>
            <span className="env-badge"><i aria-hidden="true" />Live</span>
          </div>
          <div className="topbar-actions">
            <button className="search-trigger" type="button" aria-label="Search anything (Command K)" onClick={() => setPaletteOpen(true)}>
              <Icon name="search" size={17} /><span>Search anything</span><kbd>⌘ K</kbd>
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={toggleTheme}
              title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              <Icon name={dark ? 'sun' : 'moon'} size={18} />
            </button>
            <button className="icon-button" type="button" aria-label="Help and docs"><Icon name="help" size={19} /></button>
            <button className="icon-button notification-button" type="button" aria-label="Notifications, 3 unread">
              <Icon name="bell" size={19} /><i aria-hidden="true" />
            </button>
            <button className="topbar-avatar" type="button" aria-label="Open profile menu">N</button>
          </div>
        </header>
        <div className="content-area" id="main-content" tabIndex={-1}>{children}</div>
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onToggleTheme={toggleTheme} dark={dark} />
    </div>
  );
}
