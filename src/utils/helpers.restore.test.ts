// Rigorous unit tests for the restore-workflow helpers in helpers.ts.
//
// These encode the documented intent of the "smart restore" gate + the restore
// state machine, cross-checked against the k8s-juno ApplicationSnapshotRestore
// backend contract:
//   - status.completed === true  on success (asr_request_finalize.go)
//   - the "Progressing" condition's `reason` carries the controller state name
//     (controllerutils funcs.go: stateCondition.Reason = string(nextState))
//   - terminal failure state names: PrechecksFailed,
//     SubmittingVolumeCreateRequestsFailed, ApplicationConfigRestoreFailed,
//     VolumesRestoreFailed (states.go)
//   - the replicated-in annotation key is dataservices.nutanix.com/app-snap-replicate-uid
import { describe, expect, it, vi } from 'vitest';
import type { ApplicationSnapshotRestoreStatus, KubeCondition } from '../api/types';
import { REPLICATED_IN_ANNOTATION } from '../api/types';
import {
  aggregateRestoreState,
  isRestorableSnapshot,
  makeRestoreName,
  replicationsForSnapshot,
  restoreMessage,
  restoreState,
} from './helpers';

function progressing(status: 'True' | 'False', reason?: string, message?: string): KubeCondition {
  return { type: 'Progressing', status, reason, message };
}

describe('restoreState', () => {
  it('treats no status / empty status as pending', () => {
    expect(restoreState(undefined)).toBe('pending');
    expect(restoreState({})).toBe('pending');
  });

  it('reports restored once completed=true', () => {
    expect(restoreState({ completed: true })).toBe('restored');
  });

  it('reports restoring while the controller is working', () => {
    // completed is initialised to false at the start of reconciliation.
    expect(restoreState({ completed: false })).toBe('restoring');
    expect(restoreState({ startTime: '2026-06-02T00:00:00Z' })).toBe('restoring');
    expect(
      restoreState({
        completed: false,
        conditions: [progressing('True', 'RunningPrechecks', 'Prechecks are being run')],
      })
    ).toBe('restoring');
    // An in-progress volume phase must NOT be mistaken for the *Failed variant.
    expect(
      restoreState({
        completed: false,
        conditions: [progressing('True', 'SubmittingVolumeCreateRequests')],
      })
    ).toBe('restoring');
  });

  it.each([
    'PrechecksFailed',
    'SubmittingVolumeCreateRequestsFailed',
    'ApplicationConfigRestoreFailed',
    'VolumesRestoreFailed',
  ])('reports error for terminal failure reason %s', reason => {
    expect(
      restoreState({
        completed: false,
        conditions: [progressing('False', reason, 'see condition for more info')],
      })
    ).toBe('error');
  });

  it('lets completed=true win over a stale failure reason', () => {
    expect(
      restoreState({
        completed: true,
        conditions: [progressing('False', 'PrechecksFailed')],
      })
    ).toBe('restored');
  });

  it('does not treat an unknown non-terminal reason as error', () => {
    expect(
      restoreState({
        completed: false,
        conditions: [progressing('False', 'RequestCompleted')],
      })
    ).toBe('restoring');
  });
});

describe('restoreMessage', () => {
  it('prefers the Progressing condition message', () => {
    const status: ApplicationSnapshotRestoreStatus = {
      conditions: [
        progressing('True', 'RestoringApplicationConfig', 'Application config is being restored'),
      ],
    };
    expect(restoreMessage(status)).toBe('Application config is being restored');
  });

  it('falls back to the most recent failing condition message', () => {
    const status: ApplicationSnapshotRestoreStatus = {
      conditions: [
        progressing('True', 'RunningPrechecks'),
        {
          type: 'PrechecksPassed',
          status: 'False',
          reason: 'ResourcesAlreadyExist',
          message: 'app already exists',
        },
      ],
    };
    expect(restoreMessage(status)).toBe('app already exists');
  });

  it('returns undefined when there is nothing to say', () => {
    expect(restoreMessage(undefined)).toBeUndefined();
    expect(restoreMessage({})).toBeUndefined();
  });

  // Regression: on a terminal failure the k8s-juno controller sets the
  // Progressing condition's MESSAGE to a pointer ("See 'X' condition for more
  // info") while storing the real error on status.error and the type-specific
  // failing condition. The UI must surface the real error, not the pointer.
  // (asr_prechecks.go / asr_appconfig_restore.go / asr_volume_restore_request.go)
  it('surfaces the real error (not the "See ... condition" pointer) on terminal failure', () => {
    const realError =
      'Resources to restore already exist in the kubernetes cluster: [Deployment/mongo]';
    const status: ApplicationSnapshotRestoreStatus = {
      completed: false,
      startTime: '2026-06-02T00:00:00Z',
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
    };

    expect(restoreState(status)).toBe('error');
    const msg = restoreMessage(status);
    expect(msg).not.toMatch(/See '.*' condition/);
    expect(msg).toBe(realError);
  });
});

describe('aggregateRestoreState', () => {
  const STATUS = {
    restored: { completed: true },
    restoring: { completed: false },
    pending: {},
    error: { conditions: [progressing('False', 'PrechecksFailed')] },
  };

  function restore(snapshotName: string, namespace: string, kind: keyof typeof STATUS) {
    return {
      metadata: { namespace },
      jsonData: { spec: { applicationSnapshotName: snapshotName }, status: STATUS[kind] },
    };
  }

  it('returns undefined when there are no restores for the snapshot', () => {
    expect(aggregateRestoreState(undefined, 'snap', 'ns')).toBeUndefined();
    expect(aggregateRestoreState([], 'snap', 'ns')).toBeUndefined();
    expect(
      aggregateRestoreState([restore('other-snap', 'ns', 'restored')], 'snap', 'ns')
    ).toBeUndefined();
  });

  it('reports restored / restoring / error with the documented precedence', () => {
    expect(aggregateRestoreState([restore('snap', 'ns', 'restored')], 'snap', 'ns')).toBe(
      'restored'
    );
    expect(aggregateRestoreState([restore('snap', 'ns', 'restoring')], 'snap', 'ns')).toBe(
      'restoring'
    );
    // A not-yet-reconciled (pending) restore still blocks the button.
    expect(aggregateRestoreState([restore('snap', 'ns', 'pending')], 'snap', 'ns')).toBe(
      'restoring'
    );
    expect(aggregateRestoreState([restore('snap', 'ns', 'error')], 'snap', 'ns')).toBe('error');

    // restored wins over a prior failure; an in-flight one wins over a failure.
    expect(
      aggregateRestoreState(
        [restore('snap', 'ns', 'error'), restore('snap', 'ns', 'restored')],
        'snap',
        'ns'
      )
    ).toBe('restored');
    expect(
      aggregateRestoreState(
        [restore('snap', 'ns', 'error'), restore('snap', 'ns', 'restoring')],
        'snap',
        'ns'
      )
    ).toBe('restoring');
    // Only when EVERY attempt failed do we leave the button enabled to retry.
    expect(
      aggregateRestoreState(
        [restore('snap', 'ns', 'error'), restore('snap', 'ns', 'error')],
        'snap',
        'ns'
      )
    ).toBe('error');
  });

  // Regression: ApplicationSnapshotRestore is namespaced and snapshot names can
  // collide across namespaces. On the cluster-wide dashboard (<SnapshotList/>
  // with no namespace) a restore in one namespace must NOT gate a same-named
  // snapshot in another namespace.
  it('does not let a restore in another namespace affect a same-named snapshot', () => {
    const restores = [restore('mongo-snap-1', 'team-a', 'restored')];
    // team-a's snapshot is correctly reported as restored...
    expect(aggregateRestoreState(restores, 'mongo-snap-1', 'team-a')).toBe('restored');
    // ...but team-b's same-named snapshot is untouched.
    expect(aggregateRestoreState(restores, 'mongo-snap-1', 'team-b')).toBeUndefined();
  });
});

describe('replicationsForSnapshot', () => {
  function repl(snapshotName: string, namespace: string, name: string) {
    return {
      metadata: { name, namespace },
      jsonData: { spec: { applicationSnapshotName: snapshotName } },
    };
  }

  it('returns only the replications for that snapshot in its namespace', () => {
    const repls = [
      repl('snap', 'ns', 'r1'),
      repl('snap', 'ns', 'r2'),
      repl('other', 'ns', 'r3'),
      repl('snap', 'other-ns', 'r4'),
    ];
    expect(replicationsForSnapshot(repls, 'snap', 'ns').map(r => r.metadata.name)).toEqual([
      'r1',
      'r2',
    ]);
  });

  // Regression: same-named snapshots in different namespaces must not share
  // replications (this list feeds the count AND the delete cascade).
  it('does not match a same-named snapshot in another namespace', () => {
    const repls = [repl('mongo-snap-1', 'team-a', 'r1')];
    expect(
      replicationsForSnapshot(repls, 'mongo-snap-1', 'team-a').map(r => r.metadata.name)
    ).toEqual(['r1']);
    expect(replicationsForSnapshot(repls, 'mongo-snap-1', 'team-b')).toEqual([]);
  });

  it('handles empty / nullish lists', () => {
    expect(replicationsForSnapshot(undefined, 'snap', 'ns')).toEqual([]);
    expect(replicationsForSnapshot([], 'snap', 'ns')).toEqual([]);
  });
});

describe('isRestorableSnapshot', () => {
  const ready = { readyToUse: true };

  it('is true for a ready snapshot replicated in from another cluster', () => {
    expect(
      isRestorableSnapshot({
        metadata: { annotations: { [REPLICATED_IN_ANNOTATION]: 'some-uid' } },
        status: ready,
      })
    ).toBe(true);
  });

  it('is false for a locally created snapshot (no annotation)', () => {
    expect(isRestorableSnapshot({ metadata: { annotations: {} }, status: ready })).toBe(false);
    expect(isRestorableSnapshot({ status: ready })).toBe(false);
  });

  it('is false for a replicated-in snapshot that is not ready yet', () => {
    expect(
      isRestorableSnapshot({
        metadata: { annotations: { [REPLICATED_IN_ANNOTATION]: 'some-uid' } },
        status: { readyToUse: false },
      })
    ).toBe(false);
  });

  it('is false for a replicated-in snapshot that errored', () => {
    expect(
      isRestorableSnapshot({
        metadata: { annotations: { [REPLICATED_IN_ANNOTATION]: 'some-uid' } },
        status: { error: { message: 'boom' } },
      })
    ).toBe(false);
  });

  it('is false for undefined', () => {
    expect(isRestorableSnapshot(undefined)).toBe(false);
  });
});

describe('makeRestoreName', () => {
  const RFC1123 = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

  it('produces a valid, suffixed RFC-1123 name', () => {
    const name = makeRestoreName('mongo-snap-1');
    expect(name).toMatch(/-restore-/);
    expect(name).toMatch(RFC1123);
    expect(name.length).toBeLessThanOrEqual(63);
  });

  it('stays within 63 chars and valid even for very long inputs', () => {
    const longName = 'a'.repeat(200);
    const name = makeRestoreName(longName);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toMatch(RFC1123);
    expect(name).toMatch(/-restore-/);
  });

  it('sanitises illegal characters', () => {
    const name = makeRestoreName('My_Snap.With UPPER');
    expect(name).toMatch(RFC1123);
  });

  it('is unique across calls', () => {
    const names = new Set(Array.from({ length: 50 }, () => makeRestoreName('snap')));
    expect(names.size).toBe(50);
  });

  it('uses the random suffix deterministically when Math.random is fixed', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      // charset[0] === 'a', so a length-5 suffix is "aaaaa".
      expect(makeRestoreName('snap')).toBe('snap-restore-aaaaa');
    } finally {
      spy.mockRestore();
    }
  });
});
