import Link from 'next/link';
import { Icon } from '@/components/Icons';

export default function NotFound() {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon name="search" size={18} /></div>
      <strong>We could not find that page</strong>
      It may have moved, or the link may be wrong.
      <br /><Link className="btn btn-sm" href="/" style={{ marginTop: 12 }}>Back to Overview</Link>
    </div>
  );
}
