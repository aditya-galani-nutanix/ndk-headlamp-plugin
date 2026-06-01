// Owner: P2 — merged Snapshot-and-Replicate workflow with progress stepper (hero feature).
//
// Triggers a manual ApplicationSnapshot, waits for status.readyToUse, then
// creates one ApplicationSnapshotReplication per chosen target and tracks each
// to completion. Everything is plain CR CRUD against the Kubernetes API server
// the NDK controllers in k8s-juno do the work.
import { Icon } from '@iconify/react';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
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
  FormControlLabel,
  InputLabel,
  LinearProgress,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  Step,
  StepContent,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createSnapshot, ensureReplicationTarget, replicateSnapshot } from '../api/ndk-actions';
import {
  ApplicationClass,
  ApplicationSnapshotClass,
  ApplicationSnapshotReplicationClass,
  RemoteClass,
  ReplicationTargetClass,
} from '../api/ndk-resources';
import type {
  ApplicationSnapshotReplicationStatus,
  ApplicationSnapshotStatus,
  RemoteStatus,
} from '../api/types';
import {
  DEFAULT_EXPIRY,
  EXPIRY_OPTIONS,
  formatAge,
  makeReplicationName,
  makeSnapshotName,
  remoteIsAvailable,
  remoteUnavailableReason,
  replicationMessage,
  type ReplicationState,
  replicationState,
  snapshotErrorMessage,
  snapshotNameFormatError,
  snapshotState,
} from '../utils/helpers';

type Phase = 'idle' | 'creatingSnapshot' | 'waitingSnapshot' | 'replicating' | 'done' | 'error';

interface CreatedReplication {
  target: string;
  name: string;
}

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

// ---------------------------------------------------------------------------
// Lightweight resume: persist an in-flight run so closing/reopening the dialog
// (or a page reload) re-attaches to the live snapshot + replications instead of
// losing track of the random replication names.
// ---------------------------------------------------------------------------

const RESUME_KEY = 'ndk.snapshotReplicate.activeRun';
const RESUME_TTL_MS = 6 * 60 * 60 * 1000;

interface PersistedRun {
  namespace: string;
  applicationName: string;
  snapshotName: string;
  expiresAfter: string;
  alsoReplicate: boolean;
  /** Selected Remote (cluster) names. */
  remotes: string[];
  created: CreatedReplication[];
  ts: number;
}

function loadRun(): PersistedRun | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) {
      return null;
    }
    const run = JSON.parse(raw) as PersistedRun;
    if (!run?.snapshotName || !run?.namespace || Date.now() - (run.ts ?? 0) > RESUME_TTL_MS) {
      localStorage.removeItem(RESUME_KEY);
      return null;
    }
    return run;
  } catch {
    return null;
  }
}

function saveRun(run: PersistedRun): void {
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify(run));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

function clearRun(): void {
  try {
    localStorage.removeItem(RESUME_KEY);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Launch button (used on the dashboard and on the Application detail view).
// ---------------------------------------------------------------------------

export interface SnapshotAndReplicateButtonProps {
  /** Preselect + lock the application (e.g. from the Application detail view). */
  application?: string;
  /** Namespace of the preselected application. */
  namespace?: string;
  variant?: 'contained' | 'outlined' | 'text';
  size?: 'small' | 'medium' | 'large';
}

export function SnapshotAndReplicateButton({
  application,
  namespace,
  variant = 'contained',
  size = 'small',
}: SnapshotAndReplicateButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        size={size}
        startIcon={<Icon icon="mdi:camera-plus-outline" />}
        onClick={() => setOpen(true)}
      >
        Snapshot &amp; Replicate
      </Button>
      {open && (
        <SnapshotReplicateDialog
          application={application}
          namespace={namespace}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Convenience wrapper that renders the button inside a SectionBox. */
export function SnapshotAndReplicate() {
  return (
    <SectionBox title="Snapshot & Replicate">
      <SnapshotAndReplicateButton />
    </SectionBox>
  );
}

// ---------------------------------------------------------------------------
// The dialog: form (idle) -> progress stepper (started).
// ---------------------------------------------------------------------------

interface DialogProps {
  application?: string;
  namespace?: string;
  onClose: () => void;
}

function SnapshotReplicateDialog({ application, namespace, onClose }: DialogProps) {
  const locked = Boolean(application && namespace);
  // A previous in-flight run (persisted in localStorage). We do NOT auto-resume
  // it — the dialog always opens on a fresh form so the button can start a new
  // snapshot. Resuming is offered as an explicit banner action instead.
  const resume = useMemo(() => (locked ? null : loadRun()), [locked]);
  const [resumeDismissed, setResumeDismissed] = useState(false);

  const [applicationName, setApplicationName] = useState(application ?? '');
  const [ns, setNs] = useState(namespace ?? '');
  const [snapshotName, setSnapshotName] = useState(
    application ? makeSnapshotName(application) : ''
  );
  const [expiresAfter, setExpiresAfter] = useState(DEFAULT_EXPIRY);
  const [alsoReplicate, setAlsoReplicate] = useState(true);
  const [remotes, setRemotes] = useState<string[]>([]);

  const [started, setStarted] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [initialCreated, setInitialCreated] = useState<CreatedReplication[]>([]);

  const [apps] = ApplicationClass.useList();
  const [remotesList] = RemoteClass.useList();
  // Existing snapshots in the chosen namespace, used to reject a duplicate name
  // before we POST (K8s would reject it as AlreadyExists anyway).
  const [nsSnapshots] = ApplicationSnapshotClass.useList(ns ? { namespace: ns } : {});

  const appOptions = useMemo(
    () =>
      (apps ?? []).map(a => ({
        name: a.metadata.name,
        namespace: a.metadata.namespace ?? '',
      })),
    [apps]
  );

  // Remotes are cluster-scoped "available clusters"; the plugin auto-creates the
  // namespace-local ReplicationTarget for the chosen remote at replicate time.
  const remoteOptions = useMemo(
    () =>
      (remotesList ?? []).map(r => {
        const status = r.jsonData?.status as RemoteStatus | undefined;
        return {
          name: r.metadata.name,
          address: (r.jsonData?.spec?.ndkServiceIp as string | undefined) ?? '',
          available: remoteIsAvailable(status),
          reason: remoteUnavailableReason(status),
        };
      }),
    [remotesList]
  );

  useEffect(() => {
    if (phase === 'done' || phase === 'error') {
      clearRun();
    }
  }, [phase]);

  function handleApplicationChange(value: string) {
    const slash = value.indexOf('/');
    const selNs = slash >= 0 ? value.slice(0, slash) : '';
    const selName = slash >= 0 ? value.slice(slash + 1) : value;
    setApplicationName(selName);
    setNs(selNs);
    setSnapshotName(makeSnapshotName(selName));
    setRemotes([]);
  }

  const nameFormatError = snapshotNameFormatError(snapshotName);
  const duplicateName =
    !nameFormatError &&
    Boolean(ns) &&
    (nsSnapshots ?? []).some(
      s => s.metadata.name === snapshotName.trim() && (s.metadata.namespace ?? '') === ns
    );
  const nameError =
    nameFormatError ??
    (duplicateName
      ? `A snapshot named “${snapshotName.trim()}” already exists in “${ns}”. Choose a different name.`
      : undefined);

  const formValid =
    Boolean(applicationName) &&
    Boolean(ns) &&
    !nameError &&
    (!alsoReplicate || remotes.length > 0);

  async function handleStart() {
    const trimmedName = snapshotName.trim();
    setSubmitError(null);
    setInitialCreated([]);
    setStarted(true);
    setPhase('creatingSnapshot');
    try {
      await createSnapshot({ name: trimmedName, namespace: ns, applicationName, expiresAfter });
      setPhase('waitingSnapshot');
      saveRun({
        namespace: ns,
        applicationName,
        snapshotName: trimmedName,
        expiresAfter,
        alsoReplicate,
        remotes,
        created: [],
        ts: Date.now(),
      });
    } catch (e) {
      setPhase('error');
      setSubmitError(errMessage(e));
    }
  }

  function handleReplicationsCreated(created: CreatedReplication[]) {
    saveRun({
      namespace: ns,
      applicationName,
      snapshotName: snapshotName.trim(),
      expiresAfter,
      alsoReplicate,
      remotes,
      created,
      ts: Date.now(),
    });
  }

  function handleReset() {
    clearRun();
    setResumeDismissed(true);
    setStarted(false);
    setPhase('idle');
    setSubmitError(null);
    setInitialCreated([]);
    const baseApp = locked ? (application as string) : applicationName;
    setSnapshotName(baseApp ? makeSnapshotName(baseApp) : '');
  }

  // Explicitly re-attach to the persisted in-flight run (banner action).
  function handleResume() {
    if (!resume) {
      return;
    }
    setApplicationName(resume.applicationName);
    setNs(resume.namespace);
    setSnapshotName(resume.snapshotName);
    setExpiresAfter(resume.expiresAfter);
    setAlsoReplicate(resume.alsoReplicate);
    setRemotes(resume.remotes ?? []);
    setInitialCreated(resume.created ?? []);
    setSubmitError(null);
    setPhase(resume.created.length > 0 ? 'replicating' : 'waitingSnapshot');
    setStarted(true);
  }

  const inFlight =
    phase === 'creatingSnapshot' || phase === 'waitingSnapshot' || phase === 'replicating';
  const terminal = phase === 'done' || phase === 'error';

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Snapshot &amp; Replicate</DialogTitle>
      <DialogContent dividers>
        {!started ? (
          <Stack spacing={2} sx={{ mt: 1 }}>
            {submitError && <Alert severity="error">{submitError}</Alert>}

            {resume && !resumeDismissed && (
              <Alert
                severity="info"
                action={
                  <>
                    <Button color="inherit" size="small" onClick={handleResume}>
                      Resume
                    </Button>
                    <Button
                      color="inherit"
                      size="small"
                      onClick={() => {
                        clearRun();
                        setResumeDismissed(true);
                      }}
                    >
                      Discard
                    </Button>
                  </>
                }
              >
                A previous run “{resume.snapshotName}” is still in progress (started{' '}
                {formatAge(new Date(resume.ts).toISOString())} ago).
              </Alert>
            )}

            {locked ? (
              <TextField
                label="Application"
                value={`${ns} / ${applicationName}`}
                fullWidth
                disabled
              />
            ) : apps === null ? (
              <Typography color="textSecondary" variant="body2">
                Loading applications…
              </Typography>
            ) : appOptions.length === 0 ? (
              <Alert severity="info">No Applications found. Protect an application first.</Alert>
            ) : (
              <FormControl fullWidth>
                <InputLabel id="ndk-app-label">Application</InputLabel>
                <Select
                  labelId="ndk-app-label"
                  label="Application"
                  value={applicationName ? `${ns}/${applicationName}` : ''}
                  onChange={e => handleApplicationChange(String(e.target.value))}
                >
                  {appOptions.map(a => (
                    <MenuItem key={`${a.namespace}/${a.name}`} value={`${a.namespace}/${a.name}`}>
                      <ListItemText primary={a.name} secondary={a.namespace} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            <TextField
              label="Snapshot name"
              value={snapshotName}
              onChange={e => setSnapshotName(e.target.value)}
              fullWidth
              error={Boolean(nameError)}
              helperText={
                nameError ?? 'Must start with a letter; lowercase letters, numbers and dashes.'
              }
            />

            <FormControl fullWidth>
              <InputLabel id="ndk-expiry-label">Expires after</InputLabel>
              <Select
                labelId="ndk-expiry-label"
                label="Expires after"
                value={expiresAfter}
                onChange={e => setExpiresAfter(String(e.target.value))}
              >
                {EXPIRY_OPTIONS.map(o => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControlLabel
              control={
                <Checkbox
                  checked={alsoReplicate}
                  onChange={e => setAlsoReplicate(e.target.checked)}
                />
              }
              label="Also replicate to other clusters"
            />

            {alsoReplicate &&
              (remotesList !== null && remoteOptions.length === 0 ? (
                <Alert severity="warning">
                  No remote clusters are configured. An administrator must register a Remote first,
                  or uncheck replication.
                </Alert>
              ) : (
                <FormControl fullWidth>
                  <InputLabel id="ndk-clusters-label">Replicate to clusters</InputLabel>
                  <Select
                    labelId="ndk-clusters-label"
                    multiple
                    value={remotes}
                    onChange={e => {
                      const v = e.target.value;
                      setRemotes(typeof v === 'string' ? v.split(',') : (v as string[]));
                    }}
                    input={<OutlinedInput label="Replicate to clusters" />}
                    renderValue={selected => (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {(selected as string[]).map(v => (
                          <Chip key={v} size="small" label={v} />
                        ))}
                      </Box>
                    )}
                  >
                    {remoteOptions.map(r => (
                      <MenuItem key={r.name} value={r.name} disabled={!r.available}>
                        <Checkbox checked={remotes.includes(r.name)} disabled={!r.available} />
                        <ListItemText
                          primary={r.name}
                          secondary={r.available ? r.address || 'Available' : r.reason}
                        />
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              ))}
            {alsoReplicate && (
              <Typography variant="caption" color="textSecondary">
                A replication target for the chosen cluster is created automatically in “
                {ns || 'the app namespace'}”.
              </Typography>
            )}
          </Stack>
        ) : (
          <WorkflowProgress
            namespace={ns}
            snapshotName={snapshotName.trim()}
            alsoReplicate={alsoReplicate}
            remotes={remotes}
            phase={phase}
            setPhase={setPhase}
            submitError={submitError}
            initialCreated={initialCreated}
            onReplicationsCreated={handleReplicationsCreated}
          />
        )}
      </DialogContent>
      <DialogActions>
        {!started && (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="contained" onClick={handleStart} disabled={!formValid}>
              Start
            </Button>
          </>
        )}
        {started && inFlight && <Button onClick={onClose}>Close (runs in background)</Button>}
        {started && terminal && (
          <>
            <Button onClick={handleReset}>Start another</Button>
            <Button variant="contained" onClick={onClose}>
              Done
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Progress stepper: watches the live CRs and drives the state machine.
// ---------------------------------------------------------------------------

interface WorkflowProgressProps {
  namespace: string;
  snapshotName: string;
  alsoReplicate: boolean;
  /** Selected Remote (cluster) names. */
  remotes: string[];
  phase: Phase;
  setPhase: (p: Phase) => void;
  submitError: string | null;
  initialCreated: CreatedReplication[];
  onReplicationsCreated: (created: CreatedReplication[]) => void;
}

export interface ReplicationRowData {
  target: string;
  name: string;
  state: ReplicationState;
  percent: number;
  message?: string;
}

function WorkflowProgress({
  namespace,
  snapshotName,
  alsoReplicate,
  remotes,
  phase,
  setPhase,
  submitError,
  initialCreated,
  onReplicationsCreated,
}: WorkflowProgressProps) {
  const [snapshots] = ApplicationSnapshotClass.useList({ namespace });
  const [replications] = ApplicationSnapshotReplicationClass.useList({ namespace });
  const [existingTargets] = ReplicationTargetClass.useList({ namespace });

  const [created, setCreated] = useState<CreatedReplication[]>(initialCreated);
  const [postErrors, setPostErrors] = useState<Record<string, string>>({});
  const replicateGuard = useRef(initialCreated.length > 0);

  const snapObj = (snapshots ?? []).find(s => s.metadata.name === snapshotName);
  const snapStatus = snapObj?.jsonData?.status as ApplicationSnapshotStatus | undefined;
  const snapPhase = snapshotState(snapStatus);
  const snapReady = snapPhase === 'ready';
  const snapFailed = snapPhase === 'error';

  useEffect(() => {
    if (snapFailed && phase !== 'error') {
      setPhase('error');
    }
  }, [snapFailed, phase, setPhase]);

  const targetsLoaded = existingTargets !== null;

  // Snapshot is ready -> ensure a ReplicationTarget for each chosen remote, then
  // create one ApplicationSnapshotReplication per remote (exactly once).
  useEffect(() => {
    if (!snapReady || replicateGuard.current) {
      return;
    }
    if (!alsoReplicate || remotes.length === 0) {
      replicateGuard.current = true;
      setPhase('done');
      return;
    }
    // Wait for the existing-target list so we reuse instead of duplicating.
    if (!targetsLoaded) {
      return;
    }
    replicateGuard.current = true;
    setPhase('replicating');
    const existing = (existingTargets ?? []).map(t => ({
      name: t.metadata.name,
      remoteName: t.jsonData?.spec?.remoteName as string | undefined,
    }));
    (async () => {
      const ok: CreatedReplication[] = [];
      const errs: Record<string, string> = {};
      for (const remote of remotes) {
        try {
          const targetName = await ensureReplicationTarget(remote, namespace, existing);
          const name = makeReplicationName(snapshotName, targetName);
          await replicateSnapshot({
            name,
            namespace,
            applicationSnapshotName: snapshotName,
            replicationTargetName: targetName,
          });
          ok.push({ target: remote, name });
        } catch (e) {
          errs[remote] = errMessage(e);
        }
      }
      setCreated(ok);
      setPostErrors(errs);
      onReplicationsCreated(ok);
      if (ok.length === 0) {
        setPhase('done');
      }
    })();
    // Keyed on snapReady + targetsLoaded; the ref guards against re-entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapReady, targetsLoaded]);

  const rows: ReplicationRowData[] = useMemo(() => {
    const live = created.map(c => {
      const obj = (replications ?? []).find(r => r.metadata.name === c.name);
      const status = obj?.jsonData?.status as ApplicationSnapshotReplicationStatus | undefined;
      return {
        target: c.target,
        name: c.name,
        state: replicationState(status),
        percent: status?.replicationCompletionPercent ?? 0,
        message: replicationMessage(status),
      };
    });
    const failed: ReplicationRowData[] = Object.keys(postErrors).map(target => ({
      target,
      name: '',
      state: 'error',
      percent: 0,
      message: postErrors[target],
    }));
    return [...live, ...failed];
  }, [created, replications, postErrors]);

  // All in-flight replications reached a terminal state -> done.
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

  const replicateStepActive = alsoReplicate && remotes.length > 0;
  const snapshotCreated =
    phase === 'waitingSnapshot' || phase === 'replicating' || phase === 'done' || Boolean(snapObj);
  const postFailed = phase === 'error' && !snapFailed;

  let activeStep = 0;
  if (phase === 'creatingSnapshot') {
    activeStep = 0;
  } else if (phase === 'waitingSnapshot') {
    activeStep = 1;
  } else if (phase === 'replicating') {
    activeStep = 2;
  } else if (phase === 'done') {
    activeStep = replicateStepActive ? 2 : 1;
  } else if (phase === 'error') {
    activeStep = snapFailed ? 1 : 0;
  }

  const availableCount = rows.filter(r => r.state === 'available').length;
  const errorCount = rows.filter(r => r.state === 'error').length;

  let summaryText = `Snapshot “${snapshotName}” is ready.`;
  if (replicateStepActive) {
    const total = remotes.length;
    const plural = total > 1 ? 's' : '';
    if (errorCount === 0) {
      summaryText = `Snapshot ready and replicated to all ${total} cluster${plural}.`;
    } else if (availableCount === 0) {
      summaryText = `Snapshot ready, but replication failed for all ${total} cluster${plural}.`;
    } else {
      summaryText = `Snapshot ready. Replicated to ${availableCount} of ${total} clusters; ${errorCount} failed.`;
    }
  }

  return (
    <Box sx={{ mt: 1 }}>
      <Stepper activeStep={activeStep} orientation="vertical">
        <Step completed={snapshotCreated}>
          <StepLabel
            error={postFailed}
            optional={<Typography variant="caption">{snapshotName}</Typography>}
          >
            Create application snapshot
          </StepLabel>
          <StepContent>
            {phase === 'creatingSnapshot' && <LinearProgress sx={{ mt: 1 }} />}
            {postFailed && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {submitError}
              </Alert>
            )}
            {snapshotCreated && !postFailed && (
              <Typography variant="body2" color="textSecondary">
                Snapshot object created on the cluster.
              </Typography>
            )}
          </StepContent>
        </Step>

        <Step completed={snapReady}>
          <StepLabel
            error={snapFailed}
            optional={
              snapReady && snapStatus?.creationTime ? (
                <Typography variant="caption">
                  taken {formatAge(snapStatus.creationTime)} ago
                </Typography>
              ) : undefined
            }
          >
            Wait for snapshot to be ready
          </StepLabel>
          <StepContent>
            {phase === 'waitingSnapshot' && !snapFailed && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                <LinearProgress sx={{ flexGrow: 1 }} />
                <Typography variant="caption" color="textSecondary">
                  snapshotting…
                </Typography>
              </Box>
            )}
            {snapFailed && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {snapshotErrorMessage(snapStatus)}
              </Alert>
            )}
            {snapReady && (
              <Typography variant="body2" color="textSecondary">
                Snapshot is ready to use.
              </Typography>
            )}
          </StepContent>
        </Step>

        {replicateStepActive && (
          <Step completed={phase === 'done'}>
            <StepLabel
              error={phase === 'done' && availableCount === 0}
              optional={
                <Typography variant="caption">
                  {remotes.length} cluster{remotes.length > 1 ? 's' : ''}
                </Typography>
              }
            >
              Replicate to other clusters
            </StepLabel>
            <StepContent>
              <Stack spacing={1.5} sx={{ mt: 1 }}>
                {rows.length === 0 && phase === 'replicating' && <LinearProgress />}
                {rows.map(r => (
                  <ReplicationRow key={r.target} row={r} />
                ))}
              </Stack>
            </StepContent>
          </Step>
        )}
      </Stepper>

      {phase === 'done' && (
        <Alert
          severity={errorCount === 0 ? 'success' : availableCount === 0 ? 'error' : 'warning'}
          sx={{ mt: 2 }}
        >
          {summaryText}
        </Alert>
      )}
      {phase === 'error' && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {snapFailed ? snapshotErrorMessage(snapStatus) : submitError}
        </Alert>
      )}
    </Box>
  );
}

export function ReplicationRow({ row }: { row: ReplicationRowData }) {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="body2">{row.target}</Typography>
        <StateChip state={row.state} />
      </Box>
      {row.state === 'progressing' && (
        <LinearProgress
          variant={row.percent ? 'determinate' : 'indeterminate'}
          value={row.percent}
          sx={{ mt: 0.5 }}
        />
      )}
      {row.state === 'error' && row.message && (
        <Typography variant="caption" color="error">
          {row.message}
        </Typography>
      )}
      {row.state === 'blocked' && (
        <Typography variant="caption" color="warning.main">
          {row.message ?? 'Waiting on the replication target.'} The replication resumes
          automatically once the target is available.
        </Typography>
      )}
      {row.state === 'available' && (
        <Typography variant="caption" color="textSecondary">
          Replicated successfully.
        </Typography>
      )}
    </Box>
  );
}

export function StateChip({ state }: { state: ReplicationState }) {
  const map: Record<
    ReplicationState,
    { label: string; color: 'success' | 'info' | 'warning' | 'error' | 'default' }
  > = {
    available: { label: 'Available', color: 'success' },
    progressing: { label: 'Replicating', color: 'info' },
    blocked: { label: 'Blocked', color: 'warning' },
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
