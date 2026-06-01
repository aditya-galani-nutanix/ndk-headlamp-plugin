// Imperative write helpers that "trigger" the NDK workflow by creating CR
// objects through the Kubernetes API server. This is exactly what `ndkcli`
// does internally (see k8s-juno pkg/ndkcli/{create,replicate}); we just POST
// from the browser via Headlamp's generated resource classes.
// Owner: P2.

import { makeReplicationTargetName } from '../utils/helpers';
import {
  ApplicationClass,
  ApplicationSnapshotClass,
  ApplicationSnapshotReplicationClass,
  ApplicationSnapshotRestoreClass,
  ReplicationTargetClass,
} from './ndk-resources';

export const NDK_GROUP_VERSION = 'dataservices.nutanix.com/v1alpha1';

export interface CreateApplicationArgs {
  name: string;
  namespace: string;
  /**
   * Optional label selector (matchLabels). When empty/omitted, NDK protects
   * every resource in the namespace.
   */
  matchLabels?: { [key: string]: string };
  /** Optional extra namespaces to include (namespaceSelectors.includeNamespaces). */
  includeNamespaces?: string[];
  /** Start watching + protecting immediately. Defaults to true. */
  start?: boolean;
}

/**
 * POST an Application CR. Mirrors how `ndkcli` / kubectl onboard an app: write
 * the desired selector and let the Application controller collect the matching
 * resources. We never set the NDK-managed globalID/incarnation fields, and keep
 * useExistingConfig=false (correct for a brand-new application).
 */
export function createApplication({
  name,
  namespace,
  matchLabels,
  includeNamespaces,
  start = true,
}: CreateApplicationArgs): Promise<unknown> {
  const selector: Record<string, unknown> = {};
  if (matchLabels && Object.keys(matchLabels).length > 0) {
    selector.resourceLabelSelectors = [{ labelSelector: { matchLabels } }];
  }
  if (includeNamespaces && includeNamespaces.length > 0) {
    selector.namespaceSelectors = { includeNamespaces };
  }
  const spec: Record<string, unknown> = { start, useExistingConfig: false };
  if (Object.keys(selector).length > 0) {
    spec.applicationSelector = selector;
  }
  return ApplicationClass.apiEndpoint.post({
    apiVersion: NDK_GROUP_VERSION,
    kind: 'Application',
    metadata: { name, namespace },
    spec,
  });
}

export interface CreateSnapshotArgs {
  name: string;
  namespace: string;
  applicationName: string;
  /** Go duration string, e.g. "24h". Required for out-of-band snapshots. */
  expiresAfter: string;
}

/** POST an ApplicationSnapshot (equivalent to `ndkcli create snapshot`). */
export function createSnapshot({
  name,
  namespace,
  applicationName,
  expiresAfter,
}: CreateSnapshotArgs): Promise<unknown> {
  return ApplicationSnapshotClass.apiEndpoint.post({
    apiVersion: NDK_GROUP_VERSION,
    kind: 'ApplicationSnapshot',
    metadata: { name, namespace },
    spec: {
      source: { applicationRef: { name: applicationName } },
      expiresAfter,
    },
  });
}

export interface DeleteSnapshotArgs {
  name: string;
  namespace: string;
  /**
   * metadata.names of the ApplicationSnapshotReplication CRs that reference this
   * snapshot (spec.applicationSnapshotName === name). They are deleted first.
   */
  replicationNames?: string[];
}

function isNotFound(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return status === 404 || /not\s*found/i.test(msg);
}

/**
 * Delete an ApplicationSnapshot, cascading to its replications first.
 *
 * Why the explicit cascade (confirmed against k8s-juno):
 *  - NDK does NOT set an ownerReference from ApplicationSnapshotReplication (ASR)
 *    to the ApplicationSnapshot, so Kubernetes garbage collection will NOT remove
 *    the ASRs when the snapshot is deleted.
 *  - While an ASR exists it places a per-ASR finalizer on the source snapshot
 *    (operations.go: EnsureFinalizer(... appSnapshot)). The snapshot controller
 *    refuses to finalize a snapshot that carries any finalizer other than its own
 *    ("snapshot is being used by some other resource(s)"), so a snapshot with live
 *    replications would otherwise hang in Terminating forever.
 *  - Deleting an ASR runs its finalizer cleanup, which releases the finalizer it
 *    placed on the snapshot (and on the ReplicationTarget).
 *
 * Once the ASRs are gone, deleting the snapshot lets the snapshot controller
 * garbage-collect the bound ApplicationSnapshotContent and its volume snapshots.
 * We do not force-remove finalizers; the controllers do the real cleanup.
 */
export async function deleteSnapshotCascade({
  name,
  namespace,
  replicationNames = [],
}: DeleteSnapshotArgs): Promise<void> {
  for (const repName of replicationNames) {
    try {
      await ApplicationSnapshotReplicationClass.apiEndpoint.delete(namespace, repName);
    } catch (e) {
      if (!isNotFound(e)) {
        throw e;
      }
    }
  }
  try {
    await ApplicationSnapshotClass.apiEndpoint.delete(namespace, name);
  } catch (e) {
    if (!isNotFound(e)) {
      throw e;
    }
  }
}

export interface ReplicateSnapshotArgs {
  name: string;
  namespace: string;
  applicationSnapshotName: string;
  replicationTargetName: string;
}

/**
 * POST an ApplicationSnapshotReplication (equivalent to `ndkcli replicate
 * snapshot`). The spec is immutable, so a new object is created per target.
 */
export function replicateSnapshot({
  name,
  namespace,
  applicationSnapshotName,
  replicationTargetName,
}: ReplicateSnapshotArgs): Promise<unknown> {
  return ApplicationSnapshotReplicationClass.apiEndpoint.post({
    apiVersion: NDK_GROUP_VERSION,
    kind: 'ApplicationSnapshotReplication',
    metadata: { name, namespace },
    spec: {
      applicationSnapshotName,
      replicationTargetName,
    },
  });
}

export interface CreateRestoreArgs {
  name: string;
  namespace: string;
  /** metadata.name of the ApplicationSnapshot to restore. */
  applicationSnapshotName: string;
  /** Namespace of the snapshot. Defaults to `namespace` on the backend. */
  applicationSnapshotNamespace?: string;
}

/**
 * POST an ApplicationSnapshotRestore (equivalent to `ndkcli perform restore`).
 * The controller recreates the application's resources from the snapshot into
 * this CR's namespace. The spec is immutable, so each restore is a new object.
 */
export function createRestore({
  name,
  namespace,
  applicationSnapshotName,
  applicationSnapshotNamespace,
}: CreateRestoreArgs): Promise<unknown> {
  return ApplicationSnapshotRestoreClass.apiEndpoint.post({
    apiVersion: NDK_GROUP_VERSION,
    kind: 'ApplicationSnapshotRestore',
    metadata: { name, namespace },
    spec: {
      applicationSnapshotName,
      ...(applicationSnapshotNamespace ? { applicationSnapshotNamespace } : {}),
    },
  });
}

export interface CreateReplicationTargetArgs {
  name: string;
  namespace: string;
  /** metadata.name of the cluster-scoped Remote to point at. */
  remoteName: string;
  /** Namespace on the remote cluster. Defaults to "default" on the backend. */
  namespaceName?: string;
}

/** POST a ReplicationTarget that binds the namespace to a Remote. */
export function createReplicationTarget({
  name,
  namespace,
  remoteName,
  namespaceName,
}: CreateReplicationTargetArgs): Promise<unknown> {
  return ReplicationTargetClass.apiEndpoint.post({
    apiVersion: NDK_GROUP_VERSION,
    kind: 'ReplicationTarget',
    metadata: { name, namespace },
    spec: {
      remoteName,
      ...(namespaceName ? { namespaceName } : {}),
    },
  });
}

/** Minimal view of an existing ReplicationTarget used for reuse lookups. */
export interface ExistingTarget {
  name: string;
  remoteName?: string;
}

/**
 * Resolve the ReplicationTarget to use for a remote in `namespace`: reuse one
 * that already points at the remote, otherwise create it. Returns the target's
 * metadata.name (used as the ApplicationSnapshotReplication.spec.replicationTargetName).
 */
export async function ensureReplicationTarget(
  remoteName: string,
  namespace: string,
  existing: ExistingTarget[]
): Promise<string> {
  const found = existing.find(t => t.remoteName === remoteName);
  if (found) {
    return found.name;
  }
  const name = makeReplicationTargetName(remoteName);
  await createReplicationTarget({ name, namespace, remoteName, namespaceName: namespace });
  return name;
}
