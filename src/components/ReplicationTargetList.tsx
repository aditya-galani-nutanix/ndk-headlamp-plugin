// Owner: P2/P3 — a live table of ReplicationTargets (the replication
// "destinations") in a namespace, or cluster-wide. Shows the Remote each target
// points at, the remote namespace replicas land in, and whether the target is
// Available (the controller marks it ready only once the Remote is healthy).
import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Tooltip } from '@mui/material';
import { ReplicationTargetClass } from '../api/ndk-resources';
import type { ReplicationTargetStatus } from '../api/types';
import { formatAge, targetIsAvailable, targetUnavailableReason } from '../utils/helpers';
import { DeleteReplicationTargetButton } from './DeleteReplicationTargetDialog';

export interface ReplicationTargetListProps {
  /** Limit to a namespace (e.g. an Application detail view). Omit for all. */
  namespace?: string;
  title?: string;
  /** View-only: hide the per-row delete action, e.g. on Overview. */
  readOnly?: boolean;
}

function AvailabilityChip({ status }: { status?: ReplicationTargetStatus }) {
  if (targetIsAvailable(status)) {
    return <Chip size="small" color="success" label="Available" />;
  }
  return (
    <Tooltip title={targetUnavailableReason(status)}>
      <Chip size="small" color="warning" label="Not ready" />
    </Tooltip>
  );
}

export function ReplicationTargetList({
  namespace,
  title = 'Replication targets',
  readOnly = false,
}: ReplicationTargetListProps) {
  const [targets] = ReplicationTargetClass.useList(namespace ? { namespace } : {});

  return (
    <SectionBox title={title}>
      <SimpleTable
        emptyMessage="No replication targets yet."
        columns={[
          { label: 'Name', getter: (t: any) => t.metadata.name, sort: true },
          { label: 'Namespace', getter: (t: any) => t.metadata.namespace ?? '—', sort: true },
          { label: 'Remote', getter: (t: any) => t.jsonData?.spec?.remoteName ?? '—', sort: true },
          {
            label: 'Remote namespace',
            getter: (t: any) => t.jsonData?.spec?.namespaceName ?? 'default',
          },
          {
            label: 'Status',
            getter: (t: any) => (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AvailabilityChip status={t.jsonData?.status} />
              </Box>
            ),
          },
          {
            label: 'Age',
            getter: (t: any) => formatAge(t.metadata.creationTimestamp),
            sort: (a: any, b: any) =>
              new Date(a.metadata.creationTimestamp ?? 0).getTime() -
              new Date(b.metadata.creationTimestamp ?? 0).getTime(),
          },
          ...(readOnly
            ? []
            : [
                {
                  label: 'Actions',
                  getter: (t: any) => (
                    <DeleteReplicationTargetButton
                      name={t.metadata.name}
                      namespace={t.metadata.namespace}
                      remoteName={t.jsonData?.spec?.remoteName}
                    />
                  ),
                },
              ]),
        ]}
        data={targets}
        defaultSortingColumn={5}
      />
    </SectionBox>
  );
}
