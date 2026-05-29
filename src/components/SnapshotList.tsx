// Owner: P3 — Snapshot List view with status badges + live K8s watch.
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Typography } from '@mui/material';

export function SnapshotList() {
  // TODO(P3): ApplicationSnapshotClass.useList({ namespace }) -> SimpleTable
  // columns: Name, Application, Age, Ready, Expiry, Replicated, Actions.
  return (
    <SectionBox title="Snapshots">
      <Typography color="textSecondary">P3: Snapshot list goes here.</Typography>
    </SectionBox>
  );
}
