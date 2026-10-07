import { ActingClient, api, setActing } from './api';

/**
 * Staff start previewing a client: the audit log is told, then every request names that client until the preview ends.
 * `view` is read only and shows exactly what the client sees; `admin` can make changes. Switching mode is the same call.
 */
export async function startPreview(client: { id: string; name: string }, mode: ActingClient['mode'] = 'view') {
  await api('/admin/preview/start', { method: 'POST', body: JSON.stringify({ clientId: client.id, mode }) });
  setActing({ id: client.id, name: client.name, mode });
}

/** Staff stop previewing. The acting client is cleared even if the audit call fails, so nobody is left stuck in a preview. */
export async function exitPreview(clientId: string) {
  try { await api('/admin/preview/exit', { method: 'POST', body: JSON.stringify({ clientId }) }); }
  finally { setActing(null); }
}
