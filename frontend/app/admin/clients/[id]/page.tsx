'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ClientHeader from '../../../../components/admin/ClientHeader';
import { EmptyBlock, ErrorNotice, SkeletonRows } from '../../../../components/admin/Feedback';
import { useDocumentTitle, useLoad } from '../../../../components/admin/hooks';
import { CLIENT_TABS } from '../../../../components/admin/tabs';
import { ClientDetail, getClient } from '../../../../lib/admin';

function ClientPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const client = useLoad<ClientDetail>(() => getClient(id), [id]);
  useDocumentTitle(client.data ? client.data.name : 'Client');

  const wanted = search.get('tab');
  const active = CLIENT_TABS.find((t) => t.id === wanted) ?? CLIENT_TABS[0];

  const pick = useCallback((tab: string) => {
    router.replace(`${pathname}?tab=${encodeURIComponent(tab)}`, { scroll: false });
  }, [router, pathname]);

  const { reload: reloadClient } = client;
  const reload = useCallback(async () => { await reloadClient(); }, [reloadClient]);

  if (client.error && !client.data) {
    const missing = /not found/i.test(client.error);
    return missing
      ? <EmptyBlock icon="search" title="Client not found"><Link className="card-action" href="/admin/clients">Back to all clients</Link></EmptyBlock>
      : <ErrorNotice message={client.error} onRetry={() => void client.reload()} busy={client.loading} />;
  }
  if (!client.data) return <SkeletonRows count={3} label="Loading client" />;

  const Panel = active.component;
  return (
    <div>
      <ClientHeader client={client.data} onChanged={reload} />
      {client.error && <ErrorNotice message={client.error} onRetry={() => void client.reload()} busy={client.loading} />}
      <Tabs value={active.id} onValueChange={pick}>
        <TabsList variant="line" className="adm-tablist" aria-label="Client sections">
          {CLIENT_TABS.map((t) => <TabsTrigger key={t.id} value={t.id} className="adm-tab">{t.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value={active.id}>
          <Panel key={active.id} client={client.data} reload={reload} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ClientDetailPage() {
  return <Suspense fallback={<SkeletonRows count={3} label="Loading client" />}><ClientPage /></Suspense>;
}
