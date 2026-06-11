// NDK Data Protection — Headlamp plugin entry point.
// Registers the cluster chooser, the AppBar actions, and the NDK sidebar
// section: an Overview dashboard plus a dedicated page per resource type
// (Applications, Snapshots, Replications, Replication Targets, Schedules).
import {
  type DetailsViewSectionProps,
  registerAppBarAction,
  registerClusterChooser,
  registerDetailsViewSection,
  registerRoute,
  registerSidebarEntry,
} from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Typography } from '@mui/material';
import { applyUiTweaks } from './applyUiTweaks';
import { ApplicationList } from './components/ApplicationList';
import { CreateRemoteButton } from './components/CreateRemoteDialog';
import { CreateReplicationTargetButton } from './components/CreateReplicationTargetDialog';
import { NdkAppBarActions } from './components/NdkAppBarActions';
import { NdkClusterChooser } from './components/NdkClusterChooser';
import { ProtectionDashboard } from './components/ProtectionDashboard';
import { RemoteList } from './components/RemoteList';
import { ReplicationList } from './components/ReplicationList';
import { ReplicationTargetList } from './components/ReplicationTargetList';
import { ScheduleButton } from './components/ScheduleForm';
import { ScheduleList } from './components/ScheduleList';
import { SnapshotAndReplicateButton } from './components/SnapshotAndReplicate';
import { SnapshotList } from './components/SnapshotList';

// Soften Headlamp's core cluster-error banner into a tidy floating toast.
applyUiTweaks();

// Replace the native cluster-name button with one that shows a clear dropdown
// affordance (its click still opens Headlamp's own cluster-switch popup).
registerClusterChooser(NdkClusterChooser);

// ---------------------------------------------------------------------------
// Sidebar: "NDK Data Protection" with one entry per resource type.
// ---------------------------------------------------------------------------

registerSidebarEntry({
  parent: null,
  name: 'ndk',
  label: 'NDK Data Protection',
  url: '/ndk',
  icon: 'mdi:shield-sync',
});

const SUBSECTIONS: { name: string; label: string; path: string; icon: string }[] = [
  { name: 'ndk-overview', label: 'Overview', path: '/ndk', icon: 'mdi:view-dashboard-outline' },
  {
    name: 'ndk-applications',
    label: 'Applications',
    path: '/ndk/applications',
    icon: 'mdi:cube-outline',
  },
  { name: 'ndk-snapshots', label: 'Snapshots', path: '/ndk/snapshots', icon: 'mdi:camera-outline' },
  { name: 'ndk-replications', label: 'Replications', path: '/ndk/replications', icon: 'mdi:sync' },
  { name: 'ndk-remotes', label: 'Remotes', path: '/ndk/remotes', icon: 'mdi:server-network' },
  {
    name: 'ndk-replication-targets',
    label: 'Replication Targets',
    path: '/ndk/replication-targets',
    icon: 'mdi:target',
  },
  { name: 'ndk-schedules', label: 'Schedules', path: '/ndk/schedules', icon: 'mdi:calendar-clock' },
];

SUBSECTIONS.forEach(s => {
  registerSidebarEntry({
    parent: 'ndk',
    name: s.name,
    label: s.label,
    url: s.path,
    icon: s.icon,
  });
});

// ---------------------------------------------------------------------------
// Routes — one component per subsection page.
// ---------------------------------------------------------------------------

registerRoute({
  path: '/ndk',
  sidebar: 'ndk-overview',
  name: 'ndk',
  exact: true,
  component: () => <ProtectionDashboard />,
});

registerRoute({
  path: '/ndk/applications',
  sidebar: 'ndk-applications',
  name: 'ndk-applications',
  exact: true,
  component: () => <ApplicationList title="NDK Applications" />,
});

registerRoute({
  path: '/ndk/snapshots',
  sidebar: 'ndk-snapshots',
  name: 'ndk-snapshots',
  exact: true,
  component: () => (
    <SectionBox title="Snapshots">
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <SnapshotAndReplicateButton />
      </Box>
      <Typography color="textSecondary" variant="body2" sx={{ mb: 2 }}>
        Point-in-time snapshots of your protected applications. Replicate any snapshot to a remote
        cluster, or restore it back.
      </Typography>
      <SnapshotList title="All snapshots" />
    </SectionBox>
  ),
});

registerRoute({
  path: '/ndk/replications',
  sidebar: 'ndk-replications',
  name: 'ndk-replications',
  exact: true,
  component: () => (
    <SectionBox title="Replications">
      <Typography color="textSecondary" variant="body2" sx={{ mb: 2 }}>
        Live status of every snapshot replication — what is in progress, complete, or blocked (with
        the reason, including the target's health).
      </Typography>
      <ReplicationList title="All replications" />
    </SectionBox>
  ),
});

registerRoute({
  path: '/ndk/remotes',
  sidebar: 'ndk-remotes',
  name: 'ndk-remotes',
  exact: true,
  component: () => (
    <SectionBox title="Remotes">
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <CreateRemoteButton />
      </Box>
      <Typography color="textSecondary" variant="body2" sx={{ mb: 2 }}>
        A remote is a peer cluster you replicate to. Register one per peer (pointing at its
        ndk-intercom-service), then create replication targets in your namespaces that bind to it.
      </Typography>
      <RemoteList title="All remotes" />
    </SectionBox>
  ),
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
      <Typography color="textSecondary" variant="body2" sx={{ mb: 2 }}>
        Recurring snapshot (and replication) schedules that keep your applications protected
        automatically.
      </Typography>
      <ScheduleList title="All schedules" />
    </SectionBox>
  ),
});

// ---------------------------------------------------------------------------
// AppBar actions + per-Application detail integration.
// ---------------------------------------------------------------------------

// One evenly-spaced toolbar group: "Add cluster" and "Install NDK".
registerAppBarAction(<NdkAppBarActions />);

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
            <CreateReplicationTargetButton namespace={resource.getNamespace()} variant="outlined" />
            <Typography color="textSecondary" variant="body2">
              Take a manual snapshot of this application, replicate it, schedule recurring
              snapshots, or set up a replication target for this namespace.
            </Typography>
          </Box>
        </SectionBox>
        <SnapshotList
          namespace={resource.getNamespace()}
          application={resource.getName()}
          title="Application snapshots"
        />
        <ReplicationList namespace={resource.getNamespace()} title="Replication tasks" />
        <ReplicationTargetList namespace={resource.getNamespace()} title="Replication targets" />
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
