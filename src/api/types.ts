// Shared TypeScript interfaces for NDK custom resources.
// Owner: P1 (shared). Field names verified against the k8s-juno backend
// type definitions in api/dataservices/v1alpha1/*_types.go.

export interface NdkObjectMeta {
  name: string;
  namespace?: string;
  uid?: string;
  creationTimestamp?: string;
  annotations?: { [key: string]: string };
  labels?: { [key: string]: string };
}

/** Standard metav1.Condition as written by the NDK controllers. */
export interface KubeCondition {
  type: string;
  status: 'True' | 'False' | 'Unknown' | string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
  observedGeneration?: number;
}

// ---------------------------------------------------------------------------
// ApplicationSnapshot (dataservices.nutanix.com/v1alpha1)
// ---------------------------------------------------------------------------

export interface ApplicationSnapshotSource {
  /** Set when snapshotting an application. */
  applicationRef?: { name: string };
  /** Set when wrapping an existing snapshot content. */
  applicationSnapshotContentName?: string;
}

export interface ApplicationSnapshotSpec {
  /** Required, immutable. Exactly one source member must be set. */
  source: ApplicationSnapshotSource;
  /** Go duration string (e.g. "24h"). Required for out-of-band/manual snapshots. */
  expiresAfter?: string;
  forceDeleteFilesSnapshot?: boolean;
  [key: string]: unknown;
}

/** Terminal failure detail; `status.error` is an object, not a string. */
export interface ApplicationSnapshotError {
  time?: string;
  reason?: string;
  message?: string;
}

export interface ApplicationSnapshotStatus {
  readyToUse?: boolean;
  error?: ApplicationSnapshotError;
  creationTime?: string;
  expirationTime?: string;
  boundApplicationSnapshotContentName?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// ApplicationSnapshotReplication (dataservices.nutanix.com/v1alpha1)
// ---------------------------------------------------------------------------

export interface ApplicationSnapshotReplicationSpec {
  /** metadata.name of the ApplicationSnapshot to replicate. Immutable. */
  applicationSnapshotName: string;
  /** metadata.name of the ReplicationTarget to replicate to. Immutable. */
  replicationTargetName: string;
  [key: string]: unknown;
}

export interface ApplicationSnapshotReplicationStatus {
  /** 0-100 replication progress. */
  replicationCompletionPercent?: number;
  conditions?: KubeCondition[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// ApplicationSnapshotRestore (dataservices.nutanix.com/v1alpha1)
// ---------------------------------------------------------------------------

export interface ApplicationSnapshotRestoreSpec {
  snapshotRef?: { name: string };
  targetNamespace?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// ReplicationTarget (dataservices.nutanix.com/v1alpha1)
// ---------------------------------------------------------------------------

export interface ReplicationTargetSpec {
  remoteName?: string;
  namespaceName?: string;
  serviceAccountName?: string;
  [key: string]: unknown;
}

export interface ReplicationTargetStatus {
  conditions?: KubeCondition[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Remote (dataservices.nutanix.com/v1alpha1, cluster-scoped) — an "available
// cluster" to replicate to. ReplicationTargets reference a Remote by name.
// ---------------------------------------------------------------------------

export interface RemoteSpec {
  clusterName?: string;
  ndkServiceIp?: string;
  ndkServicePort?: number;
  [key: string]: unknown;
}

export interface RemoteStatus {
  conditions?: KubeCondition[];
  clusterID?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// JobScheduler (scheduler.nutanix.com/v1alpha1)
// ---------------------------------------------------------------------------

export interface JobSchedulerSpec {
  schedule?: string; // cron expression
  suspend?: boolean;
  [key: string]: unknown;
}
