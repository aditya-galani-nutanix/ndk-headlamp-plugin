// Owner: P3 — smart restore. The Restore button is enabled only for snapshots
// that were replicated INTO this cluster (they carry REPLICATED_IN_ANNOTATION);
// locally-created snapshots show it disabled with an explanatory tooltip.
//
// Clicking it opens a centered confirmation dialog; confirming creates an
// ApplicationSnapshotRestore CR and then watches its status live, showing an
// animated progress bar + a status message that updates as the restore advances
// (Prechecks -> Volumes -> App config -> Finalize). A snapshot can be restored
// only once: once a restore has succeeded (or is in progress) the button is
// disabled with an explanatory tooltip. A failed restore leaves the button
// enabled so the user can retry that still-unrestored snapshot.
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
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { createRestore } from '../api/ndk-actions';
import { ApplicationSnapshotRestoreClass } from '../api/ndk-resources';
import type { ApplicationSnapshotRestoreStatus } from '../api/types';
import { makeRestoreName, restoreMessage, type RestoreState, restoreState } from '../utils/helpers';

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

export function RestoreStateChip({ state }: { state: RestoreState }) {
  const map: Record<
    RestoreState,
    { label: string; color: 'success' | 'info' | 'error' | 'default' }
  > = {
    restored: { label: 'Restored', color: 'success' },
    restoring: { label: 'Restoring', color: 'info' },
    error: { label: 'Failed', color: 'error' },
    pending: { label: 'Pending', color: 'default' },
  };
  const c = map[state];
  return (
    <Chip
      size="small"
      label={c.label}
      color={c.color}
      variant={state === 'pending' ? 'outlined' : 'filled'}
    />
  );
}

export interface RestoreButtonProps {
  snapshotName: string;
  namespace: string;
  /** True only for snapshots replicated in from another cluster (and ready). */
  restorable: boolean;
  /**
   * Aggregate state of restores that already exist for this snapshot, if any.
   * 'restored' (already restored) and 'restoring' (in progress) disable the
   * button; a previous failure leaves it enabled so the user can retry.
   */
  existingRestoreState?: RestoreState;
}

export function RestoreButton({
  snapshotName,
  namespace,
  restorable,
  existingRestoreState,
}: RestoreButtonProps) {
  const [open, setOpen] = useState(false);

  const alreadyRestored = existingRestoreState === 'restored';
  const restoreInProgress = existingRestoreState === 'restoring';
  const disabled = !restorable || alreadyRestored || restoreInProgress;

  let tooltip: string;
  if (!restorable) {
    tooltip =
      'This snapshot was created on this cluster. Restore is available for snapshots replicated in from another cluster.';
  } else if (alreadyRestored) {
    tooltip = 'This snapshot has already been restored into this cluster.';
  } else if (restoreInProgress) {
    tooltip = 'A restore from this snapshot is already in progress.';
  } else {
    tooltip = `Restore this replicated snapshot into ${namespace}`;
  }

  return (
    <>
      <Tooltip title={tooltip}>
        <span>
          <Button
            size="small"
            variant="outlined"
            disabled={disabled}
            startIcon={<Icon icon="mdi:backup-restore" />}
            onClick={() => setOpen(true)}
          >
            Restore
          </Button>
        </span>
      </Tooltip>
      {open && (
        <RestoreDialog
          snapshotName={snapshotName}
          namespace={namespace}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

interface RestoreDialogProps {
  snapshotName: string;
  namespace: string;
  onClose: () => void;
}

function RestoreDialog({ snapshotName, namespace, onClose }: RestoreDialogProps) {
  const [started, setStarted] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'restoring' | 'done'>('idle');
  const [restoreName, setRestoreName] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Live watch: re-renders on every status change the controller writes.
  const [restores] = ApplicationSnapshotRestoreClass.useList({ namespace });

  const restoreObj = useMemo(
    () => (restoreName ? (restores ?? []).find(r => r.metadata.name === restoreName) : undefined),
    [restores, restoreName]
  );
  const status = restoreObj?.jsonData?.status as ApplicationSnapshotRestoreStatus | undefined;
  const state = restoreState(status);
  const message = restoreMessage(status);

  // Move to the terminal phase once the watched CR reports success or failure.
  useEffect(() => {
    if (phase === 'restoring' && (state === 'restored' || state === 'error')) {
      setPhase('done');
    }
  }, [phase, state]);

  async function handleRestore() {
    const name = makeRestoreName(snapshotName);
    setRestoreName(name);
    setSubmitError(null);
    setStarted(true);
    setPhase('restoring');
    try {
      await createRestore({ name, namespace, applicationSnapshotName: snapshotName });
    } catch (e) {
      setSubmitError(errMessage(e));
      setPhase('done');
    }
  }

  const failed = Boolean(submitError) || state === 'error';

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Restore snapshot</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
          {namespace} / {snapshotName}
        </Typography>

        {!started ? (
          <Stack spacing={2}>
            <Typography variant="body2">
              This recreates the application's resources from this recovery point into{' '}
              <b>{namespace}</b>. This action cannot be undone.
            </Typography>
            {submitError && <Alert severity="error">{submitError}</Alert>}
          </Stack>
        ) : (
          <Stack spacing={1.5}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <RestoreStateChip state={submitError ? 'error' : state} />
              {message && (
                <Typography variant="caption" color="textSecondary">
                  {message}
                </Typography>
              )}
            </Box>
            {phase === 'restoring' && !failed && <LinearProgress />}
            {submitError && <Alert severity="error">{submitError}</Alert>}
            {phase === 'done' && !submitError && state === 'restored' && (
              <Alert severity="success">
                Snapshot “{snapshotName}” restored successfully
                {status?.boundApplication ? ` as “${status.boundApplication}”` : ''}.
              </Alert>
            )}
            {phase === 'done' && !submitError && state === 'error' && (
              <Alert severity="error">{message ?? 'Restore failed.'}</Alert>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {!started && (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="contained"
              onClick={handleRestore}
              startIcon={<Icon icon="mdi:backup-restore" />}
            >
              Restore
            </Button>
          </>
        )}
        {started && phase !== 'done' && (
          <Button onClick={onClose}>Close (runs in background)</Button>
        )}
        {started && phase === 'done' && (
          <Button variant="contained" onClick={onClose}>
            Done
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
