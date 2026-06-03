// Component tests for the Create Replication Target dialog: the remote picker
// auto-suggests the target name and mirrors the namespace, the Create button
// builds the right CreateReplicationTargetArgs, success + webhook-rejection are
// surfaced, and an existing target for the remote is flagged for reuse.
//
// The K8s list hooks (namespaces, remotes, existing targets) and the create
// action are mocked, mirroring RestoreButton.test.tsx.
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createReplicationTarget: vi.fn(),
  remotes: [] as any[],
  targets: [] as any[],
  namespaces: [] as any[],
}));

vi.mock('../api/ndk-actions', () => ({
  createReplicationTarget: mocks.createReplicationTarget,
}));

vi.mock('../api/ndk-resources', () => ({
  RemoteClass: { useList: () => [mocks.remotes, null] },
  ReplicationTargetClass: { useList: () => [mocks.targets, null] },
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    ResourceClasses: {
      Namespace: { useList: () => [mocks.namespaces, null] },
    },
  },
}));

import { CreateReplicationTargetDialog } from './CreateReplicationTargetDialog';

function remote(name: string, available = true) {
  return {
    metadata: { name },
    jsonData: {
      spec: { ndkServiceIp: '10.0.0.5' },
      status: { conditions: [{ type: 'Available', status: available ? 'True' : 'False' }] },
    },
  };
}

async function selectRemote(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('combobox', { name: 'Remote cluster' }));
  const listbox = await screen.findByRole('listbox');
  await user.click(within(listbox).getByRole('option', { name: new RegExp(name) }));
}

beforeEach(() => {
  mocks.createReplicationTarget.mockReset();
  mocks.createReplicationTarget.mockResolvedValue({});
  mocks.remotes = [remote('secondary-remote')];
  mocks.targets = [];
  mocks.namespaces = [{ metadata: { name: 'mongo' } }, { metadata: { name: 'default' } }];
});

describe('CreateReplicationTargetDialog', () => {
  it('auto-suggests rt-<remote>, mirrors the namespace, and creates the target', async () => {
    const user = userEvent.setup();
    render(<CreateReplicationTargetDialog fixedNamespace="mongo" onClose={vi.fn()} />);

    await selectRemote(user, 'secondary-remote');

    expect(screen.getByLabelText(/Replication target name/i)).toHaveValue('rt-secondary-remote');
    expect(screen.getByLabelText(/Remote namespace/i)).toHaveValue('mongo');

    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(mocks.createReplicationTarget).toHaveBeenCalledTimes(1);
    expect(mocks.createReplicationTarget.mock.calls[0][0]).toMatchObject({
      name: 'rt-secondary-remote',
      namespace: 'mongo',
      remoteName: 'secondary-remote',
      namespaceName: 'mongo',
    });
    expect(await screen.findByText(/created in/i)).toBeInTheDocument();
  });

  it('surfaces a webhook rejection as an error', async () => {
    mocks.createReplicationTarget.mockRejectedValue(
      new Error('admission webhook denied the request')
    );
    const user = userEvent.setup();
    render(<CreateReplicationTargetDialog fixedNamespace="mongo" onClose={vi.fn()} />);

    await selectRemote(user, 'secondary-remote');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('admission webhook denied the request')).toBeInTheDocument();
  });

  it('flags an existing target that already points at the chosen remote', async () => {
    mocks.targets = [
      {
        metadata: { name: 'rt-existing', namespace: 'mongo' },
        jsonData: { spec: { remoteName: 'secondary-remote' } },
      },
    ];
    const user = userEvent.setup();
    render(<CreateReplicationTargetDialog fixedNamespace="mongo" onClose={vi.fn()} />);

    await selectRemote(user, 'secondary-remote');

    expect(screen.getByText(/already targets/i)).toBeInTheDocument();
  });

  it('Create stays disabled until a remote is chosen', async () => {
    render(<CreateReplicationTargetDialog fixedNamespace="mongo" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });
});
