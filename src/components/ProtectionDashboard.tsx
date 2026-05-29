// Owner: P1 — landing page for the plugin at /ndk.
// Shows live summary cards. Each owner links their feature in here as it lands.
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Card, CardContent, Typography } from '@mui/material';
import {
  ApplicationSnapshotClass,
  ApplicationSnapshotReplicationClass,
  JobSchedulerClass,
} from '../api/ndk-resources';
import { snapshotState } from '../utils/helpers';

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
  const [snapshots] = ApplicationSnapshotClass.useList();
  const [replications] = ApplicationSnapshotReplicationClass.useList();
  const [schedules] = JobSchedulerClass.useList();

  const snaps = snapshots ?? [];
  const ready = snaps.filter(s => snapshotState((s.jsonData as any)?.status) === 'ready').length;
  const failed = snaps.filter(s => snapshotState((s.jsonData as any)?.status) === 'error').length;

  return (
    <SectionBox title="NDK Data Protection">
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <SummaryCard title="Snapshots" value={snaps.length} />
        <SummaryCard title="Ready" value={ready} />
        <SummaryCard title="Failed" value={failed} />
        <SummaryCard title="Replications" value={(replications ?? []).length} />
        <SummaryCard title="Schedules" value={(schedules ?? []).length} />
      </Box>
      <Typography color="textSecondary" variant="body2">
        Feature owners: P2 Snapshot &amp; Replicate · P3 Restore + List · P4 Scheduler · P1 Discovery
        + Dashboard.
      </Typography>
    </SectionBox>
  );
}
