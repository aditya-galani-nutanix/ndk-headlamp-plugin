// Inputs for the NDK install flow. Shared by the "generate script" path
// (renderInstallScript) and the in-cluster Job path (installJob). Every field
// maps to a single environment variable consumed by INSTALL_NDK_SH.

export type OsName = 'ubuntu' | 'centos' | 'rhcos' | 'rocky';
export type VolumeBindingMode = 'Immediate' | 'WaitForFirstConsumer';

export interface InstallInputs {
  // Install — required.
  csiUrl: string;
  ndkUrl: string;
  artifactoryUsername: string;
  artifactoryApiKey: string;
  clusterName: string;
  pcIp: string;
  // Install — options.
  osName: OsName;
  volumeBindingMode: VolumeBindingMode;
  /**
   * Set up the kube-vip service-LB for ndk-intercom-service (needed for SyncRep).
   * Off = snapshot-only (no external IP).
   */
  enableLb: boolean;
  /**
   * External VIP assigned to ndk-intercom-service. Pick a free static IP with the
   * SyncRep doc's get-free-static-ips.sh; the installer re-checks it is free
   * before kube-vip claims it. Required when enableLb is true.
   */
  lbIp: string;
  pcUsername: string;
  pcPassword: string;
  customValuesUrl: string;
  /** Only used by the copy/download path; never sent to the in-cluster Job. */
  kubeconfig: string;
  // StorageCluster (local).
  scName: string;
  peUuid: string;
  pcUuid: string;
  // Remote (optional peer for replication).
  enableRemote: boolean;
  remoteName: string;
  remoteNdkServiceIp: string;
  remoteNdkServicePort: string;
  remoteClusterName: string;
  remoteSkipTlsVerify: boolean;
}

export const DEFAULT_INPUTS: InstallInputs = {
  csiUrl: '',
  ndkUrl: '',
  artifactoryUsername: '',
  artifactoryApiKey: '',
  clusterName: '',
  pcIp: '',
  osName: 'ubuntu',
  volumeBindingMode: 'WaitForFirstConsumer',
  enableLb: true,
  lbIp: '',
  pcUsername: 'admin',
  pcPassword: 'Nutanix.123',
  customValuesUrl: '',
  kubeconfig: '',
  scName: '',
  peUuid: '',
  pcUuid: '',
  enableRemote: false,
  remoteName: '',
  remoteNdkServiceIp: '',
  remoteNdkServicePort: '2021',
  remoteClusterName: '',
  remoteSkipTlsVerify: true,
};

export const OS_NAME_OPTIONS: { value: OsName; label: string }[] = [
  { value: 'ubuntu', label: 'ubuntu (CAPX)' },
  { value: 'centos', label: 'centos (NKE)' },
  { value: 'rhcos', label: 'rhcos (OpenShift)' },
  { value: 'rocky', label: 'rocky (NKEX)' },
];

export const VOLUME_BINDING_MODE_OPTIONS: VolumeBindingMode[] = [
  'WaitForFirstConsumer',
  'Immediate',
];

/** Env vars that hold credentials — never inlined in the rendered script and
 * carried via a Kubernetes Secret (not the ConfigMap) for the Job path. */
export const SECRET_ENV_KEYS = ['ARTIFACTORY_API_KEY', 'PC_PASSWORD'] as const;

const IPV4 = /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/;
// Kubernetes object names: lowercase RFC 1123 (no uppercase/underscores/spaces).
const RFC1123 = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;
const RFC1123_MSG = 'Lowercase letters, digits, "-" or "." only (Kubernetes name).';

/** Returns a map of field-name -> error message. Empty map means valid. */
export function validateInputs(i: InstallInputs): Partial<Record<keyof InstallInputs, string>> {
  const errors: Partial<Record<keyof InstallInputs, string>> = {};
  const required: [keyof InstallInputs, string][] = [
    ['csiUrl', 'CSI chart URL is required.'],
    ['ndkUrl', 'NDK chart URL is required.'],
    ['artifactoryUsername', 'Artifactory username is required.'],
    ['artifactoryApiKey', 'Artifactory API key is required.'],
    ['clusterName', 'Cluster name is required.'],
    ['pcIp', 'Prism Central IP is required.'],
    ['scName', 'StorageCluster name is required.'],
    ['peUuid', 'PE UUID (storageServerUuid) is required.'],
    ['pcUuid', 'PC UUID (managementServerUuid) is required.'],
  ];
  for (const [key, msg] of required) {
    if (!String(i[key] ?? '').trim()) {
      errors[key] = msg;
    }
  }
  if (i.pcIp.trim() && !IPV4.test(i.pcIp.trim())) {
    errors.pcIp = 'Must be a valid IPv4 address.';
  }
  if (i.ndkUrl.trim() && !/\.tgz($|\?)/.test(i.ndkUrl.trim())) {
    errors.ndkUrl = 'NDK URL should point to a .tgz chart.';
  }
  if (i.scName.trim() && !RFC1123.test(i.scName.trim())) {
    errors.scName = RFC1123_MSG;
  }
  if (i.enableLb) {
    if (!i.lbIp.trim()) {
      errors.lbIp = 'LoadBalancer IP is required (find a free one with get-free-static-ips.sh).';
    } else if (!IPV4.test(i.lbIp.trim())) {
      errors.lbIp = 'Must be a valid IPv4 address.';
    }
  }
  if (i.enableRemote) {
    if (!i.remoteName.trim()) {
      errors.remoteName = 'Remote name is required.';
    } else if (!RFC1123.test(i.remoteName.trim())) {
      errors.remoteName = RFC1123_MSG;
    }
    if (!i.remoteNdkServiceIp.trim()) {
      errors.remoteNdkServiceIp = 'Remote NDK service IP is required.';
    } else if (!IPV4.test(i.remoteNdkServiceIp.trim())) {
      errors.remoteNdkServiceIp = 'Must be a valid IPv4 address.';
    }
    if (i.remoteNdkServicePort.trim() && !/^\d{1,5}$/.test(i.remoteNdkServicePort.trim())) {
      errors.remoteNdkServicePort = 'Port must be a number.';
    }
  }
  return errors;
}

/**
 * Translate the form inputs into the environment record that INSTALL_NDK_SH
 * reads. Empty optional values are omitted so the script's defaults apply.
 */
export function inputsToEnv(i: InstallInputs): Record<string, string> {
  const env: Record<string, string> = {
    CSI_URL: i.csiUrl.trim(),
    NDK_URL: i.ndkUrl.trim(),
    ARTIFACTORY_USERNAME: i.artifactoryUsername.trim(),
    ARTIFACTORY_API_KEY: i.artifactoryApiKey,
    CLUSTER_NAME: i.clusterName.trim(),
    PC_IP: i.pcIp.trim(),
    OS_NAME: i.osName,
    VOLUME_BINDING_MODE: i.volumeBindingMode,
    PC_USERNAME: i.pcUsername.trim() || 'admin',
    PC_PASSWORD: i.pcPassword,
    SC_NAME: i.scName.trim(),
    PE_UUID: i.peUuid.trim(),
    PC_UUID: i.pcUuid.trim(),
  };
  env.ENABLE_LB = i.enableLb ? 'true' : 'false';
  if (i.enableLb && i.lbIp.trim()) {
    env.LB_IP = i.lbIp.trim();
  }
  if (i.customValuesUrl.trim()) {
    env.CUSTOM_VALUES_URL = i.customValuesUrl.trim();
  }
  if (i.kubeconfig.trim()) {
    env.KUBECONFIG = i.kubeconfig.trim();
  }
  if (i.enableRemote) {
    env.REMOTE_NAME = i.remoteName.trim();
    env.REMOTE_NDK_SERVICE_IP = i.remoteNdkServiceIp.trim();
    env.REMOTE_NDK_SERVICE_PORT = i.remoteNdkServicePort.trim() || '2021';
    if (i.remoteClusterName.trim()) {
      env.REMOTE_CLUSTER_NAME = i.remoteClusterName.trim();
    }
    env.REMOTE_SKIP_TLS_VERIFY = i.remoteSkipTlsVerify ? 'true' : 'false';
  }
  return env;
}
