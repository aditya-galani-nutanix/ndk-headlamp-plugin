// Owner: P3 — Schedule snapshots button + modal (recurring snapshots).
//
// Looks and behaves like the "Snapshot & Replicate" button/modal, but instead of
// running a one-time snapshot it creates the JobScheduler -> ProtectionPlan ->
// AppProtectionPlan chain that drives recurring snapshots of an Application (with
// optional replication to other clusters). The NDK controllers in k8s-juno then
// create an ApplicationSnapshot on every scheduled tick.
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
  TextField,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { ApplicationClass, RemoteClass, ReplicationTargetClass } from '../api/ndk-resources';
import { createSchedule } from '../api/schedule-actions';
import type { RemoteStatus } from '../api/types';
import {
  buildScheduleSpec,
  DEFAULT_RETENTION_COUNT,
  describeSchedule,
  MIN_SCHEDULE_INTERVAL_MINUTES,
  RECURRENCE_OPTIONS,
  type RecurrenceType,
  remoteIsAvailable,
  remoteUnavailableReason,
  scheduleFormError,
  type ScheduleFormValues,
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

// ---------------------------------------------------------------------------
// Launch button (used on the dashboard and on the Application detail view).
// ---------------------------------------------------------------------------

export interface ScheduleButtonProps {
  /** Preselect + lock the application (e.g. from the Application detail view). */
  application?: string;
  /** Namespace of the preselected application. */
  namespace?: string;
  variant?: 'contained' | 'outlined' | 'text';
  size?: 'small' | 'medium' | 'large';
}

export function ScheduleButton({
  application,
  namespace,
  variant = 'contained',
  size = 'small',
}: ScheduleButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        size={size}
        startIcon={<Icon icon="mdi:calendar-clock" />}
        onClick={() => setOpen(true)}
      >
        Schedule Snapshots
      </Button>
      {open && (
        <ScheduleDialog
          application={application}
          namespace={namespace}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Convenience wrapper that renders the button inside a SectionBox. */
export function ScheduleForm() {
  return (
    <SectionBox title="Schedule Snapshots">
      <ScheduleButton />
    </SectionBox>
  );
}

// ---------------------------------------------------------------------------
// The dialog: form (idle) -> success/error confirmation (done).
// ---------------------------------------------------------------------------

interface DialogProps {
  application?: string;
  namespace?: string;
  onClose: () => void;
}

type Phase = 'idle' | 'creating' | 'done' | 'error';

const DEFAULT_FORM: ScheduleFormValues = {
  type: 'interval',
  intervalMinutes: String(MIN_SCHEDULE_INTERVAL_MINUTES),
  time: '02:30',
  weeklyDays: 'MON',
  monthlyDates: '1',
  cron: '0 2 * * *',
};

function ScheduleDialog({ application, namespace, onClose }: DialogProps) {
  const locked = Boolean(application && namespace);

  const [applicationName, setApplicationName] = useState(application ?? '');
  const [ns, setNs] = useState(namespace ?? '');
  const [form, setForm] = useState<ScheduleFormValues>(DEFAULT_FORM);
  const [retentionCount, setRetentionCount] = useState(String(DEFAULT_RETENTION_COUNT));
  const [alsoReplicate, setAlsoReplicate] = useState(false);
  const [remotes, setRemotes] = useState<string[]>([]);

  const [phase, setPhase] = useState<Phase>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [apps] = ApplicationClass.useList();
  const [remotesList] = RemoteClass.useList();
  const [existingTargets] = ReplicationTargetClass.useList(ns ? { namespace: ns } : {});

  const appOptions = useMemo(
    () =>
      (apps ?? []).map(a => ({
        name: a.metadata.name,
        namespace: a.metadata.namespace ?? '',
      })),
    [apps]
  );

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

  function handleApplicationChange(value: string) {
    const slash = value.indexOf('/');
    const selNs = slash >= 0 ? value.slice(0, slash) : '';
    const selName = slash >= 0 ? value.slice(slash + 1) : value;
    setApplicationName(selName);
    setNs(selNs);
    setRemotes([]);
  }

  function updateForm(patch: Partial<ScheduleFormValues>) {
    setForm(prev => ({ ...prev, ...patch }));
  }

  const scheduleError = scheduleFormError(form);
  const retentionNum = Number(retentionCount);
  const retentionError =
    !Number.isInteger(retentionNum) || retentionNum <= 0
      ? 'Retention count must be a positive whole number.'
      : undefined;

  const formValid =
    Boolean(applicationName) &&
    Boolean(ns) &&
    !scheduleError &&
    !retentionError &&
    (!alsoReplicate || remotes.length > 0);

  async function handleCreate() {
    setSubmitError(null);
    setPhase('creating');
    try {
      await createSchedule({
        applicationName,
        namespace: ns,
        schedule: buildScheduleSpec(form),
        retentionCount: retentionNum,
        remotes: alsoReplicate ? remotes : [],
        existingTargets: (existingTargets ?? []).map(t => ({
          name: t.metadata.name,
          remoteName: t.jsonData?.spec?.remoteName as string | undefined,
        })),
      });
      setPhase('done');
    } catch (e) {
      setSubmitError(errMessage(e));
      setPhase('error');
    }
  }

  function handleReset() {
    setPhase('idle');
    setSubmitError(null);
    setForm(DEFAULT_FORM);
    setRetentionCount(String(DEFAULT_RETENTION_COUNT));
    setAlsoReplicate(false);
    if (!locked) {
      setApplicationName('');
      setNs('');
      setRemotes([]);
    }
  }

  const creating = phase === 'creating';
  const done = phase === 'done';

  return (
    <Dialog open onClose={creating ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Schedule Snapshots</DialogTitle>
      <DialogContent dividers>
        {done ? (
          <Alert severity="success">
            Schedule created for “{applicationName}”. NDK will take a snapshot{' '}
            {describeSchedule(buildScheduleSpec(form)).toLowerCase()}
            {alsoReplicate && remotes.length > 0
              ? ` and replicate it to ${remotes.length} cluster${remotes.length > 1 ? 's' : ''}`
              : ''}
            , retaining the {retentionNum} most recent snapshots.
          </Alert>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            {submitError && <Alert severity="error">{submitError}</Alert>}

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
                <InputLabel id="ndk-sched-app-label">Application</InputLabel>
                <Select
                  labelId="ndk-sched-app-label"
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

            <FormControl fullWidth>
              <InputLabel id="ndk-recurrence-label">Recurrence</InputLabel>
              <Select
                labelId="ndk-recurrence-label"
                label="Recurrence"
                value={form.type}
                onChange={e => updateForm({ type: e.target.value as RecurrenceType })}
              >
                {RECURRENCE_OPTIONS.map(o => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <RecurrenceFields form={form} updateForm={updateForm} error={scheduleError} />

            <TextField
              label="Retention count"
              type="number"
              value={retentionCount}
              onChange={e => setRetentionCount(e.target.value)}
              fullWidth
              error={Boolean(retentionError)}
              helperText={retentionError ?? 'Number of most-recent snapshots to keep.'}
              inputProps={{ min: 1 }}
            />

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
                  <InputLabel id="ndk-sched-clusters-label">Replicate to clusters</InputLabel>
                  <Select
                    labelId="ndk-sched-clusters-label"
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

            {creating && <LinearProgress />}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {done ? (
          <>
            <Button onClick={handleReset}>Create another</Button>
            <Button variant="contained" onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose} disabled={creating}>
              Cancel
            </Button>
            <Button variant="contained" onClick={handleCreate} disabled={!formValid || creating}>
              Create schedule
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Contextual input(s) for the selected recurrence type.
// ---------------------------------------------------------------------------

interface RecurrenceFieldsProps {
  form: ScheduleFormValues;
  updateForm: (patch: Partial<ScheduleFormValues>) => void;
  error?: string;
}

function RecurrenceFields({ form, updateForm, error }: RecurrenceFieldsProps) {
  if (form.type === 'interval') {
    return (
      <TextField
        label="Every (minutes)"
        type="number"
        value={form.intervalMinutes}
        onChange={e => updateForm({ intervalMinutes: e.target.value })}
        fullWidth
        error={Boolean(error)}
        helperText={error ?? `Minimum ${MIN_SCHEDULE_INTERVAL_MINUTES} minutes between snapshots.`}
        inputProps={{ min: MIN_SCHEDULE_INTERVAL_MINUTES }}
      />
    );
  }
  if (form.type === 'cron') {
    return (
      <TextField
        label="Cron expression"
        value={form.cron}
        onChange={e => updateForm({ cron: e.target.value })}
        fullWidth
        error={Boolean(error)}
        helperText={
          error ?? 'Standard 5-field cron, e.g. "0 2 * * *". Effective interval ≥ 60 min.'
        }
      />
    );
  }
  // daily / weekly / monthly all need a time; weekly/monthly add days/dates.
  return (
    <Stack spacing={2}>
      {form.type === 'weekly' && (
        <TextField
          label="Days"
          value={form.weeklyDays}
          onChange={e => updateForm({ weeklyDays: e.target.value })}
          fullWidth
          helperText='e.g. "MON,WED,FRI" or "1-5" (0=Sun … 6=Sat).'
        />
      )}
      {form.type === 'monthly' && (
        <TextField
          label="Dates"
          value={form.monthlyDates}
          onChange={e => updateForm({ monthlyDates: e.target.value })}
          fullWidth
          helperText='e.g. "1,15" or "2-7" (1-31).'
        />
      )}
      <TextField
        label="Time (HH:MM)"
        value={form.time}
        onChange={e => updateForm({ time: e.target.value })}
        fullWidth
        error={Boolean(error)}
        helperText={error ?? '24-hour local time, e.g. "02:30".'}
      />
    </Stack>
  );
}
