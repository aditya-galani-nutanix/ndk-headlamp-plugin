// Owner: P2 — merged Snapshot-and-Replicate workflow with progress stepper (hero feature).
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Typography } from '@mui/material';

export function SnapshotAndReplicate() {
  // TODO(P2): create ApplicationSnapshot -> wait readyToUse ->
  // create ApplicationSnapshotReplication -> stepper UI.
  return (
    <SectionBox title="Snapshot & Replicate">
      <Typography color="textSecondary">P2: Snapshot &amp; Replicate workflow goes here.</Typography>
    </SectionBox>
  );
}
