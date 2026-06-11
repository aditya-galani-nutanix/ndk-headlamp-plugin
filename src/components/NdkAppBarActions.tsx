// Owner: P1 — the plugin's AppBar toolbar group.
//
// Groups the top-bar actions into one tidy, evenly-spaced row so they no longer
// hug each other: "Add cluster" and "Install NDK" (the latter disabled
// off-cluster — see the button itself). The cluster switcher lives in the
// existing cluster-name button (see NdkClusterChooser), not here, to avoid two
// controls doing the same job.
import { Stack } from '@mui/material';
import { AddClusterButton } from './AddClusterDialog';
import { InstallNdkButton } from './InstallNdkButton';

export function NdkAppBarActions() {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mr: 1 }}>
      <AddClusterButton />
      <InstallNdkButton />
    </Stack>
  );
}
