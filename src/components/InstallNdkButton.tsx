// Gated "Install NDK" trigger. NDK readiness is detected by listing Deployments
// in ntnx-system and looking for an *Available* ndk-controller-manager. The
// button renders when NDK is absent OR present-but-not-ready (e.g. a failed or
// partial install), so the user can install or recover.
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Button } from '@mui/material';
import { useState } from 'react';
import { INSTALL_NAMESPACE } from '../install/installJob';
import { InstallNdkDialog } from './InstallNdkDialog';

const NDK_DEPLOYMENT = 'ndk-controller-manager';

/**
 * Detect whether NDK is installed AND ready on the current cluster.
 * Returns true (controller present and Available), false (absent, or present
 * but not Available — e.g. a failed/partial install that still needs work), or
 * null (still loading/unknown).
 *
 * We list Deployments rather than GET a single object: a missing namespace
 * returns a clean empty list (HTTP 200), whereas a single-object GET relies on a
 * 404 propagating through react-query's cache, which proved unreliable for
 * runtime-added clusters. We additionally gate on readiness so a broken install
 * (deployment exists but 0 available replicas) surfaces the Install/recover
 * button instead of being mistaken for a healthy NDK.
 */
export function useNdkInstalled(): boolean | null {
  const [deployments] = K8s.ResourceClasses.Deployment.useList({
    namespace: INSTALL_NAMESPACE,
  });
  // null = still loading or a transient error -> "unknown" (keep button hidden).
  if (!deployments) {
    return null;
  }
  const ndk = deployments.find(d => d.metadata?.name === NDK_DEPLOYMENT);
  if (!ndk) {
    return false;
  }
  const status = (ndk.status ?? {}) as {
    availableReplicas?: number;
    readyReplicas?: number;
    conditions?: { type?: string; status?: string }[];
  };
  const readyByCount = (status.availableReplicas ?? status.readyReplicas ?? 0) >= 1;
  const readyByCondition = (status.conditions ?? []).some(
    c => c.type === 'Available' && c.status === 'True'
  );
  return readyByCount || readyByCondition;
}

export function InstallNdkButton() {
  const installed = useNdkInstalled();
  const [open, setOpen] = useState(false);

  // Hide while loading (null) and when NDK is already installed and ready (true).
  if (installed !== false) {
    return null;
  }

  return (
    <>
      <Button size="small" variant="outlined" color="primary" onClick={() => setOpen(true)}>
        Install NDK
      </Button>
      <InstallNdkDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
