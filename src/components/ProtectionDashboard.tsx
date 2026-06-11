// Owner: P1 — Overview landing page for the plugin at /ndk.
//
// A read-only, at-a-glance summary: install state and headline counts. All
// create/manage actions and the full per-resource tables live on their own
// subsection pages (Applications, Snapshots, Replications, Remotes, Replication
// Targets, Schedules).
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Card, CardContent, CircularProgress, Typography } from '@mui/material';
import {
  ApplicationClass,
  ApplicationSnapshotClass,
  ApplicationSnapshotReplicationClass,
  JobSchedulerClass,
} from '../api/ndk-resources';
import { replicationState, snapshotState } from '../utils/helpers';
import { ApplicationList } from './ApplicationList';
import { InstallNdkButton, useNdkInstalled } from './InstallNdkButton';
import { RemoteList } from './RemoteList';
import { ReplicationList } from './ReplicationList';
import { ReplicationTargetList } from './ReplicationTargetList';
import { ScheduleList } from './ScheduleList';
import { SnapshotList } from './SnapshotList';

function SummaryCard({
  title,
  value,
  color,
}: {
  title: string;
  value: string | number;
  color?: string;
}) {
  return (
    <Card variant="outlined" sx={{ minWidth: 150, flex: '1 1 150px', maxWidth: 220 }}>
      <CardContent>
        <Typography variant="h4" sx={{ color }}>
          {value}
        </Typography>
        <Typography color="textSecondary" variant="body2">
          {title}
        </Typography>
      </CardContent>
    </Card>
  );
}

export function ProtectionDashboard() {
  const ndkInstalled = useNdkInstalled();
  const [applications] = ApplicationClass.useList();
  const [snapshots] = ApplicationSnapshotClass.useList();
  const [replications] = ApplicationSnapshotReplicationClass.useList();
  const [schedules] = JobSchedulerClass.useList();

  const snaps = snapshots ?? [];
  const ready = snaps.filter(s => snapshotState((s.jsonData as any)?.status) === 'ready').length;
  const failed = snaps.filter(s => snapshotState((s.jsonData as any)?.status) === 'error').length;

  const repls = replications ?? [];
  const replicating = repls.filter(
    r => replicationState((r.jsonData as any)?.status) === 'progressing'
  ).length;
  const blocked = repls.filter(
    r => replicationState((r.jsonData as any)?.status) === 'blocked'
  ).length;

  // While the first round of resource lists is still in flight, every list is
  // null. Show one calm spinner instead of a wall of "0" cards that pop to real
  // numbers a moment later.
  const loadingSummary =
    applications === null && snapshots === null && replications === null && schedules === null;

  return (
    <SectionBox title="Overview">
      {ndkInstalled === false && (
        <Card variant="outlined" sx={{ mb: 2, borderColor: 'warning.main' }}>
          <CardContent
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              flexWrap: 'wrap',
            }}
          >
            <Box>
              <Typography variant="h6">
                NDK is not installed or not ready on this cluster
              </Typography>
              <Typography color="textSecondary" variant="body2">
                Install (or re-run setup to recover) the CSI prerequisites and NDK to start
                protecting applications.
              </Typography>
            </Box>
            <InstallNdkButton />
          </CardContent>
        </Card>
      )}

      {loadingSummary ? (
        <Box
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, py: 6 }}
        >
          <CircularProgress size={26} />
          <Typography color="textSecondary" variant="body2">
            Loading protection data…
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <SummaryCard title="Applications" value={(applications ?? []).length} />
          <SummaryCard title="Snapshots" value={snaps.length} />
          <SummaryCard title="Ready" value={ready} color="success.main" />
          <SummaryCard title="Failed" value={failed} color={failed ? 'error.main' : undefined} />
          <SummaryCard title="Replications" value={repls.length} />
          <SummaryCard title="Replicating" value={replicating} color="info.main" />
          <SummaryCard
            title="Blocked"
            value={blocked}
            color={blocked ? 'warning.main' : undefined}
          />
          <SummaryCard title="Schedules" value={(schedules ?? []).length} />
        </Box>
      )}

      <Typography color="textSecondary" variant="body2" sx={{ mt: 3, mb: 1 }}>
        Everything protected on this cluster, at a glance. Open a section in the sidebar to create
        or manage these resources.
      </Typography>

      <ApplicationList readOnly />
      <SnapshotList readOnly />
      <ReplicationList />
      <ReplicationTargetList readOnly />
      <RemoteList />
      <ScheduleList readOnly />
    </SectionBox>
  );
}
