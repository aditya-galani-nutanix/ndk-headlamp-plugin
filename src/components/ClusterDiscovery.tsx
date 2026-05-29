// Owner: P1 — AppBar chip showing discovered NDK peer clusters.
import { useEffect, useState } from 'react';
import { Chip, Tooltip } from '@mui/material';
import { discoverPeers, DiscoveredPeer } from '../api/cluster-discovery';

export function ClusterDiscoveryChip() {
  const [peers, setPeers] = useState<DiscoveredPeer[]>([]);

  useEffect(() => {
    let active = true;
    discoverPeers().then(found => {
      if (active) {
        setPeers(found);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const label = `NDK: ${peers.length} peer${peers.length === 1 ? '' : 's'}`;
  const tooltip = peers.length ? peers.map(p => p.name).join(', ') : 'No NDK peers discovered yet';

  return (
    <Tooltip title={tooltip}>
      <Chip size="small" color="primary" variant="outlined" label={label} />
    </Tooltip>
  );
}
