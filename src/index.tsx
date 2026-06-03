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
import { applyUiTweaks } from './applyUiTweaks';
import { AddClusterButton } from './components/AddClusterDialog';
import { CreateReplicationTargetButton } from './components/CreateReplicationTargetDialog';
import { InstallNdkButton } from './components/InstallNdkButton';
import { ProtectionDashboard } from './components/ProtectionDashboard';
import { ReplicationList } from './components/ReplicationList';
import { ReplicationTargetList } from './components/ReplicationTargetList';
import { ScheduleButton } from './components/ScheduleForm';
import { ScheduleList } from './components/ScheduleList';
import { SnapshotAndReplicateButton } from './components/SnapshotAndReplicate';
import { SnapshotList } from './components/SnapshotList';

// Soften Headlamp's core cluster-error banner into a tidy floating toast.
applyUiTweaks();

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

registerSidebarEntry({
  parent: 'ndk',
  name: 'ndk-schedules',
  label: 'Schedules',
  url: '/ndk/schedules',
});

registerRoute({
  path: '/ndk/schedules',
  sidebar: 'ndk-schedules',
  name: 'ndk-schedules',
  exact: true,
  component: () => (
    <SectionBox title="Snapshot Schedules">
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <ScheduleButton />
      </Box>
      <ScheduleList />
    </SectionBox>
  ),
});

registerSidebarEntry({
  parent: 'ndk',
  name: 'ndk-replication-targets',
  label: 'Replication Targets',
  url: '/ndk/replication-targets',
});

registerRoute({
  path: '/ndk/replication-targets',
  sidebar: 'ndk-replication-targets',
  name: 'ndk-replication-targets',
  exact: true,
  component: () => (
    <SectionBox title="Replication Targets">
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <CreateReplicationTargetButton />
      </Box>
      <Typography color="textSecondary" variant="body2" sx={{ mb: 2 }}>
        A replication target is the per-namespace destination snapshots replicate to. Create one for
        each namespace + remote cluster you want to replicate to.
      </Typography>
      <ReplicationTargetList title="All replication targets" />
    </SectionBox>
  ),
});

registerAppBarAction(<AddClusterButton />);

// Always shown. When NDK is already installed, the in-cluster install action is
// disabled inside the dialog (the form still opens for script generation/review).
registerAppBarAction(<InstallNdkButton />);

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
            <ScheduleButton
              application={resource.getName()}
              namespace={resource.getNamespace()}
              variant="outlined"
            />
            <CreateReplicationTargetButton
              namespace={resource.getNamespace()}
              variant="outlined"
            />
            <Typography color="textSecondary" variant="body2">
              Take a manual snapshot of this application, replicate it, schedule recurring snapshots,
              or set up a replication target for this namespace.
            </Typography>
          </Box>
        </SectionBox>
        <SnapshotList
          namespace={resource.getNamespace()}
          application={resource.getName()}
          title="Application snapshots"
        />
        <ReplicationList namespace={resource.getNamespace()} title="Replication tasks" />
        <ReplicationTargetList
          namespace={resource.getNamespace()}
          title="Replication targets"
        />
        <ScheduleList
          namespace={resource.getNamespace()}
          application={resource.getName()}
          title="Snapshot schedules"
        />
      </>
    );
  }
  return null;
});
