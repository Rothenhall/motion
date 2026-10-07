// Friendly names for the feature switches. The server decides which switches exist; this only adds words to the ones we know,
// and anything new still gets a readable name and a generic line, so a new switch never breaks the screen.

const COPY: Record<string, { label: string; hides: string }> = {
  planner: { label: 'Planner', hides: 'Hides the Planner page and its calendar.' },
  'content-lab': { label: 'Content Lab', hides: 'Hides the ideas board, the hook library and brand voice.' },
  preflight: { label: 'Pre-flight check', hides: 'Hides pre-flight checks on posts.' },
  inbox: { label: 'Inbox', hides: 'Hides the comment inbox.' },
  automations: { label: 'Automations', hides: 'Hides automation rules.' },
  analytics: { label: 'Analytics', hides: 'Hides Analytics and the numbers on the overview.' },
  creators: { label: 'Creators', hides: 'Find and shortlist Instagram creators.' },
  compose: { label: 'Create and edit posts', hides: 'Stops the client creating or editing drafts and posts, and uploading media.' },
  schedule: { label: 'Schedule posts', hides: 'Stops the client scheduling a post without approval.' },
  'delete-posts': { label: 'Delete posts', hides: 'Stops the client deleting scheduled posts.' },
  'inbox-reply': { label: 'Reply to comments', hides: 'Stops the client replying to comments from the inbox.' },
  'edit-brand': { label: 'Edit brand voice', hides: 'Stops the client changing the brand voice.' },
  ai: { label: 'AI tools', hides: 'Hides AI writing and AI checks. These cost money, so they start off for new clients.' },
};

const titleCase = (key: string) => {
  const words = key.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
};

export function featureCopy(key: string): { label: string; hides: string } {
  const known = COPY[key];
  if (known) return known;
  const label = titleCase(key);
  return { label, hides: `Turns ${label} on or off for this client.` };
}
