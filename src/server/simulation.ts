import { ACROSS_FACTORY, SIM } from '../shared/constants.js';
import type {
  ContributionSummary,
  PublicSubmission,
  SimEvent,
  SimFrame,
  SimSummary,
  SimulationResult,
  Station,
  StationFrame,
  Upgrade,
} from '../shared/types.js';

export interface SimulationInput {
  stations: Station[];
  submissions: PublicSubmission[];
  upgrades: Upgrade[];
}

interface StationModel {
  id: string;
  baseSpeed: number;
  bottleneckFactor: number;
  boosterFactor: number;
  upgradeFactor: number;
  speed: number;
}

interface ScheduledEvent {
  startTick: number;
  endTick: number;
  station: string;
  title: string;
  multiplier: number;
}

/** Scale applied when a submission targets the whole factory instead of a station. */
function scaleFor(station: string): number {
  return station === ACROSS_FACTORY ? SIM.GLOBAL_SCALE : 1;
}

function targetsStation(submission: { station: string }, stationId: string): boolean {
  return submission.station === ACROSS_FACTORY || submission.station === stationId;
}

/**
 * Turns submissions and purchased upgrades into per-station speeds.
 *
 * Rules (fully deterministic, no randomness anywhere):
 *   base speed          = 1.0 for every station
 *   bottleneck          x (1 - 0.15 * impact * scale)
 *   booster             x (1 + 0.12 * impact * scale)
 *   purchased upgrade   removes 50% of the remaining bottleneck penalty at its
 *                       target station and adds a flat +5% handling bonus
 *   final speed clamped to [0.2, 2.5]
 */
export function computeStationModels(input: SimulationInput): StationModel[] {
  return input.stations.map((station) => {
    let bottleneckFactor = 1;
    let boosterFactor = 1;

    for (const submission of input.submissions) {
      if (!targetsStation(submission, station.id)) continue;
      const scale = scaleFor(submission.station);
      if (submission.kind === 'bottleneck') {
        bottleneckFactor *= 1 - SIM.BOTTLENECK_STEP * submission.impact * scale;
      } else if (submission.kind === 'booster') {
        boosterFactor *= 1 + SIM.BOOSTER_STEP * submission.impact * scale;
      }
    }

    let relievedBottleneck = bottleneckFactor;
    let upgradeBonus = 1;
    for (const upgrade of input.upgrades) {
      if (!targetsStation(upgrade, station.id)) continue;
      const scale = scaleFor(upgrade.station);
      relievedBottleneck += (1 - relievedBottleneck) * SIM.UPGRADE_RELIEF * scale;
      upgradeBonus += SIM.UPGRADE_BONUS * scale;
    }

    const raw = relievedBottleneck * boosterFactor * upgradeBonus;
    const speed = Math.min(SIM.MAX_SPEED, Math.max(SIM.MIN_SPEED, round4(raw)));

    return {
      id: station.id,
      baseSpeed: 1,
      bottleneckFactor: round4(bottleneckFactor),
      boosterFactor: round4(boosterFactor),
      upgradeFactor: round4(relievedBottleneck * upgradeBonus / (bottleneckFactor || 1)),
      speed,
    };
  });
}

/** Wildcards fire on a fixed schedule so both runs stay comparable. */
export function scheduleWildcards(submissions: PublicSubmission[]): ScheduledEvent[] {
  const wildcards = submissions.filter((s) => s.kind === 'wildcard');
  return wildcards.map((wildcard, index) => {
    const startTick = SIM.WILDCARD_FIRST_TICK + index * SIM.WILDCARD_SPACING;
    return {
      startTick,
      endTick: startTick + SIM.WILDCARD_DURATION,
      station: wildcard.station,
      title: wildcard.title,
      multiplier: 1 - (1 - SIM.WILDCARD_MULTIPLIER) * (wildcard.impact / 3) * scaleFor(wildcard.station),
    };
  });
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Runs the symbolic factory. Work items arrive at a constant rate, each station
 * moves as many items downstream per tick as its speed allows, and anything it
 * cannot handle stays in its queue.
 */
export function runSimulation(
  input: SimulationInput,
  id: 'first' | 'second',
): SimulationResult {
  const models = computeStationModels(input);
  const events = scheduleWildcards(input.submissions);
  const queues = new Map<string, number>();
  const credits = new Map<string, number>();
  for (const model of models) {
    queues.set(model.id, 0);
    credits.set(model.id, 0);
  }

  const frames: SimFrame[] = [];
  const largestQueueByStation = new Map<string, number>();
  let throughput = 0;
  let warningLights = 0;
  let waitAccumulator = 0;
  const warningStations = new Set<string>();

  const lastStationId = models[models.length - 1]?.id ?? '';

  for (let tick = 1; tick <= SIM.TICKS; tick += 1) {
    // Fresh tickets arrive at the very first station.
    const firstStation = models[0];
    if (firstStation) {
      queues.set(firstStation.id, (queues.get(firstStation.id) ?? 0) + SIM.ARRIVALS_PER_TICK);
    }

    const activeEvents: SimEvent[] = [];
    const stationFrames: StationFrame[] = [];

    for (let index = 0; index < models.length; index += 1) {
      const model = models[index]!;
      let effectiveSpeed = model.speed;

      for (const event of events) {
        if (tick < event.startTick || tick >= event.endTick) continue;
        if (event.station !== ACROSS_FACTORY && event.station !== model.id) continue;
        effectiveSpeed *= event.multiplier;
        if (index === 0 || event.station === model.id) {
          activeEvents.push({ tick, station: event.station, title: event.title, kind: 'wildcard' });
        }
      }

      const capacityCredit = (credits.get(model.id) ?? 0) + effectiveSpeed * SIM.BASE_RATE;
      const queue = queues.get(model.id) ?? 0;
      const moved = Math.min(queue, Math.floor(capacityCredit));
      credits.set(model.id, round4(capacityCredit - moved));
      const remaining = queue - moved;
      queues.set(model.id, remaining);

      if (model.id === lastStationId) {
        throughput += moved;
      } else {
        const next = models[index + 1]!;
        queues.set(next.id, (queues.get(next.id) ?? 0) + moved);
      }

      const warning = remaining >= SIM.WARN_QUEUE;
      if (warning) {
        warningLights += 1;
        warningStations.add(model.id);
      }
      largestQueueByStation.set(
        model.id,
        Math.max(largestQueueByStation.get(model.id) ?? 0, remaining),
      );

      stationFrames.push({
        id: model.id,
        queue: remaining,
        processed: moved,
        speed: round2(effectiveSpeed),
        warning,
      });
    }

    const wip = stationFrames.reduce((sum, frame) => sum + frame.queue, 0);
    const waitIndex = round2(wip / SIM.ARRIVALS_PER_TICK);
    waitAccumulator += waitIndex;

    frames.push({
      tick,
      stations: stationFrames,
      throughput,
      wip,
      waitIndex,
      activeEvents,
    });
  }

  let largestQueue = { station: models[0]?.id ?? '', value: 0 };
  for (const [stationId, value] of largestQueueByStation) {
    if (value > largestQueue.value) largestQueue = { station: stationId, value };
  }

  const summary: SimSummary = {
    throughput,
    largestQueue,
    averageWaitIndex: round2(waitAccumulator / SIM.TICKS),
    warningLights,
    warningStations: [...warningStations],
    topBoosters: rankContributions(input, 'booster'),
    topBottlenecks: rankContributions(input, 'bottleneck'),
    affectedStations: affectedStations(input),
    stationSpeeds: Object.fromEntries(models.map((model) => [model.id, model.speed])),
  };

  return {
    id,
    frames,
    summary,
    upgradesApplied: input.upgrades.map((upgrade) => upgrade.id),
  };
}

function rankContributions(
  input: SimulationInput,
  kind: 'booster' | 'bottleneck',
): ContributionSummary[] {
  const step = kind === 'booster' ? SIM.BOOSTER_STEP : SIM.BOTTLENECK_STEP;
  return input.submissions
    .filter((submission) => submission.kind === kind)
    .map((submission) => ({
      id: submission.id,
      title: submission.title,
      station: submission.station,
      impact: submission.impact,
      effectPercent: Math.round(step * submission.impact * scaleFor(submission.station) * 100),
    }))
    .sort((a, b) => b.effectPercent - a.effectPercent || a.title.localeCompare(b.title))
    .slice(0, 5);
}

function affectedStations(input: SimulationInput): string[] {
  const set = new Set<string>();
  for (const submission of input.submissions) set.add(submission.station);
  for (const upgrade of input.upgrades) set.add(upgrade.station);
  return [...set];
}
