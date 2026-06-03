// Unit tests for the ReplicationTarget dependent-detection helpers that gate a
// SAFE delete. These encode the k8s-juno finalizer/reference contract:
//   - ApplicationSnapshotReplication.spec.replicationTargetName  -> HARD blocker
//     (per-ASR finalizer on the target; operations.go).
//   - AppNearSyncProtection.spec.replicationTargetRef{name,namespace} -> HARD
//     blocker (lock finalizer; nsp_lock_dependencies.go).
//   - ProtectionPlan.spec.replicationConfigs[].replicationTargetName -> SOFT
//     blocker (plan degrades; protectionplan_controller.go).
// All referrers are namespaced and resolve the target in their own namespace, so
// matching must use the compound (namespace + name) key — never name alone.
import { describe, expect, it } from 'vitest';
import {
  hasHardBlockers,
  nearSyncProtectionsUsingTarget,
  protectionPlansUsingTarget,
  replicationsUsingTarget,
  replicationTargetDependents,
} from './helpers';

function asr(name: string, namespace: string, targetName: string) {
  return {
    metadata: { name, namespace },
    jsonData: { spec: { replicationTargetName: targetName } },
  };
}

function plan(name: string, namespace: string, targetNames: (string | undefined)[]) {
  return {
    metadata: { name, namespace },
    jsonData: {
      spec: { replicationConfigs: targetNames.map(t => ({ replicationTargetName: t })) },
    },
  };
}

function nsp(name: string, namespace: string, refName: string, refNamespace: string) {
  return {
    metadata: { name, namespace },
    jsonData: { spec: { replicationTargetRef: { name: refName, namespace: refNamespace } } },
  };
}

describe('replicationsUsingTarget', () => {
  it('matches ASRs by (namespace + target name)', () => {
    const list = [
      asr('r1', 'mongo', 'rt-a'),
      asr('r2', 'mongo', 'rt-a'),
      asr('r3', 'mongo', 'rt-b'),
      asr('r4', 'other', 'rt-a'),
    ];
    expect(replicationsUsingTarget(list, 'rt-a', 'mongo').map(r => r.metadata.name)).toEqual([
      'r1',
      'r2',
    ]);
  });

  it('does not match a same-named target in another namespace', () => {
    const list = [asr('r1', 'team-a', 'rt-shared')];
    expect(replicationsUsingTarget(list, 'rt-shared', 'team-a').map(r => r.metadata.name)).toEqual([
      'r1',
    ]);
    expect(replicationsUsingTarget(list, 'rt-shared', 'team-b')).toEqual([]);
  });

  it('handles empty / nullish lists', () => {
    expect(replicationsUsingTarget(undefined, 'rt', 'ns')).toEqual([]);
    expect(replicationsUsingTarget([], 'rt', 'ns')).toEqual([]);
  });
});

describe('protectionPlansUsingTarget', () => {
  it('matches a plan if ANY replicationConfig references the target', () => {
    const list = [
      plan('p1', 'mongo', ['rt-other', 'rt-a']),
      plan('p2', 'mongo', ['rt-other']),
      plan('p3', 'mongo', [undefined, 'rt-a']),
    ];
    expect(protectionPlansUsingTarget(list, 'rt-a', 'mongo').map(p => p.metadata.name)).toEqual([
      'p1',
      'p3',
    ]);
  });

  it('respects the namespace boundary', () => {
    const list = [plan('p1', 'team-a', ['rt-a'])];
    expect(protectionPlansUsingTarget(list, 'rt-a', 'team-b')).toEqual([]);
  });

  it('tolerates plans with no replicationConfigs', () => {
    const list = [{ metadata: { name: 'p', namespace: 'mongo' }, jsonData: { spec: {} } }];
    expect(protectionPlansUsingTarget(list, 'rt-a', 'mongo')).toEqual([]);
  });
});

describe('nearSyncProtectionsUsingTarget', () => {
  it('matches on the explicit namespaced ReplicationTargetRef', () => {
    const list = [
      nsp('n1', 'mongo', 'rt-a', 'mongo'),
      // right name, wrong ref namespace -> not a match (different target object)
      nsp('n2', 'mongo', 'rt-a', 'other'),
      nsp('n3', 'mongo', 'rt-b', 'mongo'),
    ];
    expect(nearSyncProtectionsUsingTarget(list, 'rt-a', 'mongo').map(n => n.metadata.name)).toEqual(
      ['n1']
    );
  });

  it('handles nullish ref / list', () => {
    const list = [{ metadata: { name: 'n', namespace: 'mongo' }, jsonData: { spec: {} } }];
    expect(nearSyncProtectionsUsingTarget(list, 'rt-a', 'mongo')).toEqual([]);
    expect(nearSyncProtectionsUsingTarget(undefined, 'rt-a', 'mongo')).toEqual([]);
  });
});

describe('replicationTargetDependents / hasHardBlockers', () => {
  it('collects names grouped by blocker severity', () => {
    const deps = replicationTargetDependents('rt-a', 'mongo', {
      replications: [asr('r1', 'mongo', 'rt-a'), asr('r2', 'other', 'rt-a')],
      protectionPlans: [plan('p1', 'mongo', ['rt-a'])],
      nearSyncProtections: [nsp('n1', 'mongo', 'rt-a', 'mongo')],
    });
    expect(deps).toEqual({
      replications: ['r1'],
      nearSyncProtections: ['n1'],
      protectionPlans: ['p1'],
    });
    expect(hasHardBlockers(deps)).toBe(true);
  });

  it('treats a target referenced only by a ProtectionPlan as a SOFT blocker', () => {
    const deps = replicationTargetDependents('rt-a', 'mongo', {
      protectionPlans: [plan('p1', 'mongo', ['rt-a'])],
    });
    expect(deps.replications).toEqual([]);
    expect(deps.nearSyncProtections).toEqual([]);
    expect(deps.protectionPlans).toEqual(['p1']);
    expect(hasHardBlockers(deps)).toBe(false);
  });

  it('reports no blockers for an unreferenced target', () => {
    const deps = replicationTargetDependents('rt-a', 'mongo', {
      replications: [asr('r1', 'mongo', 'rt-other')],
      protectionPlans: [plan('p1', 'mongo', ['rt-other'])],
      nearSyncProtections: [nsp('n1', 'mongo', 'rt-other', 'mongo')],
    });
    expect(hasHardBlockers(deps)).toBe(false);
    expect(deps.protectionPlans).toEqual([]);
  });
});
