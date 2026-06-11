// Owner: P2/P3 (extension) — create a ReplicationTarget so a namespace can
// replicate its snapshots to a remote cluster.
//
// A ReplicationTarget is the namespace-local "destination" that snapshot
// replication points at: it binds (this namespace) -> (a Remote cluster + a
// namespace on that remote). You need one per namespace per distinct remote
// destination; every ApplicationSnapshotReplication / ProtectionPlan in the
// namespace then references it by name. (Verified against k8s-juno: the CR is
// namespaced and the controllers resolve it in the referrer's own namespace.)
import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  LinearProgress,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { createReplicationTarget } from '../api/ndk-actions';
import { RemoteClass, ReplicationTargetClass } from '../api/ndk-resources';
import type { RemoteStatus } from '../api/types';
import {
  makeReplicationTargetName,
  remoteIsAvailable,
  remoteUnavailableReason,
  sanitizeRFC1123,
  snapshotNameFormatError,
} from '../utils/helpers';

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

type Phase = 'idle' | 'creating' | 'done' | 'error';

export interface CreateReplicationTargetButtonProps {
  /** Pre-select and lock the namespace, e.g. from an Application detail view. */
  namespace?: string;
  variant?: 'contained' | 'outlined' | 'text';
  size?: 'small' | 'medium' | 'large';
}

export function CreateReplicationTargetButton({
  namespace,
  variant = 'contained',
  size = 'small',
}: CreateReplicationTargetButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        size={size}
        startIcon={<Icon icon="mdi:target" />}
        onClick={() => setOpen(true)}
      >
        Create Replication Target
      </Button>
      {open && (
        <CreateReplicationTargetDialog fixedNamespace={namespace} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

interface DialogProps {
  /** When set, the namespace is fixed (no picker shown). */
  fixedNamespace?: string;
  onClose: () => void;
}

export function CreateReplicationTargetDialog({ fixedNamespace, onClose }: DialogProps) {
  const [namespaces] = K8s.ResourceClasses.Namespace.useList();
  const [remotesList] = RemoteClass.useList();

  const [ns, setNs] = useState(fixedNamespace ?? '');
  const [remoteName, setRemoteName] = useState('');
  const [remoteNamespace, setRemoteNamespace] = useState(fixedNamespace ?? '');
  const [remoteNsEdited, setRemoteNsEdited] = useState(false);
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [serviceAccount, setServiceAccount] = useState('');

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const [existingTargets] = ReplicationTargetClass.useList(ns ? { namespace: ns } : {});

  const nsOptions = useMemo(
    () => (namespaces ?? []).map(n => n.metadata.name).sort((a, b) => a.localeCompare(b)),
    [namespaces]
  );

  const remoteOptions = useMemo(
    () =>
      (remotesList ?? []).map(r => {
        const status = r.jsonData?.status as RemoteStatus | undefined;
        const available = remoteIsAvailable(status);
        return {
          name: r.metadata.name,
          available,
          secondary: available
            ? (r.jsonData?.spec?.ndkServiceIp as string | undefined) || 'Available'
            : remoteUnavailableReason(status),
        };
      }),
    [remotesList]
  );

  // Suggest a stable name (rt-<remote>) from the chosen remote; keep it editable.
  function applyRemote(value: string) {
    setRemoteName(value);
    if (!nameEdited) {
      setName(makeReplicationTargetName(value));
    }
  }

  // Mirror the remote namespace to the source namespace until the user edits it.
  function applyNamespace(value: string) {
    setNs(value);
    if (!remoteNsEdited) {
      setRemoteNamespace(value);
    }
  }

  const existingForRemote = useMemo(
    () =>
      remoteName
        ? (existingTargets ?? []).find(t => t.jsonData?.spec?.remoteName === remoteName)?.metadata
            ?.name
        : undefined,
    [existingTargets, remoteName]
  );

  const selectedRemoteUnavailable =
    remoteName !== '' && remoteOptions.find(r => r.name === remoteName)?.available === false;

  const nameError = snapshotNameFormatError(name);
  const formValid = Boolean(ns) && Boolean(remoteName) && !nameError && phase !== 'creating';

  async function handleCreate() {
    setError(null);
    setPhase('creating');
    try {
      await createReplicationTarget({
        name: name.trim(),
        namespace: ns,
        remoteName,
        namespaceName: remoteNamespace.trim() || undefined,
        serviceAccountName: serviceAccount.trim() || undefined,
      });
      setPhase('done');
    } catch (e) {
      setPhase('error');
      setError(errMessage(e));
    }
  }

  const done = phase === 'done';

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Create Replication Target</DialogTitle>
      <DialogContent dividers>
        {done ? (
          <Alert severity="success">
            Replication target “{name.trim()}” created in “{ns}”. Snapshots in this namespace can
            now replicate to “{remoteName}”.
          </Alert>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}

            <Typography variant="body2" color="textSecondary">
              A replication target lets a namespace replicate its snapshots to a remote cluster. It
              binds this namespace to a Remote plus a namespace on that remote. Create one per
              namespace per remote destination.
            </Typography>

            {fixedNamespace ? (
              <TextField label="Namespace" value={ns} fullWidth disabled />
            ) : namespaces === null ? (
              <Typography variant="body2" color="textSecondary">
                Loading namespaces…
              </Typography>
            ) : (
              <FormControl fullWidth>
                <InputLabel id="rt-ns-label">Namespace</InputLabel>
                <Select
                  labelId="rt-ns-label"
                  label="Namespace"
                  value={ns}
                  onChange={e => applyNamespace(String(e.target.value))}
                >
                  {nsOptions.map(n => (
                    <MenuItem key={n} value={n}>
                      <ListItemText primary={n} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {remotesList !== null && remoteOptions.length === 0 ? (
              <Alert severity="warning">
                No remote clusters are configured. An administrator must register a Remote first.
              </Alert>
            ) : (
              <FormControl fullWidth>
                <InputLabel id="rt-remote-label">Remote cluster</InputLabel>
                <Select
                  labelId="rt-remote-label"
                  label="Remote cluster"
                  value={remoteName}
                  onChange={e => applyRemote(String(e.target.value))}
                >
                  {remoteOptions.map(r => (
                    <MenuItem key={r.name} value={r.name}>
                      <ListItemText primary={r.name} secondary={r.secondary} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {existingForRemote && (
              <Alert severity="info">
                “{existingForRemote}” already targets “{remoteName}” in this namespace — you can
                reuse it for replication instead of creating another.
              </Alert>
            )}
            {selectedRemoteUnavailable && (
              <Alert severity="warning">
                This remote is not Available yet — the target stays unavailable until the remote is
                healthy.
              </Alert>
            )}

            <TextField
              label="Remote namespace"
              value={remoteNamespace}
              onChange={e => {
                setRemoteNsEdited(true);
                setRemoteNamespace(e.target.value);
              }}
              fullWidth
              helperText="Namespace on the remote cluster where replicas land (defaults to “default”)."
            />

            <TextField
              label="Replication target name"
              value={name}
              onChange={e => {
                setNameEdited(true);
                setName(e.target.value);
              }}
              onBlur={() => setName(n => sanitizeRFC1123(n))}
              fullWidth
              error={Boolean(name && nameError)}
              helperText={
                name && nameError ? nameError : 'Lowercase letters, numbers and dashes (RFC 1123).'
              }
            />

            <TextField
              label="Service account (advanced)"
              value={serviceAccount}
              onChange={e => setServiceAccount(e.target.value)}
              fullWidth
              helperText="Service account to use on the remote namespace (defaults to “default”)."
            />

            {phase === 'creating' && <LinearProgress />}
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
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="contained" onClick={handleCreate} disabled={!formValid}>
              Create
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
