'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import './shell.css';
import { Icon } from './Icons';
import CommandPalette from './CommandPalette';
import NavIcon from './NavIcon';
import PreflightAlerts from './PreflightAlerts';
import PreviewBar from './PreviewBar';
import { signOut } from '../lib/api';
import { useApprovalCount } from '../lib/approvals';
import { buildNav, isActive, pageTitle, type NavExtras, type NavGroup } from '../lib/nav';
import { isStaff, useSession } from '../lib/session';
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

// Pages that work without a session.
const PUBLIC_PAGES = ['/login', '/accept-invite', '/reset-password'];
const isPublicPage = (pathname: string) => PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

function initialTheme(): boolean {
  if (typeof window === 'undefined') return false;
  return document.documentElement.dataset.theme === 'dark';
}

function SidebarContent({ groups, pathname, onNavigate }: { groups: NavGroup[]; pathname: string; onNavigate?: () => void }) {
  return (
    <>
      <div className="brand-row">
        <div className="brand-mark" aria-hidden="true"><span /></div>
        <span className="brand-name">motion</span>
        <span className="brand-beta">BETA</span>
      </div>
      <nav className="sidebar-nav" aria-label="Main navigation">
        {groups.map((group, i) => (
          <div key={group.id} role="group" aria-label={group.label}>
            <div className={`nav-label ${i > 0 ? 'nav-label-manage' : ''}`}>{group.label}</div>
            {group.links.map((link) => {
              const current = isActive(link, pathname);
              return (
                <Link className={`nav-item ${current ? 'active' : ''}`} href={link.href} key={`${group.id}${link.href}`} aria-current={current ? 'page' : undefined} onClick={onNavigate}>
                  <NavIcon name={link.icon} size={18} />
                  <span>{link.label}</span>
                  {link.badge ? <span className="nav-badge" aria-label={`${link.badge} waiting`}>{link.badge}</span> : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </>
  );
}

function AccountMenu({ email, staff, channelsLabel, dark, onToggleTheme, variant }: { email: string | null; staff: boolean; channelsLabel: string; dark: boolean; onToggleTheme: () => void; variant: 'sidebar' | 'topbar' }) {
  const initial = email ? email.charAt(0).toUpperCase() : '';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === 'sidebar' ? (
          <button className="user-row" type="button" aria-label="Account menu">
            <div className={`user-avatar ${email ? '' : 'skeleton'}`} aria-hidden="true">{initial}</div>
            <div className="user-copy"><strong>{staff ? 'Staff' : 'Signed in'}</strong><small>{email || 'Loading…'}</small></div>
            <Icon name="more" size={17} />
          </button>
        ) : (
          <button className={`topbar-avatar ${email ? '' : 'skeleton'}`} type="button" aria-label="Account menu">{initial}</button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={variant === 'sidebar' ? 'start' : 'end'} side={variant === 'sidebar' ? 'top' : 'bottom'} className="min-w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{staff ? `Staff: ${email}` : email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onToggleTheme}>
          <Icon name={dark ? 'sun' : 'moon'} size={15} /> {dark ? 'Light mode' : 'Dark mode'}
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/connect"><Icon name="link" size={15} /> {channelsLabel}</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={signOut}>
          <Icon name="arrow-right" size={15} /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ShellSkeleton() {
  return (
    <div className="shell-skeleton" aria-busy="true" aria-label="Loading Motion">
      <aside className="sidebar" aria-hidden="true">
        <div className="brand-row"><div className="brand-mark"><span /></div><span className="brand-name">motion</span></div>
        <div className="shell-skel-nav">{[0, 1, 2, 3, 4, 5].map((i) => <i key={i} />)}</div>
      </aside>
      <div className="shell-skel-main" aria-hidden="true">
        <div className="shell-skel-top" />
        <div className="shell-skel-body"><div className="skeleton" /><div className="skeleton" /></div>
      </div>
    </div>
  );
}

function ShellMessage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="auth-page shell-screen">
      <div className="card auth-card" role="alert">
        <div className="brand-row"><div className="brand-mark" aria-hidden="true"><span /></div><span className="brand-name">motion</span></div>
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}

/** Extra numbers for the menu: the count of posts waiting for approval, for staff only (it makes no request for anyone else). */
function useNavExtras(): NavExtras {
  const { pending } = useApprovalCount();
  return { approvalsPending: pending };
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { status, me, error, refresh } = useSession();
  const page = pageTitle(pathname, me);
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const publicPage = isPublicPage(pathname);
  const groups = buildNav(me, useNavExtras());
  const channels = groups.flatMap((g) => g.links).find((l) => l.href === '/connect');

  useEffect(() => {
    setDark(initialTheme());
  }, []);

  // No session: send people to sign in (signOut also clears any preview).
  useEffect(() => {
    if (!publicPage && status === 'anonymous') signOut();
  }, [publicPage, status]);

  // Every page gets its own tab title (WCAG 2.4.2).
  useEffect(() => {
    document.title = publicPage ? 'Motion' : `${page.title} · Motion`;
  }, [publicPage, page.title]);

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

  if (publicPage) return <>{children}</>;
  if (status === 'loading') return <ShellSkeleton />;
  // No token: signOut() is already redirecting to /login.
  if (status === 'anonymous') return null;
  if (status === 'suspended') {
    return (
      <ShellMessage title="This workspace is paused">
        <p>Contact your account manager.</p>
        <div className="shell-actions"><button className="btn" type="button" onClick={signOut}>Sign out</button></div>
      </ShellMessage>
    );
  }
  if (status === 'error' || !me) {
    return (
      <ShellMessage title="Could not reach Motion">
        <p>{error || 'Something went wrong while loading your workspace.'}</p>
        <div className="shell-actions">
          <button className="btn" type="button" onClick={() => { void refresh(); }}>Try again</button>
          <button className="btn btn-ghost" type="button" onClick={signOut}>Sign out</button>
        </div>
      </ShellMessage>
    );
  }

  const email = me.email;
  const staff = isStaff(me);
  const channelsLabel = channels?.label || 'Channels';
  // Starting, switching or leaving a preview changes whose data every page shows, so pages start fresh.
  const scope = `${me.client?.id ?? 'none'}:${me.acting ? (me.readOnlyPreview ? 'view' : 'admin') : 'own'}`;

  return (
    <>
      <PreviewBar />
      <div className="app-shell">
        <PreflightAlerts />
        <a className="skip-link" href="#main-content">Skip to content</a>

        <aside className="sidebar" aria-label="Primary">
          <SidebarContent groups={groups} pathname={pathname} />
          <div className="sidebar-bottom">
            <AccountMenu email={email} staff={staff} channelsLabel={channelsLabel} dark={dark} onToggleTheme={toggleTheme} variant="sidebar" />
          </div>
        </aside>

        {/* Mobile navigation: a real modal drawer, so focus stays inside and Esc closes it. */}
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent side="left" className="sidebar-sheet w-[280px] gap-0 border-0 bg-[var(--surface)] p-[22px_14px_16px] text-[var(--text-1)] sm:max-w-[280px]">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Go to another part of Motion</SheetDescription>
            <SidebarContent groups={groups} pathname={pathname} onNavigate={() => setNavOpen(false)} />
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
              <div className="topbar-account"><AccountMenu email={email} staff={staff} channelsLabel={channelsLabel} dark={dark} onToggleTheme={toggleTheme} variant="topbar" /></div>
            </div>
          </header>
          <div className="content-area" id="main-content" tabIndex={-1} key={scope}>{children}</div>
        </main>

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onToggleTheme={toggleTheme} dark={dark} />
      </div>
    </>
  );
}
