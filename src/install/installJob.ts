// In-cluster install path: create the K8s objects that run install-ndk.sh inside
// a Job pod (which has helm+kubectl), then stream its logs/status back to the UI.
// Everything is created through the Headlamp API proxy — the same channel the
// rest of the plugin uses to POST CRs.

import { ApiProxy, K8s } from '@kinvolk/headlamp-plugin/lib';
import { inputsToEnv, type InstallInputs, SECRET_ENV_KEYS } from './inputs';
import { jobScript } from './scriptText';

export const INSTALL_NAMESPACE = 'ntnx-system';
/** Bundles kubectl + helm + curl; override via the dialog's advanced field. */
export const DEFAULT_INSTALLER_IMAGE = 'alpine/k8s:1.30.2';
const SCRIPT_FILENAME = 'install-ndk.sh';

export type InstallPhase = 'pending' | 'running' | 'succeeded' | 'failed';

export interface LaunchOptions {
  image?: string;
}

/** Names of every object created for one install run (used for cleanup). */
export interface InstallRunHandle {
  runId: string;
  jobName: string;
  configMapName: string;
  secretName: string;
  serviceAccountName: string;
  clusterRoleBindingName: string;
}

interface EnvVar {
  name: string;
  value?: string;
  valueFrom?: { secretKeyRef: { name: string; key: string } };
}

function shortRunId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function isAlreadyExists(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return status === 409 || /already exists|conflict/i.test(msg);
}

/** Split the install env into a plain env list, secret env refs, and the
 * Secret's stringData. KUBECONFIG is dropped so the pod ServiceAccount is used. */
function buildEnv(
  inputs: InstallInputs,
  secretName: string
): { envVars: EnvVar[]; secretStringData: Record<string, string> } {
  const env = inputsToEnv(inputs);
  delete env.KUBECONFIG;
  const secretKeys = new Set<string>(SECRET_ENV_KEYS);
  const envVars: EnvVar[] = [];
  const secretStringData: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (secretKeys.has(name)) {
      secretStringData[name] = value;
      envVars.push({ name, valueFrom: { secretKeyRef: { name: secretName, key: name } } });
    } else {
      envVars.push({ name, value });
    }
  }
  return { envVars, secretStringData };
}

function buildManifests(inputs: InstallInputs, handle: InstallRunHandle, image: string) {
  const { envVars, secretStringData } = buildEnv(inputs, handle.secretName);
  const labels = { app: 'ndk-installer', 'ndk-install-run': handle.runId };

  const namespace = {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: { name: INSTALL_NAMESPACE },
  };

  const secret = {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name: handle.secretName, namespace: INSTALL_NAMESPACE, labels },
    type: 'Opaque',
    stringData: secretStringData,
  };

  const configMap = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: handle.configMapName, namespace: INSTALL_NAMESPACE, labels },
    data: { [SCRIPT_FILENAME]: jobScript() },
  };

  const serviceAccount = {
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    metadata: { name: handle.serviceAccountName, namespace: INSTALL_NAMESPACE, labels },
  };

  // Install touches cluster-scoped resources (CRDs, cert-manager, ClusterRoles,
  // a DaemonSet, the StorageClass, plus the cluster-scoped Remote/StorageCluster),
  // so the runner needs cluster-admin.
  const clusterRoleBinding = {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'ClusterRoleBinding',
    metadata: { name: handle.clusterRoleBindingName, labels },
    roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: 'cluster-admin' },
    subjects: [
      { kind: 'ServiceAccount', name: handle.serviceAccountName, namespace: INSTALL_NAMESPACE },
    ],
  };

  const job = {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name: handle.jobName, namespace: INSTALL_NAMESPACE, labels },
    spec: {
      backoffLimit: 0,
      ttlSecondsAfterFinished: 3600,
      template: {
        metadata: { labels },
        spec: {
          serviceAccountName: handle.serviceAccountName,
          restartPolicy: 'Never',
          containers: [
            {
              name: 'installer',
              image,
              command: ['/bin/bash', `/scripts/${SCRIPT_FILENAME}`],
              env: envVars,
              volumeMounts: [{ name: 'script', mountPath: '/scripts' }],
            },
          ],
          volumes: [
            {
              name: 'script',
              configMap: {
                name: handle.configMapName,
                items: [{ key: SCRIPT_FILENAME, path: SCRIPT_FILENAME }],
                defaultMode: 0o755,
              },
            },
          ],
        },
      },
    },
  };

  return { namespace, secret, configMap, serviceAccount, clusterRoleBinding, job };
}

/**
 * Create the Namespace/Secret/ConfigMap/ServiceAccount/ClusterRoleBinding/Job
 * for one install run and return the object names for later cleanup.
 */
export async function launchInstallJob(
  inputs: InstallInputs,
  opts: LaunchOptions = {}
): Promise<InstallRunHandle> {
  const runId = shortRunId();
  const base = `ndk-installer-${runId}`;
  const handle: InstallRunHandle = {
    runId,
    jobName: base,
    configMapName: base,
    secretName: base,
    serviceAccountName: base,
    clusterRoleBindingName: base,
  };
  const image = opts.image?.trim() || DEFAULT_INSTALLER_IMAGE;
  const m = buildManifests(inputs, handle, image);

  // ntnx-system may already exist (CSI/other tooling); ignore the conflict.
  try {
    await ApiProxy.post('/api/v1/namespaces', m.namespace);
  } catch (e) {
    if (!isAlreadyExists(e)) {
      throw e;
    }
  }

  await Promise.all([
    ApiProxy.post(`/api/v1/namespaces/${INSTALL_NAMESPACE}/secrets`, m.secret),
    ApiProxy.post(`/api/v1/namespaces/${INSTALL_NAMESPACE}/configmaps`, m.configMap),
    ApiProxy.post(`/api/v1/namespaces/${INSTALL_NAMESPACE}/serviceaccounts`, m.serviceAccount),
  ]);
  await ApiProxy.post('/apis/rbac.authorization.k8s.io/v1/clusterrolebindings', m.clusterRoleBinding);
  await ApiProxy.post(`/apis/batch/v1/namespaces/${INSTALL_NAMESPACE}/jobs`, m.job);

  return handle;
}

/**
 * Stream the installer pod's logs. The callback receives the full accumulated
 * line list on every update (Headlamp's getLogs semantics), so callers should
 * replace their buffer rather than append. Returns a cancel function.
 */
export function streamJobLogs(jobName: string, onLogs: (lines: string[]) => void): () => void {
  let cancelled = false;
  let cancelLogs: (() => void) | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;

  async function findPodAndStream(): Promise<void> {
    if (cancelled) {
      return;
    }
    try {
      const selector = encodeURIComponent(`job-name=${jobName}`);
      const res = await ApiProxy.request(
        `/api/v1/namespaces/${INSTALL_NAMESPACE}/pods?labelSelector=${selector}`
      );
      const item = (res as { items?: unknown[] })?.items?.[0];
      if (item && !cancelled) {
        const pod = new K8s.ResourceClasses.Pod(item as never);
        cancelLogs = pod.getLogs(
          'installer',
          (result: { logs: string[] }) => onLogs(result.logs ?? []),
          { follow: true, tailLines: -1, showTimestamps: false }
        );
        return;
      }
    } catch {
      // Pod not created yet, or transient error — retry.
    }
    pollTimer = setTimeout(findPodAndStream, 2000);
  }

  void findPodAndStream();
  return () => {
    cancelled = true;
    if (pollTimer) {
      clearTimeout(pollTimer);
    }
    if (cancelLogs) {
      cancelLogs();
    }
  };
}

/** Poll the Job's status and report a coarse phase. Returns a cancel function. */
export function watchJobStatus(
  jobName: string,
  onStatus: (phase: InstallPhase, detail?: string) => void
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function poll(): Promise<void> {
    if (cancelled) {
      return;
    }
    try {
      const job = await ApiProxy.request(
        `/apis/batch/v1/namespaces/${INSTALL_NAMESPACE}/jobs/${jobName}`
      );
      const status = (job as { status?: Record<string, unknown> })?.status ?? {};
      const succeeded = Number(status.succeeded ?? 0);
      const failed = Number(status.failed ?? 0);
      const active = Number(status.active ?? 0);
      const conditions = (status.conditions ?? []) as { type?: string; status?: string; message?: string }[];
      const failedCond = conditions.find(c => c.type === 'Failed' && c.status === 'True');
      if (succeeded > 0) {
        onStatus('succeeded');
        return;
      }
      if (failed > 0 || failedCond) {
        onStatus('failed', failedCond?.message);
        return;
      }
      onStatus(active > 0 ? 'running' : 'pending');
    } catch {
      // Job may not be visible yet — keep polling.
    }
    timer = setTimeout(poll, 3000);
  }

  void poll();
  return () => {
    cancelled = true;
    if (timer) {
      clearTimeout(timer);
    }
  };
}

/** Best-effort deletion of every object created for an install run. */
export async function cleanupInstallJob(handle: InstallRunHandle): Promise<void> {
  const targets = [
    `/apis/batch/v1/namespaces/${INSTALL_NAMESPACE}/jobs/${handle.jobName}?propagationPolicy=Background`,
    `/api/v1/namespaces/${INSTALL_NAMESPACE}/configmaps/${handle.configMapName}`,
    `/api/v1/namespaces/${INSTALL_NAMESPACE}/secrets/${handle.secretName}`,
    `/api/v1/namespaces/${INSTALL_NAMESPACE}/serviceaccounts/${handle.serviceAccountName}`,
    `/apis/rbac.authorization.k8s.io/v1/clusterrolebindings/${handle.clusterRoleBindingName}`,
  ];
  await Promise.all(
    targets.map(path => ApiProxy.request(path, { method: 'DELETE' }).catch(() => undefined))
  );
}
