// Install NDK dialog. One form feeds two delivery modes:
//   - "Generate script": render install-ndk.sh with the inputs and copy/download it.
//   - "Run in cluster":   create the installer Job and stream its logs/status.
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_INPUTS,
  type InstallInputs,
  OS_NAME_OPTIONS,
  validateInputs,
  VOLUME_BINDING_MODE_OPTIONS,
} from '../install/inputs';
import {
  cleanupInstallJob,
  DEFAULT_INSTALLER_IMAGE,
  type InstallPhase,
  type InstallRunHandle,
  launchInstallJob,
  streamJobLogs,
  watchJobStatus,
} from '../install/installJob';
import { renderInstallScript } from '../install/scriptText';

const PHASE_COLOR: Record<InstallPhase, 'default' | 'info' | 'success' | 'error'> = {
  pending: 'default',
  running: 'info',
  succeeded: 'success',
  failed: 'error',
};

export interface InstallNdkDialogProps {
  open: boolean;
  onClose: () => void;
}

export function InstallNdkDialog({ open, onClose }: InstallNdkDialogProps) {
  const [inputs, setInputs] = useState<InstallInputs>(DEFAULT_INPUTS);
  const [errors, setErrors] = useState<Partial<Record<keyof InstallInputs, string>>>({});
  const [image, setImage] = useState(DEFAULT_INSTALLER_IMAGE);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [script, setScript] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<InstallPhase | null>(null);
  const [phaseDetail, setPhaseDetail] = useState<string | undefined>(undefined);
  const [logs, setLogs] = useState<string[]>([]);
  const [handle, setHandle] = useState<InstallRunHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<Array<() => void>>([]);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  function stopWatchers() {
    cancelRef.current.forEach(fn => fn());
    cancelRef.current = [];
  }

  // Stop log/status watchers when the dialog unmounts.
  useEffect(() => () => stopWatchers(), []);

  // Reset transient state each time the dialog is reopened.
  useEffect(() => {
    if (open) {
      setScript(null);
      setError(null);
      setLogs([]);
      setPhase(null);
      setPhaseDetail(undefined);
      setHandle(null);
      setRunning(false);
    }
  }, [open]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' });
  }, [logs]);

  function set<K extends keyof InstallInputs>(key: K, value: InstallInputs[K]) {
    setInputs(prev => ({ ...prev, [key]: value }));
  }

  function validate(): boolean {
    const errs = validateInputs(inputs);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      setError('Please fix the highlighted fields.');
      return false;
    }
    setError(null);
    return true;
  }

  function handleGenerate() {
    if (!validate()) {
      return;
    }
    setScript(renderInstallScript(inputs, { includeSecrets }));
  }

  async function handleCopy() {
    if (!script) {
      return;
    }
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleDownload() {
    if (!script) {
      return;
    }
    const blob = new Blob([script], { type: 'text/x-shellscript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'install-ndk.sh';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleRun() {
    if (!validate()) {
      return;
    }
    stopWatchers();
    setRunning(true);
    setLogs([]);
    setPhase('pending');
    setPhaseDetail(undefined);
    try {
      const h = await launchInstallJob(inputs, { image });
      setHandle(h);
      const cancelLogs = streamJobLogs(h.jobName, lines => setLogs(lines));
      const cancelStatus = watchJobStatus(h.jobName, (p, detail) => {
        setPhase(p);
        setPhaseDetail(detail);
      });
      cancelRef.current = [cancelLogs, cancelStatus];
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRunning(false);
      setPhase('failed');
    }
  }

  async function handleCleanup() {
    if (!handle) {
      return;
    }
    stopWatchers();
    try {
      await cleanupInstallJob(handle);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setHandle(null);
    setRunning(false);
    setPhase(null);
  }

  function handleClose() {
    stopWatchers();
    onClose();
  }

  const text = (
    key: keyof InstallInputs,
    label: string,
    opts: { required?: boolean; password?: boolean; helper?: string; placeholder?: string } = {}
  ) => (
    <TextField
      label={label}
      required={opts.required}
      type={opts.password ? 'password' : 'text'}
      fullWidth
      margin="dense"
      size="small"
      value={String(inputs[key] ?? '')}
      onChange={e => set(key, e.target.value as InstallInputs[typeof key])}
      error={Boolean(errors[key])}
      helperText={errors[key] || opts.helper}
      placeholder={opts.placeholder}
    />
  );

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="md">
      <DialogTitle>Install NDK</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Typography variant="subtitle2" gutterBottom>
          Install
        </Typography>
        {text('csiUrl', 'CSI chart URL', { required: true, placeholder: 'https://artifactory…/nutanix-csi-storage-<ver>.tgz' })}
        {text('ndkUrl', 'NDK chart URL', { required: true, placeholder: 'https://artifactory…/ndk-<ver>.tgz' })}
        {text('artifactoryUsername', 'Artifactory username', { required: true })}
        {text('artifactoryApiKey', 'Artifactory API key', { required: true, password: true })}
        {text('clusterName', 'Cluster name', { required: true, helper: 'Used for tls.server.clusterName' })}
        {text('pcIp', 'Prism Central IP', { required: true, placeholder: '10.10.10.10' })}
        <Box sx={{ display: 'flex', gap: 2 }}>
          <FormControl fullWidth margin="dense" size="small">
            <InputLabel id="os-name-label">K8s flavor</InputLabel>
            <Select
              labelId="os-name-label"
              label="K8s flavor"
              value={inputs.osName}
              onChange={e => set('osName', e.target.value as InstallInputs['osName'])}
            >
              {OS_NAME_OPTIONS.map(o => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth margin="dense" size="small">
            <InputLabel id="vbm-label">StorageClass binding mode</InputLabel>
            <Select
              labelId="vbm-label"
              label="StorageClass binding mode"
              value={inputs.volumeBindingMode}
              onChange={e =>
                set('volumeBindingMode', e.target.value as InstallInputs['volumeBindingMode'])
              }
            >
              {VOLUME_BINDING_MODE_OPTIONS.map(v => (
                <MenuItem key={v} value={v}>
                  {v}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          {text('pcUsername', 'PC username')}
          {text('pcPassword', 'PC password', { password: true })}
        </Box>
        <FormControlLabel
          sx={{ mt: 1 }}
          control={
            <Switch checked={inputs.enableLb} onChange={e => set('enableLb', e.target.checked)} />
          }
          label="Set up SyncRep LoadBalancer"
        />
        {inputs.enableLb &&
          text('lbIp', 'LoadBalancer IP (external VIP)', {
            required: true,
            placeholder: '10.124.90.18',
            helper:
              'Free static IP for ndk-intercom-service. Find one with get-free-static-ips.sh (from the SyncRep doc); the installer re-checks it is free before assigning it via kube-vip.',
          })}
        <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mb: 1 }}>
          Turn off for snapshot-only (no external IP).
        </Typography>
        {text('customValuesUrl', 'Custom values URL (optional)')}
        {text('kubeconfig', 'KUBECONFIG path (optional)', {
          helper: 'Only used by the generated script; the in-cluster Job uses its ServiceAccount',
        })}

        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2" gutterBottom>
          StorageCluster (local PE/PC registration)
        </Typography>
        {text('scName', 'StorageCluster name', { required: true })}
        {text('peUuid', 'PE UUID (storageServerUuid)', {
          required: true,
          helper: 'ncli multicluster get-cluster-state → "Cluster Id"',
        })}
        {text('pcUuid', 'PC UUID (managementServerUuid)', {
          required: true,
          helper: 'ncli cluster info → "Cluster Uuid"',
        })}

        <Divider sx={{ my: 2 }} />
        <FormControlLabel
          control={
            <Switch
              checked={inputs.enableRemote}
              onChange={e => set('enableRemote', e.target.checked)}
            />
          }
          label="Register a remote peer for replication"
        />
        {inputs.enableRemote && (
          <Box>
            {text('remoteName', 'Remote name', { required: true })}
            {text('remoteNdkServiceIp', 'Remote NDK service IP', {
              required: true,
              helper: 'IP of ndk-intercom-service on the peer cluster',
            })}
            <Box sx={{ display: 'flex', gap: 2 }}>
              {text('remoteNdkServicePort', 'Remote NDK service port')}
              {text('remoteClusterName', 'Remote cluster name (optional)')}
            </Box>
            <FormControlLabel
              control={
                <Switch
                  checked={inputs.remoteSkipTlsVerify}
                  onChange={e => set('remoteSkipTlsVerify', e.target.checked)}
                />
              }
              label="Skip TLS verification of the remote"
            />
          </Box>
        )}

        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2" gutterBottom>
          Advanced
        </Typography>
        <TextField
          label="Installer image (Run in cluster)"
          fullWidth
          margin="dense"
          size="small"
          value={image}
          onChange={e => setImage(e.target.value)}
          helperText="Image with helm + kubectl + curl used by the in-cluster Job"
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={includeSecrets}
              onChange={e => setIncludeSecrets(e.target.checked)}
            />
          }
          label="Include secrets inline in the generated script"
        />

        <Alert severity="info" sx={{ mt: 2 }}>
          Run in cluster creates a Job (cluster-admin) in <code>ntnx-system</code>. The cluster needs
          egress to Artifactory, github.com (cert-manager), hoth.corp.nutanix.com (canaveral),
          nutanix.github.io, and — when the SyncRep LoadBalancer is on — kube-vip.io /
          raw.githubusercontent.com (kube-vip).
        </Alert>

        {script && (
          <Box sx={{ mt: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Typography variant="subtitle2">Generated script</Typography>
              <Button size="small" onClick={handleCopy}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button size="small" onClick={handleDownload}>
                Download
              </Button>
            </Box>
            <TextField
              fullWidth
              multiline
              minRows={8}
              maxRows={18}
              value={script}
              InputProps={{ readOnly: true, style: { fontFamily: 'monospace', fontSize: 12 } }}
            />
          </Box>
        )}

        {(running || logs.length > 0 || phase) && (
          <Box sx={{ mt: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Typography variant="subtitle2">In-cluster install</Typography>
              {phase && (
                <Chip
                  size="small"
                  color={PHASE_COLOR[phase]}
                  label={phase}
                  icon={
                    phase === 'pending' || phase === 'running' ? (
                      <CircularProgress size={12} color="inherit" />
                    ) : undefined
                  }
                />
              )}
              {handle && (
                <Typography variant="caption" color="textSecondary">
                  {handle.jobName}
                </Typography>
              )}
            </Box>
            {phaseDetail && (
              <Alert severity="warning" sx={{ mb: 1 }}>
                {phaseDetail}
              </Alert>
            )}
            <Box
              sx={{
                bgcolor: 'black',
                color: 'grey.100',
                fontFamily: 'monospace',
                fontSize: 12,
                p: 1,
                borderRadius: 1,
                maxHeight: 280,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {logs.length > 0 ? logs.join('\n') : 'Waiting for the installer pod to start…'}
              <div ref={logEndRef} />
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {handle && (
          <Button color="error" onClick={handleCleanup} sx={{ mr: 'auto' }}>
            Delete installer Job
          </Button>
        )}
        <Button onClick={handleClose}>Close</Button>
        <Button onClick={handleGenerate} variant="outlined">
          Generate script
        </Button>
        <Button onClick={handleRun} variant="contained" disabled={running && phase !== 'failed'}>
          {running && phase !== 'failed' && phase !== 'succeeded' ? 'Running…' : 'Run in cluster'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
