import { C2S, S2C } from '../shared/events.js';
import type { ErrorPayload, JoinedPayload, NoticePayload, PlaybackTickPayload } from '../shared/events.js';
import type { GameStateView } from '../shared/types.js';

export interface SocketLike {
  id?: string;
  connected: boolean;
  on(event: string, handler: (payload: never) => void): void;
  emit(event: string, payload?: unknown): void;
}

declare const io: (options?: Record<string, unknown>) => SocketLike;

const SESSION_KEY = 'flow-factory:session';

export interface StoredSession {
  roomCode: string;
  reconnectToken: string;
  playerName: string;
}

export function loadSession(): StoredSession | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (!parsed.roomCode || !parsed.reconnectToken) return null;
    return {
      roomCode: parsed.roomCode,
      reconnectToken: parsed.reconnectToken,
      playerName: parsed.playerName ?? '',
    };
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* private mode - reconnection simply will not survive a refresh */
  }
}

export function clearSession(): void {
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

type Listener<T> = (value: T) => void;

/** Small observable app store shared by every view. */
export class AppStore {
  readonly socket: SocketLike;
  state: GameStateView | null = null;
  connection: 'connecting' | 'online' | 'offline' = 'connecting';
  /** Local playhead so ticks do not require a full state broadcast. */
  playbackTick = 0;
  playbackPlaying = false;

  private readonly stateListeners: Array<Listener<GameStateView>> = [];
  private readonly tickListeners: Array<Listener<PlaybackTickPayload>> = [];
  private readonly noticeListeners: Array<Listener<NoticePayload>> = [];
  private readonly errorListeners: Array<Listener<ErrorPayload>> = [];
  private readonly connectionListeners: Array<Listener<AppStore['connection']>> = [];
  private readonly joinListeners: Array<Listener<JoinedPayload>> = [];
  private readonly snapshotListeners: Array<Listener<{ filename: string; json: string }>> = [];

  constructor() {
    this.socket = io({ transports: ['websocket', 'polling'] });

    this.socket.on('connect', () => {
      this.connection = 'online';
      this.connectionListeners.forEach((listener) => listener(this.connection));
      const session = loadSession();
      if (session) {
        this.emit(C2S.reconnect, {
          roomCode: session.roomCode,
          reconnectToken: session.reconnectToken,
        });
      }
    });

    this.socket.on('disconnect', () => {
      this.connection = 'offline';
      this.connectionListeners.forEach((listener) => listener(this.connection));
    });

    this.socket.on(S2C.joined, (payload: JoinedPayload) => {
      saveSession({
        roomCode: payload.roomCode,
        reconnectToken: payload.reconnectToken,
        playerName: payload.playerName,
      });
      this.joinListeners.forEach((listener) => listener(payload));
    });

    this.socket.on(S2C.state, (payload: GameStateView) => {
      this.state = payload;
      this.playbackTick = payload.playback.tick;
      this.playbackPlaying = payload.playback.playing;
      this.stateListeners.forEach((listener) => listener(payload));
    });

    this.socket.on(S2C.playbackTick, (payload: PlaybackTickPayload) => {
      this.playbackTick = payload.tick;
      this.playbackPlaying = payload.playing;
      if (this.state) {
        this.state.playback = {
          run: payload.run,
          tick: payload.tick,
          playing: payload.playing,
          finished: payload.finished,
        };
      }
      this.tickListeners.forEach((listener) => listener(payload));
    });

    this.socket.on(S2C.notice, (payload: NoticePayload) => {
      this.noticeListeners.forEach((listener) => listener(payload));
    });

    this.socket.on(S2C.errorMessage, (payload: ErrorPayload) => {
      this.errorListeners.forEach((listener) => listener(payload));
    });

    this.socket.on(S2C.snapshotData, (payload: { filename: string; json: string }) => {
      this.snapshotListeners.forEach((listener) => listener(payload));
    });

    this.socket.on(S2C.kicked, (payload: { message: string }) => {
      clearSession();
      this.errorListeners.forEach((listener) => listener({ message: payload.message }));
      window.setTimeout(() => window.location.reload(), 2_500);
    });
  }

  emit(event: string, payload?: unknown): void {
    this.socket.emit(event, payload ?? {});
  }

  onState(listener: Listener<GameStateView>): void {
    this.stateListeners.push(listener);
  }

  onTick(listener: Listener<PlaybackTickPayload>): void {
    this.tickListeners.push(listener);
  }

  onNotice(listener: Listener<NoticePayload>): void {
    this.noticeListeners.push(listener);
  }

  onError(listener: Listener<ErrorPayload>): void {
    this.errorListeners.push(listener);
  }

  onConnection(listener: Listener<AppStore['connection']>): void {
    this.connectionListeners.push(listener);
  }

  onJoined(listener: Listener<JoinedPayload>): void {
    this.joinListeners.push(listener);
  }

  onSnapshot(listener: Listener<{ filename: string; json: string }>): void {
    this.snapshotListeners.push(listener);
  }
}
