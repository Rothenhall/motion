import type { ComponentType } from 'react';
import ActivityTab from './ActivityTab';
import ApprovalsTab from './ApprovalsTab';
import ChannelsTab from './ChannelsTab';
import FeaturesTab from './FeaturesTab';
import OverviewTab from './OverviewTab';
import RequireApprovalToggle from './RequireApprovalToggle';
import TeamTab from './TeamTab';
import type { ClientTabProps } from './types';

export interface ClientTab { id: string; label: string; component: ComponentType<ClientTabProps> }

/** Features, with the per-client "Require approval" switch placed in its slot at the top. */
function FeaturesWithApproval(props: ClientTabProps) {
  return (
    <FeaturesTab {...props}>
      <RequireApprovalToggle clientId={props.client.id} value={!!props.client.requireApproval} onChange={() => { void props.reload(); }} />
    </FeaturesTab>
  );
}

/** The tabs on a client's page, in order. The page builds its tab bar and the `?tab=` address from this list. */
export const CLIENT_TABS: ClientTab[] = [
  { id: 'overview', label: 'Overview', component: OverviewTab },
  { id: 'channels', label: 'Channels', component: ChannelsTab },
  { id: 'features', label: 'Features', component: FeaturesWithApproval },
  { id: 'team', label: 'Team', component: TeamTab },
  { id: 'approvals', label: 'Approvals', component: ({ client }: ClientTabProps) => <ApprovalsTab clientId={client.id} /> },
  { id: 'activity', label: 'Activity', component: ActivityTab },
];
