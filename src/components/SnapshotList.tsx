// Owner: P3 — Snapshot List view with status badges + live K8s watch.
//
// Renders a live table of ApplicationSnapshot objects (optionally scoped to a
// namespace and/or application) so users can see what snapshots exist, whether
// they are ready, and how many replications each one has.
import { Icon } from '@iconify/react';
import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Button, Chip, Tooltip } from '@mui/material';
import { useState } from 'react';
import {
  ApplicationSnapshotClass,
  ApplicationSnapshotReplicationClass,
} from '../api/ndk-resources';
import type { ApplicationSnapshotStatus } from '../api/types';
import { formatAge, replicationState, snapshotErrorMessage, snapshotState } from '../utils/helpers';
import { ReplicateSnapshotDialog } from './ReplicateSnapshotDialog';

export interface SnapshotListProps {
  /** Scope the list to a single namespace. */
  namespace?: string;
  /** Scope the list to a single application (matches spec.source.applicationRef.name). */
  application?: string;
  title?: string;
}

function SnapshotStatusChip({ status }: { status?: ApplicationSnapshotStatus }) {
  const state = snapshotState(status);
  if (state === 'ready') {
    return <Chip size="small" color="success" label="Ready" />;
  }
  if (state === 'error') {
    return (
      <Tooltip title={snapshotErrorMessage(status) ?? 'Failed'}>
        <Chip size="small" color="error" label="Failed" />
      </Tooltip>
    );
  }
  return <Chip size="small" variant="outlined" label="Pending" />;
}

export function SnapshotList({ namespace, application, title = 'Snapshots' }: SnapshotListProps) {
  const [snapshots] = ApplicationSnapshotClass.useList(namespace ? { namespace } : {});
  const [replications] = ApplicationSnapshotReplicationClass.useList(
    namespace ? { namespace } : {}
  );
  const [replicateFor, setReplicateFor] = useState<{ name: string; namespace: string } | null>(
    null
  );

  const data =
    snapshots === null
      ? null
      : snapshots.filter(
          s => !application || s.jsonData?.spec?.source?.applicationRef?.name === application
        );

  function replicationSummary(snapshotName: string): string {
    const list = (replications ?? []).filter(
      r => r.jsonData?.spec?.applicationSnapshotName === snapshotName
    );
    if (list.length === 0) {
      return '—';
    }
    const available = list.filter(r => replicationState(r.jsonData?.status) === 'available').length;
    return `${available}/${list.length}`;
  }

  return (
    <>
      <SectionBox title={title}>
        <SimpleTable
          emptyMessage={
            application ? 'No snapshots for this application yet.' : 'No snapshots yet.'
          }
          columns={[
            { label: 'Name', getter: (s: any) => s.metadata.name, sort: true },
            { label: 'Namespace', getter: (s: any) => s.metadata.namespace ?? '—', sort: true },
            {
              label: 'Application',
              getter: (s: any) => s.jsonData?.spec?.source?.applicationRef?.name ?? '—',
              sort: true,
            },
          {
            label: 'Status',
            getter: (s: any) => <SnapshotStatusChip status={s.jsonData?.status} />,
          },
            {
              label: 'Replications',
              getter: (s: any) => replicationSummary(s.metadata.name),
            },
            {
              label: 'Expiry',
              getter: (s: any) => s.jsonData?.spec?.expiresAfter ?? '—',
            },
            {
              label: 'Age',
              getter: (s: any) => formatAge(s.metadata.creationTimestamp),
              sort: (a: any, b: any) =>
                new Date(a.metadata.creationTimestamp ?? 0).getTime() -
                new Date(b.metadata.creationTimestamp ?? 0).getTime(),
            },
            {
              label: '',
              getter: (s: any) => {
                const ready = snapshotState(s.jsonData?.status) === 'ready';
                return (
                  <Tooltip
                    title={
                      ready
                        ? 'Replicate this snapshot to another cluster'
                        : 'Available once the snapshot is ready'
                    }
                  >
                    <span>
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={!ready}
                        startIcon={<Icon icon="mdi:content-copy" />}
                        onClick={() =>
                          setReplicateFor({
                            name: s.metadata.name,
                            namespace: s.metadata.namespace ?? '',
                          })
                        }
                      >
                        Replicate
                      </Button>
                    </span>
                  </Tooltip>
                );
              },
            },
          ]}
          data={data}
          defaultSortingColumn={6}
        />
      </SectionBox>
      {replicateFor && (
        <ReplicateSnapshotDialog
          snapshotName={replicateFor.name}
          namespace={replicateFor.namespace}
          onClose={() => setReplicateFor(null)}
        />
      )}
    </>
  );
}
