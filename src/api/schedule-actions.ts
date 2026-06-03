// Imperative write helpers for the recurring-snapshot ("job scheduler") feature.
// Recurring snapshots require three CRs, exactly as `ndkcli create protectionplan`
// + `ndkcli protect application` do (see k8s-juno pkg/ndkcli/{create,protect}):
//   1. JobScheduler        — the "when" (scheduler.nutanix.com/v1alpha1)
//   2. ProtectionPlan      — schedule reference + retention + replication recipe
//   3. AppProtectionPlan   — binds an Application to the ProtectionPlan(s)
// We just POST these objects from the browser; the k8s-juno controllers do the work.
// Owner: P3 (scheduler).

import {
  makeAppProtectionPlanName,
  makeJobSchedulerName,
  makeProtectionPlanName,
} from '../utils/helpers';
import { ensureReplicationTarget, type ExistingTarget } from './ndk-actions';
import { AppProtectionPlanClass, JobSchedulerClass, ProtectionPlanClass } from './ndk-resources';
import type { JobSchedulerSpec, ReplicationConfig } from './types';

export const NDK_GROUP_VERSION = 'dataservices.nutanix.com/v1alpha1';
export const SCHED_GROUP_VERSION = 'scheduler.nutanix.com/v1alpha1';

export interface CreateScheduleArgs {
  /** Application to protect (spec.applicationName on the AppProtectionPlan). */
  applicationName: string;
  namespace: string;
  /** The JobScheduler spec (exactly one recurrence member set). */
  schedule: JobSchedulerSpec;
  /** Number of most-recent snapshots to retain. */
  retentionCount: number;
  /**
   * Remote (cluster) names to replicate each scheduled snapshot to. A
   * namespace-local ReplicationTarget is auto-created/reused for each remote.
   */
  remotes?: string[];
  /** Existing ReplicationTargets in the namespace (for reuse lookups). */
  existingTargets?: ExistingTarget[];
}

export interface CreateScheduleResult {
  jobSchedulerName: string;
  protectionPlanName: string;
  appProtectionPlanName: string;
}

/**
 * Create the JobScheduler -> ProtectionPlan -> AppProtectionPlan chain that
 * drives recurring snapshots of an Application. Mirrors the async snapshot-only /
 * snapshot+replicate flow in `ndkcli create protectionplan`.
 */
export async function createSchedule({
  applicationName,
  namespace,
  schedule,
  retentionCount,
  remotes = [],
  existingTargets = [],
}: CreateScheduleArgs): Promise<CreateScheduleResult> {
  const jobSchedulerName = makeJobSchedulerName(applicationName);
  const protectionPlanName = makeProtectionPlanName(applicationName);
  const appProtectionPlanName = makeAppProtectionPlanName(applicationName);

  // 1) JobScheduler — the recurrence.
  await JobSchedulerClass.apiEndpoint.post({
    apiVersion: SCHED_GROUP_VERSION,
    kind: 'JobScheduler',
    metadata: { name: jobSchedulerName, namespace },
    spec: schedule,
  });

  // 2) Resolve ReplicationTargets for any chosen remotes (reuse or create).
  const replicationConfigs: ReplicationConfig[] = [];
  for (const remote of remotes) {
    const targetName = await ensureReplicationTarget(remote, namespace, existingTargets);
    replicationConfigs.push({ replicationTargetName: targetName });
  }

  // 3) ProtectionPlan — async, references the schedule + retention (+ replication).
  await ProtectionPlanClass.apiEndpoint.post({
    apiVersion: NDK_GROUP_VERSION,
    kind: 'ProtectionPlan',
    metadata: { name: protectionPlanName, namespace },
    spec: {
      protectionType: 'async',
      scheduleName: jobSchedulerName,
      retentionPolicy: { retentionCount },
      ...(replicationConfigs.length > 0 ? { replicationConfigs } : {}),
    },
  });

  // 4) AppProtectionPlan — bind the Application to the ProtectionPlan.
  await AppProtectionPlanClass.apiEndpoint.post({
    apiVersion: NDK_GROUP_VERSION,
    kind: 'AppProtectionPlan',
    metadata: { name: appProtectionPlanName, namespace },
    spec: {
      applicationName,
      protectionPlanNames: [protectionPlanName],
    },
  });

  return { jobSchedulerName, protectionPlanName, appProtectionPlanName };
}

function isNotFound(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return status === 404 || /not\s*found/i.test(msg);
}

export interface DeleteScheduleArgs {
  namespace: string;
  appProtectionPlanName: string;
  protectionPlanName?: string;
  jobSchedulerName?: string;
}

/**
 * Delete a whole schedule. Order matters: remove the AppProtectionPlan binding
 * first (stops snapshots and releases its finalizers on the ProtectionPlan),
 * then the ProtectionPlan, then the JobScheduler. 404s are ignored so a partial
 * cleanup can be retried safely.
 */
export async function deleteScheduleCascade({
  namespace,
  appProtectionPlanName,
  protectionPlanName,
  jobSchedulerName,
}: DeleteScheduleArgs): Promise<void> {
  await disableSchedule({ namespace, appProtectionPlanName });
  if (protectionPlanName) {
    try {
      await ProtectionPlanClass.apiEndpoint.delete(namespace, protectionPlanName);
    } catch (e) {
      if (!isNotFound(e)) {
        throw e;
      }
    }
  }
  if (jobSchedulerName) {
    try {
      await JobSchedulerClass.apiEndpoint.delete(namespace, jobSchedulerName);
    } catch (e) {
      if (!isNotFound(e)) {
        throw e;
      }
    }
  }
}

/**
 * Disable a schedule by deleting only the AppProtectionPlan binding. The
 * ProtectionPlan + JobScheduler are kept, so protection can be re-enabled later
 * by recreating the binding.
 */
export async function disableSchedule({
  namespace,
  appProtectionPlanName,
}: {
  namespace: string;
  appProtectionPlanName: string;
}): Promise<void> {
  try {
    await AppProtectionPlanClass.apiEndpoint.delete(namespace, appProtectionPlanName);
  } catch (e) {
    if (!isNotFound(e)) {
      throw e;
    }
  }
}
