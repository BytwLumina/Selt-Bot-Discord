import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseUserToken, isUserToken, maskToken } from '../src/tokenParse.js';
import { loadConfig } from '../src/config.js';
import { loadAccountDefs, addAccountToStore, removeAccountFromStore } from '../src/accounts.js';
import { createHealthWatch } from '../src/health.js';

function makeToken(userId) {
  const id = Buffer.from(String(userId), 'utf8').toString('base64url');
  const ts = Buffer.from([0, 0, 0, 0]).toString('base64url');
  return `${id}.${ts}.c2ln`;
}

test('parseUserToken đọc được Discord ID từ token hợp lệ', () => {
  const res = parseUserToken(makeToken('123456789012345678'));
  assert.equal(res.ok, true);
  assert.equal(res.discordId, '123456789012345678');
  assert.ok(res.issuedAt > 0);
  assert.ok(!Number.isNaN(Date.parse(res.issuedAtIso)));
});

test('parseUserToken báo lỗi rõ ràng với token rác', () => {
  assert.equal(parseUserToken('').ok, false);
  assert.equal(parseUserToken('abc').ok, false);
  assert.equal(parseUserToken('a.b.c').ok, false);
  assert.equal(parseUserToken(`${makeToken('123456789012345678')}.x`).ok, false);
  assert.equal(parseUserToken('has space.a.b').ok, false);
  assert.equal(isUserToken(makeToken('123456789012345678')), true);
  assert.equal(isUserToken('nope'), false);
});

test('maskToken không lộ full token', () => {
  const token = makeToken('123456789012345678');
  const masked = maskToken(token);
  assert.ok(masked.includes('…'));
  assert.ok(!masked.includes(token.slice(10)));
});

test('loadConfig áp dụng khối health mặc định', () => {
  const file = path.join(os.tmpdir(), `cfg-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify({ sessionMaxMinutes: 0 }));
  const { config } = loadConfig(file);
  fs.rmSync(file, { force: true });

  assert.equal(config.health.enabled, true);
  assert.equal(config.health.intervalMs, 10000);
  assert.equal(config.health.graceMs, 90000);
  assert.equal(config.sessionMaxMinutes, 0);
});

test('account store thêm / xoá đúng dòng', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-store-'));
  try {
    const defs = loadAccountDefs({ root });
    assert.equal(defs.accounts.length, 0);

    const token = makeToken('123456789012345678');
    const index = addAccountToStore({ root, file: 'accounts.json', name: 'Main', token });

    const after = loadAccountDefs({ root });
    assert.equal(after.accounts.length, 1);
    assert.equal(after.accounts[0].name, 'Main');
    assert.equal(after.accounts[0].token, token);
    assert.equal(after.file, 'accounts.json');

    assert.equal(removeAccountFromStore({ root, file: 'accounts.json', index }), true);
    assert.equal(loadAccountDefs({ root }).accounts.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('watchdog không restart account đang khoẻ, có restart account rớt', async () => {
  const restarted = [];
  const healthy = {
    id: 'ok',
    name: 'OK',
    client: { isReady: () => true },
    permanentError: false,
    restarting: false,
  };
  const dead = {
    id: 'dead',
    name: 'Dead',
    client: null,
    permanentError: false,
    restarting: false,
  };
  const broken = {
    id: 'bad',
    name: 'Bad',
    client: null,
    permanentError: true,
    restarting: false,
  };

  const watch = createHealthWatch({
    config: { health: { enabled: true, intervalMs: 1000, graceMs: 0, backoffBaseMs: 600000 } },
    logger: null,
    getAccounts: () => [healthy, dead, broken],
    restartAccount: async (acct) => { restarted.push(acct.id); },
    isShuttingDown: () => false,
  });

  await watch.tick();
  assert.deepEqual(restarted, []);

  await watch.tick();
  assert.deepEqual(restarted, ['dead']);

  await watch.tick();
  assert.deepEqual(restarted, ['dead'], 'backoff phải chặn restart liên tục');

  const snap = watch.snapshot();
  assert.equal(snap.enabled, true);
  assert.equal(snap.accounts.length, 3);
});
