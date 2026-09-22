import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_STATIONS, SIM } from '../shared/constants.js';
import { computeStationModels, runSimulation } from '../server/simulation.js';
import type { PublicSubmission, Upgrade } from '../shared/types.js';

const stations = DEFAULT_STATIONS.map((station) => ({ ...station }));

function submission(partial: Partial<PublicSubmission> & { kind: PublicSubmission['kind'] }): PublicSubmission {
  return {
    id: partial.id ?? `${partial.kind}-${partial.title ?? 'item'}`,
    kind: partial.kind,
    title: partial.title ?? 'Item',
    description: partial.description ?? '',
    station: partial.station ?? 'all',
    impact: partial.impact ?? 2,
    mergedFrom: [],
  };
}

function upgrade(partial: Partial<Upgrade>): Upgrade {
  return {
    id: partial.id ?? 'upgrade-1',
    name: partial.name ?? 'Review rota',
    problem: 'Reviews wait',
    experiment: 'Two named reviewers per day',
    signal: 'No pull request waits longer than a day',
    cost: partial.cost ?? 3,
    owner: '',
    reviewDate: '',
    station: partial.station ?? 'review',
  };
}

test('an empty factory runs at base speed and never warns', () => {
  const result = runSimulation({ stations, submissions: [], upgrades: [] }, 'first');
  assert.equal(result.frames.length, SIM.TICKS);
  assert.equal(result.summary.warningLights, 0);
  assert.ok(result.summary.throughput > 0);
  for (const speed of Object.values(result.summary.stationSpeeds)) {
    assert.equal(speed, 1);
  }
});

test('the simulation is deterministic - identical inputs give identical frames', () => {
  const input = {
    stations,
    submissions: [
      submission({ kind: 'bottleneck', title: 'Slow review', station: 'review', impact: 3 }),
      submission({ kind: 'booster', title: 'Pairing', station: 'development', impact: 2 }),
      submission({ kind: 'wildcard', title: 'Fire drill', station: 'all', impact: 2 }),
    ],
    upgrades: [],
  };
  const a = runSimulation(input, 'first');
  const b = runSimulation(input, 'first');
  assert.deepEqual(a.frames, b.frames);
  assert.deepEqual(a.summary, b.summary);
});

test('station speed follows the documented multipliers', () => {
  const models = computeStationModels({
    stations,
    submissions: [
      submission({ kind: 'bottleneck', station: 'review', impact: 2 }),
      submission({ kind: 'booster', station: 'development', impact: 1 }),
    ],
    upgrades: [],
  });
  const review = models.find((model) => model.id === 'review')!;
  const development = models.find((model) => model.id === 'development')!;
  const intake = models.find((model) => model.id === 'intake')!;

  assert.equal(review.speed, 1 - SIM.BOTTLENECK_STEP * 2);
  assert.equal(development.speed, 1 + SIM.BOOSTER_STEP * 1);
  assert.equal(intake.speed, 1);
});

test('an across-the-factory item is applied at half strength everywhere', () => {
  const models = computeStationModels({
    stations,
    submissions: [submission({ kind: 'bottleneck', station: 'all', impact: 2 })],
    upgrades: [],
  });
  const expected = 1 - SIM.BOTTLENECK_STEP * 2 * SIM.GLOBAL_SCALE;
  for (const model of models) {
    assert.equal(model.speed, expected);
  }
});

test('a bigger impact value produces a bigger effect', () => {
  const light = runSimulation(
    {
      stations,
      submissions: [submission({ kind: 'bottleneck', station: 'test', impact: 1 })],
      upgrades: [],
    },
    'first',
  );
  const heavy = runSimulation(
    {
      stations,
      submissions: [submission({ kind: 'bottleneck', station: 'test', impact: 3 })],
      upgrades: [],
    },
    'first',
  );
  assert.ok(heavy.summary.throughput < light.summary.throughput);
  assert.ok(heavy.summary.largestQueue.value > light.summary.largestQueue.value);
  assert.equal(heavy.summary.largestQueue.station, 'test');
});

test('queues and warning lights build up at the constrained station', () => {
  const result = runSimulation(
    {
      stations,
      submissions: [submission({ kind: 'bottleneck', station: 'review', impact: 3 })],
      upgrades: [],
    },
    'first',
  );
  assert.ok(result.summary.warningLights > 0);
  assert.deepEqual(result.summary.warningStations, ['review']);
  const lastFrame = result.frames.at(-1)!;
  const review = lastFrame.stations.find((station) => station.id === 'review')!;
  assert.ok(review.queue >= SIM.WARN_QUEUE);
});

test('wildcards fire on a fixed schedule rather than at random', () => {
  const input = {
    stations,
    submissions: [submission({ kind: 'wildcard', title: 'Incident call', station: 'deploy', impact: 3 })],
    upgrades: [],
  };
  const result = runSimulation(input, 'first');
  const active = result.frames.filter((frame) => frame.activeEvents.length > 0).map((frame) => frame.tick);
  assert.equal(active[0], SIM.WILDCARD_FIRST_TICK);
  assert.equal(active.length, SIM.WILDCARD_DURATION);
  assert.equal(result.frames[0]?.activeEvents.length, 0);
});

test('purchased upgrades relieve the bottleneck they target', () => {
  const submissions = [submission({ kind: 'bottleneck', station: 'review', impact: 3 })];
  const before = runSimulation({ stations, submissions, upgrades: [] }, 'first');
  const after = runSimulation(
    { stations, submissions, upgrades: [upgrade({ station: 'review' })] },
    'second',
  );

  assert.ok(after.summary.throughput > before.summary.throughput);
  assert.ok(after.summary.largestQueue.value < before.summary.largestQueue.value);
  assert.ok(after.summary.averageWaitIndex < before.summary.averageWaitIndex);
  assert.deepEqual(after.upgradesApplied, ['upgrade-1']);
});

test('an upgrade aimed at an untouched station leaves the constrained one alone', () => {
  const submissions = [submission({ kind: 'bottleneck', station: 'review', impact: 3 })];
  const before = computeStationModels({ stations, submissions, upgrades: [] });
  const after = computeStationModels({
    stations,
    submissions,
    upgrades: [upgrade({ station: 'deploy' })],
  });
  const reviewBefore = before.find((model) => model.id === 'review')!.speed;
  const reviewAfter = after.find((model) => model.id === 'review')!.speed;
  assert.equal(reviewBefore, reviewAfter);
});

test('speeds stay inside the clamped range even with extreme input', () => {
  const many = Array.from({ length: 12 }, (_, index) =>
    submission({ kind: 'bottleneck', id: `b${index}`, station: 'test', impact: 3 }),
  );
  const models = computeStationModels({ stations, submissions: many, upgrades: [] });
  const test1 = models.find((model) => model.id === 'test')!;
  assert.ok(test1.speed >= SIM.MIN_SPEED);
  assert.ok(test1.speed <= SIM.MAX_SPEED);
});

test('top contributors are ranked by their symbolic effect', () => {
  const result = runSimulation(
    {
      stations,
      submissions: [
        submission({ kind: 'bottleneck', id: 'b1', title: 'Small', station: 'test', impact: 1 }),
        submission({ kind: 'bottleneck', id: 'b2', title: 'Large', station: 'review', impact: 3 }),
        submission({ kind: 'booster', id: 'g1', title: 'Pairing', station: 'development', impact: 3 }),
      ],
      upgrades: [],
    },
    'first',
  );
  assert.equal(result.summary.topBottlenecks[0]?.title, 'Large');
  assert.equal(result.summary.topBottlenecks[0]?.effectPercent, 45);
  assert.equal(result.summary.topBoosters[0]?.title, 'Pairing');
  assert.equal(result.summary.topBoosters[0]?.effectPercent, 36);
});
