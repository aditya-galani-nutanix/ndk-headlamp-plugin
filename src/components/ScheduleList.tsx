// Owner: P3 — Schedule list with execution history + delete.
//
// A "schedule" is the AppProtectionPlan (binds an Application to a ProtectionPlan)
// joined to its ProtectionPlan (retention + replication recipe) and the
// JobScheduler that ProtectionPlan references (the recurrence + next/last run).
// Delete removes the whole chain (AppProtectionPlan + ProtectionPlan + JobScheduler).
import { Icon } from '@iconify/react';
import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import {
  AppProtectionPlanClass,
  JobSchedulerClass,
  ProtectionPlanClass,
} from '../api/ndk-resources';
import { deleteScheduleCascade } from '../api/schedule-actions';
import type { JobSchedulerSpec, ProtectionPlanSpec } from '../api/types';
import {
  describeSchedule,
  formatAge,
  formatTimestamp,
  protectionPlanState,
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

export interface ScheduleListProps {
  /** Scope the list to a single namespace. */
  namespace?: string;
  /** Scope to a single application (matches spec.applicationName). */
  application?: string;
  title?: string;
}

interface ScheduleRow {
  appPlanName: string;
  namespace: string;
  applicationName: string;
  protectionPlanName?: string;
  jobSchedulerName?: string;
  scheduleSpec?: JobSchedulerSpec;
  retentionCount?: number;
  replicationTargets: string[];
  nextActivation?: string;
  lastActivation?: string;
  available: ReturnType<typeof protectionPlanState>;
  creationTimestamp?: string;
}

function StatusChip({ state }: { state: ReturnType<typeof protectionPlanState> }) {
  if (state === 'available') {
    return <Chip size="small" color="success" label="Active" />;
  }
  if (state === 'degraded') {
    return <Chip size="small" color="error" label="Degraded" />;
  }
  return <Chip size="small" variant="outlined" label="Pending" />;
}

export function ScheduleList({ namespace, application, title = 'Schedules' }: ScheduleListProps) {
  const [appPlans] = AppProtectionPlanClass.useList(namespace ? { namespace } : {});
  const [protectionPlans] = ProtectionPlanClass.useList(namespace ? { namespace } : {});
  const [jobSchedulers] = JobSchedulerClass.useList(namespace ? { namespace } : {});

  const [deleteFor, setDeleteFor] = useState<ScheduleRow | null>(null);

  function planByName(ns: string, name?: string) {
    if (!name) {
      return undefined;
    }
    return (protectionPlans ?? []).find(
      p => p.metadata.name === name && (p.metadata.namespace ?? '') === ns
    );
  }

  function schedulerByName(ns: string, name?: string) {
    if (!name) {
      return undefined;
    }
    return (jobSchedulers ?? []).find(
      s => s.metadata.name === name && (s.metadata.namespace ?? '') === ns
    );
  }

  const rows: ScheduleRow[] | null =
    appPlans === null
      ? null
      : appPlans
          .filter(ap => !application || ap.jsonData?.spec?.applicationName === application)
          .map(ap => {
            const ns = ap.metadata.namespace ?? '';
            const protectionPlanName = (ap.jsonData?.spec?.protectionPlanNames ?? [])[0];
            const plan = planByName(ns, protectionPlanName);
            const planSpec = plan?.jsonData?.spec as ProtectionPlanSpec | undefined;
            const scheduler = schedulerByName(ns, planSpec?.scheduleName);
            const schedStatus = scheduler?.jsonData?.status;
            return {
              appPlanName: ap.metadata.name,
              namespace: ns,
              applicationName: ap.jsonData?.spec?.applicationName ?? '—',
              protectionPlanName,
              jobSchedulerName: planSpec?.scheduleName,
              scheduleSpec: scheduler?.jsonData?.spec as JobSchedulerSpec | undefined,
              retentionCount: planSpec?.retentionPolicy?.retentionCount,
              replicationTargets: (planSpec?.replicationConfigs ?? [])
                .map(c => c.replicationTargetName)
                .filter((n): n is string => Boolean(n)),
              nextActivation: schedStatus?.nextActivation,
              lastActivation: schedStatus?.lastActivation,
              available: protectionPlanState(ap.jsonData?.status?.conditions),
              creationTimestamp: ap.metadata.creationTimestamp,
            };
          });

  return (
    <>
      <SectionBox title={title}>
        <SimpleTable
          emptyMessage="No snapshot schedules yet. Use “Schedule Snapshots” to create one."
          columns={[
            { label: 'Application', getter: (r: ScheduleRow) => r.applicationName, sort: true },
            { label: 'Namespace', getter: (r: ScheduleRow) => r.namespace || '—', sort: true },
            { label: 'Schedule', getter: (r: ScheduleRow) => describeSchedule(r.scheduleSpec) },
            { label: 'Retention', getter: (r: ScheduleRow) => r.retentionCount ?? '—' },
            {
              label: 'Replication',
              getter: (r: ScheduleRow) =>
                r.replicationTargets.length > 0 ? (
                  <Stack direction="row" spacing={0.5} flexWrap="wrap">
                    {r.replicationTargets.map(t => (
                      <Chip key={t} size="small" label={t} />
                    ))}
                  </Stack>
                ) : (
                  '—'
                ),
            },
            { label: 'Next run', getter: (r: ScheduleRow) => formatTimestamp(r.nextActivation) },
            { label: 'Last run', getter: (r: ScheduleRow) => formatTimestamp(r.lastActivation) },
            {
              label: 'Status',
              getter: (r: ScheduleRow) => <StatusChip state={r.available} />,
            },
            {
              label: 'Age',
              getter: (r: ScheduleRow) => formatAge(r.creationTimestamp),
              sort: (a: ScheduleRow, b: ScheduleRow) =>
                new Date(a.creationTimestamp ?? 0).getTime() -
                new Date(b.creationTimestamp ?? 0).getTime(),
            },
            {
              label: 'Actions',
              cellProps: { align: 'right' },
              getter: (r: ScheduleRow) => (
                <Tooltip title="Delete schedule (schedule, plan and binding)">
                  <IconButton
                    size="small"
                    color="error"
                    aria-label="Delete schedule"
                    onClick={() => setDeleteFor(r)}
                  >
                    <Icon icon="mdi:delete" width={20} />
                  </IconButton>
                </Tooltip>
              ),
            },
          ]}
          data={rows}
        />
      </SectionBox>
      {deleteFor && <DeleteScheduleDialog row={deleteFor} onClose={() => setDeleteFor(null)} />}
    </>
  );
}

interface RowDialogProps {
  row: ScheduleRow;
  onClose: () => void;
}

function DeleteScheduleDialog({ row, onClose }: RowDialogProps) {
  const [phase, setPhase] = useState<'idle' | 'working' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setPhase('working');
    setError(null);
    try {
      await deleteScheduleCascade({
        namespace: row.namespace,
        appProtectionPlanName: row.appPlanName,
        protectionPlanName: row.protectionPlanName,
        jobSchedulerName: row.jobSchedulerName,
      });
      setPhase('done');
    } catch (e) {
      setError(errMessage(e));
      setPhase('idle');
    }
  }

  return (
    <Dialog open onClose={phase === 'working' ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Delete schedule</DialogTitle>
      <DialogContent dividers>
        {phase === 'done' ? (
          <Alert severity="success">
            Schedule for “{row.applicationName}” deleted. No new snapshots will be taken. Snapshots
            already created are not removed.
          </Alert>
        ) : (
          <Stack spacing={2}>
            <Typography variant="body2">
              This deletes the schedule for “{row.applicationName}”, including its recurrence
              definition, protection plan and binding. Snapshots already created are not removed.
              This cannot be undone.
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
            {phase === 'working' && <LinearProgress />}
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
            <Button onClick={onClose} disabled={phase === 'working'}>
              Cancel
            </Button>
            <Button
              variant="contained"
              color="error"
              onClick={handleDelete}
              disabled={phase === 'working'}
              startIcon={<Icon icon="mdi:delete" />}
            >
              Delete schedule
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
