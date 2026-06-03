// Owner: P1 — custom "Add / remove cluster" button for the WEB UI.
// Headlamp's native add/remove cluster controls are desktop-only (gated behind
// isElectron()), so this plugin provides its own. The user pastes (or uploads) a
// kubeconfig and we register it as a dynamic cluster via Headlamp.setCluster();
// dynamically-added clusters can be removed again via ApiProxy.deleteCluster().
// Both require the Headlamp server to run with --enable-dynamic-clusters.
import { ApiProxy, Headlamp, K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  List,
  ListItem,
  ListItemSecondaryAction,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import { useRef, useState } from 'react';

/** Base64-encode a UTF-8 string (what Headlamp.setCluster expects for kubeconfig). */
function toBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

// Headlamp stores dynamically-added (stateless) clusters in the browser's
// IndexedDB ("kubeconfigs" DB, "kubeconfigStore" store). Its own deleteCluster
// removes only ONE matching row then reloads, so duplicate rows (e.g. from
// clicking Add multiple times) survive. This removes EVERY row that references
// the given cluster in a single pass, then resolves with the count removed.
function removeClusterFromIndexedDB(clusterName: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open('kubeconfigs', 1);
    } catch (e) {
      reject(e);
      return;
    }
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kubeconfigStore')) {
        resolve(0);
        return;
      }
      const tx = db.transaction(['kubeconfigStore'], 'readwrite');
      const store = tx.objectStore('kubeconfigStore');
      let removed = 0;
      store.openCursor().onsuccess = (event: Event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
        if (!cursor) {
          return;
        }
        try {
          const decoded = atob(cursor.value.kubeconfig);
          if (decoded.includes(clusterName)) {
            cursor.delete();
            removed += 1;
          }
        } catch {
          // ignore rows we can't decode
        }
        cursor.continue();
      };
      tx.oncomplete = () => resolve(removed);
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

export function AddClusterButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kubeconfig, setKubeconfig] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Only dynamically-added clusters (via setCluster) are removable; the cluster
  // that came from the mounted kubeconfig is served by the backend and stays.
  const clustersConf = (K8s.useClustersConf() || {}) as Record<
    string,
    { meta_data?: { source?: string } }
  >;
  const removableClusters = Object.keys(clustersConf).filter(
    name => clustersConf[name]?.meta_data?.source === 'dynamic_cluster'
  );

  function reset() {
    setName('');
    setKubeconfig('');
    setError(null);
    setDone(false);
    setBusy(false);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setKubeconfig(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  async function handleAdd() {
    setError(null);
    if (!kubeconfig.trim()) {
      setError('Paste or upload a kubeconfig first.');
      return;
    }
    setBusy(true);
    try {
      // setCluster stores the kubeconfig in IndexedDB, then calls
      // /parseKubeConfig. With a single kubeconfig that endpoint returns
      // { clusters: null }, so we must NOT gate success on result.clusters.
      // Headlamp.setCluster swallows errors and resolves to undefined on
      // failure, so a truthy result means the cluster was stored successfully.
      const result = await Headlamp.setCluster({
        name: name.trim() || undefined,
        kubeconfig: toBase64(kubeconfig),
      });
      if (result) {
        setDone(true);
        // Reload so the new cluster shows up in the picker (Headlamp loads
        // stateless clusters from IndexedDB on startup).
        setTimeout(() => window.location.reload(), 900);
      } else {
        setError(
          'Could not add the cluster. Check the kubeconfig and that Headlamp runs with --enable-dynamic-clusters.'
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(clusterName: string) {
    setError(null);
    setRemoving(clusterName);
    try {
      // Remove every IndexedDB row for this cluster (handles duplicate rows that
      // older builds could create). Fall back to Headlamp's deleteCluster for
      // non-stateless clusters where nothing matched in IndexedDB.
      const removed = await removeClusterFromIndexedDB(clusterName);
      if (removed === 0) {
        await ApiProxy.deleteCluster(clusterName);
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRemoving(null);
    }
  }

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        Add cluster
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Manage clusters</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {done && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Cluster added. Reloading…
            </Alert>
          )}
          {removableClusters.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Added clusters
              </Typography>
              <List dense disablePadding>
                {removableClusters.map(clusterName => (
                  <ListItem key={clusterName} divider>
                    <ListItemText primary={clusterName} />
                    <ListItemSecondaryAction>
                      <Button
                        size="small"
                        color="error"
                        disabled={removing !== null}
                        onClick={() => handleRemove(clusterName)}
                      >
                        {removing === clusterName ? 'Removing…' : 'Remove'}
                      </Button>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
              <Divider sx={{ mt: 2 }} />
              <Typography variant="subtitle2" sx={{ mt: 2 }} gutterBottom>
                Add a cluster
              </Typography>
            </Box>
          )}
          <TextField
            label="Cluster name (optional)"
            placeholder="Defaults to the kubeconfig context name"
            fullWidth
            margin="dense"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <TextField
            label="Kubeconfig (YAML)"
            placeholder="Paste the peer cluster's kubeconfig here"
            fullWidth
            multiline
            minRows={8}
            margin="dense"
            value={kubeconfig}
            onChange={e => setKubeconfig(e.target.value)}
            inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }}
          />
          <input
            ref={fileInput}
            type="file"
            accept=".yaml,.yml,.kubeconfig,.txt,*/*"
            style={{ display: 'none' }}
            onChange={handleFile}
          />
          <Button size="small" onClick={() => fileInput.current?.click()} sx={{ mt: 1 }}>
            Upload kubeconfig file…
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleAdd} variant="contained" disabled={busy || done}>
            {busy ? 'Adding…' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
