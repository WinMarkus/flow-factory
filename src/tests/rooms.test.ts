import assert from 'node:assert/strict';
import test from 'node:test';
import { LIMITS, ROOM_LIFETIME } from '../shared/constants.js';
import * as game from '../server/game.js';
import { RoomStore } from '../server/state.js';

function freshRoom(playerName = 'Dana') {
  const store = new RoomStore();
  const created = game.createRoom(store, { playerName, factoryName: 'Widget Works' });
  assert.ok(created.ok, 'room creation should succeed');
  return { store, room: created.value.room, player: created.value.player };
}

test('creating a room makes the first player the facilitator', () => {
  const { room, player } = freshRoom();
  assert.equal(room.players.length, 1);
  assert.equal(player.isFacilitator, true);
  assert.equal(room.factoryName, 'Widget Works');
  assert.equal(room.code.length, LIMITS.roomCode);
  assert.match(room.code, /^[A-Z0-9]+$/);
  assert.equal(room.phase, 'lobby');
});

test('a room code resolves case-insensitively', () => {
  const { store, room } = freshRoom();
  assert.ok(store.get(room.code.toLowerCase()));
});

test('joining with a room code adds an ordinary player', () => {
  const { store, room } = freshRoom();
  const joined = game.joinRoom(store, { roomCode: room.code, playerName: 'Sam' });
  assert.ok(joined.ok);
  assert.equal(joined.value.player.isFacilitator, false);
  assert.equal(room.players.length, 2);
});

test('joining an unknown room code fails', () => {
  const { store } = freshRoom();
  const joined = game.joinRoom(store, { roomCode: 'ZZZZ', playerName: 'Sam' });
  assert.equal(joined.ok, false);
});

test('a player name is mandatory for creating and joining', () => {
  const store = new RoomStore();
  const created = game.createRoom(store, { playerName: '   ', factoryName: 'Nameless' });
  assert.equal(created.ok, false);
  assert.match(created.ok === false ? created.error : '', /player name/i);

  const room = game.createRoom(store, { playerName: 'Dana' });
  assert.ok(room.ok);
  const joined = game.joinRoom(store, { roomCode: room.value.room.code, playerName: '' });
  assert.equal(joined.ok, false);
});

test('duplicate names in the same room are rejected, case-insensitively', () => {
  const { store, room } = freshRoom('Dana');
  const duplicate = game.joinRoom(store, { roomCode: room.code, playerName: '  dana ' });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.ok === false ? duplicate.error : '', /already on this shift/i);
  assert.equal(room.players.length, 1);
});

test('the same name may be used in two different rooms', () => {
  const store = new RoomStore();
  const first = game.createRoom(store, { playerName: 'Dana' });
  const second = game.createRoom(store, { playerName: 'Dana' });
  assert.ok(first.ok && second.ok);
  assert.notEqual(first.value.room.code, second.value.room.code);
});

test('reconnection restores the same seat via the reconnect token', () => {
  const { store, room, player } = freshRoom();
  game.attachSocket(room, player, 'socket-1');
  game.detachSocket(room, player);
  assert.equal(player.connected, false);

  const result = game.reconnect(store, {
    roomCode: room.code,
    reconnectToken: player.reconnectToken,
  });
  assert.ok(result.ok);
  assert.equal(result.value.player.id, player.id);

  game.attachSocket(room, result.value.player, 'socket-2');
  assert.equal(player.connected, true);
  assert.equal(room.players.length, 1);
});

test('reconnection with a wrong token is refused', () => {
  const { store, room } = freshRoom();
  const result = game.reconnect(store, { roomCode: room.code, reconnectToken: 'nope' });
  assert.equal(result.ok, false);
});

test('a disconnected name cannot be stolen by a new joiner', () => {
  const { store, room, player } = freshRoom('Dana');
  game.attachSocket(room, player, 'socket-1');
  game.detachSocket(room, player);
  const stolen = game.joinRoom(store, { roomCode: room.code, playerName: 'Dana' });
  assert.equal(stolen.ok, false);
});

test('the facilitator role transfers when the facilitator stays away', () => {
  const { store, room, player } = freshRoom('Dana');
  const joined = game.joinRoom(store, { roomCode: room.code, playerName: 'Sam' });
  assert.ok(joined.ok);
  game.attachSocket(room, joined.value.player, 'socket-sam');
  game.attachSocket(room, player, 'socket-dana');
  game.detachSocket(room, player);
  player.disconnectedAt = Date.now() - ROOM_LIFETIME.facilitatorGraceMs - 1_000;

  const { changed } = store.janitor();
  assert.deepEqual(changed, [room.code]);
  assert.equal(player.isFacilitator, false);
  assert.equal(joined.value.player.isFacilitator, true);
});

test('removing the facilitator hands the role to another player immediately', () => {
  const { store, room, player } = freshRoom('Dana');
  const joined = game.joinRoom(store, { roomCode: room.code, playerName: 'Sam' });
  assert.ok(joined.ok);
  game.attachSocket(room, joined.value.player, 'socket-sam');
  game.removePlayer(room, player);
  assert.equal(room.players.length, 1);
  assert.equal(joined.value.player.isFacilitator, true);
});

test('empty rooms are cleaned up once the grace period passes', () => {
  const { store, room, player } = freshRoom();
  game.attachSocket(room, player, 'socket-1');
  game.detachSocket(room, player);
  room.updatedAt = Date.now() - ROOM_LIFETIME.emptyRoomMs - 1_000;
  player.lastSeen = room.updatedAt;

  const { removed } = store.janitor();
  assert.deepEqual(removed, [room.code]);
  assert.equal(store.has(room.code), false);
});
