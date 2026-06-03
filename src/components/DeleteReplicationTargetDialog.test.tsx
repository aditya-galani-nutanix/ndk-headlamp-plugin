// Component tests for the SAFE delete dialog. They pin the gating contract:
//   - a target held by an ApplicationSnapshotReplication or AppNearSyncProtection
//     is BLOCKED (no Delete button, blockers listed),
//   - a target referenced only by a ProtectionPlan WARNS but still deletes,
//   - an unreferenced target deletes cleanly,
//   - a missing NearSync CRD (useList error) is treated as "no dependents".
// The K8s list hooks and the delete action are mocked; the dependent helpers are
// the real (pure) implementation.
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteReplicationTarget: vi.fn(),
  replications: [null, null] as [any[] | null, unknown],
  plans: [null, null] as [any[] | null, unknown],
  nsps: [null, null] as [any[] | null, unknown],
}));

vi.mock('../api/ndk-actions', () => ({
  deleteReplicationTarget: mocks.deleteReplicationTarget,
}));

vi.mock('../api/ndk-resources', () => ({
  ApplicationSnapshotReplicationClass: { useList: () => mocks.replications },
  ProtectionPlanClass: { useList: () => mocks.plans },
  AppNearSyncProtectionClass: { useList: () => mocks.nsps },
}));

import { DeleteReplicationTargetDialog } from './DeleteReplicationTargetDialog';

function asr(name: string, namespace: string, targetName: string) {
  return { metadata: { name, namespace }, jsonData: { spec: { replicationTargetName: targetName } } };
}
function plan(name: string, namespace: string, targetName: string) {
  return {
    metadata: { name, namespace },
    jsonData: { spec: { replicationConfigs: [{ replicationTargetName: targetName }] } },
  };
}
function nsp(name: string, namespace: string, refName: string, refNamespace: string) {
  return {
    metadata: { name, namespace },
    jsonData: { spec: { replicationTargetRef: { name: refName, namespace: refNamespace } } },
  };
}

function renderDialog(extra: Record<string, unknown> = {}) {
  return render(
    <DeleteReplicationTargetDialog
      name="rt-a"
      namespace="mongo"
      remoteName="secondary-remote"
      onClose={vi.fn()}
      {...extra}
    />
  );
}

beforeEach(() => {
  mocks.deleteReplicationTarget.mockReset();
  mocks.deleteReplicationTarget.mockResolvedValue(undefined);
  // Default: every dependent list resolved + empty (safe to delete).
  mocks.replications = [[], null];
  mocks.plans = [[], null];
  mocks.nsps = [[], null];
});

describe('DeleteReplicationTargetDialog', () => {
  it('deletes cleanly when nothing references the target', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderDialog({ onClose });

    expect(screen.getByText(/safe to delete/i)).toBeInTheDocument();

    const del = screen.getByRole('button', { name: 'Delete' });
    expect(del).toBeEnabled();
    await user.click(del);

    expect(mocks.deleteReplicationTarget).toHaveBeenCalledTimes(1);
    expect(mocks.deleteReplicationTarget).toHaveBeenCalledWith({ name: 'rt-a', namespace: 'mongo' });
    expect(await screen.findByText(/deleted from/i)).toBeInTheDocument();
  });

  it('BLOCKS deletion when an ApplicationSnapshotReplication references the target', () => {
    mocks.replications = [[asr('repl-1', 'mongo', 'rt-a')], null];
    renderDialog();

    expect(screen.getByText(/in use and can’t be deleted yet/i)).toBeInTheDocument();
    expect(screen.getByText('repl-1')).toBeInTheDocument();
    // No Delete button in the blocked state — only Close.
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('BLOCKS deletion when an AppNearSyncProtection locks the target', () => {
    mocks.nsps = [[nsp('nsp-1', 'mongo', 'rt-a', 'mongo')], null];
    renderDialog();

    expect(screen.getByText(/in use and can’t be deleted yet/i)).toBeInTheDocument();
    expect(screen.getByText('nsp-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('WARNS about degraded protection plans but still allows the delete', async () => {
    mocks.plans = [[plan('pplan-1', 'mongo', 'rt-a')], null];
    const user = userEvent.setup();
    renderDialog();

    expect(screen.getByText(/Protection plans reference this target/i)).toBeInTheDocument();
    expect(screen.getByText('pplan-1')).toBeInTheDocument();

    const del = screen.getByRole('button', { name: 'Delete' });
    expect(del).toBeEnabled();
    await user.click(del);
    expect(mocks.deleteReplicationTarget).toHaveBeenCalledWith({ name: 'rt-a', namespace: 'mongo' });
  });

  it('disables Delete while dependents are still loading', () => {
    mocks.replications = [null, null]; // still loading
    renderDialog();

    expect(screen.getByText(/Checking what depends on this target/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('treats a missing NearSync CRD (useList error) as no dependents', () => {
    mocks.nsps = [null, { status: 404, message: 'the server could not find the requested resource' }];
    renderDialog();

    // Not blocked, and Delete is enabled.
    expect(screen.getByText(/safe to delete/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
  });

  it('surfaces a delete failure as an error', async () => {
    mocks.deleteReplicationTarget.mockRejectedValue(new Error('forbidden'));
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('forbidden')).toBeInTheDocument();
  });
});
