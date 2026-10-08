'use client';

import { useRouter } from 'next/navigation';
import NavIcon from './NavIcon';
import { buildCommands, type NavIconName } from '../lib/nav';
import { useMe } from '../lib/session';
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

type Action = { id: string; label: string; hint: string; href?: string; run?: () => void; icon: NavIconName; keywords?: string[] };

export default function CommandPalette({ open, onOpenChange, onToggleTheme, dark }: { open: boolean; onOpenChange: (open: boolean) => void; onToggleTheme: () => void; dark: boolean }) {
  const router = useRouter();
  const me = useMe();
  // Only what this person may use: switched-off sections and actions are left out, clients get no Connections, staff get Admin.
  const commands = buildCommands(me);

  const actions: Action[] = [
    ...commands.actions,
    { id: 'theme', label: dark ? 'Switch to light mode' : 'Switch to dark mode', hint: 'Theme', run: onToggleTheme, icon: dark ? 'sun' : 'moon' },
  ];

  const select = (item: Action) => {
    onOpenChange(false);
    if (item.run) item.run();
    else if (item.href) router.push(item.href);
  };

  const renderItem = (item: Action) => (
    <CommandItem key={item.id} value={`${item.label} ${item.hint}`} keywords={item.keywords} onSelect={() => select(item)}>
      <span className="cmdk-icon"><NavIcon name={item.icon} size={15} /></span>
      <span>{item.label}</span>
      <CommandShortcut>{item.hint}</CommandShortcut>
    </CommandItem>
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command menu" description="Jump to a page or run an action" className="sm:max-w-[560px]">
      <CommandInput placeholder="Type a command or search…" className="h-12 border-0 px-0 shadow-none focus:shadow-none" />
      <CommandList>
        <CommandEmpty>No results. Try “planner” or “inbox”.</CommandEmpty>
        <CommandGroup heading="Go to">{commands.go.map(renderItem)}</CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">{actions.map(renderItem)}</CommandGroup>
        {commands.admin.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Admin">{commands.admin.map(renderItem)}</CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
