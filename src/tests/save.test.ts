import assert from 'node:assert/strict';
import test from 'node:test';
import { SAVE_PLAYER_NAME, SCHEMA_VERSION } from '../shared/constants.js';
import * as game from '../server/game.js';
import {
  GitHubConfigError,
  commitFile,
  describeGitHubError,
  isGitHubConfigured,
  missingGitHubSettings,
  readGitHubConfig,
  redact,
  type FetchLike,
} from '../server/github.js';
import { buildCommitMessage, buildSavePath, buildSnapshot, snapshotToJson } from '../server/snapshot.js';
import { RoomStore, type InternalPlayer, type Room } from '../server/state.js';

function playedRoom(): { room: Room; markus: InternalPlayer; other: InternalPlayer } {
  const store = new RoomStore();
  const created = game.createRoom(store, { playerName: 'Markus', factoryName: 'Widget Works' });
  assert.ok(created.ok);
  const joined = game.joinRoom(store, { roomCode: created.value.room.code, playerName: 'Sam' });
  assert.ok(joined.ok);

  const room = created.value.room;
  const markus = created.value.player;
  const other = joined.value.player;
  game.attachSocket(room, markus, 'socket-markus');
  game.attachSocket(room, other, 'socket-sam');

  room.phase = 'checkin';
  assert.equal(game.submitCheckIn(room, markus, { energy: 4, condition: 'Busy' }).ok, true);
  assert.equal(game.submitCheckIn(room, other, { energy: 2, condition: 'Jammed' }).ok, true);

  room.phase = 'build';
  assert.equal(
    game.saveSubmissions(room, markus, {
      items: [
        { kind: 'bottleneck', title: 'Review waits two days', station: 'review', impact: 3 },
        { kind: 'booster', title: 'Pairing helps', station: 'development', impact: 2 },
        { kind: 'wildcard', title: 'Surprise incident', station: 'all', impact: 2 },
      ],
    }).ok,
    true,
  );
  assert.equal(
    game.saveSubmissions(room, other, {
      items: [{ kind: 'bottleneck', title: 'Flaky tests', station: 'test', impact: 2 }],
    }).ok,
    true,
  );

  assert.equal(game.advancePhase(room, markus).ok, true); // run1
  room.phase = 'inspect';
  const bottleneck = room.submissions.find((item) => item.title === 'Review waits two days')!;
  assert.equal(game.allocateTokens(room, other, { allocations: { [bottleneck.id]: 3 } }).ok, true);
  assert.equal(game.focusItem(room, markus, { itemId: bottleneck.id }).ok, true);
  assert.equal(game.addNote(room, other, { itemId: bottleneck.id, text: 'Reviewers are all in meetings' }).ok, true);

  room.phase = 'shop';
  assert.equal(
    game.proposeUpgrade(room, other, {
      name: 'Review rota',
      problem: 'Reviews sit unclaimed',
      experiment: 'Two named reviewers each morning',
      signal: 'No pull request waits longer than one working day',
      cost: 3,
      owner: 'Sam',
      reviewDate: '2026-10-15',
      station: 'review',
    }).ok,
    true,
  );
  const upgradeId = room.upgrades[0]!.id;
  assert.equal(game.setBasket(room, other, { upgradeIds: [upgradeId] }).ok, true);
  assert.equal(game.setBasket(room, markus, { upgradeIds: [upgradeId] }).ok, true);
  assert.equal(game.revealBaskets(room, markus).ok, true);
  assert.equal(game.purchase(room, markus, { upgradeIds: [upgradeId] }).ok, true);
  assert.equal(game.advancePhase(room, markus).ok, true); // run2
  assert.equal(game.advancePhase(room, markus).ok, true); // report

  return { room, markus, other };
}

test('only a connected player named exactly Markus may save', () => {
  const { room, markus, other } = playedRoom();

  assert.equal(game.canSaveSnapshot(room, markus, 'socket-markus', SAVE_PLAYER_NAME), true);
  assert.equal(game.canSaveSnapshot(room, other, 'socket-sam', SAVE_PLAYER_NAME), false);

  // A different socket cannot borrow Markus's seat.
  assert.equal(game.canSaveSnapshot(room, markus, 'socket-sam', SAVE_PLAYER_NAME), false);

  // The check is case-sensitive and whitespace-sensitive.
  for (const name of ['markus', 'MARKUS', 'Markus ', 'Markuss']) {
    const impostor = { ...markus, name } as InternalPlayer;
    assert.equal(game.isSavePlayer(impostor, SAVE_PLAYER_NAME), name === 'Markus');
  }

  // A disconnected Markus loses the permission until he reconnects.
  game.detachSocket(room, markus);
  assert.equal(game.canSaveSnapshot(room, markus, 'socket-markus', SAVE_PLAYER_NAME), false);
});

test('a player who left the room cannot save even with the right name', () => {
  const { room, markus } = playedRoom();
  game.removePlayer(room, markus);
  assert.equal(game.canSaveSnapshot(room, markus, 'socket-markus', SAVE_PLAYER_NAME), false);
});

test('the snapshot is anonymous and free of internal server state', () => {
  const { room, markus } = playedRoom();
  const snapshot = buildSnapshot(room);
  const json = snapshotToJson(snapshot);

  assert.equal(snapshot.app, 'Flow Factory');
  assert.equal(snapshot.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(snapshot.participants, ['Markus', 'Sam']);
  assert.equal(snapshot.boosters.length, 1);
  assert.equal(snapshot.bottlenecks.length, 2);
  assert.equal(snapshot.wildcards.length, 1);
  assert.equal(snapshot.purchasedUpgrades.length, 1);
  assert.equal(snapshot.purchasedUpgrades[0]?.owner, 'Sam');
  assert.equal(snapshot.purchasedUpgrades[0]?.reviewDate, '2026-10-15');
  assert.ok(snapshot.metrics.before);
  assert.ok(snapshot.metrics.after);
  assert.equal(snapshot.checkIn.submitted, 2);
  assert.equal(snapshot.discussionNotes[0]?.notes[0], 'Reviewers are all in meetings');
  assert.equal(snapshot.inspectionAllocations[0]?.tokens, 3);

  for (const forbidden of ['authorId', 'socketId', 'reconnectToken', 'playerId', markus.id, markus.reconnectToken]) {
    assert.equal(json.includes(forbidden), false, `snapshot must not contain ${forbidden}`);
  }
  assert.equal(JSON.parse(json).room.code, room.code);
});

test('the snapshot keeps the original texts of merged duplicates', () => {
  const { room, markus } = playedRoom();
  room.phase = 'inspect';
  const target = room.submissions.find((item) => item.title === 'Review waits two days')!;
  const source = room.submissions.find((item) => item.title === 'Flaky tests')!;
  assert.equal(game.mergeItems(room, markus, { targetId: target.id, sourceIds: [source.id] }).ok, true);

  const snapshot = buildSnapshot(room);
  assert.equal(snapshot.mergedItems.length, 1);
  assert.equal(snapshot.mergedItems[0]?.mergedFrom[0]?.title, 'Flaky tests');
});

test('the GitHub path and commit message follow the agreed format', () => {
  const when = new Date(Date.UTC(2026, 1, 14, 9, 5));
  assert.equal(buildSavePath('4F7Q', when), 'retro-saves/flow-factory/2026-02-14_09-05_room-4F7Q.json');
  assert.equal(buildSavePath('ab-3!', when), 'retro-saves/flow-factory/2026-02-14_09-05_room-AB3.json');
  assert.match(buildSavePath('4F7Q', when), /^retro-saves\/flow-factory\/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}_room-[A-Z0-9]+\.json$/);

  const { room } = playedRoom();
  const message = buildCommitMessage(room, when);
  assert.equal(message, `Flow Factory retro: Widget Works (room ${room.code}) on 2026-02-14`);
});

test('missing environment configuration is reported without guessing', () => {
  assert.equal(readGitHubConfig({} as NodeJS.ProcessEnv), null);
  assert.equal(isGitHubConfigured({} as NodeJS.ProcessEnv), false);
  assert.deepEqual(missingGitHubSettings({ GITHUB_OWNER: 'acme' } as NodeJS.ProcessEnv), [
    'GITHUB_TOKEN',
    'GITHUB_REPO',
  ]);

  const configured = readGitHubConfig({
    GITHUB_TOKEN: 'token',
    GITHUB_OWNER: 'acme',
    GITHUB_REPO: 'retros',
  } as NodeJS.ProcessEnv);
  assert.equal(configured?.branch, 'main');

  const explicitBranch = readGitHubConfig({
    GITHUB_TOKEN: 'token',
    GITHUB_OWNER: 'acme',
    GITHUB_REPO: 'retros',
    GITHUB_BRANCH: 'retros-2026',
  } as NodeJS.ProcessEnv);
  assert.equal(explicitBranch?.branch, 'retros-2026');

  const message = new GitHubConfigError(['GITHUB_TOKEN']).message;
  assert.match(message, /GITHUB_TOKEN/);
  assert.match(message, /Download JSON/);
});

test('commitFile creates a new file through a mocked Contents API', async () => {
  const calls: Array<{ url: string; init: Record<string, unknown> }> = [];
  const fetchMock: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'GET') {
      return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' };
    }
    return {
      ok: true,
      status: 201,
      json: async () => ({
        content: { html_url: 'https://github.com/acme/retros/blob/main/file.json', path: 'file.json' },
        commit: { sha: 'abc123' },
      }),
      text: async () => '',
    };
  };

  const result = await commitFile({
    config: { token: 'ghp_secrettokenvalue', owner: 'acme', repo: 'retros', branch: 'main' },
    path: 'retro-saves/flow-factory/2026-02-14_09-05_room-4F7Q.json',
    content: '{"hello":"world"}',
    message: 'Flow Factory retro',
    fetchImpl: fetchMock,
  });

  assert.equal(result.htmlUrl, 'https://github.com/acme/retros/blob/main/file.json');
  assert.equal(result.commitSha, 'abc123');
  assert.equal(calls.length, 2);
  assert.match(calls[1]!.url, /^https:\/\/api\.github\.com\/repos\/acme\/retros\/contents\//);

  const body = JSON.parse(String(calls[1]!.init.body));
  assert.equal(body.branch, 'main');
  assert.equal(Buffer.from(body.content, 'base64').toString('utf8'), '{"hello":"world"}');
  assert.equal('sha' in body, false);
});

test('commitFile updates in place when the file already exists', async () => {
  const fetchMock: FetchLike = async (_url, init) => {
    if (init.method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ sha: 'existing-sha' }), text: async () => '' };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: { html_url: 'https://github.com/acme/retros/blob/main/file.json', path: 'file.json' },
        commit: { sha: 'def456' },
      }),
      text: async () => '',
    };
  };

  let sentSha = '';
  const spy: FetchLike = async (url, init) => {
    if (init.method === 'PUT') sentSha = JSON.parse(String(init.body)).sha;
    return fetchMock(url, init);
  };

  await commitFile({
    config: { token: 't', owner: 'acme', repo: 'retros', branch: 'main' },
    path: 'a/b.json',
    content: '{}',
    message: 'update',
    fetchImpl: spy,
  });
  assert.equal(sentSha, 'existing-sha');
});

test('a failed commit never reports success and never leaks the token', async () => {
  const fetchMock: FetchLike = async (_url, init) => {
    if (init.method === 'GET') {
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    }
    return {
      ok: false,
      status: 401,
      json: async () => ({ message: 'Bad credentials for ghp_secrettokenvalue' }),
      text: async () => 'Bad credentials',
    };
  };

  await assert.rejects(
    commitFile({
      config: { token: 'ghp_secrettokenvalue', owner: 'acme', repo: 'retros', branch: 'main' },
      path: 'a/b.json',
      content: '{}',
      message: 'save',
      fetchImpl: fetchMock,
    }),
    (error: unknown) => {
      const described = describeGitHubError(error, 'ghp_secrettokenvalue');
      assert.match(described, /Contents: Read and write/);
      assert.equal(described.includes('ghp_secrettokenvalue'), false);
      return true;
    },
  );
});

test('redact removes token shapes from any message', () => {
  assert.equal(redact('using ghp_abcdefghijklmnop now'), 'using *** now');
  assert.equal(redact('header Bearer xyz.abc-123'), 'header Bearer ***');
  assert.equal(redact('secret is supersecret', 'supersecret'), 'secret is ***');
});
