// Owner: P2/P3 (extension) — SAFELY delete a ReplicationTarget.
//
// A ReplicationTarget is namespace-local "plumbing" that other NDK resources
// finalize or reference. Verified against k8s-juno, deleting one is only safe
// once nothing in its namespace still uses it:
//   * ApplicationSnapshotReplication and AppNearSyncProtection each place a
//     finalizer on the target, so deleting it while they exist leaves it stuck
//     in Terminating — we BLOCK and tell the user to remove those first.
//   * ProtectionPlans hold no finalizer but go Degraded once their target is
//     gone — we WARN and require explicit confirmation.
// When nothing references it, the delete is a plain namespaced delete; the
// ReplicationTarget controller releases its own finalizer (tears down remote
// health monitoring) and the object is removed promptly. We never force-remove
// finalizers.
import { Icon } from '@iconify/react';
import {
  Alert,
  AlertTitle,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { deleteReplicationTarget } from '../api/ndk-actions';
import {
  ApplicationSnapshotReplicationClass,
  AppNearSyncProtectionClass,
  ProtectionPlanClass,
} from '../api/ndk-resources';
import { hasHardBlockers, replicationTargetDependents } from '../utils/helpers';

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

type Phase = 'idle' | 'deleting' | 'done' | 'error';

export interface DeleteReplicationTargetButtonProps {
  name: string;
  namespace?: string;
  /** Shown in the confirmation copy so the user knows where snapshots replicate. */
  remoteName?: string;
  variant?: 'contained' | 'outlined' | 'text';
  size?: 'small' | 'medium' | 'large';
}

export function DeleteReplicationTargetButton({
  name,
  namespace,
  remoteName,
  variant = 'outlined',
  size = 'small',
}: DeleteReplicationTargetButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        size={size}
        color="error"
        startIcon={<Icon icon="mdi:delete-outline" />}
        onClick={() => setOpen(true)}
        // The target is namespaced; without a namespace we cannot check dependents.
        disabled={!namespace}
      >
        Delete
      </Button>
      {open && namespace && (
        <DeleteReplicationTargetDialog
          name={name}
          namespace={namespace}
          remoteName={remoteName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

interface DialogProps {
  name: string;
  namespace: string;
  remoteName?: string;
  onClose: () => void;
  /** Called after a successful delete (e.g. to refresh a parent view). */
  onDeleted?: () => void;
}

/** A Headlamp useList tuple is [items|null, error|null]; loading is [null, null]. */
function isResolved<T>(items: T[] | null, error: unknown): boolean {
  return items !== null || Boolean(error);
}

export function DeleteReplicationTargetDialog({
  name,
  namespace,
  remoteName,
  onClose,
  onDeleted,
}: DialogProps) {
  // Dependents that gate the delete. ASR + ProtectionPlan CRDs are always
  // present; AppNearSyncProtection may be absent (NearSync disabled), in which
  // case useList surfaces an error and we treat it as "none" (no objects can
  // exist without the CRD).
  const [replications, replError] = ApplicationSnapshotReplicationClass.useList({ namespace });
  const [plans, planError] = ProtectionPlanClass.useList({ namespace });
  const [nsps, nspError] = AppNearSyncProtectionClass.useList({ namespace });

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const checking = !(
    isResolved(replications, replError) &&
    isResolved(plans, planError) &&
    isResolved(nsps, nspError)
  );

  const deps = useMemo(
    () =>
      replicationTargetDependents(name, namespace, {
        replications,
        protectionPlans: plans,
        nearSyncProtections: nsps,
      }),
    [name, namespace, replications, plans, nsps]
  );

  const blocked = hasHardBlockers(deps);
  const hasPlanWarning = deps.protectionPlans.length > 0;
  const done = phase === 'done';

  // Could not enumerate NearSync protections for a reason OTHER than the CRD
  // being absent — we can't fully verify, so flag it (a 404/NotFound means the
  // CRD is simply not installed, which is safe).
  const nspUnverified = Boolean(nspError) && !/not\s*found|404|could not find/i.test(errMessage(nspError));

  async function handleDelete() {
    setError(null);
    setPhase('deleting');
    try {
      await deleteReplicationTarget({ name, namespace });
      setPhase('done');
      onDeleted?.();
    } catch (e) {
      setPhase('error');
      setError(errMessage(e));
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Delete replication target</DialogTitle>
      <DialogContent dividers>
        {done ? (
          <Alert severity="success">
            Replication target “{name}” deleted from “{namespace}”.
          </Alert>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}

            <DialogContentText>
              Delete replication target <strong>{name}</strong> in namespace{' '}
              <strong>{namespace}</strong>
              {remoteName ? (
                <>
                  {' '}
                  (replicates to <strong>{remoteName}</strong>)
                </>
              ) : null}
              ?
            </DialogContentText>

            {checking && (
              <Stack spacing={1}>
                <Typography variant="body2" color="textSecondary">
                  Checking what depends on this target…
                </Typography>
                <LinearProgress />
              </Stack>
            )}

            {!checking && blocked && (
              <Alert severity="error">
                <AlertTitle>This target is in use and can’t be deleted yet</AlertTitle>
                Deleting it now would leave it stuck in <code>Terminating</code> because the
                following still hold it. Remove them first, then delete the target.
                {deps.replications.length > 0 && (
                  <>
                    <Typography variant="subtitle2" sx={{ mt: 1 }}>
                      Snapshot replications ({deps.replications.length})
                    </Typography>
                    <List dense disablePadding>
                      {deps.replications.map(n => (
                        <ListItem key={n} sx={{ py: 0 }}>
                          <ListItemText primary={n} />
                        </ListItem>
                      ))}
                    </List>
                  </>
                )}
                {deps.nearSyncProtections.length > 0 && (
                  <>
                    <Typography variant="subtitle2" sx={{ mt: 1 }}>
                      NearSync protections ({deps.nearSyncProtections.length})
                    </Typography>
                    <List dense disablePadding>
                      {deps.nearSyncProtections.map(n => (
                        <ListItem key={n} sx={{ py: 0 }}>
                          <ListItemText primary={n} />
                        </ListItem>
                      ))}
                    </List>
                  </>
                )}
              </Alert>
            )}

            {!checking && !blocked && hasPlanWarning && (
              <Alert severity="warning">
                <AlertTitle>Protection plans reference this target</AlertTitle>
                Deleting it will leave the following protection plan(s) degraded — their scheduled
                replications will fail until you point them at another target:
                <List dense disablePadding>
                  {deps.protectionPlans.map(n => (
                    <ListItem key={n} sx={{ py: 0 }}>
                      <ListItemText primary={n} />
                    </ListItem>
                  ))}
                </List>
              </Alert>
            )}

            {!checking && !blocked && !hasPlanWarning && (
              <Alert severity="info">
                Nothing in this namespace references this target, so it is safe to delete.
              </Alert>
            )}

            {!checking && nspUnverified && (
              <Typography variant="caption" color="textSecondary">
                Note: NearSync protections could not be verified ({errMessage(nspError)}). If
                NearSync DR is in use, confirm no protection references this target.
              </Typography>
            )}

            {phase === 'deleting' && <LinearProgress />}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {done ? (
          <Button variant="contained" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>{blocked ? 'Close' : 'Cancel'}</Button>
            {!blocked && (
              <Button
                variant="contained"
                color="error"
                onClick={handleDelete}
                disabled={checking || phase === 'deleting'}
              >
                Delete
              </Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
