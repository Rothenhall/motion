'use client';

import { ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InviteLink, exactTime, timeAgo } from '../../lib/admin';
import CopyField from './CopyField';

/** The one-time link for an invitation or a password reset. Nothing is emailed, so the wording says so every time. */
export function LinkDetails({ link, label = 'Link' }: { link: InviteLink; label?: string }) {
  return (
    <div className="adm-link-details">
      <CopyField label={label} value={link.url} />
      <p className="adm-expiry">Expires <time dateTime={link.expiresAt} title={exactTime(link.expiresAt)}>{timeAgo(link.expiresAt)}</time> ({exactTime(link.expiresAt)}).</p>
      <p className="adm-no-email">No email is sent. Copy this link and send it to {link.email}.</p>
    </div>
  );
}

export default function CopyLinkDialog({ open, onOpenChange, title, description, link, label, footer }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  link: InviteLink | null;
  label?: string;
  footer?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description ?? 'This link works once. If you lose it, make a new one.'}</DialogDescription>
        </DialogHeader>
        {link && <LinkDetails link={link} label={label} />}
        <DialogFooter>
          {footer}
          <button className="btn btn-ghost" type="button" onClick={() => onOpenChange(false)}>Done</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
