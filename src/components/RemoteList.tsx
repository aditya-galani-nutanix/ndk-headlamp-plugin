// Owner: P1 — a live table of Remotes (the cluster-scoped peer registrations).
//
// A Remote registers a peer cluster's NDK service (ndk-intercom-service) so this
// cluster can replicate to it. It is cluster-scoped: one Remote per peer, shared
// by every namespace's ReplicationTargets. The controller marks it Available
// only once it can reach and authenticate to the peer's NDK service.
import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Tooltip } from '@mui/material';
import { RemoteClass } from '../api/ndk-resources';
import type { RemoteStatus } from '../api/types';
import { formatAge, remoteIsAvailable, remoteUnavailableReason } from '../utils/helpers';

export interface RemoteListProps {
  title?: string;
}

function AvailabilityChip({ status }: { status?: RemoteStatus }) {
  if (remoteIsAvailable(status)) {
    return <Chip size="small" color="success" label="Available" />;
  }
  return (
    <Tooltip title={remoteUnavailableReason(status)}>
      <Chip size="small" color="warning" label="Not ready" />
    </Tooltip>
  );
}

export function RemoteList({ title = 'Remotes' }: RemoteListProps) {
  const [remotes] = RemoteClass.useList();

  return (
    <SectionBox title={title}>
      <SimpleTable
        emptyMessage="No remotes yet. Register a peer cluster to replicate to."
        columns={[
          { label: 'Name', getter: (r: any) => r.metadata.name, sort: true },
          {
            label: 'Service IP',
            getter: (r: any) => r.jsonData?.spec?.ndkServiceIp ?? '—',
            sort: true,
          },
          { label: 'Port', getter: (r: any) => r.jsonData?.spec?.ndkServicePort ?? 2021 },
          {
            label: 'Remote cluster',
            getter: (r: any) => r.jsonData?.spec?.clusterName ?? '—',
          },
          {
            label: 'Status',
            getter: (r: any) => (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AvailabilityChip status={r.jsonData?.status} />
              </Box>
            ),
          },
          {
            label: 'Age',
            getter: (r: any) => formatAge(r.metadata.creationTimestamp),
            sort: (a: any, b: any) =>
              new Date(a.metadata.creationTimestamp ?? 0).getTime() -
              new Date(b.metadata.creationTimestamp ?? 0).getTime(),
          },
        ]}
        data={remotes}
        defaultSortingColumn={5}
      />
    </SectionBox>
  );
}
