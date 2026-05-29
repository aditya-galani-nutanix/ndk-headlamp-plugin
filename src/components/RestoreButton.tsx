// Owner: P3 — smart restore (enable only for replicated snapshots) + RestoreButton.
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Typography } from '@mui/material';

export function RestoreButton() {
  // TODO(P3): confirm dialog -> ApplicationSnapshotRestoreClass create -> watch status.
  return (
    <SectionBox title="Restore">
      <Typography color="textSecondary">P3: Restore action goes here.</Typography>
    </SectionBox>
  );
}
