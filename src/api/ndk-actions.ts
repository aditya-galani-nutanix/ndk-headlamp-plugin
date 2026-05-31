// Imperative write helpers that "trigger" the NDK workflow by creating CR
// objects through the Kubernetes API server. This is exactly what `ndkcli`
// does internally (see k8s-juno pkg/ndkcli/{create,replicate}); we just POST
// from the browser via Headlamp's generated resource classes.
// Owner: P2.

import { makeReplicationTargetName } from '../utils/helpers';
import {
  ApplicationSnapshotClass,
  ApplicationSnapshotReplicationClass,
  ReplicationTargetClass,
} from './ndk-resources';

export const NDK_GROUP_VERSION = 'dataservices.nutanix.com/v1alpha1';

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
