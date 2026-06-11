// Owner: P3 — Snapshot List view with status badges + live K8s watch.
//
// Renders a live table of ApplicationSnapshot objects (optionally scoped to a
// namespace and/or application) so users can see what snapshots exist, whether
// they are ready, and how many replications each one has.
import { Icon } from '@iconify/react';
import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Button, Chip, IconButton, Link, Stack, Tooltip } from '@mui/material';
import { useState } from 'react';
import {
  ApplicationSnapshotClass,
  ApplicationSnapshotReplicationClass,
  ApplicationSnapshotRestoreClass,
} from '../api/ndk-resources';
import type { ApplicationSnapshotStatus } from '../api/types';
import {
  aggregateRestoreState,
  formatAge,
  isRestorableSnapshot,
  replicationsForSnapshot,
  replicationState,
  snapshotErrorMessage,
  snapshotState,
} from '../utils/helpers';
import { DeleteSnapshotDialog } from './DeleteSnapshotDialog';
import { ReplicateSnapshotDialog } from './ReplicateSnapshotDialog';
import { RestoreButton } from './RestoreButton';
import { SnapshotDetailsDialog } from './SnapshotDetailsDialog';

export interface SnapshotListProps {
  /** Scope the list to a single namespace. */
  namespace?: string;
  /** Scope the list to a single application (matches spec.source.applicationRef.name). */
  application?: string;
  title?: string;
  /** View-only: hide per-row actions (restore/replicate/delete), e.g. on Overview. */
  readOnly?: boolean;
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

export function SnapshotList({
  namespace,
  application,
  title = 'Snapshots',
  readOnly = false,
}: SnapshotListProps) {
  const [snapshots] = ApplicationSnapshotClass.useList(namespace ? { namespace } : {});
  const [replications] = ApplicationSnapshotReplicationClass.useList(
    namespace ? { namespace } : {}
  );
  const [restores] = ApplicationSnapshotRestoreClass.useList(namespace ? { namespace } : {});
  const [replicateFor, setReplicateFor] = useState<{ name: string; namespace: string } | null>(
    null
  );
  const [detailsFor, setDetailsFor] = useState<any | null>(null);
  const [deleteFor, setDeleteFor] = useState<{
    name: string;
    namespace: string;
    replicationNames: string[];
  } | null>(null);

  const data =
    snapshots === null
      ? null
      : snapshots.filter(
          s => !application || s.jsonData?.spec?.source?.applicationRef?.name === application
        );

  // Match a snapshot's replications on the compound (namespace + name) key, not
  // name alone: this list can be cluster-wide (the dashboard renders SnapshotList
  // unscoped) and snapshot names can collide across namespaces. Feeds both the
  // replication summary and the delete cascade.
  function replicationsFor(snapshotName: string, snapshotNamespace?: string) {
    return replicationsForSnapshot(replications, snapshotName, snapshotNamespace);
  }

  function replicationSummary(snapshotName: string, snapshotNamespace?: string): string {
    const list = replicationsFor(snapshotName, snapshotNamespace);
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
            {
              label: 'Name',
              getter: (s: any) => (
                <Link
                  component="button"
                  type="button"
                  underline="hover"
                  sx={{ textAlign: 'left' }}
                  onClick={() => setDetailsFor(s.jsonData)}
                >
                  {s.metadata.name}
                </Link>
              ),
              sort: (a: any, b: any) =>
                String(a.metadata.name).localeCompare(String(b.metadata.name)),
            },
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
              getter: (s: any) => replicationSummary(s.metadata.name, s.metadata.namespace),
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
            ...(readOnly
              ? []
              : [
                  {
                    label: '',
                    gridTemplate: 'max-content',
                    cellProps: { sx: { whiteSpace: 'nowrap' } },
                    getter: (s: any) => {
                      const ready = snapshotState(s.jsonData?.status) === 'ready';
                      const ns = s.metadata.namespace ?? '';
                      return (
                        <Stack
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          sx={{ flexWrap: 'nowrap' }}
                        >
                          <RestoreButton
                            snapshotName={s.metadata.name}
                            namespace={ns}
                            restorable={isRestorableSnapshot(s.jsonData)}
                            existingRestoreState={aggregateRestoreState(
                              restores,
                              s.metadata.name,
                              s.metadata.namespace
                            )}
                          />
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
                                  setReplicateFor({ name: s.metadata.name, namespace: ns })
                                }
                              >
                                Replicate
                              </Button>
                            </span>
                          </Tooltip>
                          <Tooltip title="Delete snapshot (and its replications)">
                            <IconButton
                              size="small"
                              color="error"
                              aria-label="Delete snapshot"
                              onClick={() =>
                                setDeleteFor({
                                  name: s.metadata.name,
                                  namespace: ns,
                                  replicationNames: replicationsFor(
                                    s.metadata.name,
                                    s.metadata.namespace
                                  ).map(r => r.metadata.name),
                                })
                              }
                            >
                              <Icon icon="mdi:delete" width={20} />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      );
                    },
                  },
                ]),
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
      {detailsFor && (
        <SnapshotDetailsDialog snapshot={detailsFor} onClose={() => setDetailsFor(null)} />
      )}
      {deleteFor && (
        <DeleteSnapshotDialog
          snapshotName={deleteFor.name}
          namespace={deleteFor.namespace}
          replicationNames={deleteFor.replicationNames}
          onClose={() => setDeleteFor(null)}
        />
      )}
    </>
  );
}
