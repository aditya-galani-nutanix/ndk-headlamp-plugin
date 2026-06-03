// Owner: P2 (extension) — onboard a workload as an NDK Application.
//
// Creates an `Application` CR. The user picks the namespace and (optionally) a
// label selector that decides which resources NDK protects; with no labels NDK
// protects every resource in the namespace. Once created, the Application
// appears live everywhere the plugin lists Applications (snapshot dialog,
// dashboard) via Headlamp's useList watch.
import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  LinearProgress,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { createApplication } from '../api/ndk-actions';
import { makeApplicationName, sanitizeRFC1123 } from '../utils/helpers';

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

type ScopeMode = 'all' | 'labels';
type Phase = 'idle' | 'creating' | 'done' | 'error';

interface LabelPair {
  key: string;
  value: string;
}

export interface CreateApplicationButtonProps {
  variant?: 'contained' | 'outlined' | 'text';
  size?: 'small' | 'medium' | 'large';
}

export function CreateApplicationButton({
  variant = 'contained',
  size = 'small',
}: CreateApplicationButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        size={size}
        startIcon={<Icon icon="mdi:shield-plus-outline" />}
        onClick={() => setOpen(true)}
      >
        Create Application
      </Button>
      {open && <CreateApplicationDialog onClose={() => setOpen(false)} />}
    </>
  );
}

interface DialogProps {
  onClose: () => void;
}

export function CreateApplicationDialog({ onClose }: DialogProps) {
  const [namespaces] = K8s.ResourceClasses.Namespace.useList();

  const [ns, setNs] = useState('');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [scope, setScope] = useState<ScopeMode>('all');
  const [labels, setLabels] = useState<LabelPair[]>([{ key: '', value: '' }]);
  const [start, setStart] = useState(true);

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const nsOptions = useMemo(
    () => (namespaces ?? []).map(n => n.metadata.name).sort((a, b) => a.localeCompare(b)),
    [namespaces]
  );

  function handleNamespaceChange(value: string) {
    setNs(value);
    if (!nameEdited) {
      setName(makeApplicationName(value));
    }
  }

  const matchLabels = useMemo(() => {
    const out: { [k: string]: string } = {};
    for (const p of labels) {
      const k = p.key.trim();
      if (k) {
        out[k] = p.value.trim();
      }
    }
    return out;
  }, [labels]);

  const labelsValid = scope === 'all' || Object.keys(matchLabels).length > 0;
  const formValid = Boolean(ns) && Boolean(name.trim()) && labelsValid && phase !== 'creating';

  function updateLabel(i: number, patch: Partial<LabelPair>) {
    setLabels(prev => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function addLabel() {
    setLabels(prev => [...prev, { key: '', value: '' }]);
  }
  function removeLabel(i: number) {
    setLabels(prev =>
      prev.length === 1 ? [{ key: '', value: '' }] : prev.filter((_, idx) => idx !== i)
    );
  }

  async function handleCreate() {
    setError(null);
    setPhase('creating');
    try {
      await createApplication({
        name: name.trim(),
        namespace: ns,
        matchLabels: scope === 'labels' ? matchLabels : undefined,
        start,
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
      <DialogTitle>Create NDK Application</DialogTitle>
      <DialogContent dividers>
        {done ? (
          <Alert severity="success">
            Application “{name.trim()}” created in “{ns}”. It now appears in the Applications list
            and the snapshot picker.
          </Alert>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}

            <Typography variant="body2" color="textSecondary">
              An Application tells NDK which Kubernetes resources to protect. Pick a namespace and,
              optionally, a label selector to narrow the scope.
            </Typography>

            {namespaces === null ? (
              <Typography variant="body2" color="textSecondary">
                Loading namespaces…
              </Typography>
            ) : (
              <FormControl fullWidth>
                <InputLabel id="ndk-ns-label">Namespace</InputLabel>
                <Select
                  labelId="ndk-ns-label"
                  label="Namespace"
                  value={ns}
                  onChange={e => handleNamespaceChange(String(e.target.value))}
                >
                  {nsOptions.map(n => (
                    <MenuItem key={n} value={n}>
                      <ListItemText primary={n} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            <TextField
              label="Application name"
              value={name}
              onChange={e => {
                setNameEdited(true);
                setName(e.target.value);
              }}
              onBlur={() => setName(n => sanitizeRFC1123(n))}
              fullWidth
              helperText="Lowercase letters, numbers and dashes (RFC 1123)."
            />

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Resource scope
              </Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={scope}
                onChange={(_e, v) => v && setScope(v as ScopeMode)}
              >
                <ToggleButton value="all">Entire namespace</ToggleButton>
                <ToggleButton value="labels">Filter by labels</ToggleButton>
              </ToggleButtonGroup>
            </Box>

            {scope === 'all' ? (
              <Alert severity="info">
                Every resource in “{ns || 'the selected namespace'}” will be protected.
              </Alert>
            ) : (
              <Stack spacing={1}>
                <Typography variant="caption" color="textSecondary">
                  Only resources matching ALL of these labels are protected (matchLabels).
                </Typography>
                {labels.map((p, i) => (
                  <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <TextField
                      label="Label key"
                      value={p.key}
                      onChange={e => updateLabel(i, { key: e.target.value })}
                      size="small"
                      sx={{ flex: 1 }}
                    />
                    <TextField
                      label="Value"
                      value={p.value}
                      onChange={e => updateLabel(i, { value: e.target.value })}
                      size="small"
                      sx={{ flex: 1 }}
                    />
                    <Tooltip title="Remove label">
                      <IconButton
                        aria-label="Remove label"
                        onClick={() => removeLabel(i)}
                        size="small"
                      >
                        <Icon icon="mdi:close" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                ))}
                <Box>
                  <Button size="small" startIcon={<Icon icon="mdi:plus" />} onClick={addLabel}>
                    Add label
                  </Button>
                </Box>
              </Stack>
            )}

            <FormControlLabel
              control={<Switch checked={start} onChange={e => setStart(e.target.checked)} />}
              label="Start protecting immediately"
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
