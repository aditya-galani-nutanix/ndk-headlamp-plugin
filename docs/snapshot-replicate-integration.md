# Snapshot & Replicate: Frontend ↔ Backend Integration Guide

How the **NDK Data Protection** Headlamp plugin (frontend) triggers a **manual
snapshot** of an application and **replicates it to another cluster**, using the
**already-existing** NDK backend (`k8s-juno`).

> **TL;DR** — There is *no* custom REST/gRPC "snapshot service" to call. NDK is
> a **declarative Kubernetes system**. The frontend "triggers" the workflow by
> **creating Custom Resource (CR) objects through the Kubernetes API server**.
> Background controllers in `k8s-juno` watch those objects and do the real work.
> This is exactly what the official `ndkcli` CLI does internally — we just do it
> from a browser instead of a terminal.

---

## Table of contents

1. [The core idea: Kubernetes is declarative](#1-the-core-idea-kubernetes-is-declarative)
2. [Vocabulary (read this first)](#2-vocabulary-read-this-first)
3. [The NDK objects we use](#3-the-ndk-objects-we-use)
4. [Architecture at a glance](#4-architecture-at-a-glance)
5. [The end-to-end flow](#5-the-end-to-end-flow)
6. [How the frontend talks to the backend](#6-how-the-frontend-talks-to-the-backend)
7. [Proof: the backend already does this (`ndkcli`)](#7-proof-the-backend-already-does-this-ndkcli)
8. [What NOT to call (internal gRPC)](#8-what-not-to-call-internal-grpc)
9. [Where this lands in our plugin](#9-where-this-lands-in-our-plugin)
10. [FAQ](#10-faq)

---

## 1. The core idea: Kubernetes is declarative

The biggest mental shift: **you do not call a function that says "take a snapshot
now."** Instead you **write down what you want to exist**, save it into the
cluster, and a background program makes reality match your wish.

Think of a **restaurant**:

- You (the frontend) write an **order ticket**: *"I want a snapshot of app `foo`."*
- You hand it to the **front desk** = the Kubernetes **API server**, which records
  it in its book (a database called `etcd`).
- A **chef** in the back = a **controller** is always watching for new tickets.
  It sees yours, cooks (creates the snapshot on storage), and writes status back
  onto the ticket: *"in progress" → "ready."*
- You never enter the kitchen. You just keep glancing at the ticket until it's done.

That "ticket" is a **resource (object)**. Its *type* is defined by a **CRD**.

---

## 2. Vocabulary (read this first)

| Term | What it is | Restaurant analogy |
|---|---|---|
| **API server** | The single front door to the cluster. Everything is an HTTP REST call to it (`GET`/`POST`/`DELETE`). | Front desk |
| **etcd** | The database where all objects are stored. | The order book |
| **CRD** (Custom Resource Definition) | Defines a *new type* of object, e.g. `ApplicationSnapshot`. The blank ticket template. | Menu definition |
| **CR / Custom Resource** | One actual object of that type, e.g. "snapshot of app foo". | A filled-in ticket |
| **Controller / reconciler** | Background program that watches CRs and does the real work, updating `.status`. (This is the `k8s-juno` code.) | The chef |
| **`spec`** | Part of the object *you* write = **desired state**. | What you ordered |
| **`status`** | Part the *controller* writes = **current reality**. | "cooking / ready" stamp |
| **kubeconfig** | Credentials + address telling a client which cluster + who you are. | Reservation + ID |

**So "is there an API to trigger this?" → The API _is_ the Kubernetes API server,
and "triggering" = creating CR objects.** No separate snapshot microservice.

---

## 3. The NDK objects we use

NDK ships CRDs in the `dataservices.nutanix.com/v1alpha1` API group, and runs the
controllers for them (that is the `k8s-juno` repository).

| Kind | Scope | Meaning | Key `spec` fields |
|---|---|---|---|
| `ApplicationSnapshot` | namespaced | "Take a snapshot of this app." | `source.applicationRef.name` |
| `ApplicationSnapshotReplication` | namespaced | "Copy snapshot X to target Y." | `applicationSnapshotName`, `replicationTargetName` |
| `ReplicationTarget` | namespaced | A configured destination. | `remoteName`, `namespaceName`, `serviceAccountName` |
| `Remote` | **cluster** | A remote cluster / object store we can replicate to. | (admin-configured) |

These field names are taken straight from the backend type definitions in
`k8s-juno`:

- `api/dataservices/v1alpha1/applicationsnapshot_types.go`
- `api/dataservices/v1alpha1/applicationsnapshotreplication_types.go`
- `api/dataservices/v1alpha1/replicationtarget_types.go`

**The "choose a cluster" dropdown** in the UI = the list of `ReplicationTarget`
objects (each one points at a `Remote`). A target is usable when its
`status.conditions[type=Available].status == "True"`.

---

## 4. Architecture at a glance

```
  ┌───────────────────────────┐
  │  Headlamp plugin (browser) │   <-- our frontend (React/TypeScript)
  └───────────────┬───────────┘
                  │  HTTP REST (POST/GET/WATCH)   via Headlamp's K8s client + kubeconfig
                  ▼
  ┌───────────────────────────┐
  │   Kubernetes API server    │   <-- the ONLY thing the frontend talks to
  │        (+ etcd db)         │
  └───────────────┬───────────┘
                  │  watch / update status
                  ▼
  ┌───────────────────────────┐
  │  NDK controllers (k8s-juno)│   <-- the existing backend; the "chefs"
  └───────────────┬───────────┘
                  │  internal gRPC (NOT called by us)
                  ▼
   remote cluster / AOS / Prism Central  (actual storage + cross-cluster copy)
```

Key takeaways:

- The frontend only ever speaks to the **API server**.
- The backend controllers react to objects and talk to storage / remote clusters
  **on their own**, using internal gRPC that the browser never touches.

---

## 5. The end-to-end flow

A "manifest" is just a JSON/YAML object describing a CR (`apiVersion`, `kind`,
`metadata`, `spec`).

### Step 1 — User picks an application + a target cluster

The target dropdown is populated by **listing `ReplicationTarget` objects**.

### Step 2 — Create the snapshot (`POST ApplicationSnapshot`)

```yaml
apiVersion: dataservices.nutanix.com/v1alpha1
kind: ApplicationSnapshot
metadata:
  name: foo-snap-1
  namespace: my-app-ns
spec:
  source:
    applicationRef:
      name: foo          # the Application CR to snapshot
  # optional: expiry can be set here (CLI exposes --expires-after)
```

### Step 3 — Wait until the snapshot is ready

Watch that object until:

```yaml
status:
  readyToUse: true
```

### Step 4 — Replicate it (`POST ApplicationSnapshotReplication`)

```yaml
apiVersion: dataservices.nutanix.com/v1alpha1
kind: ApplicationSnapshotReplication
metadata:
  name: foo-repl-1
  namespace: my-app-ns
spec:
  applicationSnapshotName: foo-snap-1   # from Step 2
  replicationTargetName: cluster-b      # from Step 1 (a ReplicationTarget name)
```

> Note: `ApplicationSnapshotReplication.spec` is **immutable** — you create a new
> one per replication; you don't edit an existing one.

### Step 5 — Show progress

Watch the replication object's `status.conditions` and drive a stepper / progress
UI from it.

### Sequence summary

```
User → [POST ApplicationSnapshot] → API server → controller snapshots app
                                          │
       (watch) status.readyToUse = true ◄─┘
User → [POST ApplicationSnapshotReplication] → API server → controller copies to remote
                                          │
       (watch) status.conditions ◄────────┘  → progress stepper
```

---

## 6. How the frontend talks to the backend

A Headlamp plugin runs in the browser. **Headlamp itself holds the kubeconfig and
proxies requests to the API server**, so the plugin never manages credentials — it
calls a thin JS wrapper and Headlamp does the networking + auth.

We already declared those wrappers in `src/api/ndk-resources.ts` using Headlamp's
`makeCustomResourceClass(...)`. Each generated class gives us **read** hooks and a
**write** endpoint.

> The exact hook return shapes vary slightly between Headlamp versions. Check the
> bundled examples in `node_modules/@kinvolk/headlamp-plugin/examples/` if a
> signature differs from below.

### Reading (list / watch) — for tables and dropdowns

```ts
import { ReplicationTargetClass, ApplicationSnapshotClass } from '../api/ndk-resources';

// Populate the "target cluster" dropdown:
const [targets] = ReplicationTargetClass.useList({ namespace });

// Live snapshot table (auto re-renders as status changes):
const [snapshots] = ApplicationSnapshotClass.useList({ namespace });
```

Each returned item is a Headlamp object; read fields via `item.jsonData`
(`item.jsonData.spec`, `item.jsonData.status`, ...).

### Writing (create) — to trigger the workflow

```ts
import { ApplicationSnapshotClass, ApplicationSnapshotReplicationClass } from '../api/ndk-resources';

const GROUP_VERSION = 'dataservices.nutanix.com/v1alpha1';

export async function createSnapshot(name: string, namespace: string, applicationName: string) {
  return ApplicationSnapshotClass.apiEndpoint.post({
    apiVersion: GROUP_VERSION,
    kind: 'ApplicationSnapshot',
    metadata: { name, namespace },
    spec: { source: { applicationRef: { name: applicationName } } },
  });
}

export async function replicateSnapshot(
  name: string,
  namespace: string,
  applicationSnapshotName: string,
  replicationTargetName: string,
) {
  return ApplicationSnapshotReplicationClass.apiEndpoint.post({
    apiVersion: GROUP_VERSION,
    kind: 'ApplicationSnapshotReplication',
    metadata: { name, namespace },
    spec: { applicationSnapshotName, replicationTargetName },
  });
}
```

### The combined "Snapshot & Replicate" workflow (the hero feature)

```ts
// Pseudocode for the stepper: create snapshot → wait readyToUse → replicate.
async function snapshotAndReplicate(opts: {
  namespace: string;
  applicationName: string;
  replicationTargetName: string;
}) {
  const snapName = `${opts.applicationName}-snap-${Date.now()}`;

  // 1) Create the ApplicationSnapshot
  await createSnapshot(snapName, opts.namespace, opts.applicationName);

  // 2) Poll until status.readyToUse === true
  await waitUntil(async () => {
    const snap = await ApplicationSnapshotClass.apiEndpoint.get(opts.namespace, snapName);
    return snap?.status?.readyToUse === true;
  });

  // 3) Create the ApplicationSnapshotReplication
  const replName = `${snapName}-repl`;
  await replicateSnapshot(replName, opts.namespace, snapName, opts.replicationTargetName);

  // 4) Watch the replication's status.conditions to drive the progress UI
}
```

> Prefer watching (hooks) over manual polling where possible — Headlamp's `useGet`
> /`useList` already stream live updates so the UI reflects `status` changes
> without you writing a poll loop.

---

## 7. Proof: the backend already does this (`ndkcli`)

The official NDK CLI is the **reference implementation** of triggering this flow
programmatically. It does nothing more than build a CR and `Create()` it against
the API server using a kubeconfig-derived client — **no juno backend API in
between.**

- `pkg/ndkcli/create/create_snapshot.go`
  → `ndkcli create snapshot <name> --application=<app>` creates an `ApplicationSnapshot`.
- `pkg/ndkcli/replicate/replicate_snapshot.go`
  → `ndkcli replicate snapshot <snap> --replication-target=<target>` builds and
  creates an `ApplicationSnapshotReplication`:

```go
applicationSnapshotReplication.Spec = dsv1alpha1.ApplicationSnapshotReplicationSpec{
    ApplicationSnapshotName: o.Name,
    ReplicationTargetName:   o.ReplicationTarget,
}
// ...
o.Client.ApplicationSnapshotReplications(o.Namespace).Create(ctx, applicationSnapshotReplication, createOptions)
```

Our browser code in [§6](#6-how-the-frontend-talks-to-the-backend) is the exact
same idea — just a different client (Headlamp/HTTP) hitting the same API server.

**Equivalent commands you can run by hand to sanity-check the flow:**

```bash
# create a snapshot
ndkcli create snapshot foo-snap-1 --application=foo

# replicate it to a configured target
ndkcli replicate snapshot foo-snap-1 --replication-target=cluster-b

# or with raw kubectl (proves it's just CR CRUD on the API server):
kubectl apply -f application-snapshot.yaml
kubectl get applicationsnapshot foo-snap-1 -o jsonpath='{.status.readyToUse}'
kubectl apply -f application-snapshot-replication.yaml
```

---

## 8. What NOT to call (internal gRPC)

You will see gRPC/RPC code in the backend repos. **The frontend must not call it.**
It is backend-to-backend plumbing that runs *after* a CR triggers it:

- `k8s-juno/pkg/juno_interface/juno_interface.proto` (`CreateAppSnapshot`,
  `StoreAppSnapshot`, `CreateAppSnapshotContent`, `VerifyReplicationTarget`, …) is
  the **cross-cluster** interface a controller uses to talk to the *remote* juno
  service (juno ↔ remote juno).
- `k8s-juno-aos-pc-client` is an internal **infra-manager gRPC service** the juno
  reconciler calls to drive AOS / Prism Central (recovery points, VG & recovery
  point replication across PCs, files snapshots). Its own header literally says
  `juno reconciler | gRPC client <-> gRPC server`.

**Rule of thumb: the browser only ever speaks to the Kubernetes API server.**

---

## 9. Where this lands in our plugin

The plugin is already scaffolded for this approach — the stubs even name the calls:

| File | Role | Hook / call to implement |
|---|---|---|
| `src/api/ndk-resources.ts` | Shared CR classes (done) | `makeCustomResourceClass(...)` |
| `src/api/types.ts` | CR TypeScript interfaces | `ApplicationSnapshotSpec`, `...ReplicationSpec` |
| `src/components/SnapshotAndReplicate.tsx` | Hero workflow + stepper | create snapshot → wait `readyToUse` → create replication |
| `src/components/TakeSnapshotDialog.tsx` | Manual snapshot dialog | `ApplicationSnapshotClass.apiEndpoint.post(manifest)` |
| `src/components/SnapshotList.tsx` | Snapshot table | `ApplicationSnapshotClass.useList({ namespace })` |
| `src/utils/helpers.ts` | Formatters | `snapshotState()` reads `status.readyToUse` / `status.error` |

The plugin registers a sidebar entry and a `/ndk` route in `src/index.tsx`, so all
of this shows up under **"NDK Data Protection"** in Headlamp.

---

## 10. FAQ

**Q: Is it actually possible to trigger snapshot + replicate from the frontend?**
Yes. By creating `ApplicationSnapshot` and `ApplicationSnapshotReplication` objects
via the Kubernetes API server. Confirmed against the live CRDs and the `ndkcli`
reference implementation.

**Q: Do we need a new backend API / endpoint?**
No. The Kubernetes API server *is* the API. The backend work is done by existing
`k8s-juno` controllers reacting to the CRs.

**Q: How does the frontend authenticate to the cluster?**
Headlamp manages the kubeconfig/cluster connection and proxies our requests. The
plugin just calls the generated CR classes.

**Q: How do we know when the snapshot is ready / replication is done?**
Read `status`: `ApplicationSnapshot.status.readyToUse == true`, and watch
`ApplicationSnapshotReplication.status.conditions` for progress/completion.

**Q: How does a user choose "which cluster" to replicate to?**
They pick a `ReplicationTarget` (which references a `Remote`). List the
`ReplicationTarget` objects to build the dropdown; show ones whose `Available`
condition is `True`.

---

### The 3 things to remember

1. **You create objects, you don't call actions.** Writing an `ApplicationSnapshot`
   *is* "take a snapshot."
2. **`spec` = your wish; `status` = the controller's progress.** Write spec, read status.
3. **Everything is one endpoint** (the API server); Headlamp + our CR classes make
   the calls for us.
