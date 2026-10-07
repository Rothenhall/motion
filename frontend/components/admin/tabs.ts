import type { ComponentType } from 'react';
import ActivityTab from './ActivityTab';
import ChannelsTab from './ChannelsTab';
import FeaturesTab from './FeaturesTab';
import OverviewTab from './OverviewTab';
import TeamTab from './TeamTab';
import type { ClientTabProps } from './types';

export interface ClientTab { id: string; label: string; component: ComponentType<ClientTabProps> }

/**
 * The tabs on a client's page, in order. The page builds its tab bar and the `?tab=` address from this list.
 *
 * INTEGRATION: the approvals stream adds an entry here, between Team and Activity:
 *   { id: 'approvals', label: 'Approvals', component: ApprovalsTab },
 * and (to place its "Require approval" toggle) can wrap FeaturesTab, see the SLOT note in FeaturesTab.tsx.
 */
export const CLIENT_TABS: ClientTab[] = [
  { id: 'overview', label: 'Overview', component: OverviewTab },
  { id: 'channels', label: 'Channels', component: ChannelsTab },
  { id: 'features', label: 'Features', component: FeaturesTab },
  { id: 'team', label: 'Team', component: TeamTab },
  { id: 'activity', label: 'Activity', component: ActivityTab },
];
