// Owner: P4 — Schedule form (recurring snapshots via JobScheduler CRD).
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Typography } from '@mui/material';

export function ScheduleForm() {
  // TODO(P4): form (Application, frequency/cron, expiry, target) -> JobSchedulerClass create.
  return (
    <SectionBox title="Create Schedule">
      <Typography color="textSecondary">P4: Schedule form goes here.</Typography>
    </SectionBox>
  );
}
