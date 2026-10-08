'use client';

import { useRouter } from 'next/navigation';
import { Icon } from './Icons';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';

type IconName = Parameters<typeof Icon>[0]['name'];
type Action = { id: string; label: string; hint: string; href?: string; run?: () => void; icon: IconName; keywords?: string[] };

const navigate: Action[] = [
  { id: 'ov', label: 'Overview', hint: 'Workspace', href: '/', icon: 'grid', keywords: ['home', 'dashboard'] },
  { id: 'pl', label: 'Planner', hint: 'Calendar', href: '/planner', icon: 'calendar', keywords: ['schedule', 'calendar'] },
  { id: 'lab', label: 'Content Lab', hint: 'Ideas and hooks', href: '/lab', icon: 'bulb', keywords: ['ideas', 'hooks', 'board'] },
  { id: 'cr', label: 'Creators', hint: 'Find Instagram creators', href: '/creators', icon: 'search', keywords: ['creators', 'marketplace', 'influencers', 'partnership'] },
  { id: 'hk', label: 'Hook library', hint: 'Opening lines', href: '/lab?view=hooks', icon: 'sparkles' },
  { id: 'pf', label: 'Pre-flight check', hint: 'Predict reactions before posting', href: '/preflight', icon: 'gauge', keywords: ['predict', 'review', 'check'] },
  { id: 'au', label: 'Automations', hint: 'Comment to DM', href: '/automations', icon: 'zap', keywords: ['rules', 'dm'] },
  { id: 'in', label: 'Inbox', hint: 'Comments', href: '/comments', icon: 'inbox', keywords: ['comments', 'reply'] },
  { id: 'co', label: 'Connections', hint: 'Channels', href: '/connect', icon: 'link', keywords: ['instagram', 'facebook', 'threads'] },
  { id: 'an', label: 'Analytics', hint: 'Reports', href: '/analytics', icon: 'chart', keywords: ['stats', 'insights'] },
];

export default function CommandPalette({ open, onOpenChange, onToggleTheme, dark }: { open: boolean; onOpenChange: (open: boolean) => void; onToggleTheme: () => void; dark: boolean }) {
  const router = useRouter();

  const actions: Action[] = [
    { id: 'new', label: 'Create post', hint: 'Composer', href: '/?compose=true', icon: 'plus', keywords: ['new', 'schedule', 'compose'] },
    { id: 'gen', label: 'Generate ideas', hint: 'Content Lab', href: '/lab', icon: 'sparkles', keywords: ['write', 'ideas'] },
    { id: 'check', label: 'Check a reel', hint: 'Pre-flight', href: '/preflight', icon: 'gauge', keywords: ['predict', 'reel', 'preflight'] },
    { id: 'sync', label: 'Sync insights', hint: 'Analytics', href: '/analytics', icon: 'refresh', keywords: ['refresh', 'meta'] },
    { id: 'theme', label: dark ? 'Switch to light mode' : 'Switch to dark mode', hint: 'Theme', run: onToggleTheme, icon: dark ? 'sun' : 'moon' },
  ];

  const select = (item: Action) => {
    onOpenChange(false);
    if (item.run) item.run();
    else if (item.href) router.push(item.href);
  };

  const renderItem = (item: Action) => (
    <CommandItem key={item.id} value={`${item.label} ${item.hint}`} keywords={item.keywords} onSelect={() => select(item)}>
      <span className="cmdk-icon"><Icon name={item.icon} size={15} /></span>
      <span>{item.label}</span>
      <CommandShortcut>{item.hint}</CommandShortcut>
    </CommandItem>
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command menu" description="Jump to a page or run an action" className="sm:max-w-[560px]">
      <CommandInput placeholder="Type a command or search…" className="h-12 border-0 px-0 shadow-none focus:shadow-none" />
      <CommandList>
        <CommandEmpty>No results. Try “planner” or “inbox”.</CommandEmpty>
        <CommandGroup heading="Go to">{navigate.map(renderItem)}</CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">{actions.map(renderItem)}</CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
