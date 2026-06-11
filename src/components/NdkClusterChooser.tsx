// Owner: P1 — replacement for Headlamp's built-in cluster-name button.
//
// Headlamp already renders a button showing the current cluster that, when
// clicked, opens the native cluster-switch popup. Rather than add a *second*
// switcher next to it, we replace that button (via registerClusterChooser) with
// a tidier one that makes its "this is a dropdown" affordance explicit: the
// cluster name plus a chevron. `clickHandler` still opens Headlamp's own popup,
// so all the actual switching logic is reused.
import { Icon } from '@iconify/react';
import type { ClusterChooserProps } from '@kinvolk/headlamp-plugin/lib';
import { Box, Button, Tooltip } from '@mui/material';

export function NdkClusterChooser({ clickHandler, cluster }: ClusterChooserProps) {
  // No active cluster (e.g. the home / cluster-list screen): nothing to show.
  if (!cluster) {
    return null;
  }

  return (
    <Tooltip title="Switch cluster">
      <Button
        color="inherit"
        size="small"
        onClick={clickHandler}
        startIcon={<Icon icon="mdi:kubernetes" />}
        endIcon={<Icon icon="mdi:chevron-down" />}
        sx={{ textTransform: 'none', fontWeight: 600, maxWidth: 260 }}
      >
        <Box
          component="span"
          sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {cluster}
        </Box>
      </Button>
    </Tooltip>
  );
}
