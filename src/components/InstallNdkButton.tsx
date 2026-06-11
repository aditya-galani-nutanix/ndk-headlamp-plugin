// Gated "Install NDK" trigger. NDK readiness is detected by listing Deployments
// in ntnx-system and looking for an *Available* ndk-controller-manager. The
// button renders when NDK is absent OR present-but-not-ready (e.g. a failed or
// partial install), so the user can install or recover.
import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Button, Tooltip } from '@mui/material';
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
  const cluster = K8s.useCluster();
  const installed = useNdkInstalled();
  const [open, setOpen] = useState(false);

  // On the home / cluster-list screen there is no active cluster, so installing
  // NDK is meaningless. Show the action disabled with an explanation instead of
  // letting the user open a dialog that has nowhere to install to.
  if (!cluster) {
    return (
      <Tooltip title="Open a cluster first to install NDK">
        <span>
          <Button
            size="small"
            variant="outlined"
            color="primary"
            startIcon={<Icon icon="mdi:cloud-download-outline" />}
            disabled
          >
            Install NDK
          </Button>
        </span>
      </Tooltip>
    );
  }

  // Inside a cluster the button is always shown. When NDK is already installed
  // and ready, the dialog still opens (so the user can review inputs / generate
  // the script), but the in-cluster install action is disabled inside the form.
  return (
    <>
      <Button
        size="small"
        variant="outlined"
        color="primary"
        startIcon={<Icon icon="mdi:cloud-download-outline" />}
        onClick={() => setOpen(true)}
      >
        Install NDK
      </Button>
      <InstallNdkDialog
        open={open}
        onClose={() => setOpen(false)}
        alreadyInstalled={installed === true}
      />
    </>
  );
}
