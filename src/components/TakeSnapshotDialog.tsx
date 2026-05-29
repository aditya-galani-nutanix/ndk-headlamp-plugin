// Owner: P2 — Take Snapshot dialog (Application dropdown, expiry, CR creation).
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Typography } from '@mui/material';

export function TakeSnapshotDialog() {
  // TODO(P2): MUI dialog -> ApplicationSnapshotClass.apiEndpoint.post(manifest),
  // then watch status.readyToUse.
  return (
    <SectionBox title="Take Snapshot">
      <Typography color="textSecondary">P2: Take Snapshot dialog goes here.</Typography>
    </SectionBox>
  );
}
