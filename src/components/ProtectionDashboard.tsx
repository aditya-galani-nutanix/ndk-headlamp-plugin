// Owner: P1 — landing page for the plugin at /ndk.
// Shows live summary cards. Each owner links their feature in here as it lands.
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Card, CardContent, Typography } from '@mui/material';
import {
  ApplicationClass,
  ApplicationSnapshotClass,
  ApplicationSnapshotReplicationClass,
  JobSchedulerClass,
} from '../api/ndk-resources';
import { replicationState, snapshotState } from '../utils/helpers';
import { ApplicationList } from './ApplicationList';
import { InstallNdkButton, useNdkInstalled } from './InstallNdkButton';
import { ReplicationList } from './ReplicationList';
import { ScheduleButton } from './ScheduleForm';
import { ScheduleList } from './ScheduleList';
import { SnapshotAndReplicateButton } from './SnapshotAndReplicate';
import { SnapshotList } from './SnapshotList';

function SummaryCard({ title, value }: { title: string; value: string | number }) {
  return (
    <Card variant="outlined" sx={{ minWidth: 160 }}>
      <CardContent>
        <Typography variant="h4">{value}</Typography>
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

  return (
    <SectionBox title="NDK Data Protection">
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mb: 2 }}>
        <ScheduleButton variant="outlined" />
      </Box>
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
              <Typography variant="h6">NDK is not installed or not ready on this cluster</Typography>
              <Typography color="textSecondary" variant="body2">
                Install (or re-run setup to recover) the CSI prerequisites and NDK to start
                protecting applications.
              </Typography>
            </Box>
            <InstallNdkButton />
          </CardContent>
        </Card>
      )}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <SnapshotAndReplicateButton />
      </Box>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <SummaryCard title="Applications" value={(applications ?? []).length} />
        <SummaryCard title="Snapshots" value={snaps.length} />
        <SummaryCard title="Ready" value={ready} />
        <SummaryCard title="Failed" value={failed} />
        <SummaryCard title="Replications" value={repls.length} />
        <SummaryCard title="Replicating" value={replicating} />
        <SummaryCard title="Blocked" value={blocked} />
        <SummaryCard title="Schedules" value={(schedules ?? []).length} />
      </Box>
      <ApplicationList />
      <SnapshotList />
      <ReplicationList />
      <ScheduleList />
    </SectionBox>
  );
}
