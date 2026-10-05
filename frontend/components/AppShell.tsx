'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from './Icons';
import CommandPalette from './CommandPalette';
import { api, getToken, signOut } from '../lib/api';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const primaryLinks = [
  { href: '/', label: 'Overview', icon: 'grid' as const },
  { href: '/planner', label: 'Planner', icon: 'calendar' as const },
  { href: '/ideas', label: 'Ideas', icon: 'bulb' as const },
  { href: '/hooks', label: 'Hook library', icon: 'sparkles' as const },
  { href: '/preflight', label: 'Pre-flight check', icon: 'gauge' as const },
  { href: '/automations', label: 'Automations', icon: 'zap' as const },
  { href: '/comments', label: 'Inbox', icon: 'inbox' as const },
];

const manageLinks = [
  { href: '/connect', label: 'Connections', icon: 'link' as const },
  { href: '/analytics', label: 'Analytics', icon: 'chart' as const },
];

const titles: Record<string, { eyebrow: string; title: string }> = {
  '/': { eyebrow: 'Workspace', title: 'Overview' },
  '/planner': { eyebrow: 'Workspace', title: 'Planner' },
  '/ideas': { eyebrow: 'Create', title: 'Ideas' },
  '/hooks': { eyebrow: 'Create', title: 'Hook library' },
  '/preflight': { eyebrow: 'Create', title: 'Pre-flight check' },
  '/automations': { eyebrow: 'Engagement', title: 'Automations' },
  '/comments': { eyebrow: 'Engagement', title: 'Inbox' },
  '/connect': { eyebrow: 'Manage', title: 'Connections' },
  '/analytics': { eyebrow: 'Manage', title: 'Analytics' },
};

function initialTheme(): boolean {
  if (typeof window === 'undefined') return false;
  return document.documentElement.dataset.theme === 'dark';
}

function SidebarContent({ isCurrent, onNavigate }: { isCurrent: (href: string) => boolean; onNavigate?: () => void }) {
  const renderLink = (link: { href: string; label: string; icon: Parameters<typeof Icon>[0]['name'] }) => (
    <Link
      className={`nav-item ${isCurrent(link.href) ? 'active' : ''}`}
      href={link.href}
      key={link.href}
      aria-current={isCurrent(link.href) ? 'page' : undefined}
      onClick={onNavigate}
    >
      <Icon name={link.icon} size={18} />
      <span>{link.label}</span>
    </Link>
  );
  return (
    <>
      <div className="brand-row">
        <div className="brand-mark" aria-hidden="true"><span /></div>
        <span className="brand-name">motion</span>
        <span className="brand-beta">BETA</span>
      </div>
      <nav className="sidebar-nav" aria-label="Main navigation">
        <div className="nav-label">Workspace</div>
        {primaryLinks.map(renderLink)}
        <div className="nav-label nav-label-manage">Manage</div>
        {manageLinks.map(renderLink)}
      </nav>
    </>
  );
}

function AccountMenu({ email, dark, onToggleTheme, variant }: { email: string | null; dark: boolean; onToggleTheme: () => void; variant: 'sidebar' | 'topbar' }) {
  const initial = email ? email.charAt(0).toUpperCase() : '';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === 'sidebar' ? (
          <button className="user-row" type="button" aria-label="Account menu">
            <div className={`user-avatar ${email ? '' : 'skeleton'}`} aria-hidden="true">{initial}</div>
            <div className="user-copy"><strong>Signed in</strong><small>{email || 'Loading…'}</small></div>
            <Icon name="more" size={17} />
          </button>
        ) : (
          <button className={`topbar-avatar ${email ? '' : 'skeleton'}`} type="button" aria-label="Account menu">{initial}</button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={variant === 'sidebar' ? 'start' : 'end'} side={variant === 'sidebar' ? 'top' : 'bottom'} className="min-w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onToggleTheme}>
          <Icon name={dark ? 'sun' : 'moon'} size={15} /> {dark ? 'Light mode' : 'Dark mode'}
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/connect"><Icon name="link" size={15} /> Connections</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={signOut}>
          <Icon name="arrow-right" size={15} /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Sub-pages (e.g. /preflight/<id>) share their section's title.
  const page = titles[pathname] || titles[`/${pathname.split('/')[1]}`] || titles['/'];
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [hasSession, setHasSession] = useState(false);
  const isAuthPage = pathname === '/login';
  const isCurrent = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  useEffect(() => {
    setDark(initialTheme());
  }, []);

  useEffect(() => {
    if (isAuthPage) return;
    if (!getToken()) { signOut(); return; }
    setHasSession(true);
    api<{ email: string }>('/auth/me').then((me) => setEmail(me.email)).catch(() => { /* api() redirects on 401 */ });
  }, [isAuthPage]);

  // Every page gets its own tab title (WCAG 2.4.2).
  useEffect(() => {
    document.title = isAuthPage ? 'Sign in · Motion' : `${page.title} · Motion`;
  }, [isAuthPage, page.title]);

  const toggleTheme = useCallback(() => {
    setDark((d) => {
      const next = !d;
      document.documentElement.dataset.theme = next ? 'dark' : 'light';
      try { window.localStorage.setItem('motion-theme', next ? 'dark' : 'light'); } catch { /* ignore */ }
      return next;
    });
  }, []);

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

  if (isAuthPage) return <>{children}</>;
  // No token: signOut() is already redirecting to /login.
  if (!hasSession) return null;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>

      <aside className="sidebar" aria-label="Primary">
        <SidebarContent isCurrent={isCurrent} />
        <div className="sidebar-bottom">
          <AccountMenu email={email} dark={dark} onToggleTheme={toggleTheme} variant="sidebar" />
        </div>
      </aside>

      {/* Mobile navigation: a real modal drawer, so focus stays inside and Esc closes it. */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="sidebar-sheet w-[280px] gap-0 border-0 bg-[linear-gradient(180deg,var(--navy)_0%,var(--navy-2)_100%)] p-[22px_14px_16px] text-[#e8ecf5] sm:max-w-[280px]">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Go to another part of Motion</SheetDescription>
          <SidebarContent isCurrent={isCurrent} onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <main className="main-area">
        <header className="topbar">
          <button
            className="icon-button menu-btn"
            type="button"
            aria-label="Open menu"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <div className="mobile-brand"><div className="brand-mark" aria-hidden="true"><span /></div><span>motion</span></div>
          <nav className="page-heading" aria-label="Breadcrumb">
            <span className="crumb">{page.eyebrow}</span>
            <Icon name="chevron-right" size={13} className="crumb-sep" />
            <span className="page-title" aria-current="page">{page.title}</span>
          </nav>
          <div className="topbar-actions">
            <button className="search-trigger" type="button" aria-label="Search and commands" aria-keyshortcuts="Control+K Meta+K" onClick={() => setPaletteOpen(true)}>
              <Icon name="search" size={17} /><span>Search or jump to…</span><kbd>⌘ K</kbd>
            </button>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="icon-button" type="button" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme}>
                  <Icon name={dark ? 'sun' : 'moon'} size={18} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{dark ? 'Light mode' : 'Dark mode'}</TooltipContent>
            </Tooltip>
            <div className="topbar-account"><AccountMenu email={email} dark={dark} onToggleTheme={toggleTheme} variant="topbar" /></div>
          </div>
        </header>
        <div className="content-area" id="main-content" tabIndex={-1}>{children}</div>
      </main>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onToggleTheme={toggleTheme} dark={dark} />
    </div>
  );
}
