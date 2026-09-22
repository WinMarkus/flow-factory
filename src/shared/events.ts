/**
 * Single source of truth for socket event names.
 * Both the server and the browser import this file, so a typo cannot drift.
 */

export const C2S = {
  createRoom: 'room:create',
  joinRoom: 'room:join',
  reconnect: 'room:reconnect',
  leaveRoom: 'room:leave',
  resetRoom: 'room:reset',
  renameStation: 'station:rename',
  submitCheckIn: 'checkin:submit',
  saveSubmissions: 'build:save',
  readyBuild: 'build:ready',
  unreadyBuild: 'build:unready',
  phaseNext: 'phase:next',
  phaseBack: 'phase:back',
  playback: 'sim:playback',
  allocate: 'inspect:allocate',
  readyInspect: 'inspect:ready',
  closeVoting: 'inspect:close',
  focusItem: 'inspect:focus',
  addNote: 'inspect:note',
  timerControl: 'inspect:timer',
  mergeItems: 'inspect:merge',
  proposeUpgrade: 'shop:propose',
  editUpgrade: 'shop:edit',
  removeUpgrade: 'shop:remove',
  setBasket: 'shop:basket',
  readyShop: 'shop:ready',
  revealBaskets: 'shop:reveal',
  purchase: 'shop:purchase',
  saveToGitHub: 'save:github',
  downloadSnapshot: 'save:download',
} as const;

export const S2C = {
  joined: 'room:joined',
  state: 'state',
  playbackTick: 'sim:tick',
  errorMessage: 'error:message',
  notice: 'notice',
  snapshotData: 'save:snapshot',
  kicked: 'room:closed',
} as const;

export interface JoinedPayload {
  roomCode: string;
  playerId: string;
  reconnectToken: string;
  playerName: string;
}

export interface ErrorPayload {
  message: string;
  code?: string;
}

export interface NoticePayload {
  message: string;
  tone: 'info' | 'success' | 'warning';
}

export interface PlaybackTickPayload {
  run: 'first' | 'second';
  tick: number;
  playing: boolean;
  finished: boolean;
}
