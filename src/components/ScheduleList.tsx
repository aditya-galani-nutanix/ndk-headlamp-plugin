// Owner: P4 — Schedule list with pause/resume/delete + execution history.
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Typography } from '@mui/material';

export function ScheduleList() {
  // TODO(P4): JobSchedulerClass.useList() -> table with suspend toggle + delete.
  return (
    <SectionBox title="Schedules">
      <Typography color="textSecondary">P4: Schedule list goes here.</Typography>
    </SectionBox>
  );
}
