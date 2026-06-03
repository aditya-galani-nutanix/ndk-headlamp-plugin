<<<<<<< HEAD
# [[github_repo_name]]
[[github_repo_description]]

# Welcome to your new service
We've created an empty service structure to show you the setup and workflow with Canaveral.

### Directory Structure
The top level directory of your repository should be set up like this:
  1. `README.md`: this file contains a textual description of the repository.
  2. `.circleci/`: this directory contains CircleCI's `config.yml` file.
  3. `hooks/`: this directory, if present, can contain *ad hoc* scripts that customize your build.
  4. `package/`:  add your `Dockerfile` under `package/docker/` to build a docker image.  (Note:  You can refer to files and folders directly in your `Dockerfile` because all files and folders under `services/` will be copied into the same folder as the `Dockerfile` during build.)
  5. `services/`: this directory should have a subdirectory for each `service`, *e.g.* `services/my-service/`.  Each subdirectory (often there is only one) would contain the definition (source and tests) for the service.
  6. `blueprint.json`: this file, if present, contains instructions for Canaveral to deploy the service.

### Build
Canaveral uses CircleCI for building, packaging, and alerting its Deployment Engine. Your repository should have been registered with CircleCI when it was provisioned.  Here are some additional steps you should follow to ensure proper builds:

##### Ensure `.circleci/config.yml` has the correct variables (docker image only)
  1. Specify your preferred `CANAVERAL_BUILD_SYSTEM` (default is noop)
  2. Specify your preferred `CANAVERAL_PACKAGE_TOOLS` (use "docker" if deploying a docker image, use "noop" if no packaging is needed)
  3. **[OPTIONAL]** Specify the target `DOCKERFILE_NAME` to use  (default is Dockerfile)

You'll be able to monitor the build at [circleci.canaveral-corp.us-west-2.aws](https://circleci.canaveral-corp.us-west-2.aws/)

### Deployment
To use Canaveral for deployment, `blueprint.json` should be placed at the top level of the repo.  Spec for the blueprint can be found at [Canaveral Blueprint Spec](https://confluence.eng.nutanix.com:8443/x/5kbdBQ).

__Questions, issues or suggestions? Reach us at https://nutanix.slack.com/messages/canaveral-onboarding/.__
=======
# ndk-headlamp-plugin

A Headlamp plugin that adds **NDK Data Protection** features (snapshot, replicate,
restore, schedule) to the Headlamp Kubernetes UI. Built for the NDK hackathon.

## Prerequisites

- Node 20 LTS + npm 10 (use `nvm install 20`).
- The shared kubeconfig (`ndk-clusters.kubeconfig`) with the primary + secondary
  clusters. Put it somewhere and `export KUBECONFIG=/path/to/ndk-clusters.kubeconfig`.
- The Headlamp desktop app (v0.42.x) for the dev loop below.

## Quick start

```bash
git clone <this-repo> && cd ndk-headlamp-plugin
npm install
npm run start    # watch-builds and hot-copies into the local Headlamp desktop plugin dir
```

Open the Headlamp desktop app (loaded with `ndk-clusters.kubeconfig`). The plugin
appears as **"NDK Data Protection"** in the sidebar. Edits to `src/` rebuild and
hot-reload automatically.

## Two-track workflow

- **Track A — develop (per person):** `npm run start`. The watcher rebuilds on save
  and copies into `~/.config/Headlamp/plugins/ndk-headlamp-plugin/` (Linux) /
  `~/Library/Application Support/Headlamp/plugins/...` (macOS). Your local Headlamp
  hot-reloads. Only you see your changes.
- **Track B — integrate/demo (shared):** after merging to `main`, `npm run build`
  produces `dist/main.js`, which gets deployed into the shared in-cluster Headlamp so
  everyone (and the demo) sees the combined plugin. See `deploy-to-cluster.sh`.

## Install NDK

When NDK is not yet installed (no `ndk-controller-manager` Deployment in
`ntnx-system`), an **Install NDK** button appears in the AppBar and on the
dashboard. It opens a form (CSI/NDK chart URLs, Artifactory creds, Prism Central
IP, StorageCluster PE/PC UUIDs, optional Remote peer, etc.) with two actions:

- **Generate script** — renders `install-ndk.sh` with your inputs to copy or
  download and run yourself (`kubectl`/`helm` honor `KUBECONFIG`).
- **Run in cluster** — creates a one-shot Job (cluster-admin) in `ntnx-system`
  that runs the same script and streams its logs live.

The script is a single source of truth in `src/install/scriptText.ts`; run
`npm run gen:script` to refresh the standalone `scripts/install-ndk.sh`. The
in-cluster path needs egress to Artifactory, github.com (cert-manager),
hoth.corp.nutanix.com (canaveral certs) and nutanix.github.io.

## Project structure

```
src/
  index.tsx                 # P1 — registers sidebar, /ndk route, AppBar buttons
  api/
    ndk-resources.ts        # P1 (shared) — K8s factories for all NDK CRDs (incl. StorageCluster)
    ndk-actions.ts          # imperative CR writers (snapshot/replicate, StorageCluster, Remote)
    types.ts                # P1 (shared) — NDK CR TypeScript interfaces
  install/
    inputs.ts               # InstallInputs type, defaults, validation, env mapping
    scriptText.ts           # canonical install script body + renderInstallScript()
    installJob.ts           # in-cluster install Job manifests + log/status streaming
  components/
    ProtectionDashboard.tsx # P1 — landing page (/ndk) with live summary cards
    AddClusterDialog.tsx    # P1 — AppBar "Add cluster" button (paste/upload kubeconfig -> setCluster)
    InstallNdkDialog.tsx    # Install NDK form (generate script / run in cluster)
    InstallNdkButton.tsx    # gated Install NDK button + useNdkInstalled() hook
    TakeSnapshotDialog.tsx  # P2 — manual snapshot
    SnapshotAndReplicate.tsx# P2 — merged snapshot + replicate (hero feature)
    SnapshotList.tsx        # P3 — snapshot list + status badges
    RestoreButton.tsx       # P3 — smart restore
    ScheduleForm.tsx        # P4 — create recurring schedule
    ScheduleList.tsx        # P4 — schedule list + pause/resume/delete
  utils/
    helpers.ts              # P1 (shared) — formatters
scripts/
  gen-install-script.mjs    # regenerates scripts/install-ndk.sh from scriptText.ts
  install-ndk.sh            # generated standalone install script
```

## NDK CRDs (confirmed on cluster)

- `dataservices.nutanix.com/v1alpha1`: `applications`, `applicationsnapshots`,
  `applicationsnapshotreplications`, `applicationsnapshotrestores`,
  `replicationtargets`, `remotes` (cluster-scoped).
- `scheduler.nutanix.com/v1alpha1`: `jobschedulers`.

## Branching

Work on `feature/<name>` branches, open a quick PR, merge to `main`. P1 owns
re-deploying `main` to the shared in-cluster Headlamp (Track B).
>>>>>>> source/main
