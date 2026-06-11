// Owner: P1 — register a Remote (a peer cluster) for replication.
//
// A Remote is cluster-scoped: it points at the peer's ndk-intercom-service
// (IP + port) so this cluster can authenticate and replicate to it. One Remote
// per peer; namespaces then bind to it through ReplicationTargets. This replaces
// the old "register a remote" toggle that used to live inside the Install NDK
// dialog — registering peers is a day-2 action, not part of installation.
import { Icon } from '@iconify/react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { createRemote } from '../api/ndk-actions';
import { RemoteClass } from '../api/ndk-resources';
import { sanitizeRFC1123, snapshotNameFormatError } from '../utils/helpers';

const IPV4 = /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/;

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

export interface CreateRemoteButtonProps {
  variant?: 'contained' | 'outlined' | 'text';
  size?: 'small' | 'medium' | 'large';
}

export function CreateRemoteButton({
  variant = 'contained',
  size = 'small',
}: CreateRemoteButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        size={size}
        startIcon={<Icon icon="mdi:server-network" />}
        onClick={() => setOpen(true)}
      >
        Register Remote
      </Button>
      {open && <CreateRemoteDialog onClose={() => setOpen(false)} />}
    </>
  );
}

interface DialogProps {
  onClose: () => void;
}

export function CreateRemoteDialog({ onClose }: DialogProps) {
  const [existingRemotes] = RemoteClass.useList();

  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [serviceIp, setServiceIp] = useState('');
  const [servicePort, setServicePort] = useState('2021');
  const [clusterName, setClusterName] = useState('');
  const [skipTlsVerify, setSkipTlsVerify] = useState(true);

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const nameError = snapshotNameFormatError(name);
  const ipError =
    serviceIp.trim() && !IPV4.test(serviceIp.trim()) ? 'Must be a valid IPv4 address.' : '';
  const portError =
    servicePort.trim() && !/^\d{1,5}$/.test(servicePort.trim()) ? 'Port must be a number.' : '';
  const duplicate = (existingRemotes ?? []).some(r => r.metadata.name === name.trim());

  const formValid =
    Boolean(name.trim()) &&
    !nameError &&
    Boolean(serviceIp.trim()) &&
    !ipError &&
    !portError &&
    !duplicate &&
    phase !== 'creating';

  // Suggest a name from the remote cluster name until the user edits it.
  function applyClusterName(value: string) {
    setClusterName(value);
    if (!nameEdited && value.trim()) {
      setName(sanitizeRFC1123(value));
    }
  }

  async function handleCreate() {
    setError(null);
    setPhase('creating');
    try {
      await createRemote({
        name: name.trim(),
        ndkServiceIp: serviceIp.trim(),
        ndkServicePort: servicePort.trim() ? Number(servicePort.trim()) : undefined,
        clusterName: clusterName.trim() || undefined,
        skipTLSVerify: skipTlsVerify,
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
      <DialogTitle>Register Remote</DialogTitle>
      <DialogContent dividers>
        {done ? (
          <Alert severity="success">
            Remote “{name.trim()}” registered. Namespaces can now create replication targets that
            point at it.
          </Alert>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}

            <Typography variant="body2" color="textSecondary">
              A remote is a peer cluster you replicate to. Point it at the peer's NDK service
              (ndk-intercom-service) — its external IP and port. It becomes Available once this
              cluster can reach and authenticate to that service.
            </Typography>

            <TextField
              label="Remote NDK service IP"
              value={serviceIp}
              onChange={e => setServiceIp(e.target.value)}
              fullWidth
              required
              error={Boolean(ipError)}
              helperText={ipError || 'External IP of ndk-intercom-service on the peer cluster.'}
              placeholder="10.124.90.18"
            />

            <TextField
              label="Remote NDK service port"
              value={servicePort}
              onChange={e => setServicePort(e.target.value)}
              fullWidth
              error={Boolean(portError)}
              helperText={portError || 'Defaults to 2021.'}
            />

            <TextField
              label="Remote cluster name (optional)"
              value={clusterName}
              onChange={e => applyClusterName(e.target.value)}
              fullWidth
              helperText="The peer's cluster name, used as the SAN in its TLS certificate."
            />

            <TextField
              label="Remote name"
              value={name}
              onChange={e => {
                setNameEdited(true);
                setName(e.target.value);
              }}
              onBlur={() => setName(n => sanitizeRFC1123(n))}
              fullWidth
              required
              error={Boolean((name && nameError) || duplicate)}
              helperText={
                duplicate
                  ? 'A remote with this name already exists.'
                  : name && nameError
                  ? nameError
                  : 'Lowercase letters, numbers and dashes (RFC 1123).'
              }
            />

            <FormControlLabel
              control={
                <Switch
                  checked={skipTlsVerify}
                  onChange={e => setSkipTlsVerify(e.target.checked)}
                />
              }
              label="Skip TLS verification of the remote"
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
              Register
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
