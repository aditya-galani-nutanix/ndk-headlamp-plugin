// Shared formatters and helpers. Owner: P1 (shared).

import type {
  ApplicationResourceSummary,
  ApplicationSnapshotReplicationStatus,
  ApplicationSnapshotStatus,
  ApplicationStatus,
  JobSchedulerSpec,
  KubeCondition,
  RemoteStatus,
  ReplicationTargetStatus,
  ResourcesByGVK,
  ResourcesByNamespace,
  SnapshotResourceSummary,
} from '../api/types';

export function formatAge(timestamp?: string): string {
  if (!timestamp) {
    return '-';
  }
  const then = new Date(timestamp).getTime();
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}

/** Find a condition by `type` in a metav1.Condition list. */
export function findCondition(
  conditions: KubeCondition[] | undefined,
  type: string
): KubeCondition | undefined {
  return (conditions ?? []).find(c => c.type === type);
}

// ---------------------------------------------------------------------------
// ApplicationSnapshot status
// ---------------------------------------------------------------------------

export type SnapshotState = 'ready' | 'error' | 'pending';

export function snapshotState(status?: ApplicationSnapshotStatus): SnapshotState {
  if (status?.error) {
    return 'error';
  }
  if (status?.readyToUse) {
    return 'ready';
  }
  return 'pending';
}

/** Human-readable failure detail for a snapshot, if any. */
export function snapshotErrorMessage(status?: ApplicationSnapshotStatus): string | undefined {
  const err = status?.error;
  if (!err) {
    return undefined;
  }
  return err.message || err.reason || 'Snapshot failed';
}

// ---------------------------------------------------------------------------
// ApplicationSnapshotReplication status
// ---------------------------------------------------------------------------

export type ReplicationState = 'available' | 'progressing' | 'blocked' | 'error' | 'pending';

// Progressing=False reasons the backend treats as terminal failures (k8s-juno
// applicationsnapshotreplication: terminalFailureReasons).
const TERMINAL_FAILURE_REASONS = new Set([
  'VolumeSnapshotReplicationFailed',
  'VolumeSnapshotReplicationRetriesExhausted',
  'ApplicationSnapshotExistsOnTarget',
  'appSnapshotExistsOnRemoteStorageBackend',
  'ApplicationActiveOnTarget',
  'ApplicationUnderNearSyncProtection',
  'ApplicationSnapshotTerminalCondition',
]);

// Progressing=False reasons that mean the replication is stuck waiting on an
// external resource that likely needs operator attention (e.g. the
// ReplicationTarget/remote cluster is not healthy). The controller sets
// reason=ClustersNotReady with message "ReplicationTarget is not available".
const BLOCKED_REASONS = new Set(['ClustersNotReady', 'ReplicationTargetNotAvailable']);

export function replicationState(status?: ApplicationSnapshotReplicationStatus): ReplicationState {
  const conditions = status?.conditions ?? [];
  const available = findCondition(conditions, 'Available');
  if (available?.status === 'True') {
    return 'available';
  }

  const progressing = findCondition(conditions, 'Progressing');
  if (progressing?.status === 'False' && progressing.reason) {
    if (TERMINAL_FAILURE_REASONS.has(progressing.reason)) {
      return 'error';
    }
    if (BLOCKED_REASONS.has(progressing.reason)) {
      return 'blocked';
    }
  }

  // Fallback heuristic for any other failing condition whose text reads as an error.
  const failed = conditions.find(
    c => c.status === 'False' && /error|fail/i.test(`${c.reason ?? ''} ${c.message ?? ''}`)
  );
  if (failed) {
    return 'error';
  }

  if (progressing?.status === 'True' || (status?.replicationCompletionPercent ?? 0) > 0) {
    return 'progressing';
  }
  // Available=False with an in-flight reason (Initializing / *Pending) = working.
  if (available?.status === 'False' && available.reason) {
    return 'progressing';
  }
  return 'pending';
}

/** Best-available human message describing replication progress / failure. */
export function replicationMessage(
  status?: ApplicationSnapshotReplicationStatus
): string | undefined {
  const conditions = status?.conditions ?? [];
  const available = findCondition(conditions, 'Available');
  if (available?.status === 'True') {
    return available.message || undefined;
  }
  const progressing = findCondition(conditions, 'Progressing');
  // A blocking/failing Progressing condition carries the most relevant message.
  if (progressing?.status === 'False') {
    return progressing.message || progressing.reason || available?.message || undefined;
  }
  return (
    progressing?.message ||
    available?.message ||
    progressing?.reason ||
    available?.reason ||
    undefined
  );
}

// ---------------------------------------------------------------------------
// ReplicationTarget availability (drives the target dropdown)
// ---------------------------------------------------------------------------

export function targetIsAvailable(status?: ReplicationTargetStatus): boolean {
  return findCondition(status?.conditions, 'Available')?.status === 'True';
}

/** Reason a target is unavailable, for the dropdown tooltip. */
export function targetUnavailableReason(status?: ReplicationTargetStatus): string {
  const available = findCondition(status?.conditions, 'Available');
  if (available?.status === 'True') {
    return '';
  }
  return available?.message || available?.reason || 'Replication target is not available yet';
}

// ---------------------------------------------------------------------------
// Remote (cluster) availability (drives the cluster picker)
// ---------------------------------------------------------------------------

export function remoteIsAvailable(status?: RemoteStatus): boolean {
  return findCondition(status?.conditions, 'Available')?.status === 'True';
}

/** Reason a remote cluster is unavailable, for the picker tooltip. */
export function remoteUnavailableReason(status?: RemoteStatus): string {
  const available = findCondition(status?.conditions, 'Available');
  if (available?.status === 'True') {
    return '';
  }
  return available?.message || available?.reason || 'Remote cluster is not available yet';
}

// ---------------------------------------------------------------------------
// Resource-name helpers (RFC 1123: lowercase alphanumeric + '-', <= 63 chars)
// ---------------------------------------------------------------------------

/** Coerce an arbitrary string into a valid RFC 1123 subdomain segment. */
export function sanitizeRFC1123(name: string, maxLength = 63): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
  return cleaned || 'snap';
}

function randomSuffix(length = 5): string {
  const charset = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += charset[Math.floor(Math.random() * charset.length)];
  }
  return out;
}

/** Default, editable snapshot name, e.g. "my-app-snap-1748600000". */
export function makeSnapshotName(applicationName: string): string {
  const ts = Math.floor(Date.now() / 1000);
  return sanitizeRFC1123(`${applicationName}-snap-${ts}`);
}

// DNS-1035 label: starts with a letter, lowercase alphanumeric + '-', ends with
// an alphanumeric, max 63 chars. The NDK ApplicationSnapshot webhook rejects
// names that fail IsDNS1035Label, so we mirror that rule in the form.
const DNS1035_LABEL = /^[a-z]([-a-z0-9]*[a-z0-9])?$/;

/**
 * Validate a user-entered snapshot name against the backend's naming rule.
 * Returns an error string, or undefined when the name is acceptable.
 */
export function snapshotNameFormatError(name: string): string | undefined {
  const n = name.trim();
  if (!n) {
    return 'Name is required.';
  }
  if (n.length > 63) {
    return 'Name must be 63 characters or fewer.';
  }
  if (!DNS1035_LABEL.test(n)) {
    return 'Must start with a lowercase letter and use only lowercase letters, numbers and dashes.';
  }
  return undefined;
}

/**
 * Unique replication name for a (snapshot, target) pair. Mirrors the backend
 * CLI's GetRFC1123NameWithRandomSuffix: keep a random suffix and truncate the
 * readable base so the total stays within 63 characters.
 */
export function makeReplicationName(snapshotName: string, targetName: string): string {
  const suffix = `-${randomSuffix()}`;
  const base = sanitizeRFC1123(`${snapshotName}-${targetName}`, 63 - suffix.length);
  return sanitizeRFC1123(`${base}${suffix}`);
}

/**
 * Stable ReplicationTarget name for a remote within a namespace. We key the
 * target on the remote so a namespace ends up with at most one auto-created
 * target per remote (the plugin reuses an existing one when present).
 */
export function makeReplicationTargetName(remoteName: string): string {
  return sanitizeRFC1123(`rt-${remoteName}`);
}

// ---------------------------------------------------------------------------
// Expiry options for the manual snapshot form (all under the 60-day max).
// Values are Go duration strings accepted by spec.expiresAfter.
// ---------------------------------------------------------------------------

export interface ExpiryOption {
  label: string;
  value: string;
}

export const EXPIRY_OPTIONS: ExpiryOption[] = [
  { label: '24 hours', value: '24h' },
  { label: '48 hours', value: '48h' },
  { label: '72 hours', value: '72h' },
  { label: '1 week', value: '168h' },
  { label: '30 days', value: '720h' },
];

export const DEFAULT_EXPIRY = '24h';

// ---------------------------------------------------------------------------
// Application status (drives the Application list + dashboard)
// ---------------------------------------------------------------------------

export type ApplicationState = 'active' | 'collecting' | 'error' | 'inactive' | 'pending';

export function applicationState(status?: ApplicationStatus): ApplicationState {
  if (status?.error) {
    return 'error';
  }
  const active = findCondition(status?.conditions, 'Active');
  if (active?.status === 'True') {
    return 'active';
  }
  if (active?.status === 'False') {
    if (active.reason && /collect|initializ/i.test(active.reason)) {
      return 'collecting';
    }
    if (active.reason && /fail/i.test(active.reason)) {
      return 'error';
    }
    return 'inactive';
  }
  return 'pending';
}

/** Human message for an Application's current condition, if any. */
export function applicationMessage(status?: ApplicationStatus): string | undefined {
  if (status?.error?.message) {
    return status.error.message;
  }
  const active = findCondition(status?.conditions, 'Active');
  return active?.message || active?.reason || undefined;
}

// ---------------------------------------------------------------------------
// Resource summary helpers (shared by Application + ApplicationSnapshot)
// ---------------------------------------------------------------------------

export interface ParsedGVK {
  group: string;
  version: string;
  kind: string;
}

/** Parse a "[group/]version/Kind" key as written by the NDK controllers. */
export function parseGVK(gvk: string): ParsedGVK {
  const parts = gvk.split('/');
  if (parts.length >= 3) {
    return { group: parts[0], version: parts[1], kind: parts.slice(2).join('/') };
  }
  if (parts.length === 2) {
    return { group: '', version: parts[0], kind: parts[1] };
  }
  return { group: '', version: '', kind: gvk };
}

export interface CapturedResource {
  name: string;
  namespace?: string;
  reason?: string;
  error?: string;
}

export interface ResourceKindGroup {
  kind: string;
  group: string;
  resources: CapturedResource[];
}

function pushInto(
  byKind: Map<string, ResourceKindGroup>,
  gvk: string,
  list: { name: string; reason?: string; error?: string }[] | undefined,
  namespace?: string
): void {
  const { kind, group } = parseGVK(gvk);
  const key = `${group}/${kind}`;
  let g = byKind.get(key);
  if (!g) {
    g = { kind, group, resources: [] };
    byKind.set(key, g);
  }
  for (const r of list ?? []) {
    g.resources.push({ name: r.name, namespace, reason: r.reason, error: r.error });
  }
}

/**
 * Collapse the two backend shapes (the namespaced map and the deprecated flat
 * map) into a single list of resources grouped by Kind, sorted by Kind. Prefers
 * the namespaced map when present so resources are never double-counted.
 */
export function groupResourcesByKind(
  byNamespace?: ResourcesByNamespace,
  flat?: ResourcesByGVK
): ResourceKindGroup[] {
  const byKind = new Map<string, ResourceKindGroup>();
  const hasByNs = byNamespace && Object.keys(byNamespace).length > 0;
  if (hasByNs) {
    for (const ns of Object.keys(byNamespace as ResourcesByNamespace)) {
      const gvks = (byNamespace as ResourcesByNamespace)[ns] ?? {};
      for (const gvk of Object.keys(gvks)) {
        pushInto(byKind, gvk, gvks[gvk], ns);
      }
    }
  } else if (flat) {
    for (const gvk of Object.keys(flat)) {
      pushInto(byKind, gvk, flat[gvk]);
    }
  }
  return [...byKind.values()].sort((a, b) => a.kind.localeCompare(b.kind));
}

export interface SnapshotArtifacts {
  captured: ResourceKindGroup[];
  skipped: ResourceKindGroup[];
  failed: ResourceKindGroup[];
  total: number;
}

/** Group a snapshot's captured / skipped / failed artifacts by Kind. */
export function groupSnapshotArtifacts(summary?: SnapshotResourceSummary): SnapshotArtifacts {
  const captured = groupResourcesByKind(
    summary?.snapshotArtifactsByNamespace,
    summary?.snapshotArtifacts
  );
  const skipped = groupResourcesByKind(
    summary?.skippedSnapshotArtifactsByNamespace,
    summary?.skippedSnapshotArtifacts
  );
  const failed = groupResourcesByKind(
    summary?.failedSnapshotArtifactsByNamespace,
    summary?.failedSnapshotArtifacts
  );
  const total = captured.reduce((n, g) => n + g.resources.length, 0);
  return { captured, skipped, failed, total };
}

/** Total number of resources an Application currently protects. */
export function countApplicationResources(summary?: ApplicationResourceSummary): number {
  return groupResourcesByKind(summary?.resourcesByNamespace, summary?.resources).reduce(
    (n, g) => n + g.resources.length,
    0
  );
}

/** Map a Kubernetes Kind to an mdi icon for the resource cards. */
export function kindIcon(kind: string): string {
  const k = kind.toLowerCase();
  if (k.includes('persistentvolumeclaim') || k.includes('persistentvolume')) {
    return 'mdi:database-outline';
  }
  if (k.includes('statefulset')) {
    return 'mdi:database-cog-outline';
  }
  if (k.includes('deployment')) {
    return 'mdi:rocket-launch-outline';
  }
  if (k.includes('daemonset')) {
    return 'mdi:server-network-outline';
  }
  if (k.includes('replicaset')) {
    return 'mdi:layers-outline';
  }
  if (k === 'pod') {
    return 'mdi:cube-outline';
  }
  if (k.includes('configmap')) {
    return 'mdi:file-cog-outline';
  }
  if (k.includes('secret')) {
    return 'mdi:key-outline';
  }
  if (k.includes('serviceaccount')) {
    return 'mdi:account-outline';
  }
  if (k.includes('service')) {
    return 'mdi:lan';
  }
  if (k.includes('ingress')) {
    return 'mdi:directions-fork';
  }
  if (k.includes('role') || k.includes('binding')) {
    return 'mdi:shield-account-outline';
  }
  if (k.includes('job')) {
    return 'mdi:briefcase-outline';
  }
  return 'mdi:kubernetes';
}

// ---------------------------------------------------------------------------
// Application-name helper for the create form.
// ---------------------------------------------------------------------------

/** Suggested default Application name for a namespace, e.g. "mongo-app". */
export function makeApplicationName(namespace: string): string {
  return sanitizeRFC1123(`${namespace || 'ndk'}-app`);
}

// ---------------------------------------------------------------------------
// Job scheduler (recurring snapshots) — names, options, formatting, validation.
// Mirrors the rules enforced by the k8s-job-scheduler webhook and the
// `ndkcli create protectionplan` naming (GetRFC1123NameWithRandomSuffix).
// ---------------------------------------------------------------------------

/** "js-<app>-<rand>" — the JobScheduler name for an application's schedule. */
export function makeJobSchedulerName(applicationName: string): string {
  const suffix = `-${randomSuffix()}`;
  const base = sanitizeRFC1123(`js-${applicationName}`, 63 - suffix.length);
  return sanitizeRFC1123(`${base}${suffix}`);
}

/** "pplan-<app>-<rand>" — the ProtectionPlan name for an application's schedule. */
export function makeProtectionPlanName(applicationName: string): string {
  const suffix = `-${randomSuffix()}`;
  const base = sanitizeRFC1123(`pplan-${applicationName}`, 63 - suffix.length);
  return sanitizeRFC1123(`${base}${suffix}`);
}

/** "appplan-<app>-<rand>" — the AppProtectionPlan name binding an app to a plan. */
export function makeAppProtectionPlanName(applicationName: string): string {
  const suffix = `-${randomSuffix()}`;
  const base = sanitizeRFC1123(`appplan-${applicationName}`, 63 - suffix.length);
  return sanitizeRFC1123(`${base}${suffix}`);
}

export type RecurrenceType = 'interval' | 'daily' | 'weekly' | 'monthly' | 'cron';

export interface RecurrenceOption {
  label: string;
  value: RecurrenceType;
}

export const RECURRENCE_OPTIONS: RecurrenceOption[] = [
  { label: 'Interval (every N minutes)', value: 'interval' },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Cron expression', value: 'cron' },
];

/** Minimum interval (minutes) between runs, enforced by the backend webhook. */
export const MIN_SCHEDULE_INTERVAL_MINUTES = 60;
export const DEFAULT_RETENTION_COUNT = 10;

/** Raw form inputs for the schedule, before building the JobScheduler spec. */
export interface ScheduleFormValues {
  type: RecurrenceType;
  /** interval: minutes. */
  intervalMinutes: string;
  /** daily/weekly/monthly: "HH:MM". */
  time: string;
  /** weekly: days, e.g. "MON,WED,FRI" or "1-5". */
  weeklyDays: string;
  /** monthly: dates, e.g. "1,15" or "2-7". */
  monthlyDates: string;
  /** cron: 5-field cron expression. */
  cron: string;
}

const TIME_24H = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** Build a JobSchedulerSpec from the form values (one recurrence member set). */
export function buildScheduleSpec(v: ScheduleFormValues): JobSchedulerSpec {
  switch (v.type) {
    case 'interval':
      return { interval: { minutes: Number(v.intervalMinutes) } };
    case 'daily':
      return { daily: { time: v.time.trim() } };
    case 'weekly':
      return { weekly: { days: v.weeklyDays.trim(), time: v.time.trim() } };
    case 'monthly':
      return { monthly: { dates: v.monthlyDates.trim(), time: v.time.trim() } };
    case 'cron':
      return { cronSchedule: v.cron.trim() };
    default:
      return {};
  }
}

/**
 * Validate the schedule form against the backend's rules. Returns an error
 * string, or undefined when the values are acceptable.
 */
export function scheduleFormError(v: ScheduleFormValues): string | undefined {
  switch (v.type) {
    case 'interval': {
      const n = Number(v.intervalMinutes);
      if (!Number.isInteger(n)) {
        return 'Interval must be a whole number of minutes.';
      }
      if (n < MIN_SCHEDULE_INTERVAL_MINUTES) {
        return `Interval must be at least ${MIN_SCHEDULE_INTERVAL_MINUTES} minutes.`;
      }
      return undefined;
    }
    case 'daily':
      return TIME_24H.test(v.time.trim()) ? undefined : 'Time must be in HH:MM 24-hour format.';
    case 'weekly':
      if (!v.weeklyDays.trim()) {
        return 'Specify one or more days, e.g. "MON,WED,FRI" or "1-5".';
      }
      return TIME_24H.test(v.time.trim()) ? undefined : 'Time must be in HH:MM 24-hour format.';
    case 'monthly':
      if (!v.monthlyDates.trim()) {
        return 'Specify one or more dates, e.g. "1,15" or "2-7".';
      }
      return TIME_24H.test(v.time.trim()) ? undefined : 'Time must be in HH:MM 24-hour format.';
    case 'cron': {
      const parts = v.cron.trim().split(/\s+/);
      if (v.cron.trim() === '' || parts.length !== 5) {
        return 'Cron must have 5 fields: minute hour day month day-of-week.';
      }
      // Enforce the same >= 60-minute floor as the interval recurrence (and the
      // backend webhook). A schedule runs more than once per hour exactly when
      // the minute field selects more than one minute — i.e. it is anything
      // other than a single fixed value (so "*", "*/15", "0-5", "0,30" are all
      // sub-hourly). A single minute value fires at most once per hour.
      if (!/^[0-5]?\d$/.test(parts[0])) {
        return `Cron must run at most once per hour (effective interval ≥ ${MIN_SCHEDULE_INTERVAL_MINUTES} min). Use a single minute value, e.g. "0 2 * * *".`;
      }
      return undefined;
    }
    default:
      return 'Select a recurrence type.';
  }
}

/** Human-readable description of a JobScheduler spec, e.g. "Daily at 02:30". */
export function describeSchedule(spec?: JobSchedulerSpec): string {
  if (!spec) {
    return '—';
  }
  if (spec.interval) {
    return `Every ${spec.interval.minutes} min`;
  }
  if (spec.daily) {
    return `Daily at ${spec.daily.time}`;
  }
  if (spec.weekly) {
    return `Weekly on ${spec.weekly.days} at ${spec.weekly.time}`;
  }
  if (spec.monthly) {
    return `Monthly on ${spec.monthly.dates} at ${spec.monthly.time}`;
  }
  if (spec.cronSchedule) {
    return `Cron: ${spec.cronSchedule}`;
  }
  return '—';
}

/** Format an RFC3339 timestamp as a short local date-time, or "—" when absent. */
export function formatTimestamp(timestamp?: string): string {
  if (!timestamp) {
    return '—';
  }
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleString();
}

export type ProtectionPlanState = 'available' | 'degraded' | 'pending';

/** Map a ProtectionPlan / AppProtectionPlan condition list to a simple state. */
export function protectionPlanState(conditions?: KubeCondition[]): ProtectionPlanState {
  if (findCondition(conditions, 'Degraded')?.status === 'True') {
    return 'degraded';
  }
  if (findCondition(conditions, 'Available')?.status === 'True') {
    return 'available';
  }
  return 'pending';
}
