import { Icon } from './Icons';
import type { NavIconName } from '../lib/nav';

/** Menu icons: the app's own set, plus two only the menu uses. */
export default function NavIcon({ name, size = 18 }: { name: NavIconName; size?: number }) {
  if (name === 'users') {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.3c1.8.8 3 2.6 3 5.2" /></svg>;
  }
  if (name === 'shield') {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.4 3 7.9 7.5 9.5 4.5-1.6 7.5-5.1 7.5-9.5V6L12 3Z" /></svg>;
  }
  return <Icon name={name} size={size} />;
}
