// NDK Data Protection — Headlamp plugin entry point.
// Owner: P1. Registers the sidebar entry, the /ndk route, and the AppBar
// "Add cluster" button. Feature components live under src/components and are
// owned by P2/P3/P4 per the hackathon roadmap.

import {
  type DetailsViewSectionProps,
  registerAppBarAction,
  registerDetailsViewSection,
  registerRoute,
  registerSidebarEntry,
} from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Typography } from '@mui/material';
import { AddClusterButton } from './components/AddClusterDialog';
import { ProtectionDashboard } from './components/ProtectionDashboard';
import { ReplicationList } from './components/ReplicationList';
import { SnapshotAndReplicateButton } from './components/SnapshotAndReplicate';
import { SnapshotList } from './components/SnapshotList';

registerSidebarEntry({
  parent: null,
  name: 'ndk',
  label: 'NDK Data Protection',
  url: '/ndk',
  icon: 'mdi:shield-sync',
});

registerRoute({
  path: '/ndk',
  sidebar: 'ndk',
  name: 'ndk',
  exact: true,
  component: () => <ProtectionDashboard />,
});

registerAppBarAction(<AddClusterButton />);

// Add a "Snapshot & Replicate" action to every NDK Application detail view.
registerDetailsViewSection(({ resource }: DetailsViewSectionProps) => {
  const apiVersion: string = resource?.jsonData?.apiVersion ?? '';
  if (
    resource &&
    resource.kind === 'Application' &&
    apiVersion.startsWith('dataservices.nutanix.com')
  ) {
    return (
      <>
        <SectionBox title="NDK Data Protection">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <SnapshotAndReplicateButton
              application={resource.getName()}
              namespace={resource.getNamespace()}
            />
            <Typography color="textSecondary" variant="body2">
              Take a manual snapshot of this application and replicate it to other clusters.
            </Typography>
          </Box>
        </SectionBox>
        <SnapshotList
          namespace={resource.getNamespace()}
          application={resource.getName()}
          title="Application snapshots"
        />
        <ReplicationList namespace={resource.getNamespace()} title="Replication tasks" />
      </>
    );
  }
  return null;
});
