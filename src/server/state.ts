import {
  DEFAULT_DISCUSSION_SECONDS,
  DEFAULT_STATIONS,
  LIMITS,
  ROOM_LIFETIME,
} from '../shared/constants.js';
import type { Phase } from '../shared/constants.js';
import type {
  CheckIn,
  DiscussionNote,
  PublicSubmission,
  SaveState,
  SimulationResult,
  Station,
  TimerState,
  Upgrade,
} from '../shared/types.js';
import { generateRoomCode, newId, newToken } from './ids.js';
import { normalizeName } from './sanitize.js';

export interface InternalPlayer {
  id: string;
  name: string;
  normalizedName: string;
  avatar: string;
  reconnectToken: string;
  socketId: string | null;
  connected: boolean;
  isFacilitator: boolean;
  joinedAt: number;
  lastSeen: number;
  disconnectedAt: number | null;
}

/** Stored submission. `authorId` never leaves the server. */
export interface InternalSubmission extends PublicSubmission {
  authorId: string;
  createdAt: number;
}

export interface Room {
  code: string;
  factoryName: string;
  createdAt: number;
  updatedAt: number;
  phase: Phase;
  players: InternalPlayer[];
  stations: Station[];
  checkIns: Map<string, CheckIn>;
  submissions: InternalSubmission[];
  readyBuild: Set<string>;
  readyInspect: Set<string>;
  readyShop: Set<string>;
  allocations: Map<string, Record<string, number>>;
  votingClosed: boolean;
  focusItemId: string | null;
  notes: DiscussionNote[];
  timer: TimerState;
  upgrades: Upgrade[];
  baskets: Map<string, string[]>;
  basketsRevealed: boolean;
  purchased: string[];
  runs: { first: SimulationResult | null; second: SimulationResult | null };
  playback: { run: 'first' | 'second' | null; tick: number; playing: boolean; finished: boolean };
  save: SaveState;
  saveInProgress: boolean;
  lastSaveAttempt: number;
}

export function freshStations(): Station[] {
  return DEFAULT_STATIONS.map((station) => ({ ...station }));
}

export function freshTimer(): TimerState {
  return {
    durationSeconds: DEFAULT_DISCUSSION_SECONDS,
    running: false,
    endsAt: null,
    remainingSeconds: DEFAULT_DISCUSSION_SECONDS,
  };
}

export function freshSaveState(): SaveState {
  return { status: 'idle', message: '', url: null, path: null, savedAt: null };
}

export function createPlayer(name: string, isFacilitator: boolean): InternalPlayer {
  const now = Date.now();
  return {
    id: newId(),
    name,
    normalizedName: normalizeName(name),
    avatar: '',
    reconnectToken: newToken(),
    socketId: null,
    connected: false,
    isFacilitator,
    joinedAt: now,
    lastSeen: now,
    disconnectedAt: null,
  };
}

/** Wipes every round-specific field but keeps the room, its players and name. */
export function resetRoomState(room: Room): void {
  room.phase = 'lobby';
  room.stations = freshStations();
  room.checkIns.clear();
  room.submissions = [];
  room.readyBuild.clear();
  room.readyInspect.clear();
  room.readyShop.clear();
  room.allocations.clear();
  room.votingClosed = false;
  room.focusItemId = null;
  room.notes = [];
  room.timer = freshTimer();
  room.upgrades = [];
  room.baskets.clear();
  room.basketsRevealed = false;
  room.purchased = [];
  room.runs = { first: null, second: null };
  room.playback = { run: null, tick: 0, playing: false, finished: false };
  room.save = freshSaveState();
  room.saveInProgress = false;
  room.updatedAt = Date.now();
}

export class RoomStore {
  private readonly rooms = new Map<string, Room>();

  get size(): number {
    return this.rooms.size;
  }

  list(): Room[] {
    return [...this.rooms.values()];
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  has(code: string): boolean {
    return this.rooms.has(code.toUpperCase());
  }

  delete(code: string): void {
    this.rooms.delete(code.toUpperCase());
  }

  create(factoryName: string): Room {
    let code = generateRoomCode(LIMITS.roomCode);
    let attempts = 0;
    while (this.rooms.has(code)) {
      code = generateRoomCode(attempts > 40 ? LIMITS.roomCode + 1 : LIMITS.roomCode);
      attempts += 1;
    }
    const now = Date.now();
    const room: Room = {
      code,
      factoryName,
      createdAt: now,
      updatedAt: now,
      phase: 'lobby',
      players: [],
      stations: freshStations(),
      checkIns: new Map(),
      submissions: [],
      readyBuild: new Set(),
      readyInspect: new Set(),
      readyShop: new Set(),
      allocations: new Map(),
      votingClosed: false,
      focusItemId: null,
      notes: [],
      timer: freshTimer(),
      upgrades: [],
      baskets: new Map(),
      basketsRevealed: false,
      purchased: [],
      runs: { first: null, second: null },
      playback: { run: null, tick: 0, playing: false, finished: false },
      save: freshSaveState(),
      saveInProgress: false,
      lastSaveAttempt: 0,
    };
    this.rooms.set(code, room);
    return room;
  }

  findPlayerByName(room: Room, name: string): InternalPlayer | undefined {
    const normalized = normalizeName(name);
    return room.players.find((player) => player.normalizedName === normalized);
  }

  findPlayerBySocket(socketId: string): { room: Room; player: InternalPlayer } | undefined {
    for (const room of this.rooms.values()) {
      const player = room.players.find((candidate) => candidate.socketId === socketId);
      if (player) return { room, player };
    }
    return undefined;
  }

  /**
   * Removes rooms nobody is coming back to and transfers the facilitator role
   * when the current facilitator has been gone for longer than the grace period.
   * Returns the codes of rooms whose state changed so callers can broadcast.
   */
  janitor(now = Date.now()): { removed: string[]; changed: string[] } {
    const removed: string[] = [];
    const changed: string[] = [];

    for (const room of [...this.rooms.values()]) {
      const connected = room.players.filter((player) => player.connected);

      if (connected.length === 0) {
        const lastActivity = Math.max(
          room.updatedAt,
          ...room.players.map((player) => player.lastSeen),
        );
        if (now - lastActivity > ROOM_LIFETIME.emptyRoomMs) {
          this.rooms.delete(room.code);
          removed.push(room.code);
          continue;
        }
      }

      if (now - room.updatedAt > ROOM_LIFETIME.maxIdleMs) {
        this.rooms.delete(room.code);
        removed.push(room.code);
        continue;
      }

      const facilitator = room.players.find((player) => player.isFacilitator);
      const facilitatorGone =
        !facilitator ||
        (!facilitator.connected &&
          facilitator.disconnectedAt !== null &&
          now - facilitator.disconnectedAt > ROOM_LIFETIME.facilitatorGraceMs);

      if (facilitatorGone && connected.length > 0) {
        if (facilitator) facilitator.isFacilitator = false;
        const heir = [...connected].sort((a, b) => a.joinedAt - b.joinedAt)[0]!;
        heir.isFacilitator = true;
        room.updatedAt = now;
        changed.push(room.code);
      }
    }

    return { removed, changed };
  }
}
