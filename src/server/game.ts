import {
  ACROSS_FACTORY,
  AVATARS,
  CONDITIONS,
  DEFAULT_DISCUSSION_SECONDS,
  GEAR_COINS,
  INSPECTION_TOKENS,
  LIMITS,
  MAX_BOOSTERS,
  MAX_BOTTLENECKS,
  MAX_PURCHASES,
  MAX_UPGRADE_COST,
  MAX_WILDCARDS,
  MIN_UPGRADE_COST,
  PHASES,
  TIMER_EXTENSION_SECONDS,
} from '../shared/constants.js';
import type { Condition, Phase } from '../shared/constants.js';
import type { ActionResult, PublicSubmission, SubmissionKind, Upgrade } from '../shared/types.js';
import { newId } from './ids.js';
import {
  asArray,
  clampInt,
  isPlainObject,
  normalizeName,
  sanitizeLine,
  sanitizeText,
} from './sanitize.js';
import { runSimulation } from './simulation.js';
import {
  createPlayer,
  freshTimer,
  resetRoomState,
  type InternalPlayer,
  type InternalSubmission,
  type Room,
  type RoomStore,
} from './state.js';

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

function fail(error: string): Outcome<never> {
  return { ok: false, error };
}

function done<T>(value: T): Outcome<T> {
  return { ok: true, value };
}

export function ok(): ActionResult {
  return { ok: true };
}

export function err(message: string): ActionResult {
  return { ok: false, error: message };
}

/* -------------------------------------------------------------- membership */

export function validatePlayerName(raw: unknown): Outcome<string> {
  const name = sanitizeLine(raw, LIMITS.playerName);
  if (name.length === 0) return fail('Enter a player name before joining.');
  if (name.length < 2) return fail('Player names need at least two characters.');
  return done(name);
}

export function createRoom(
  store: RoomStore,
  payload: { playerName?: unknown; factoryName?: unknown },
): Outcome<{ room: Room; player: InternalPlayer }> {
  const name = validatePlayerName(payload.playerName);
  if (!name.ok) return name;

  const factoryName =
    sanitizeLine(payload.factoryName, LIMITS.factoryName) || `${name.value}'s Factory`;

  const room = store.create(factoryName);
  const player = createPlayer(name.value, true);
  room.players.push(player);
  room.updatedAt = Date.now();
  return done({ room, player });
}

export function joinRoom(
  store: RoomStore,
  payload: { roomCode?: unknown; playerName?: unknown },
): Outcome<{ room: Room; player: InternalPlayer }> {
  const code = sanitizeLine(payload.roomCode, 8).toUpperCase();
  if (!code) return fail('Enter a room code.');
  const room = store.get(code);
  if (!room) return fail(`No factory found with code ${code}.`);

  const name = validatePlayerName(payload.playerName);
  if (!name.ok) return name;

  const existing = store.findPlayerByName(room, name.value);
  if (existing) {
    if (existing.connected) {
      return fail(`"${name.value}" is already on this shift. Pick another name.`);
    }
    return fail(
      `"${name.value}" is already on this shift but disconnected. Reopen the original tab, or pick another name.`,
    );
  }

  if (room.players.length >= LIMITS.maxPlayers) {
    return fail('This factory is full.');
  }
  if (room.phase !== 'lobby' && room.phase !== 'checkin') {
    return fail('The shift already started. Ask the facilitator to reset or rejoin later.');
  }

  const player = createPlayer(name.value, room.players.length === 0);
  room.players.push(player);
  room.updatedAt = Date.now();
  return done({ room, player });
}

export function reconnect(
  store: RoomStore,
  payload: { roomCode?: unknown; reconnectToken?: unknown },
): Outcome<{ room: Room; player: InternalPlayer }> {
  const code = sanitizeLine(payload.roomCode, 8).toUpperCase();
  const token = sanitizeLine(payload.reconnectToken, 64);
  if (!code || !token) return fail('Missing reconnection details.');

  const room = store.get(code);
  if (!room) return fail('That factory has closed for the day.');

  const player = room.players.find((candidate) => candidate.reconnectToken === token);
  if (!player) return fail('Your seat was given away. Join again with your name.');

  return done({ room, player });
}

export function attachSocket(room: Room, player: InternalPlayer, socketId: string): void {
  player.socketId = socketId;
  player.connected = true;
  player.disconnectedAt = null;
  player.lastSeen = Date.now();
  room.updatedAt = Date.now();
}

export function detachSocket(room: Room, player: InternalPlayer): void {
  player.socketId = null;
  player.connected = false;
  player.disconnectedAt = Date.now();
  player.lastSeen = Date.now();
  room.updatedAt = Date.now();
}

export function removePlayer(room: Room, player: InternalPlayer): void {
  room.players = room.players.filter((candidate) => candidate.id !== player.id);
  room.checkIns.delete(player.id);
  room.submissions = room.submissions.filter((item) => item.authorId !== player.id);
  room.readyBuild.delete(player.id);
  room.readyInspect.delete(player.id);
  room.readyShop.delete(player.id);
  room.allocations.delete(player.id);
  room.baskets.delete(player.id);
  if (player.isFacilitator) {
    const heir = room.players.find((candidate) => candidate.connected) ?? room.players[0];
    if (heir) heir.isFacilitator = true;
  }
  room.updatedAt = Date.now();
}

function requireFacilitator(room: Room, player: InternalPlayer): ActionResult | null {
  if (!player.isFacilitator) return err('Only the facilitator can do that.');
  if (!room.players.some((candidate) => candidate.id === player.id)) {
    return err('You are not part of this factory.');
  }
  return null;
}

function requirePhase(room: Room, ...phases: Phase[]): ActionResult | null {
  if (!phases.includes(room.phase)) {
    return err('That action does not belong to the current phase.');
  }
  return null;
}

function touch(room: Room): ActionResult {
  room.updatedAt = Date.now();
  return ok();
}

/* ----------------------------------------------------------------- phase 1 */

export function submitCheckIn(
  room: Room,
  player: InternalPlayer,
  payload: unknown,
): ActionResult {
  const guard = requirePhase(room, 'checkin');
  if (guard) return guard;
  if (!isPlainObject(payload)) return err('Invalid check-in.');

  const avatar = typeof payload.avatar === 'string' && AVATARS.includes(payload.avatar)
    ? payload.avatar
    : AVATARS[0]!;
  const energy = clampInt(payload.energy, 1, 5, 3) as 1 | 2 | 3 | 4 | 5;
  const condition = CONDITIONS.includes(payload.condition as Condition)
    ? (payload.condition as Condition)
    : 'Busy';

  player.avatar = avatar;
  room.checkIns.set(player.id, { avatar, energy, condition });
  return touch(room);
}

/* ----------------------------------------------------------------- phase 2 */

function validStation(room: Room, value: unknown): string {
  const id = sanitizeLine(value, 40);
  if (id === ACROSS_FACTORY) return ACROSS_FACTORY;
  return room.stations.some((station) => station.id === id) ? id : ACROSS_FACTORY;
}

const KIND_LIMITS: Record<SubmissionKind, number> = {
  booster: MAX_BOOSTERS,
  bottleneck: MAX_BOTTLENECKS,
  wildcard: MAX_WILDCARDS,
};

export function saveSubmissions(
  room: Room,
  player: InternalPlayer,
  payload: unknown,
): ActionResult {
  const guard = requirePhase(room, 'build');
  if (guard) return guard;
  if (room.readyBuild.has(player.id)) {
    return err('You are marked ready. Unlock your entries to edit them.');
  }

  const rawItems = asArray(
    isPlainObject(payload) ? payload.items : payload,
    MAX_BOOSTERS + MAX_BOTTLENECKS + MAX_WILDCARDS,
  );
  const counts: Record<SubmissionKind, number> = { booster: 0, bottleneck: 0, wildcard: 0 };
  const accepted: InternalSubmission[] = [];

  for (const raw of rawItems) {
    if (!isPlainObject(raw)) continue;
    const kind = raw.kind as SubmissionKind;
    if (kind !== 'booster' && kind !== 'bottleneck' && kind !== 'wildcard') continue;
    const title = sanitizeLine(raw.title, LIMITS.title);
    if (!title) continue;
    if (counts[kind] >= KIND_LIMITS[kind]) {
      return err(
        `You can submit at most ${KIND_LIMITS[kind]} ${kind}${KIND_LIMITS[kind] > 1 ? 's' : ''}.`,
      );
    }
    counts[kind] += 1;

    const existingId = sanitizeLine(raw.id, 64);
    const previous = room.submissions.find(
      (item) => item.id === existingId && item.authorId === player.id,
    );

    accepted.push({
      id: previous?.id ?? newId(),
      authorId: player.id,
      kind,
      title,
      description: sanitizeText(raw.description, LIMITS.description),
      station: validStation(room, raw.station),
      impact: clampInt(raw.impact, 1, 3, 2) as 1 | 2 | 3,
      mergedFrom: previous?.mergedFrom ?? [],
      createdAt: previous?.createdAt ?? Date.now(),
    });
  }

  room.submissions = room.submissions.filter((item) => item.authorId !== player.id);
  room.submissions.push(...accepted);
  return touch(room);
}

export function setBuildReady(room: Room, player: InternalPlayer, ready: boolean): ActionResult {
  const guard = requirePhase(room, 'build');
  if (guard) return guard;
  if (ready) room.readyBuild.add(player.id);
  else room.readyBuild.delete(player.id);
  return touch(room);
}

export function renameStation(
  room: Room,
  player: InternalPlayer,
  payload: unknown,
): ActionResult {
  const guard = requireFacilitator(room, player);
  if (guard) return guard;
  const phaseGuard = requirePhase(room, 'lobby', 'checkin', 'build');
  if (phaseGuard) return phaseGuard;
  if (!isPlainObject(payload)) return err('Invalid station update.');

  const station = room.stations.find((candidate) => candidate.id === sanitizeLine(payload.id, 40));
  if (!station) return err('Unknown station.');
  const name = sanitizeLine(payload.name, LIMITS.stationName);
  if (!name) return err('Station names cannot be empty.');
  station.name = name;
  return touch(room);
}

/* ----------------------------------------------------------------- phase 4 */

export function allocateTokens(
  room: Room,
  player: InternalPlayer,
  payload: unknown,
): ActionResult {
  const guard = requirePhase(room, 'inspect');
  if (guard) return guard;
  if (room.votingClosed) return err('Voting is closed.');
  if (!isPlainObject(payload)) return err('Invalid allocation.');

  const source = isPlainObject(payload.allocations) ? payload.allocations : {};
  const cleaned: Record<string, number> = {};
  let total = 0;

  for (const [itemId, rawValue] of Object.entries(source)) {
    const item = room.submissions.find((candidate) => candidate.id === itemId);
    if (!item || item.kind === 'wildcard') continue;
    const value = clampInt(rawValue, 0, INSPECTION_TOKENS, 0);
    if (value <= 0) continue;
    cleaned[itemId] = value;
    total += value;
  }

  if (total > INSPECTION_TOKENS) {
    return err(`You only have ${INSPECTION_TOKENS} inspection tokens.`);
  }

  room.allocations.set(player.id, cleaned);
  return touch(room);
}

export function setInspectReady(room: Room, player: InternalPlayer, ready: boolean): ActionResult {
  const guard = requirePhase(room, 'inspect');
  if (guard) return guard;
  if (ready) room.readyInspect.add(player.id);
  else room.readyInspect.delete(player.id);

  const connected = room.players.filter((candidate) => candidate.connected);
  const allReady =
    connected.length > 0 && connected.every((candidate) => room.readyInspect.has(candidate.id));
  if (allReady) room.votingClosed = true;
  return touch(room);
}

export function closeVoting(room: Room, player: InternalPlayer): ActionResult {
  const guard = requireFacilitator(room, player);
  if (guard) return guard;
  const phaseGuard = requirePhase(room, 'inspect');
  if (phaseGuard) return phaseGuard;
  room.votingClosed = true;
  return touch(room);
}

export function focusItem(room: Room, player: InternalPlayer, payload: unknown): ActionResult {
  const guard = requireFacilitator(room, player);
  if (guard) return guard;
  const phaseGuard = requirePhase(room, 'inspect');
  if (phaseGuard) return phaseGuard;
  if (!isPlainObject(payload)) return err('Invalid item.');

  const itemId = sanitizeLine(payload.itemId, 64);
  if (itemId && !room.submissions.some((item) => item.id === itemId)) {
    return err('Unknown item.');
  }
  room.focusItemId = itemId || null;
  room.timer = freshTimer();
  room.timer.durationSeconds = clampInt(
    payload.durationSeconds,
    30,
    1800,
    DEFAULT_DISCUSSION_SECONDS,
  );
  room.timer.remainingSeconds = room.timer.durationSeconds;
  return touch(room);
}

export function addNote(room: Room, player: InternalPlayer, payload: unknown): ActionResult {
  const guard = requirePhase(room, 'inspect', 'shop', 'run2', 'report');
  if (guard) return guard;
  if (!isPlainObject(payload)) return err('Invalid note.');
  if (!room.players.some((candidate) => candidate.id === player.id)) {
    return err('You are not part of this factory.');
  }

  const itemId = sanitizeLine(payload.itemId, 64) || room.focusItemId || '';
  if (!room.submissions.some((item) => item.id === itemId)) return err('Unknown item.');
  const text = sanitizeText(payload.text, LIMITS.note);
  if (!text) return err('Write something before adding a note.');

  const existing = room.notes.filter((note) => note.itemId === itemId);
  if (existing.length >= LIMITS.maxNotesPerItem) {
    return err('This item already has plenty of notes.');
  }

  room.notes.push({ id: newId(), itemId, text, createdAt: Date.now() });
  return touch(room);
}

export function timerControl(room: Room, player: InternalPlayer, payload: unknown): ActionResult {
  const guard = requireFacilitator(room, player);
  if (guard) return guard;
  const phaseGuard = requirePhase(room, 'inspect');
  if (phaseGuard) return phaseGuard;
  if (!isPlainObject(payload)) return err('Invalid timer command.');

  const action = sanitizeLine(payload.action, 16);
  const now = Date.now();

  switch (action) {
    case 'start': {
      const duration = clampInt(payload.durationSeconds, 30, 1800, room.timer.durationSeconds);
      room.timer.durationSeconds = duration;
      room.timer.remainingSeconds = duration;
      room.timer.running = true;
      room.timer.endsAt = now + duration * 1000;
      break;
    }
    case 'pause': {
      if (room.timer.running && room.timer.endsAt) {
        room.timer.remainingSeconds = Math.max(0, Math.round((room.timer.endsAt - now) / 1000));
      }
      room.timer.running = false;
      room.timer.endsAt = null;
      break;
    }
    case 'resume': {
      if (room.timer.remainingSeconds <= 0) return err('Add time before resuming.');
      room.timer.running = true;
      room.timer.endsAt = now + room.timer.remainingSeconds * 1000;
      break;
    }
    case 'extend': {
      const extra = clampInt(payload.seconds, 15, 600, TIMER_EXTENSION_SECONDS);
      if (room.timer.running && room.timer.endsAt) {
        room.timer.endsAt += extra * 1000;
        room.timer.remainingSeconds = Math.max(0, Math.round((room.timer.endsAt - now) / 1000));
      } else {
        room.timer.remainingSeconds += extra;
      }
      break;
    }
    case 'reset': {
      room.timer = freshTimer();
      break;
    }
    default:
      return err('Unknown timer command.');
  }

  return touch(room);
}

export function mergeItems(room: Room, player: InternalPlayer, payload: unknown): ActionResult {
  const guard = requireFacilitator(room, player);
  if (guard) return guard;
  const phaseGuard = requirePhase(room, 'inspect');
  if (phaseGuard) return phaseGuard;
  if (!isPlainObject(payload)) return err('Invalid merge.');

  const targetId = sanitizeLine(payload.targetId, 64);
  const target = room.submissions.find((item) => item.id === targetId);
  if (!target) return err('Unknown merge target.');

  const sourceIds = asArray(payload.sourceIds, 10)
    .map((value) => sanitizeLine(value, 64))
    .filter((id) => id && id !== targetId);
  if (sourceIds.length === 0) return err('Select at least one duplicate to merge.');

  const sources = room.submissions.filter((item) => sourceIds.includes(item.id));
  if (sources.length !== sourceIds.length) return err('One of the duplicates no longer exists.');
  if (sources.some((item) => item.kind !== target.kind)) {
    return err('Only items of the same type can be merged.');
  }

  for (const source of sources) {
    target.mergedFrom.push({ title: source.title, description: source.description });
    target.mergedFrom.push(...source.mergedFrom);
    if (source.impact > target.impact) target.impact = source.impact;

    for (const [playerId, allocation] of room.allocations) {
      const moved = allocation[source.id];
      if (!moved) continue;
      delete allocation[source.id];
      allocation[target.id] = (allocation[target.id] ?? 0) + moved;
      room.allocations.set(playerId, allocation);
    }
    for (const note of room.notes) {
      if (note.itemId === source.id) note.itemId = target.id;
    }
  }

  const removed = new Set(sources.map((item) => item.id));
  room.submissions = room.submissions.filter((item) => !removed.has(item.id));
  if (room.focusItemId && removed.has(room.focusItemId)) room.focusItemId = target.id;
  return touch(room);
}

/* ----------------------------------------------------------------- phase 5 */

function readUpgrade(room: Room, payload: Record<string, unknown>): Outcome<Omit<Upgrade, 'id'>> {
  const name = sanitizeLine(payload.name, LIMITS.upgradeName);
  if (!name) return fail('Give the upgrade a short name.');
  const problem = sanitizeText(payload.problem, LIMITS.upgradeText);
  if (!problem) return fail('Describe the problem this upgrade addresses.');
  const experiment = sanitizeText(payload.experiment, LIMITS.upgradeText);
  if (!experiment) return fail('Describe the experiment the team will try.');
  const signal = sanitizeText(payload.signal, LIMITS.upgradeText);
  if (signal.length < LIMITS.minSignalLength) {
    return fail(
      'Name an observable sign of improvement - something the team could actually notice next sprint.',
    );
  }

  return done({
    name,
    problem,
    experiment,
    signal,
    cost: clampInt(payload.cost, MIN_UPGRADE_COST, MAX_UPGRADE_COST, 2),
    owner: sanitizeLine(payload.owner, LIMITS.owner),
    reviewDate: sanitizeLine(payload.reviewDate, LIMITS.reviewDate),
    station: validStation(room, payload.station),
  });
}

export function proposeUpgrade(
  room: Room,
  player: InternalPlayer,
  payload: unknown,
): ActionResult {
  const guard = requirePhase(room, 'shop');
  if (guard) return guard;
  if (!isPlainObject(payload)) return err('Invalid upgrade.');
  if (room.upgrades.length >= LIMITS.maxUpgrades) {
    return err('The shop shelf is full. Remove an upgrade before adding another.');
  }
  if (room.basketsRevealed) return err('Baskets are revealed - the shelf is locked.');

  const parsed = readUpgrade(room, payload);
  if (!parsed.ok) return err(parsed.error);

  room.upgrades.push({ id: newId(), ...parsed.value });
  return touch(room);
}

export function editUpgrade(room: Room, player: InternalPlayer, payload: unknown): ActionResult {
  const guard = requireFacilitator(room, player);
  if (guard) return guard;
  const phaseGuard = requirePhase(room, 'shop', 'run2', 'report');
  if (phaseGuard) return phaseGuard;
  if (!isPlainObject(payload)) return err('Invalid upgrade.');

  const upgrade = room.upgrades.find((item) => item.id === sanitizeLine(payload.id, 64));
  if (!upgrade) return err('Unknown upgrade.');

  const parsed = readUpgrade(room, { ...upgrade, ...payload });
  if (!parsed.ok) return err(parsed.error);

  Object.assign(upgrade, parsed.value);
  return touch(room);
}

export function removeUpgrade(room: Room, player: InternalPlayer, payload: unknown): ActionResult {
  const guard = requireFacilitator(room, player);
  if (guard) return guard;
  const phaseGuard = requirePhase(room, 'shop');
  if (phaseGuard) return phaseGuard;
  if (!isPlainObject(payload)) return err('Invalid upgrade.');

  const id = sanitizeLine(payload.id, 64);
  if (!room.upgrades.some((item) => item.id === id)) return err('Unknown upgrade.');
  room.upgrades = room.upgrades.filter((item) => item.id !== id);
  room.purchased = room.purchased.filter((purchasedId) => purchasedId !== id);
  for (const [playerId, basket] of room.baskets) {
    room.baskets.set(playerId, basket.filter((basketId) => basketId !== id));
  }
  return touch(room);
}

export function setBasket(room: Room, player: InternalPlayer, payload: unknown): ActionResult {
  const guard = requirePhase(room, 'shop');
  if (guard) return guard;
  if (room.basketsRevealed) return err('Baskets are already revealed.');
  if (!isPlainObject(payload)) return err('Invalid basket.');

  const ids = [
    ...new Set(
      asArray(payload.upgradeIds, LIMITS.maxUpgrades).map((value) => sanitizeLine(value, 64)),
    ),
  ].filter(Boolean);

  let total = 0;
  for (const id of ids) {
    const upgrade = room.upgrades.find((item) => item.id === id);
    if (!upgrade) return err('That upgrade is no longer on the shelf.');
    total += upgrade.cost;
  }
  if (total > GEAR_COINS) {
    return err(`A basket cannot exceed ${GEAR_COINS} Gear Coins (yours costs ${total}).`);
  }

  room.baskets.set(player.id, ids);
  return touch(room);
}

export function setShopReady(room: Room, player: InternalPlayer, ready: boolean): ActionResult {
  const guard = requirePhase(room, 'shop');
  if (guard) return guard;
  if (ready) {
    if (!room.baskets.has(player.id)) room.baskets.set(player.id, []);
    room.readyShop.add(player.id);
  } else {
    room.readyShop.delete(player.id);
  }
  return touch(room);
}

export function revealBaskets(room: Room, player: InternalPlayer): ActionResult {
  const guard = requireFacilitator(room, player);
  if (guard) return guard;
  const phaseGuard = requirePhase(room, 'shop');
  if (phaseGuard) return phaseGuard;
  if (room.upgrades.length === 0) return err('Propose at least one upgrade first.');
  room.basketsRevealed = true;
  return touch(room);
}

export function purchase(room: Room, player: InternalPlayer, payload: unknown): ActionResult {
  const guard = requireFacilitator(room, player);
  if (guard) return guard;
  const phaseGuard = requirePhase(room, 'shop');
  if (phaseGuard) return phaseGuard;
  if (!isPlainObject(payload)) return err('Invalid purchase.');

  const ids = [
    ...new Set(asArray(payload.upgradeIds, MAX_PURCHASES + 1).map((value) => sanitizeLine(value, 64))),
  ].filter(Boolean);

  if (ids.length === 0) return err('Select one or two upgrades to buy.');
  if (ids.length > MAX_PURCHASES) return err(`Buy at most ${MAX_PURCHASES} upgrades this shift.`);

  let total = 0;
  for (const id of ids) {
    const upgrade = room.upgrades.find((item) => item.id === id);
    if (!upgrade) return err('That upgrade is no longer on the shelf.');
    total += upgrade.cost;
  }
  if (total > GEAR_COINS) {
    return err(`That basket costs ${total} Gear Coins - the budget is ${GEAR_COINS}.`);
  }

  room.purchased = ids;
  return touch(room);
}

/* ------------------------------------------------------------ phase engine */

export function phaseIndex(phase: Phase): number {
  return PHASES.indexOf(phase);
}

function enterPhase(room: Room, phase: Phase): ActionResult {
  switch (phase) {
    case 'run1': {
      if (room.submissions.length === 0) {
        return err('The factory needs at least one Booster, Bottleneck or Wildcard first.');
      }
      room.runs.first = runSimulation(
        { stations: room.stations, submissions: toPublic(room.submissions), upgrades: [] },
        'first',
      );
      room.playback = { run: 'first', tick: 0, playing: true, finished: false };
      break;
    }
    case 'run2': {
      if (!room.runs.first) {
        return err('Run the first factory before the improved run.');
      }
      const purchasedUpgrades = room.upgrades.filter((upgrade) =>
        room.purchased.includes(upgrade.id),
      );
      room.runs.second = runSimulation(
        {
          stations: room.stations,
          submissions: toPublic(room.submissions),
          upgrades: purchasedUpgrades,
        },
        'second',
      );
      room.playback = { run: 'second', tick: 0, playing: true, finished: false };
      break;
    }
    case 'inspect': {
      room.playback = { run: 'first', tick: room.runs.first ? room.runs.first.frames.length : 0, playing: false, finished: true };
      break;
    }
    case 'report': {
      room.playback = { ...room.playback, playing: false, finished: true };
      break;
    }
    default: {
      room.playback = { run: null, tick: 0, playing: false, finished: false };
      break;
    }
  }

  room.phase = phase;
  return touch(room);
}

export function advancePhase(room: Room, player: InternalPlayer): ActionResult {
  const guard = requireFacilitator(room, player);
  if (guard) return guard;

  const next = PHASES[phaseIndex(room.phase) + 1];
  if (!next) return err('The shift is already finished.');
  if (room.phase === 'lobby' && room.players.length === 0) {
    return err('Nobody is in the factory yet.');
  }
  return enterPhase(room, next);
}

export function regressPhase(room: Room, player: InternalPlayer): ActionResult {
  const guard = requireFacilitator(room, player);
  if (guard) return guard;

  const previous = PHASES[phaseIndex(room.phase) - 1];
  if (!previous) return err('You are already at the factory gate.');
  return enterPhase(room, previous);
}

export function resetRoom(room: Room, player: InternalPlayer): ActionResult {
  const guard = requireFacilitator(room, player);
  if (guard) return guard;
  resetRoomState(room);
  return ok();
}

/* --------------------------------------------------------------- playback */

export function playbackControl(room: Room, player: InternalPlayer, payload: unknown): ActionResult {
  const guard = requireFacilitator(room, player);
  if (guard) return guard;
  const phaseGuard = requirePhase(room, 'run1', 'run2');
  if (phaseGuard) return phaseGuard;
  if (!isPlainObject(payload)) return err('Invalid playback command.');

  const run = room.phase === 'run1' ? room.runs.first : room.runs.second;
  if (!run) return err('No simulation to control.');

  const action = sanitizeLine(payload.action, 16);
  switch (action) {
    case 'play':
      if (room.playback.finished) {
        room.playback = { run: run.id, tick: 0, playing: true, finished: false };
      } else {
        room.playback = { ...room.playback, run: run.id, playing: true };
      }
      break;
    case 'pause':
      room.playback = { ...room.playback, playing: false };
      break;
    case 'skip':
      room.playback = { run: run.id, tick: run.frames.length, playing: false, finished: true };
      break;
    case 'restart':
      room.playback = { run: run.id, tick: 0, playing: true, finished: false };
      break;
    default:
      return err('Unknown playback command.');
  }

  return touch(room);
}

/** Advances the playhead one frame. Returns true when the run just finished. */
export function stepPlayback(room: Room): boolean {
  const run = room.playback.run === 'second' ? room.runs.second : room.runs.first;
  if (!run || !room.playback.playing) return false;

  const nextTick = room.playback.tick + 1;
  if (nextTick >= run.frames.length) {
    room.playback = { run: run.id, tick: run.frames.length, playing: false, finished: true };
    room.updatedAt = Date.now();
    return true;
  }
  room.playback = { ...room.playback, tick: nextTick };
  return false;
}

/* ---------------------------------------------------------------- helpers */

export function toPublic(submissions: InternalSubmission[]): PublicSubmission[] {
  return submissions.map((item) => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    description: item.description,
    station: item.station,
    impact: item.impact,
    mergedFrom: item.mergedFrom.map((source) => ({ ...source })),
  }));
}

export function tokenTotals(room: Room): Map<string, number> {
  const totals = new Map<string, number>();
  for (const allocation of room.allocations.values()) {
    for (const [itemId, value] of Object.entries(allocation)) {
      totals.set(itemId, (totals.get(itemId) ?? 0) + value);
    }
  }
  return totals;
}

export function basketSupport(room: Room): Array<{ upgradeId: string; supporters: number; coinsCommitted: number }> {
  const supporters = new Map<string, number>();
  const coins = new Map<string, number>();
  for (const basket of room.baskets.values()) {
    for (const upgradeId of basket) {
      const upgrade = room.upgrades.find((item) => item.id === upgradeId);
      if (!upgrade) continue;
      supporters.set(upgradeId, (supporters.get(upgradeId) ?? 0) + 1);
      coins.set(upgradeId, (coins.get(upgradeId) ?? 0) + upgrade.cost);
    }
  }
  return room.upgrades
    .map((upgrade) => ({
      upgradeId: upgrade.id,
      supporters: supporters.get(upgrade.id) ?? 0,
      coinsCommitted: coins.get(upgrade.id) ?? 0,
    }))
    .sort((a, b) => b.supporters - a.supporters);
}

export function isSavePlayer(player: InternalPlayer, exactName: string): boolean {
  return player.name === exactName;
}

export function playerInRoom(room: Room, playerId: string): boolean {
  return room.players.some((player) => player.id === playerId);
}

/**
 * Server-side authority for the GitHub save button. The socket must currently
 * own the player's seat, the player must still be in the room, and the name
 * must match exactly (case-sensitive).
 */
export function canSaveSnapshot(
  room: Room,
  player: InternalPlayer,
  socketId: string,
  exactName: string,
): boolean {
  return (
    playerInRoom(room, player.id) &&
    player.connected &&
    player.socketId === socketId &&
    isSavePlayer(player, exactName)
  );
}

export { normalizeName };
