// Owner: P2/P3 — "background tasks" view: a live table of every
// ApplicationSnapshotReplication so users can see what is replicating, what is
// done, and what is blocked/failed (with the reason, including the target's own
// health when a replication is waiting on it).
import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Tooltip, Typography } from '@mui/material';
import { ApplicationSnapshotReplicationClass, ReplicationTargetClass } from '../api/ndk-resources';
import {
  formatAge,
  replicationMessage,
  replicationState,
  targetUnavailableReason,
} from '../utils/helpers';
import { StateChip } from './SnapshotAndReplicate';

export interface ReplicationListProps {
  /** Limit to a namespace (e.g. an Application detail view). Omit for all. */
  namespace?: string;
  title?: string;
}

export function ReplicationList({ namespace, title = 'Replication tasks' }: ReplicationListProps) {
  const [replications] = ApplicationSnapshotReplicationClass.useList(
    namespace ? { namespace } : {}
  );
  const [targets] = ReplicationTargetClass.useList(namespace ? { namespace } : {});

  function targetHealth(targetName?: string, ns?: string): string {
    if (!targetName) {
      return '';
    }
    const target = (targets ?? []).find(
      t => t.metadata.name === targetName && t.metadata.namespace === ns
    );
    return target ? targetUnavailableReason(target.jsonData?.status) : '';
  }

  return (
    <SectionBox title={title}>
      <SimpleTable
        emptyMessage="No replications yet."
        columns={[
          {
            label: 'Snapshot',
            getter: (r: any) => r.jsonData?.spec?.applicationSnapshotName ?? '—',
            sort: true,
          },
          {
            label: 'Target',
            getter: (r: any) => r.jsonData?.spec?.replicationTargetName ?? '—',
            sort: true,
          },
          { label: 'Namespace', getter: (r: any) => r.metadata.namespace ?? '—', sort: true },
          {
            label: 'Status',
            getter: (r: any) => {
              const status = r.jsonData?.status;
              const state = replicationState(status);
              const pct = status?.replicationCompletionPercent ?? 0;
              return (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <StateChip state={state} />
                  {state === 'progressing' && pct > 0 && (
                    <Typography variant="caption" color="textSecondary">
                      {pct}%
                    </Typography>
                  )}
                </Box>
              );
            },
          },
          {
            label: 'Details',
            getter: (r: any) => {
              const status = r.jsonData?.status;
              const state = replicationState(status);
              const msg = replicationMessage(status);
              if (state === 'blocked') {
                const targetName = r.jsonData?.spec?.replicationTargetName;
                const health = targetHealth(targetName, r.metadata.namespace);
                const text = `${msg ?? 'Blocked'}${health ? ` — ${targetName}: ${health}` : ''}`;
                return (
                  <Tooltip title={text}>
                    <Typography
                      variant="caption"
                      color="warning.main"
                      sx={{
                        display: 'block',
                        maxWidth: 360,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {text}
                    </Typography>
                  </Tooltip>
                );
              }
              if (state === 'error') {
                return (
                  <Tooltip title={msg ?? 'Failed'}>
                    <Typography variant="caption" color="error">
                      {msg ?? 'Failed'}
                    </Typography>
                  </Tooltip>
                );
              }
              return (
                <Typography variant="caption" color="textSecondary">
                  {msg ?? '—'}
                </Typography>
              );
            },
          },
          {
            label: 'Age',
            getter: (r: any) => formatAge(r.metadata.creationTimestamp),
            sort: (a: any, b: any) =>
              new Date(a.metadata.creationTimestamp ?? 0).getTime() -
              new Date(b.metadata.creationTimestamp ?? 0).getTime(),
          },
        ]}
        data={replications}
        defaultSortingColumn={5}
      />
    </SectionBox>
  );
}
