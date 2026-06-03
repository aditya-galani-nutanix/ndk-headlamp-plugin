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
  consistencyType?: string;
  summary?: SnapshotResourceSummary;
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

/**
 * Annotation NDK stamps on an ApplicationSnapshot that was replicated INTO this
 * cluster (value = the source ApplicationSnapshotReplication's UID). A snapshot
 * created locally never carries it, so it is the restorability discriminator.
 * Const name in k8s-juno: consts.AppSnapReplUidAnnotation.
 */
export const REPLICATED_IN_ANNOTATION = 'dataservices.nutanix.com/app-snap-replicate-uid';

export interface ApplicationSnapshotRestoreSpec {
  /** metadata.name of the ApplicationSnapshot to restore. Required, immutable. */
  applicationSnapshotName: string;
  /** Namespace of the snapshot; defaults to the restore CR's own namespace. */
  applicationSnapshotNamespace?: string;
  [key: string]: unknown;
}

/** Terminal/transient failure detail; `status.error` clears on retry. */
export interface ApplicationSnapshotRestoreError {
  time?: string;
  reason?: string;
  message?: string;
}

export interface ApplicationSnapshotRestoreStatus {
  /** true once the restore has finished successfully (null/absent = not done). */
  completed?: boolean;
  error?: ApplicationSnapshotRestoreError;
  conditions?: KubeCondition[];
  startTime?: string;
  finishTime?: string;
  /** Name of the restored Application. */
  boundApplication?: string;
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

/** TLS configuration for connecting to a remote NDK server. */
export interface RemoteTLSConfig {
  /** Skip TLS verification of the remote NDK server certificate. */
  skipTLSVerify?: boolean;
  caBundle?: string;
  enableMTLS?: boolean;
  mTLSClientConfig?: { secretName?: string; secretNamespace?: string };
}

export interface RemoteSpec {
  clusterName?: string;
  ndkServiceIp?: string;
  ndkServicePort?: number;
  tlsConfig?: RemoteTLSConfig;
  [key: string]: unknown;
}

export interface RemoteStatus {
  conditions?: KubeCondition[];
  clusterID?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// StorageCluster (dataservices.nutanix.com/v1alpha1, cluster-scoped) — the
// local PE/PC registration NDK uses to reach its storage backend.
// ---------------------------------------------------------------------------

export interface StorageClusterSpec {
  /** PE cluster UUID (ncli multicluster get-cluster-state -> "Cluster Id"). Immutable. */
  storageServerUuid: string;
  /** PC UUID (ncli cluster info -> "Cluster Uuid"). */
  managementServerUuid?: string;
  [key: string]: unknown;
}

export interface StorageClusterStatus {
  /** True once NDK can reach and use the storage backend. */
  available?: boolean;
  message?: string;
  reason?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// JobScheduler (scheduler.nutanix.com/v1alpha1)
// Field names verified against k8s-job-scheduler api/v1alpha1/jobscheduler_types.go.
// The spec is a one-of: exactly one of interval/daily/weekly/monthly/cronSchedule
// may be set. The spec is immutable once created.
// ---------------------------------------------------------------------------

export interface IntervalSchedule {
  /** Minutes between runs. Must be >= 60 (webhook-enforced). */
  minutes: number;
}

export interface DailySchedule {
  /** "HH:MM" in 24-hr format, e.g. "13:54". */
  time: string;
}

export interface WeeklySchedule {
  /** Days of week, e.g. "MON,WED,FRI", "1-5", or "5". */
  days: string;
  /** "HH:MM" in 24-hr format. */
  time: string;
}

export interface MonthlySchedule {
  /** Dates of month, e.g. "1", "2-7", or "3,7,11". */
  dates: string;
  /** "HH:MM" in 24-hr format. */
  time: string;
}

export interface JobSchedulerSpec {
  interval?: IntervalSchedule;
  daily?: DailySchedule;
  weekly?: WeeklySchedule;
  monthly?: MonthlySchedule;
  /** Standard 5-field cron expression. Effective interval must be >= 60m. */
  cronSchedule?: string;
  /** First trigger time (RFC3339). Must be in the future when set. */
  startTime?: string;
  /** IANA time zone name, e.g. "America/Los_Angeles". */
  timeZoneName?: string;
  [key: string]: unknown;
}

export interface JobSchedulerStatus {
  /** RFC3339 timestamp of the last triggered run. */
  lastActivation?: string;
  /** RFC3339 timestamp of the next scheduled run. */
  nextActivation?: string;
  lastUpdatedAt?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// ProtectionPlan (dataservices.nutanix.com/v1alpha1)
// Field names verified against k8s-juno api/dataservices/v1alpha1/protectionplan_types.go.
// Spec is immutable once created.
// ---------------------------------------------------------------------------

export interface RetentionPolicy {
  labelSelector?: LabelSelector;
  /** Number of most-recent ApplicationSnapshots to retain. */
  retentionCount?: number;
}

export interface ReplicationConfig {
  replicationTargetName?: string;
  labels?: { [key: string]: string };
  annotations?: { [key: string]: string };
}

export interface ProtectionPlanSpec {
  /** "sync" | "async" | "nearSyncDR". The plugin only creates "async". */
  protectionType?: string;
  /** metadata.name of the JobScheduler that defines when snapshots run. */
  scheduleName?: string;
  /** Go duration string; only for protectionType=nearSyncDR. */
  rpo?: string;
  labels?: { [key: string]: string };
  annotations?: { [key: string]: string };
  retentionPolicy?: RetentionPolicy;
  replicationConfigs?: ReplicationConfig[];
  [key: string]: unknown;
}

export interface ProtectionPlanStatus {
  conditions?: KubeCondition[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// AppProtectionPlan (dataservices.nutanix.com/v1alpha1)
// Field names verified against k8s-juno api/dataservices/v1alpha1/appprotectionplan_types.go.
// Spec is immutable once created.
// ---------------------------------------------------------------------------

export interface AppProtectionPlanSpec {
  /** metadata.name of the Application to protect. */
  applicationName: string;
  /** metadata.names of the ProtectionPlans to apply. */
  protectionPlanNames: string[];
  labels?: { [key: string]: string };
  annotations?: { [key: string]: string };
  [key: string]: unknown;
}

export interface ProtectionPlanExecutionStatus {
  protectionPlanName?: string;
  /** Time the plan should have last executed. */
  lastScheduledExecutionTime?: string;
  /** Time the plan was last executed. */
  lastExecutionTime?: string;
}

export interface AppProtectionPlanStatus {
  protectionPlanExecutionStatus?: ProtectionPlanExecutionStatus[];
  conditions?: KubeCondition[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Application (dataservices.nutanix.com/v1alpha1)
// Field names verified against api/dataservices/v1alpha1/application_types.go.
// ---------------------------------------------------------------------------

/** Standard metav1.LabelSelector. */
export interface LabelSelector {
  matchLabels?: { [key: string]: string };
  matchExpressions?: unknown[];
}

export interface GroupKind {
  group?: string;
  kind: string;
}

/** One ORed term of an ApplicationSelector. */
export interface ResourceLabelSelector {
  includeResources?: GroupKind[];
  excludeResources?: GroupKind[];
  labelSelector?: LabelSelector;
}

export interface NamespaceSelector {
  includeNamespaces?: string[];
}

/**
 * Selects which cluster resources belong to the Application. If omitted, NDK
 * protects every resource in the Application's namespace.
 */
export interface ApplicationSelector {
  resourceLabelSelectors?: ResourceLabelSelector[];
  namespaceSelectors?: NamespaceSelector;
}

export interface ApplicationSpec {
  applicationSelector?: ApplicationSelector;
  /** false for newly created apps (snapshot current cluster state). */
  useExistingConfig?: boolean;
  /** true => actively watch + protect the selected resources. */
  start?: boolean;
  [key: string]: unknown;
}

/** A single Kubernetes resource captured by an Application/snapshot. */
export interface ApplicationResource {
  name: string;
  /** Present on skipped artifacts. */
  reason?: string;
  /** Present on failed artifacts. */
  error?: string;
}

/** map of "[group/]version/Kind" -> resource list. */
export type ResourcesByGVK = { [gvk: string]: ApplicationResource[] };
/** map of namespace -> GVK -> resource list. */
export type ResourcesByNamespace = { [namespace: string]: ResourcesByGVK };

export interface ApplicationResourceSummary {
  resources?: ResourcesByGVK;
  resourcesByNamespace?: ResourcesByNamespace;
  skippedResourcesByNamespace?: ResourcesByNamespace;
}

export interface ApplicationStatus {
  summary?: ApplicationResourceSummary;
  lastUpdatedTime?: string;
  conditions?: KubeCondition[];
  error?: { time?: string; message?: string };
  [key: string]: unknown;
}

/** Captured / skipped / failed resources recorded on a ready snapshot. */
export interface SnapshotResourceSummary {
  snapshotArtifacts?: ResourcesByGVK;
  snapshotArtifactsByNamespace?: ResourcesByNamespace;
  skippedSnapshotArtifacts?: ResourcesByGVK;
  skippedSnapshotArtifactsByNamespace?: ResourcesByNamespace;
  failedSnapshotArtifacts?: ResourcesByGVK;
  failedSnapshotArtifactsByNamespace?: ResourcesByNamespace;
}
