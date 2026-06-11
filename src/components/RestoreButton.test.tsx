// Component tests for the restore workflow: the Restore button gating + the
// confirmation dialog that creates an ApplicationSnapshotRestore CR and then
// live-watches its status to completion.
//
// The K8s list hook and the create action are mocked. `restoreStore` stands in
// for the live watch: tests mutate it and re-render to simulate the controller
// writing status updates onto the CR.
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  restoreStore: { list: [] as any[] },
  createRestore: vi.fn(),
}));

vi.mock('../api/ndk-actions', () => ({
  createRestore: mocks.createRestore,
}));

vi.mock('../api/ndk-resources', () => ({
  ApplicationSnapshotRestoreClass: {
    useList: () => [mocks.restoreStore.list, null],
  },
}));

import { RestoreButton } from './RestoreButton';

const SNAP = 'mongo-snap-1';
const NS = 'mongo';

function restoreCR(name: string, status: Record<string, unknown>) {
  return { metadata: { name, namespace: NS }, jsonData: { status } };
}

beforeEach(() => {
  mocks.restoreStore.list = [];
  mocks.createRestore.mockReset();
  mocks.createRestore.mockResolvedValue({});
});

describe('RestoreButton gating', () => {
  it('is disabled with an explanatory tooltip for a non-restorable snapshot', async () => {
    render(<RestoreButton snapshotName={SNAP} namespace={NS} restorable={false} />);
    const btn = screen.getByRole('button', { name: /restore/i });
    expect(btn).toBeDisabled();
  });

  it('is disabled when a restore has already succeeded', () => {
    render(
      <RestoreButton
        snapshotName={SNAP}
        namespace={NS}
        restorable
        existingRestoreState="restored"
      />
    );
    expect(screen.getByRole('button', { name: /restore/i })).toBeDisabled();
  });

  it('is disabled while a restore is in progress', () => {
    render(
      <RestoreButton
        snapshotName={SNAP}
        namespace={NS}
        restorable
        existingRestoreState="restoring"
      />
    );
    expect(screen.getByRole('button', { name: /restore/i })).toBeDisabled();
  });

  it('is enabled (retry) when the only prior restore failed', () => {
    render(
      <RestoreButton snapshotName={SNAP} namespace={NS} restorable existingRestoreState="error" />
    );
    expect(screen.getByRole('button', { name: /restore/i })).toBeEnabled();
  });

  it('is enabled for a restorable snapshot with no prior restore', () => {
    render(<RestoreButton snapshotName={SNAP} namespace={NS} restorable />);
    expect(screen.getByRole('button', { name: /restore/i })).toBeEnabled();
  });
});

describe('RestoreDialog workflow', () => {
  async function openAndConfirm() {
    const user = userEvent.setup();
    const view = render(<RestoreButton snapshotName={SNAP} namespace={NS} restorable />);
    await user.click(screen.getByRole('button', { name: /restore/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
    return { user, view, dialog };
  }

  it('creates the restore CR with the snapshot name + namespace on confirm', async () => {
    await openAndConfirm();
    expect(mocks.createRestore).toHaveBeenCalledTimes(1);
    const arg = mocks.createRestore.mock.calls[0][0];
    expect(arg).toMatchObject({ namespace: NS, applicationSnapshotName: SNAP });
    expect(arg.name).toMatch(/-restore-/);
  });

  it('shows progress, then a success message once the watch reports completed', async () => {
    const { view } = await openAndConfirm();
    const name = mocks.createRestore.mock.calls[0][0].name;

    // Controller finishes the restore successfully.
    mocks.restoreStore.list = [restoreCR(name, { completed: true, boundApplication: 'mongo-app' })];
    view.rerender(<RestoreButton snapshotName={SNAP} namespace={NS} restorable />);

    expect(await screen.findByText(/restored successfully/i)).toBeInTheDocument();
    expect(screen.getByText(/mongo-app/)).toBeInTheDocument();
  });

  it('surfaces a backend terminal failure with the real error message', async () => {
    const { view } = await openAndConfirm();
    const name = mocks.createRestore.mock.calls[0][0].name;

    // Shaped exactly like the k8s-juno controller writes a precheck failure: the
    // Progressing condition only points at another condition, while the real
    // error lives on status.error + the type-specific (PrechecksPassed) condition.
    const realError =
      'Resources to restore already exist in the kubernetes cluster: [Deployment/mongo]';
    mocks.restoreStore.list = [
      restoreCR(name, {
        completed: false,
        error: { reason: 'PrechecksFailed', message: realError },
        conditions: [
          {
            type: 'Progressing',
            status: 'False',
            reason: 'PrechecksFailed',
            message: "See 'PrechecksPassed' condition for more info",
          },
          {
            type: 'PrechecksPassed',
            status: 'False',
            reason: 'ResourcesAlreadyExist',
            message: realError,
          },
        ],
      }),
    ];
    view.rerender(<RestoreButton snapshotName={SNAP} namespace={NS} restorable />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(realError);
    // The unhelpful "See 'X' condition for more info" pointer must NOT be shown.
    expect(screen.queryByText(/See '.*' condition for more info/)).not.toBeInTheDocument();
    expect(within(alert).queryByText(/restored successfully/i)).not.toBeInTheDocument();
  });

  it('shows progress through intermediate phases without a premature result', async () => {
    const { view } = await openAndConfirm();
    const name = mocks.createRestore.mock.calls[0][0].name;

    // Controller has started prechecks: in progress, no result yet.
    mocks.restoreStore.list = [
      restoreCR(name, {
        completed: false,
        startTime: '2026-06-02T00:00:00Z',
        conditions: [
          {
            type: 'Progressing',
            status: 'True',
            reason: 'RunningPrechecks',
            message: 'Prechecks are being run',
          },
        ],
      }),
    ];
    view.rerender(<RestoreButton snapshotName={SNAP} namespace={NS} restorable />);

    expect(await screen.findByText('Prechecks are being run')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Restoring')).toBeInTheDocument();
  });

  it('reports success even when boundApplication is absent', async () => {
    const { view } = await openAndConfirm();
    const name = mocks.createRestore.mock.calls[0][0].name;

    mocks.restoreStore.list = [restoreCR(name, { completed: true })];
    view.rerender(<RestoreButton snapshotName={SNAP} namespace={NS} restorable />);

    expect(await screen.findByText(/restored successfully/i)).toBeInTheDocument();
  });

  it('surfaces a failed CR creation (e.g. webhook rejection) as an error', async () => {
    mocks.createRestore.mockRejectedValue(new Error('admission webhook denied the request'));
    await openAndConfirm();
    expect(await screen.findByText('admission webhook denied the request')).toBeInTheDocument();
  });
});
