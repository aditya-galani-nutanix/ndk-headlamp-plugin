// Shared K8s API factories for all NDK CRDs.
// Owner: P1 (shared) — everyone imports these classes.
//
// Groups/versions confirmed against the live cluster:
//   dataservices.nutanix.com/v1alpha1  (applications, applicationsnapshots,
//     applicationsnapshotreplications, applicationsnapshotrestores,
//     replicationtargets, remotes)
//   scheduler.nutanix.com/v1alpha1     (jobschedulers)

import { K8s } from '@kinvolk/headlamp-plugin/lib';

const { makeCustomResourceClass } = K8s.crd;

const NDK_GROUP = 'dataservices.nutanix.com';
const NDK_VERSION = 'v1alpha1';
const SCHED_GROUP = 'scheduler.nutanix.com';
const SCHED_VERSION = 'v1alpha1';

export const ApplicationClass = makeCustomResourceClass({
  apiInfo: [{ group: NDK_GROUP, version: NDK_VERSION }],
  kind: 'Application',
  pluralName: 'applications',
  singularName: 'application',
  isNamespaced: true,
});

export const ApplicationSnapshotClass = makeCustomResourceClass({
  apiInfo: [{ group: NDK_GROUP, version: NDK_VERSION }],
  kind: 'ApplicationSnapshot',
  pluralName: 'applicationsnapshots',
  singularName: 'applicationsnapshot',
  isNamespaced: true,
});

export const ApplicationSnapshotReplicationClass = makeCustomResourceClass({
  apiInfo: [{ group: NDK_GROUP, version: NDK_VERSION }],
  kind: 'ApplicationSnapshotReplication',
  pluralName: 'applicationsnapshotreplications',
  singularName: 'applicationsnapshotreplication',
  isNamespaced: true,
});

export const ApplicationSnapshotRestoreClass = makeCustomResourceClass({
  apiInfo: [{ group: NDK_GROUP, version: NDK_VERSION }],
  kind: 'ApplicationSnapshotRestore',
  pluralName: 'applicationsnapshotrestores',
  singularName: 'applicationsnapshotrestore',
  isNamespaced: true,
});

export const ReplicationTargetClass = makeCustomResourceClass({
  apiInfo: [{ group: NDK_GROUP, version: NDK_VERSION }],
  kind: 'ReplicationTarget',
  pluralName: 'replicationtargets',
  singularName: 'replicationtarget',
  isNamespaced: true,
});

// Remote is cluster-scoped (used by P1 auto-discovery).
export const RemoteClass = makeCustomResourceClass({
  apiInfo: [{ group: NDK_GROUP, version: NDK_VERSION }],
  kind: 'Remote',
  pluralName: 'remotes',
  singularName: 'remote',
  isNamespaced: false,
});

// StorageCluster is cluster-scoped — the local PE/PC registration NDK uses to
// reach its storage backend. NDK supports exactly one local StorageCluster.
export const StorageClusterClass = makeCustomResourceClass({
  apiInfo: [{ group: NDK_GROUP, version: NDK_VERSION }],
  kind: 'StorageCluster',
  pluralName: 'storageclusters',
  singularName: 'storagecluster',
  isNamespaced: false,
});

export const JobSchedulerClass = makeCustomResourceClass({
  apiInfo: [{ group: SCHED_GROUP, version: SCHED_VERSION }],
  kind: 'JobScheduler',
  pluralName: 'jobschedulers',
  singularName: 'jobscheduler',
  isNamespaced: true,
});

// ProtectionPlan references a JobScheduler (spec.scheduleName) and defines the
// retention + replication recipe for the snapshots created on that schedule.
export const ProtectionPlanClass = makeCustomResourceClass({
  apiInfo: [{ group: NDK_GROUP, version: NDK_VERSION }],
  kind: 'ProtectionPlan',
  pluralName: 'protectionplans',
  singularName: 'protectionplan',
  isNamespaced: true,
});

// AppProtectionPlan binds an Application to one or more ProtectionPlans, which is
// what actually drives recurring snapshots for that application.
export const AppProtectionPlanClass = makeCustomResourceClass({
  apiInfo: [{ group: NDK_GROUP, version: NDK_VERSION }],
  kind: 'AppProtectionPlan',
  pluralName: 'appprotectionplans',
  singularName: 'appprotectionplan',
  isNamespaced: true,
});
