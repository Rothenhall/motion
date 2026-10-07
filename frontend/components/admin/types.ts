import type { ClientDetail } from '../../lib/admin';

/** What every tab of the client page receives. `reload` re-reads the client, so the header and counts stay current. */
export interface ClientTabProps {
  client: ClientDetail;
  reload: () => Promise<void>;
}
