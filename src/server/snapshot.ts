import { APP_NAME, SCHEMA_VERSION, SIMULATION_DISCLAIMER, GEAR_COINS } from '../shared/constants.js';
import type {
  RetroSnapshot,
  SimSummary,
  SnapshotMetrics,
  SnapshotUpgrade,
} from '../shared/types.js';
import { basketSupport, toPublic, tokenTotals } from './game.js';
import type { Room } from './state.js';

function metrics(summary: SimSummary | undefined | null): SnapshotMetrics | null {
  if (!summary) return null;
  return {
    throughput: summary.throughput,
    largestQueue: { ...summary.largestQueue },
    averageWaitIndex: summary.averageWaitIndex,
    warningLights: summary.warningLights,
    affectedStations: [...summary.affectedStations],
  };
}

/** Pads a number to two digits for filename and timestamp formatting. */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Builds the committed path, e.g.
 * `retro-saves/flow-factory/2026-02-14_09-30_room-4F7Q.json` (UTC).
 */
export function buildSavePath(roomCode: string, when: Date = new Date()): string {
  const date = `${when.getUTCFullYear()}-${pad(when.getUTCMonth() + 1)}-${pad(when.getUTCDate())}`;
  const time = `${pad(when.getUTCHours())}-${pad(when.getUTCMinutes())}`;
  const safeCode = roomCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `retro-saves/flow-factory/${date}_${time}_room-${safeCode}.json`;
}

export function buildCommitMessage(room: Room, when: Date = new Date()): string {
  const date = when.toISOString().slice(0, 10);
  return `Flow Factory retro: ${room.factoryName} (room ${room.code}) on ${date}`;
}

/**
 * Produces the clean, anonymous snapshot. Socket ids, reconnection tokens,
 * player ids and submission authors are all excluded by construction: this
 * function reads only from the public projection of the room.
 */
export function buildSnapshot(room: Room, when: Date = new Date()): RetroSnapshot {
  const publicSubmissions = toPublic(room.submissions);
  const totals = tokenTotals(room);
  const support = basketSupport(room);
  const supportById = new Map(support.map((entry) => [entry.upgradeId, entry.supporters]));

  const upgradeProposals: SnapshotUpgrade[] = room.upgrades.map((upgrade) => ({
    ...upgrade,
    supporters: supportById.get(upgrade.id) ?? 0,
    purchased: room.purchased.includes(upgrade.id),
  }));

  const notesByItem = new Map<string, string[]>();
  for (const note of room.notes) {
    const list = notesByItem.get(note.itemId) ?? [];
    list.push(note.text);
    notesByItem.set(note.itemId, list);
  }

  const titleOf = (itemId: string): string =>
    publicSubmissions.find((item) => item.id === itemId)?.title ?? 'Removed item';

  return {
    app: APP_NAME,
    schemaVersion: SCHEMA_VERSION,
    disclaimer: SIMULATION_DISCLAIMER,
    room: {
      code: room.code,
      factoryName: room.factoryName,
      createdAt: new Date(room.createdAt).toISOString(),
      savedAt: when.toISOString(),
      phase: room.phase,
    },
    participants: room.players.map((player) => player.name).sort((a, b) => a.localeCompare(b)),
    checkIn: aggregateForSnapshot(room),
    stations: room.stations.map((station) => ({ ...station })),
    boosters: publicSubmissions.filter((item) => item.kind === 'booster'),
    bottlenecks: publicSubmissions.filter((item) => item.kind === 'bottleneck'),
    wildcards: publicSubmissions.filter((item) => item.kind === 'wildcard'),
    mergedItems: publicSubmissions
      .filter((item) => item.mergedFrom.length > 0)
      .map((item) => ({ id: item.id, title: item.title, mergedFrom: item.mergedFrom })),
    inspectionAllocations: publicSubmissions
      .filter((item) => item.kind !== 'wildcard')
      .map((item) => ({
        itemId: item.id,
        title: item.title,
        kind: item.kind,
        station: item.station,
        tokens: totals.get(item.id) ?? 0,
      }))
      .sort((a, b) => b.tokens - a.tokens),
    discussionNotes: [...notesByItem.entries()].map(([itemId, notes]) => ({
      itemId,
      title: titleOf(itemId),
      notes,
    })),
    upgradeProposals,
    shoppingResults: {
      coins: GEAR_COINS,
      basketsSubmitted: room.baskets.size,
      support,
    },
    purchasedUpgrades: room.upgrades
      .filter((upgrade) => room.purchased.includes(upgrade.id))
      .map((upgrade) => ({ ...upgrade })),
    metrics: {
      before: metrics(room.runs.first?.summary),
      after: metrics(room.runs.second?.summary),
    },
  };
}

function aggregateForSnapshot(room: Room): RetroSnapshot['checkIn'] {
  const energyCounts: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  const conditionCounts: Record<string, number> = {};
  let sum = 0;
  for (const checkIn of room.checkIns.values()) {
    energyCounts[String(checkIn.energy)] = (energyCounts[String(checkIn.energy)] ?? 0) + 1;
    conditionCounts[checkIn.condition] = (conditionCounts[checkIn.condition] ?? 0) + 1;
    sum += checkIn.energy;
  }
  const submitted = room.checkIns.size;
  return {
    submitted,
    total: room.players.length,
    averageEnergy: submitted > 0 ? Math.round((sum / submitted) * 10) / 10 : null,
    energyCounts,
    conditionCounts,
  };
}

export function snapshotToJson(snapshot: RetroSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}
