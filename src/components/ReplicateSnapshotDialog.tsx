// Owner: P2/P3 — replicate an EXISTING ApplicationSnapshot to additional
// clusters (Remotes). The snapshot already exists, so we skip the snapshot step
// and, for each chosen Remote, ensure a namespace-local ReplicationTarget exists
// (creating one if needed) and then create an ApplicationSnapshotReplication.
// Remotes the snapshot is already replicated to are disabled in the picker.
import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  LinearProgress,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { ensureReplicationTarget, replicateSnapshot } from '../api/ndk-actions';
import {
  ApplicationSnapshotReplicationClass,
  RemoteClass,
  ReplicationTargetClass,
} from '../api/ndk-resources';
import type { ApplicationSnapshotReplicationStatus, RemoteStatus } from '../api/types';
import {
  makeReplicationName,
  remoteIsAvailable,
  remoteUnavailableReason,
  replicationMessage,
  type ReplicationState,
  replicationState,
} from '../utils/helpers';
import { ReplicationRow, type ReplicationRowData } from './SnapshotAndReplicate';

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

interface CreatedReplication {
  /** Remote (cluster) name, used as the display label. */
  remote: string;
  /** ApplicationSnapshotReplication metadata.name, used to watch progress. */
  name: string;
}

export interface ReplicateSnapshotDialogProps {
  snapshotName: string;
  namespace: string;
  onClose: () => void;
}

export function ReplicateSnapshotDialog({
  snapshotName,
  namespace,
  onClose,
}: ReplicateSnapshotDialogProps) {
  const [remotesList] = RemoteClass.useList();
  const [existingTargets] = ReplicationTargetClass.useList({ namespace });
  const [replications] = ApplicationSnapshotReplicationClass.useList({ namespace });

  const [selected, setSelected] = useState<string[]>([]);
  const [started, setStarted] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'replicating' | 'done'>('idle');
  const [created, setCreated] = useState<CreatedReplication[]>([]);
  const [postErrors, setPostErrors] = useState<Record<string, string>>({});

  // For this snapshot, map each Remote -> the states of its existing
  // replications (resolved via the ReplicationTarget the replication points at).
  const statesByRemote = useMemo(() => {
    const targetToRemote = new Map<string, string>();
    (existingTargets ?? []).forEach(t => {
      const remote = t.jsonData?.spec?.remoteName as string | undefined;
      if (remote) {
        targetToRemote.set(t.metadata.name, remote);
      }
    });
    const m = new Map<string, ReplicationState[]>();
    (replications ?? [])
      .filter(r => r.jsonData?.spec?.applicationSnapshotName === snapshotName)
      .forEach(r => {
        const targetName = r.jsonData?.spec?.replicationTargetName as string | undefined;
        const remote = targetName ? targetToRemote.get(targetName) : undefined;
        if (!remote) {
          return;
        }
        const arr = m.get(remote) ?? [];
        arr.push(replicationState(r.jsonData?.status as ApplicationSnapshotReplicationStatus));
        m.set(remote, arr);
      });
    return m;
  }, [existingTargets, replications, snapshotName]);

  // "Already replicated" = a non-failed replication to that Remote exists, so we
  // block re-selecting it; a Remote whose only attempts failed stays selectable.
  const remoteOptions = useMemo(
    () =>
      (remotesList ?? []).map(r => {
        const status = r.jsonData?.status as RemoteStatus | undefined;
        const states = statesByRemote.get(r.metadata.name) ?? [];
        const hasAvailable = states.includes('available');
        const already = states.some(s => s !== 'error');
        const retryable = !already && states.length > 0;
        const available = remoteIsAvailable(status);
        const address = (r.jsonData?.spec?.ndkServiceIp as string | undefined) ?? '';
        let secondary: string;
        if (already) {
          secondary = hasAvailable ? 'Already replicated' : 'Replication already in progress';
        } else if (!available) {
          secondary = remoteUnavailableReason(status);
        } else if (retryable) {
          secondary = 'Previous attempt failed — retry';
        } else {
          secondary = address || 'Available';
        }
        return {
          name: r.metadata.name,
          disabled: already || !available,
          secondary,
        };
      }),
    [remotesList, statesByRemote]
  );

  const selectableCount = remoteOptions.filter(r => !r.disabled).length;

  async function handleReplicate() {
    setStarted(true);
    setPhase('replicating');
    const existing = (existingTargets ?? []).map(t => ({
      name: t.metadata.name,
      remoteName: t.jsonData?.spec?.remoteName as string | undefined,
    }));
    const ok: CreatedReplication[] = [];
    const errs: Record<string, string> = {};
    for (const remote of selected) {
      try {
        const targetName = await ensureReplicationTarget(remote, namespace, existing);
        const name = makeReplicationName(snapshotName, targetName);
        await replicateSnapshot({
          name,
          namespace,
          applicationSnapshotName: snapshotName,
          replicationTargetName: targetName,
        });
        ok.push({ remote, name });
      } catch (e) {
        errs[remote] = errMessage(e);
      }
    }
    setCreated(ok);
    setPostErrors(errs);
    if (ok.length === 0) {
      setPhase('done');
    }
  }

  const rows: ReplicationRowData[] = useMemo(() => {
    const live = created.map(c => {
      const obj = (replications ?? []).find(r => r.metadata.name === c.name);
      const status = obj?.jsonData?.status as ApplicationSnapshotReplicationStatus | undefined;
      return {
        target: c.remote,
        name: c.name,
        state: replicationState(status),
        percent: status?.replicationCompletionPercent ?? 0,
        message: replicationMessage(status),
      };
    });
    const failed: ReplicationRowData[] = Object.keys(postErrors).map(remote => ({
      target: remote,
      name: '',
      state: 'error',
      percent: 0,
      message: postErrors[remote],
    }));
    return [...live, ...failed];
  }, [created, replications, postErrors]);

  const liveStateKey = rows
    .filter(r => r.name)
    .map(r => r.state)
    .join(',');
  useEffect(() => {
    if (phase !== 'replicating' || created.length === 0) {
      return;
    }
    const allTerminal = created.every(c => {
      const obj = (replications ?? []).find(r => r.metadata.name === c.name);
      const state = replicationState(
        obj?.jsonData?.status as ApplicationSnapshotReplicationStatus | undefined
      );
      return state === 'available' || state === 'error';
    });
    if (allTerminal) {
      setPhase('done');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, liveStateKey]);

  const total = selected.length;
  const availableCount = rows.filter(r => r.state === 'available').length;
  const errorCount = rows.filter(r => r.state === 'error').length;

  let summaryText = `Replicated to all ${total} cluster${total > 1 ? 's' : ''}.`;
  if (errorCount > 0 && availableCount === 0) {
    summaryText = `Replication failed for all ${total} cluster${total > 1 ? 's' : ''}.`;
  } else if (errorCount > 0) {
    summaryText = `Replicated to ${availableCount} of ${total} clusters; ${errorCount} failed.`;
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Replicate snapshot</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
          {namespace} / {snapshotName}
        </Typography>

        {!started ? (
          <Stack spacing={2}>
            {remotesList !== null && remoteOptions.length === 0 && (
              <Alert severity="warning">
                No remote clusters are configured. An administrator must register a Remote first.
              </Alert>
            )}
            {remoteOptions.length > 0 && selectableCount === 0 && (
              <Alert severity="info">
                This snapshot is already replicated to every available cluster.
              </Alert>
            )}
            {remoteOptions.length > 0 && (
              <FormControl fullWidth>
                <InputLabel id="repl-existing-clusters">Replicate to clusters</InputLabel>
                <Select
                  labelId="repl-existing-clusters"
                  multiple
                  value={selected}
                  onChange={e => {
                    const v = e.target.value;
                    setSelected(typeof v === 'string' ? v.split(',') : (v as string[]));
                  }}
                  input={<OutlinedInput label="Replicate to clusters" />}
                  renderValue={sel => (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {(sel as string[]).map(v => (
                        <Chip key={v} size="small" label={v} />
                      ))}
                    </Box>
                  )}
                >
                  {remoteOptions.map(r => (
                    <MenuItem key={r.name} value={r.name} disabled={r.disabled}>
                      <Checkbox checked={selected.includes(r.name)} disabled={r.disabled} />
                      <ListItemText primary={r.name} secondary={r.secondary} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            <Typography variant="caption" color="textSecondary">
              A replication target for the chosen cluster is created automatically in “{namespace}”.
            </Typography>
          </Stack>
        ) : (
          <Box>
            <Stack spacing={1.5}>
              {rows.length === 0 && phase === 'replicating' && <LinearProgress />}
              {rows.map(r => (
                <ReplicationRow key={r.target} row={r} />
              ))}
            </Stack>
            {phase === 'done' && (
              <Alert
                severity={errorCount === 0 ? 'success' : availableCount === 0 ? 'error' : 'warning'}
                sx={{ mt: 2 }}
              >
                {summaryText}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {!started && (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="contained"
              onClick={handleReplicate}
              disabled={selected.length === 0}
              startIcon={<Icon icon="mdi:content-copy" />}
            >
              Replicate
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
