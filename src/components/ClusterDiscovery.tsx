// Owner: P1 — AppBar chip that triggers NDK peer auto-discovery and shows status.
// On the first render where a cluster is selected, it reads the Remote CRs on
// that cluster and registers each available peer via Headlamp.setCluster().
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useRef, useState } from 'react';
import { Chip, Tooltip } from '@mui/material';
import { discoverAndRegisterPeers, DiscoveredPeer } from '../api/cluster-discovery';

export function ClusterDiscoveryChip() {
  const cluster = K8s.useCluster();
  const [peers, setPeers] = useState<DiscoveredPeer[]>([]);
  const [running, setRunning] = useState(false);
  // Track clusters we've already run discovery against, to avoid re-registering
  // on every render / navigation.
  const discoveredFrom = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!cluster || discoveredFrom.current.has(cluster)) {
      return;
    }
    discoveredFrom.current.add(cluster);
    let active = true;
    setRunning(true);
    discoverAndRegisterPeers()
      .then(found => {
        if (active) {
          setPeers(found);
        }
      })
      .finally(() => {
        if (active) {
          setRunning(false);
        }
      });
    return () => {
      active = false;
    };
  }, [cluster]);

  // Don't show anything until we're inside a cluster and have run discovery.
  if (!cluster || (peers.length === 0 && !running)) {
    return null;
  }

  const registered = peers.filter(p => p.registered);
  const label = running ? 'NDK: discovering…' : `NDK: ${registered.length} peer${registered.length === 1 ? '' : 's'}`;

  const tooltip = peers.length
    ? peers
        .map(p =>
          p.registered
            ? `${p.name} (registered)`
            : p.ready
            ? `${p.name} (error: ${p.error ?? 'unknown'})`
            : `${p.name} (not ready)`
        )
        .join('\n')
    : 'No NDK peers discovered';

  return (
    <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tooltip}</span>}>
      <Chip
        size="small"
        color={registered.length ? 'success' : 'default'}
        variant="outlined"
        label={label}
      />
    </Tooltip>
  );
}
