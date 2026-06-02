// Owner: P3 — confirm + perform a safe, cascading snapshot delete.
//
// Deleting an ApplicationSnapshot is not a single DELETE: NDK does not own the
// ApplicationSnapshotReplication (ASR) objects, and each ASR holds a finalizer on
// the snapshot. We therefore delete the referencing ASRs first (so their
// finalizer cleanup runs) and then the snapshot, whose controller garbage-collects
// the bound ApplicationSnapshotContent + volume snapshots. See deleteSnapshotCascade.
import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { deleteSnapshotCascade } from '../api/ndk-actions';

function errMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }
  if (typeof e === 'string') {
    return e;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export interface DeleteSnapshotDialogProps {
  snapshotName: string;
  namespace: string;
  /** Names of ApplicationSnapshotReplication CRs that will be cascade-deleted. */
  replicationNames: string[];
  onClose: () => void;
}

export function DeleteSnapshotDialog({
  snapshotName,
  namespace,
  replicationNames,
  onClose,
}: DeleteSnapshotDialogProps) {
  const [phase, setPhase] = useState<'idle' | 'deleting' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const replCount = replicationNames.length;

  async function handleDelete() {
    setPhase('deleting');
    setError(null);
    try {
      await deleteSnapshotCascade({ name: snapshotName, namespace, replicationNames });
      setPhase('done');
    } catch (e) {
      setError(errMessage(e));
      setPhase('idle');
    }
  }

  return (
    <Dialog open onClose={phase === 'deleting' ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Delete snapshot</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
          {namespace} / {snapshotName}
        </Typography>

        {phase === 'done' ? (
          <Alert severity="success">
            Deletion requested. The snapshot{replCount > 0 ? ' and its replications' : ''} will be
            removed once the NDK controllers finish cleaning up the underlying snapshot content and
            volume snapshots on the storage backend.
            {replCount > 0 &&
              ' Any copy already replicated to a remote cluster is kept as a separate recovery point.'}
          </Alert>
        ) : (
          <Stack spacing={2}>
            <Typography variant="body2">
              This permanently deletes the snapshot and its captured data (the application
              configuration and the volume snapshots on the storage backend). This cannot be undone.
            </Typography>

            {replCount > 0 ? (
              <Alert severity="warning">
                <Typography variant="body2" sx={{ mb: 1 }}>
                  This snapshot has {replCount} replication{replCount > 1 ? 's' : ''} on this
                  cluster that must be removed first (NDK does not delete them automatically, and
                  they block the snapshot's deletion). These will be deleted too:
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                  {replicationNames.map(n => (
                    <Chip key={n} size="small" label={n} />
                  ))}
                </Box>
                <Typography variant="caption" color="textSecondary">
                  Note: this only removes the replication relationship here. The copy already
                  replicated to the remote cluster is an independent recovery point and is{' '}
                  <b>not</b> deleted — remove it from the remote cluster if you no longer need it.
                </Typography>
              </Alert>
            ) : (
              <Alert severity="info">This snapshot has no replications to clean up.</Alert>
            )}

            {error && <Alert severity="error">{error}</Alert>}
            {phase === 'deleting' && <LinearProgress />}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {phase === 'done' ? (
          <Button variant="contained" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={phase === 'deleting'}>
              Cancel
            </Button>
            <Button
              variant="contained"
              color="error"
              onClick={handleDelete}
              disabled={phase === 'deleting'}
              startIcon={<Icon icon="mdi:delete" />}
            >
              {replCount > 0
                ? `Delete snapshot + ${replCount} replication${replCount > 1 ? 's' : ''}`
                : 'Delete snapshot'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
