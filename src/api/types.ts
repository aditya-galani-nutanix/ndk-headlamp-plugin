// Shared TypeScript interfaces for NDK custom resources.
// Owner: P1 (shared). Extend these as the real CRD spec/status fields are confirmed.

export interface NdkObjectMeta {
  name: string;
  namespace?: string;
  uid?: string;
  creationTimestamp?: string;
  annotations?: { [key: string]: string };
  labels?: { [key: string]: string };
}

export interface ApplicationSnapshotSpec {
  applicationRef?: { name: string };
  expirationTime?: string;
  [key: string]: unknown;
}

export interface ApplicationSnapshotStatus {
  readyToUse?: boolean;
  phase?: string;
  error?: string;
  [key: string]: unknown;
}

export interface ApplicationSnapshotReplicationSpec {
  snapshotRef?: { name: string };
  replicationTargetRef?: { name: string };
  [key: string]: unknown;
}

export interface ApplicationSnapshotRestoreSpec {
  snapshotRef?: { name: string };
  targetNamespace?: string;
  [key: string]: unknown;
}

export interface JobSchedulerSpec {
  schedule?: string; // cron expression
  suspend?: boolean;
  [key: string]: unknown;
}
