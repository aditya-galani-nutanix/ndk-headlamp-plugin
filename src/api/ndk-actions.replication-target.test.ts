// Unit tests for the ReplicationTarget write helpers. These pin the exact CR
// shape POSTed to the API server (GVK + spec field names verified against the
// k8s-juno ReplicationTarget CRD/webhook) and the reuse-vs-create logic of
// ensureReplicationTarget.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rtPost: vi.fn(),
  rtDelete: vi.fn(),
}));

vi.mock('./ndk-resources', () => ({
  ApplicationClass: { apiEndpoint: { post: vi.fn() } },
  ApplicationSnapshotClass: { apiEndpoint: { post: vi.fn() } },
  ApplicationSnapshotReplicationClass: { apiEndpoint: { post: vi.fn(), delete: vi.fn() } },
  ApplicationSnapshotRestoreClass: { apiEndpoint: { post: vi.fn() } },
  ReplicationTargetClass: { apiEndpoint: { post: mocks.rtPost, delete: mocks.rtDelete } },
}));

import {
  createReplicationTarget,
  deleteReplicationTarget,
  ensureReplicationTarget,
} from './ndk-actions';

beforeEach(() => {
  mocks.rtPost.mockReset();
  mocks.rtPost.mockResolvedValue({});
  mocks.rtDelete.mockReset();
  mocks.rtDelete.mockResolvedValue({});
});

describe('createReplicationTarget', () => {
  it('POSTs a ReplicationTarget with the correct GVK, metadata and spec', async () => {
    await createReplicationTarget({
      name: 'rt-secondary-remote',
      namespace: 'mongo',
      remoteName: 'secondary-remote',
      namespaceName: 'mongo',
      serviceAccountName: 'ndk-sa',
    });
    expect(mocks.rtPost).toHaveBeenCalledTimes(1);
    expect(mocks.rtPost).toHaveBeenCalledWith({
      apiVersion: 'dataservices.nutanix.com/v1alpha1',
      kind: 'ReplicationTarget',
      metadata: { name: 'rt-secondary-remote', namespace: 'mongo' },
      spec: {
        remoteName: 'secondary-remote',
        namespaceName: 'mongo',
        serviceAccountName: 'ndk-sa',
      },
    });
  });

  it('omits namespaceName/serviceAccountName when not provided (backend defaults them)', async () => {
    await createReplicationTarget({ name: 'rt-x', namespace: 'ns', remoteName: 'r' });
    const body = mocks.rtPost.mock.calls[0][0] as { spec: Record<string, unknown> };
    expect(body.spec).toEqual({ remoteName: 'r' });
    expect('namespaceName' in body.spec).toBe(false);
    expect('serviceAccountName' in body.spec).toBe(false);
  });
});

describe('deleteReplicationTarget', () => {
  it('issues a namespaced delete by (namespace, name)', async () => {
    await deleteReplicationTarget({ name: 'rt-secondary-remote', namespace: 'mongo' });
    expect(mocks.rtDelete).toHaveBeenCalledTimes(1);
    expect(mocks.rtDelete).toHaveBeenCalledWith('mongo', 'rt-secondary-remote');
  });

  it('is idempotent: swallows a 404 (target already gone)', async () => {
    mocks.rtDelete.mockRejectedValue({ status: 404, message: 'not found' });
    await expect(
      deleteReplicationTarget({ name: 'rt-x', namespace: 'ns' })
    ).resolves.toBeUndefined();
  });

  it('rethrows non-404 failures (e.g. forbidden)', async () => {
    mocks.rtDelete.mockRejectedValue(new Error('forbidden'));
    await expect(deleteReplicationTarget({ name: 'rt-x', namespace: 'ns' })).rejects.toThrow(
      'forbidden'
    );
  });
});

describe('ensureReplicationTarget', () => {
  it('reuses an existing target that already points at the remote (no POST)', async () => {
    const name = await ensureReplicationTarget('secondary-remote', 'mongo', [
      { name: 'rt-existing', remoteName: 'secondary-remote' },
    ]);
    expect(name).toBe('rt-existing');
    expect(mocks.rtPost).not.toHaveBeenCalled();
  });

  it('creates rt-<remote> in the namespace when none exists, returning its name', async () => {
    const name = await ensureReplicationTarget('secondary-remote', 'mongo', []);
    expect(name).toBe('rt-secondary-remote');
    expect(mocks.rtPost).toHaveBeenCalledTimes(1);
    const body = mocks.rtPost.mock.calls[0][0] as {
      metadata: Record<string, unknown>;
      spec: Record<string, unknown>;
    };
    expect(body.metadata).toEqual({ name: 'rt-secondary-remote', namespace: 'mongo' });
    expect(body.spec).toMatchObject({ remoteName: 'secondary-remote', namespaceName: 'mongo' });
  });
});
