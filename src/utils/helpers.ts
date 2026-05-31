// Shared formatters and helpers. Owner: P1 (shared).

import type {
  ApplicationSnapshotReplicationStatus,
  ApplicationSnapshotStatus,
  KubeCondition,
  RemoteStatus,
  ReplicationTargetStatus,
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
