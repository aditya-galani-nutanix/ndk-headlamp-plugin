// Shared formatters and helpers. Owner: P1 (shared).

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

export type SnapshotState = 'ready' | 'error' | 'pending';

export function snapshotState(status?: { readyToUse?: boolean; error?: string }): SnapshotState {
  if (status?.error) {
    return 'error';
  }
  if (status?.readyToUse) {
    return 'ready';
  }
  return 'pending';
}
