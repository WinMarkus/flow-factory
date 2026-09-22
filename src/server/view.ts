import { GEAR_COINS, INSPECTION_TOKENS, SAVE_PLAYER_NAME } from '../shared/constants.js';
import type {
  CheckInAggregate,
  GameStateView,
  InspectionResult,
  PlayerView,
} from '../shared/types.js';
import { basketSupport, phaseIndex, toPublic, tokenTotals } from './game.js';
import type { InternalPlayer, Room } from './state.js';

export function aggregateCheckIn(room: Room): CheckInAggregate {
  const energyCounts: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  const conditionCounts: Record<string, number> = {};
  let energySum = 0;

  for (const checkIn of room.checkIns.values()) {
    energyCounts[String(checkIn.energy)] = (energyCounts[String(checkIn.energy)] ?? 0) + 1;
    conditionCounts[checkIn.condition] = (conditionCounts[checkIn.condition] ?? 0) + 1;
    energySum += checkIn.energy;
  }

  const submitted = room.checkIns.size;
  return {
    submitted,
    total: room.players.length,
    averageEnergy: submitted > 0 ? Math.round((energySum / submitted) * 10) / 10 : null,
    energyCounts,
    conditionCounts,
  };
}

export function inspectionResults(room: Room): InspectionResult[] {
  const totals = tokenTotals(room);
  return room.submissions
    .filter((item) => item.kind !== 'wildcard')
    .map((item) => ({ itemId: item.id, tokens: totals.get(item.id) ?? 0 }))
    .sort((a, b) => b.tokens - a.tokens);
}

function playerViews(room: Room): PlayerView[] {
  return room.players.map((player) => ({
    id: player.id,
    name: player.name,
    avatar: player.avatar,
    connected: player.connected,
    isFacilitator: player.isFacilitator,
    checkedIn: room.checkIns.has(player.id),
    readyBuild: room.readyBuild.has(player.id),
    readyInspect: room.readyInspect.has(player.id),
    readyShop: room.readyShop.has(player.id),
  }));
}

/**
 * Builds the state a single player is allowed to see. Submissions from other
 * players stay hidden until the reveal, and author ids are never included.
 */
export function buildStateView(
  room: Room,
  player: InternalPlayer,
  options: { githubConfigured: boolean },
): GameStateView {
  const revealed = phaseIndex(room.phase) >= phaseIndex('run1');
  const mine = toPublic(room.submissions.filter((item) => item.authorId === player.id));
  const items = revealed ? toPublic(room.submissions) : [];
  const votingVisible = room.votingClosed || phaseIndex(room.phase) > phaseIndex('inspect');

  return {
    code: room.code,
    factoryName: room.factoryName,
    phase: room.phase,
    createdAt: room.createdAt,
    you: {
      id: player.id,
      name: player.name,
      avatar: player.avatar,
      isFacilitator: player.isFacilitator,
      canSaveToGitHub: player.name === SAVE_PLAYER_NAME,
    },
    players: playerViews(room),
    stations: room.stations.map((station) => ({ ...station })),
    checkin: { ...aggregateCheckIn(room), mine: room.checkIns.get(player.id) ?? null },
    build: { mine, revealed, items },
    inspect: {
      tokensPerPlayer: INSPECTION_TOKENS,
      myAllocations: { ...(room.allocations.get(player.id) ?? {}) },
      closed: room.votingClosed,
      results: votingVisible ? inspectionResults(room) : [],
      focusItemId: room.focusItemId,
      notes: room.notes.map((note) => ({ ...note })),
      timer: { ...room.timer },
    },
    shop: {
      coins: GEAR_COINS,
      upgrades: room.upgrades.map((upgrade) => ({ ...upgrade })),
      myBasket: [...(room.baskets.get(player.id) ?? [])],
      revealed: room.basketsRevealed,
      support: room.basketsRevealed ? basketSupport(room) : [],
      basketsSubmitted: room.baskets.size,
      purchased: [...room.purchased],
    },
    runs: {
      first: room.runs.first,
      second: room.runs.second,
    },
    playback: { ...room.playback },
    save: {
      visible: player.name === SAVE_PLAYER_NAME,
      githubConfigured: options.githubConfigured,
      state: { ...room.save },
    },
  };
}
