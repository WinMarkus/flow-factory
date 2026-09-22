import type { Server, Socket } from 'socket.io';
import { RATE_LIMIT, ROOM_LIFETIME, SAVE_PLAYER_NAME, SIM } from '../shared/constants.js';
import { C2S, S2C } from '../shared/events.js';
import type { ActionResult } from '../shared/types.js';
import * as game from './game.js';
import {
  GitHubConfigError,
  commitFile,
  describeGitHubError,
  isGitHubConfigured,
  missingGitHubSettings,
  readGitHubConfig,
  type FetchLike,
} from './github.js';
import { RateLimiter } from './rateLimit.js';
import { buildCommitMessage, buildSavePath, buildSnapshot, snapshotToJson } from './snapshot.js';
import type { InternalPlayer, Room, RoomStore } from './state.js';
import { buildStateView } from './view.js';

export interface SocketDeps {
  store: RoomStore;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
}

interface Session {
  roomCode: string;
  playerId: string;
}

export function registerSocketHandlers(io: Server, deps: SocketDeps): () => void {
  const { store } = deps;
  const env = deps.env ?? process.env;
  const sessions = new Map<string, Session>();
  const limiter = new RateLimiter(RATE_LIMIT.windowMs, RATE_LIMIT.maxActions);
  const playbackTimers = new Map<string, NodeJS.Timeout>();

  function githubConfigured(): boolean {
    return isGitHubConfigured(env);
  }

  function broadcast(room: Room): void {
    for (const player of room.players) {
      if (!player.socketId) continue;
      const socket = io.sockets.sockets.get(player.socketId);
      if (!socket) continue;
      socket.emit(S2C.state, buildStateView(room, player, { githubConfigured: githubConfigured() }));
    }
    syncPlayback(room);
  }

  function emitError(socket: Socket, message: string, code?: string): void {
    socket.emit(S2C.errorMessage, code ? { message, code } : { message });
  }

  function notice(room: Room, message: string, tone: 'info' | 'success' | 'warning' = 'info'): void {
    io.to(room.code).emit(S2C.notice, { message, tone });
  }

  function stopPlayback(roomCode: string): void {
    const timer = playbackTimers.get(roomCode);
    if (timer) {
      clearInterval(timer);
      playbackTimers.delete(roomCode);
    }
  }

  /** Keeps the per-room playback interval in step with the authoritative state. */
  function syncPlayback(room: Room): void {
    const shouldRun =
      room.playback.playing && (room.phase === 'run1' || room.phase === 'run2');

    if (!shouldRun) {
      stopPlayback(room.code);
      return;
    }
    if (playbackTimers.has(room.code)) return;

    const timer = setInterval(() => {
      const live = store.get(room.code);
      if (!live) {
        stopPlayback(room.code);
        return;
      }
      const finished = game.stepPlayback(live);
      io.to(live.code).emit(S2C.playbackTick, {
        run: live.playback.run ?? 'first',
        tick: live.playback.tick,
        playing: live.playback.playing,
        finished: live.playback.finished,
      });
      if (finished || !live.playback.playing) {
        stopPlayback(live.code);
        broadcast(live);
      }
    }, SIM.TICK_MS);

    playbackTimers.set(room.code, timer);
  }

  function resolve(socket: Socket): { room: Room; player: InternalPlayer } | null {
    const session = sessions.get(socket.id);
    if (!session) {
      emitError(socket, 'You are not in a factory yet.');
      return null;
    }
    const room = store.get(session.roomCode);
    if (!room) {
      emitError(socket, 'That factory has closed.');
      sessions.delete(socket.id);
      return null;
    }
    const player = room.players.find((candidate) => candidate.id === session.playerId);
    if (!player || player.socketId !== socket.id) {
      emitError(socket, 'Your seat is no longer active. Refresh to rejoin.');
      return null;
    }
    player.lastSeen = Date.now();
    return { room, player };
  }

  /** Wraps an action so every handler gets the same guards and broadcast. */
  function action(
    socket: Socket,
    handler: (room: Room, player: InternalPlayer) => ActionResult,
  ): void {
    if (!limiter.take(socket.id)) {
      emitError(socket, 'Slow down a moment - too many actions at once.');
      return;
    }
    const context = resolve(socket);
    if (!context) return;
    const result = handler(context.room, context.player);
    if (!result.ok) {
      emitError(socket, result.error ?? 'That action was rejected.');
      return;
    }
    broadcast(context.room);
  }

  function enterRoom(
    socket: Socket,
    room: Room,
    player: InternalPlayer,
    rejoining: boolean,
  ): void {
    const previous = player.socketId;
    if (previous && previous !== socket.id) {
      const stale = io.sockets.sockets.get(previous);
      sessions.delete(previous);
      if (stale) stale.disconnect(true);
    }

    game.attachSocket(room, player, socket.id);
    sessions.set(socket.id, { roomCode: room.code, playerId: player.id });
    void socket.join(room.code);

    socket.emit(S2C.joined, {
      roomCode: room.code,
      playerId: player.id,
      reconnectToken: player.reconnectToken,
      playerName: player.name,
    });
    broadcast(room);
    notice(
      room,
      rejoining ? `${player.name} reconnected.` : `${player.name} clocked in.`,
      rejoining ? 'info' : 'success',
    );
  }

  io.on('connection', (socket: Socket) => {
    socket.on(C2S.createRoom, (payload: unknown) => {
      if (!limiter.take(socket.id)) return emitError(socket, 'Too many attempts. Wait a moment.');
      const result = game.createRoom(store, (payload ?? {}) as Record<string, unknown>);
      if (!result.ok) return emitError(socket, result.error);
      enterRoom(socket, result.value.room, result.value.player, false);
    });

    socket.on(C2S.joinRoom, (payload: unknown) => {
      if (!limiter.take(socket.id)) return emitError(socket, 'Too many attempts. Wait a moment.');
      const result = game.joinRoom(store, (payload ?? {}) as Record<string, unknown>);
      if (!result.ok) return emitError(socket, result.error);
      enterRoom(socket, result.value.room, result.value.player, false);
    });

    socket.on(C2S.reconnect, (payload: unknown) => {
      if (!limiter.take(socket.id)) return emitError(socket, 'Too many attempts. Wait a moment.');
      const result = game.reconnect(store, (payload ?? {}) as Record<string, unknown>);
      if (!result.ok) return emitError(socket, result.error, 'session-expired');
      enterRoom(socket, result.value.room, result.value.player, true);
    });

    socket.on(C2S.leaveRoom, () => {
      const context = resolve(socket);
      if (!context) return;
      const { room, player } = context;
      sessions.delete(socket.id);
      void socket.leave(room.code);
      game.removePlayer(room, player);
      notice(room, `${player.name} clocked out.`, 'warning');
      broadcast(room);
    });

    socket.on(C2S.submitCheckIn, (payload: unknown) =>
      action(socket, (room, player) => game.submitCheckIn(room, player, payload)),
    );

    socket.on(C2S.saveSubmissions, (payload: unknown) =>
      action(socket, (room, player) => game.saveSubmissions(room, player, payload)),
    );

    socket.on(C2S.readyBuild, () =>
      action(socket, (room, player) => game.setBuildReady(room, player, true)),
    );

    socket.on(C2S.unreadyBuild, () =>
      action(socket, (room, player) => game.setBuildReady(room, player, false)),
    );

    socket.on(C2S.renameStation, (payload: unknown) =>
      action(socket, (room, player) => game.renameStation(room, player, payload)),
    );

    socket.on(C2S.phaseNext, () =>
      action(socket, (room, player) => game.advancePhase(room, player)),
    );

    socket.on(C2S.phaseBack, () =>
      action(socket, (room, player) => game.regressPhase(room, player)),
    );

    socket.on(C2S.resetRoom, () =>
      action(socket, (room, player) => {
        const result = game.resetRoom(room, player);
        if (result.ok) notice(room, 'The facilitator reset the factory.', 'warning');
        return result;
      }),
    );

    socket.on(C2S.playback, (payload: unknown) =>
      action(socket, (room, player) => game.playbackControl(room, player, payload)),
    );

    socket.on(C2S.allocate, (payload: unknown) =>
      action(socket, (room, player) => game.allocateTokens(room, player, payload)),
    );

    socket.on(C2S.readyInspect, (payload: unknown) =>
      action(socket, (room, player) =>
        game.setInspectReady(room, player, (payload as { ready?: boolean })?.ready !== false),
      ),
    );

    socket.on(C2S.closeVoting, () =>
      action(socket, (room, player) => game.closeVoting(room, player)),
    );

    socket.on(C2S.focusItem, (payload: unknown) =>
      action(socket, (room, player) => game.focusItem(room, player, payload)),
    );

    socket.on(C2S.addNote, (payload: unknown) =>
      action(socket, (room, player) => game.addNote(room, player, payload)),
    );

    socket.on(C2S.timerControl, (payload: unknown) =>
      action(socket, (room, player) => game.timerControl(room, player, payload)),
    );

    socket.on(C2S.mergeItems, (payload: unknown) =>
      action(socket, (room, player) => game.mergeItems(room, player, payload)),
    );

    socket.on(C2S.proposeUpgrade, (payload: unknown) =>
      action(socket, (room, player) => game.proposeUpgrade(room, player, payload)),
    );

    socket.on(C2S.editUpgrade, (payload: unknown) =>
      action(socket, (room, player) => game.editUpgrade(room, player, payload)),
    );

    socket.on(C2S.removeUpgrade, (payload: unknown) =>
      action(socket, (room, player) => game.removeUpgrade(room, player, payload)),
    );

    socket.on(C2S.setBasket, (payload: unknown) =>
      action(socket, (room, player) => game.setBasket(room, player, payload)),
    );

    socket.on(C2S.readyShop, (payload: unknown) =>
      action(socket, (room, player) =>
        game.setShopReady(room, player, (payload as { ready?: boolean })?.ready !== false),
      ),
    );

    socket.on(C2S.revealBaskets, () =>
      action(socket, (room, player) => game.revealBaskets(room, player)),
    );

    socket.on(C2S.purchase, (payload: unknown) =>
      action(socket, (room, player) => {
        const result = game.purchase(room, player, payload);
        if (result.ok) notice(room, 'Upgrades purchased. Fit them to the factory!', 'success');
        return result;
      }),
    );

    socket.on(C2S.downloadSnapshot, () => {
      const context = resolve(socket);
      if (!context) return;
      const { room, player } = context;
      if (!canSave(room, player, socket.id)) {
        return emitError(socket, `Only a connected player named exactly "${SAVE_PLAYER_NAME}" can export this retro.`);
      }
      socket.emit(S2C.snapshotData, {
        filename: buildSavePath(room.code).split('/').pop(),
        json: snapshotToJson(buildSnapshot(room)),
      });
    });

    socket.on(C2S.saveToGitHub, () => {
      const context = resolve(socket);
      if (!context) return;
      void handleSave(socket, context.room, context.player);
    });

    socket.on('disconnect', () => {
      const session = sessions.get(socket.id);
      sessions.delete(socket.id);
      limiter.forget(socket.id);
      if (!session) return;
      const room = store.get(session.roomCode);
      if (!room) return;
      const player = room.players.find((candidate) => candidate.id === session.playerId);
      if (!player || player.socketId !== socket.id) return;

      game.detachSocket(room, player);
      if (room.phase === 'lobby') {
        game.removePlayer(room, player);
        notice(room, `${player.name} left the lobby.`, 'warning');
      } else {
        notice(room, `${player.name} lost connection.`, 'warning');
      }
      broadcast(room);
    });
  });

  /** Server-side permission check - the hidden button is only cosmetic. */
  function canSave(room: Room, player: InternalPlayer, socketId: string): boolean {
    return game.canSaveSnapshot(room, player, socketId, SAVE_PLAYER_NAME);
  }

  async function handleSave(socket: Socket, room: Room, player: InternalPlayer): Promise<void> {
    if (!canSave(room, player, socket.id)) {
      emitError(
        socket,
        `Only a connected player named exactly "${SAVE_PLAYER_NAME}" can save this retro to GitHub.`,
      );
      return;
    }

    if (room.saveInProgress) {
      emitError(socket, 'A save is already running.');
      return;
    }

    const now = Date.now();
    if (room.save.status === 'success' && now - (room.save.savedAt ?? 0) < RATE_LIMIT.saveCooldownMs) {
      emitError(socket, 'This retro was just saved. Wait a few seconds before saving again.');
      return;
    }

    const config = readGitHubConfig(env);
    if (!config) {
      const missing = missingGitHubSettings(env);
      room.save = {
        status: 'error',
        message: new GitHubConfigError(missing).message,
        url: null,
        path: null,
        savedAt: null,
      };
      broadcast(room);
      return;
    }

    room.saveInProgress = true;
    room.lastSaveAttempt = now;
    room.save = {
      status: 'working',
      message: 'Building the anonymous snapshot and committing it to GitHub...',
      url: null,
      path: null,
      savedAt: null,
    };
    broadcast(room);

    const when = new Date();
    const path = buildSavePath(room.code, when);

    try {
      const result = await commitFile({
        config,
        path,
        content: snapshotToJson(buildSnapshot(room, when)),
        message: buildCommitMessage(room, when),
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      });
      room.save = {
        status: 'success',
        message: 'Committed to GitHub.',
        url: result.htmlUrl,
        path: result.path,
        savedAt: Date.now(),
      };
      notice(room, 'Retro saved to GitHub.', 'success');
    } catch (error) {
      room.save = {
        status: 'error',
        message: describeGitHubError(error, config.token),
        url: null,
        path: null,
        savedAt: null,
      };
    } finally {
      room.saveInProgress = false;
      room.updatedAt = Date.now();
      broadcast(room);
    }
  }

  const janitor = setInterval(() => {
    const { removed, changed } = store.janitor();
    for (const code of removed) {
      stopPlayback(code);
      io.to(code).emit(S2C.kicked, { message: 'This factory was closed after a long idle period.' });
    }
    for (const code of changed) {
      const room = store.get(code);
      if (!room) continue;
      notice(room, 'The facilitator role moved to the longest-present player.', 'warning');
      broadcast(room);
    }
    limiter.sweep();
  }, ROOM_LIFETIME.janitorIntervalMs);

  return () => {
    clearInterval(janitor);
    for (const code of [...playbackTimers.keys()]) stopPlayback(code);
  };
}
