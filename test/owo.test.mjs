import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createOwO,
  isCaptchaPrompt,
  isWarning,
  parseHuntCatch,
  isQuestComplete,
  parseQuestSay,
  parseGemSlots,
  findFightButton,
  findClaimButton,
  parseQuestLog,
  collectComponentText,
  collectOwOText,
  OWO_BOT_ID,
} from '../src/owo.js';

const quietLogger = {
  debug() {},
  warn() {},
  error() {},
  cmd() {},
  ok() {},
  info() {},
  ws() {},
  voice() {},
};

test('isCaptchaPrompt nhận đúng câu captcha của OwO', () => {
  assert.equal(isCaptchaPrompt('Please complete the captcha (1/5) to continue'), true);
  assert.equal(isCaptchaPrompt('Captcha check — verify you are human'), true);
  assert.equal(isCaptchaPrompt('Captcha: type the letters shown'), true);
  assert.equal(isCaptchaPrompt('owo h → caught a dog'), false);
  assert.equal(isCaptchaPrompt('captcha but no marker'), false);
});

test('isWarning chỉ bắt cảnh báo từ OwO', () => {
  assert.equal(isWarning('OwO: you have been warned for spamming'), true);
  assert.equal(isWarning('Warning: captcha required (2/5)'), false);
  assert.equal(isWarning('Someone warned you in chat'), false);
});

test('parseHuntCatch đọc tên thú bắt được', () => {
  assert.equal(parseHuntCatch('owo h → caught a **dog**'), 'dog');
  assert.equal(parseHuntCatch('caught an owl'), 'owl');
  assert.equal(parseHuntCatch('nothing here'), '');
});

test('quest: nhận diện hoàn thành và yêu cầu nói owo', () => {
  assert.equal(isQuestComplete('Your quest has been completed!'), true);
  assert.equal(isQuestComplete('Quest complete: say owo 5 times'), true);
  assert.equal(isQuestComplete('quest is available'), false);
  assert.equal(parseQuestSay('say "owo" to finish the quest'), true);
  assert.equal(parseQuestSay('say hello'), false);
});

test('parseGemSlots chọn gem mạnh nhất mỗi tier', () => {
  const text = 'Inventory: `1` <:cgem3:111> `2` <:ugem3:112> `3` <:fgem1:113> `4` <:lgem1:114>';
  assert.deepEqual(parseGemSlots(text), ['3', '2']);
});

test('findFightButton tìm nút Fight trong components lồng nhau', () => {
  const components = [
    {
      type: 1,
      components: [
        { type: 2, label: 'Fight', custom_id: 'boss_fight', disabled: false },
        { type: 2, label: 'Run', custom_id: 'boss_run' },
      ],
    },
  ];
  assert.equal(findFightButton(components), 'boss_fight');
  assert.equal(findFightButton([{ type: 1, components: [{ type: 2, label: 'Fight', custom_id: 'x', disabled: true }] }]), null);
  assert.equal(findFightButton(null), null);
});

test('collectOwOText gom cả content và embed', () => {
  const text = collectOwOText({
    content: 'hello',
    embeds: [{ toJSON: () => ({ title: 'OwO', description: 'caught a cat', fields: [{ name: 'xp', value: '+5' }] }) }],
  });
  assert.ok(text.includes('hello'));
  assert.ok(text.includes('caught a cat'));
  assert.ok(text.includes('+5'));
});

test('createOwO: validate channel, clamp interval, lưu file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owo-'));
  const file = path.join(dir, '.owo.json');
  try {
    const owo = createOwO({
      config: { owo: { enabled: false, channelIds: [] } },
      logger: quietLogger,
      file,
      getClient: () => null,
    });

    assert.equal(owo.getState().enabled, false);
    assert.equal(owo.OWO_BOT_ID, OWO_BOT_ID);

    const st = owo.setSettings({
      channelIds: ['123456789012345678', 'bad', '123456789012345678'],
      hunt: { enabled: true, intervalMs: 1000 },
      quest: { enabled: true, intervalMs: 999999999 },
    });
    assert.deepEqual(st.channels, ['123456789012345678']);
    // Khoảng thời gian kẹt trong [15s, 3h]
    assert.equal(st.features.hunt.minMs, 15000);
    assert.equal(st.features.hunt.maxMs, 15000);
    assert.equal(st.features.quest.minMs, 10800000);
    assert.equal(st.features.quest.maxMs, 10800000);

    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(saved.channelIds, ['123456789012345678']);

    assert.equal(owo.start().ok, false, 'chưa login thì không start được');
    owo.dispose();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createOwO: min/max ngẫu nhiên + module mới + nút thời gian an toàn', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owo-'));
  const file = path.join(dir, '.owo.json');
  try {
    const owo = createOwO({
      config: { owo: { enabled: false, channelIds: [] } },
      logger: quietLogger,
      file,
      getClient: () => null,
    });

    const st = owo.setSettings({
      channelIds: ['123456789012345678'],
      hunt: { enabled: true, minMs: 20000, maxMs: 45000 },
      train: { enabled: true, minMs: 600000, maxMs: 900000 },
      roll: { enabled: true, minMs: 300000, maxMs: 600000 },
      daily: { enabled: true, minMs: 3600000, maxMs: 7200000 },
    });

    assert.equal(st.features.hunt.minMs, 20000);
    assert.equal(st.features.hunt.maxMs, 45000);
    assert.equal(st.features.train.enabled, true);
    assert.equal(st.features.roll.enabled, true);
    assert.equal(st.features.daily.enabled, true);
    // Khoảng an toàn luôn nằm trong [15s, 3h]
    for (const key of Object.keys(st.safe)) {
      assert.ok(st.safe[key].minMs >= 15000, key);
      assert.ok(st.safe[key].maxMs <= 10800000, key);
      assert.ok(st.safe[key].minMs <= st.safe[key].maxMs, key);
    }
    // min > max thì sửa lại cho hợp lệ
    const fixed = owo.setSettings({ hunt: { minMs: 900000, maxMs: 30000 } });
    assert.equal(fixed.features.hunt.maxMs, 900000);
    owo.dispose();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createOwO: start cần channel + ít nhất một module', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owo-'));
  try {
    const owo = createOwO({
      config: { owo: { enabled: false, channelIds: [] } },
      logger: quietLogger,
      file: path.join(dir, '.owo.json'),
      getClient: () => ({ user: { id: '1' } }),
    });

    assert.match(owo.start().error, /channel/i);

    owo.setSettings({ channelIds: ['123456789012345678'] });
    const noModules = owo.setSettings({
      hunt: { enabled: false },
      quest: { enabled: false },
      gem: { enabled: false },
      boss: { enabled: false },
    });
    assert.equal(noModules.features.hunt.enabled, false);
    assert.match(owo.start().error, /module/i);

    owo.setSettings({ hunt: { enabled: true } });
    const started = owo.start();
    assert.equal(started.ok, true);
    assert.equal(owo.getState().enabled, true);
    assert.ok(owo.getState().features.hunt.nextAt > Date.now());

    const stopped = owo.stop('test');
    assert.equal(stopped.ok, true);
    assert.equal(owo.getState().enabled, false);
    assert.equal(owo.getState().features.hunt.nextAt, 0);
    owo.dispose();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createOwO: onMessage chỉ xử lý channel trong danh sách farm', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owo-'));
  try {
    const owo = createOwO({
      config: { owo: { enabled: false, channelIds: [] } },
      logger: quietLogger,
      file: path.join(dir, '.owo.json'),
      getClient: () => ({ user: { id: '1' } }),
    });
    const msg = (content, channelId = '123456789012345678') => ({
      id: 'm1',
      author: { id: OWO_BOT_ID },
      channel: { id: channelId },
      content,
      embeds: [],
      components: [],
    });

    owo.onMessage(msg('Please complete the captcha (2/5)'));
    assert.equal(owo.getState().paused, '', 'channel rỗng thì không dính captcha ngoài phạm vi');
    assert.equal(owo.getState().counters.captchaStops, 0);

    owo.setSettings({ channelIds: ['123456789012345678'] });
    owo.onMessage(msg('owo caught a **dog**', '999999999999999999'));
    assert.equal(owo.getState().counters.catches, 0, 'channel khác thì bỏ qua');

    owo.onMessage(msg('owo caught a **dog**'));
    assert.equal(owo.getState().counters.catches, 1);

    owo.onMessage(msg('Please complete the captcha (2/5)'));
    assert.equal(owo.getState().paused, 'captcha');
    assert.equal(owo.getState().counters.captchaStops, 1);
    owo.dispose();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parseQuestLog đọc quest + tiến độ trong quest log', () => {
  const text = [
    'Quest Log — 3 quest đang chạy',
    'Say "owo" in chat',
    '1/3',
    'Send an action to a friend',
    '0/2',
    'Gamble your cowoncy',
    '2/5',
  ].join('\n');
  const parsed = parseQuestLog(text);
  assert.equal(parsed.found, true);
  assert.equal(parsed.allDone, false);
  assert.deepEqual(parsed.quests.map((q) => q.key), ['say_owo', 'send_action', 'gamble']);
  assert.deepEqual(
    parsed.quests.map((q) => `${q.current}/${q.total}`),
    ['1/3', '0/2', '2/5'],
  );
});

test('parseQuestLog đọc tiến độ nằm cùng dòng với nhãn', () => {
  const parsed = parseQuestLog([
    '**Daily Quests**',
    'Gamble your cowoncy `2`/`5`',
    'Battle with a friend',
    '0/1',
  ].join('\n'));
  assert.deepEqual(
    parsed.quests.map((q) => `${q.key}:${q.current}/${q.total}`),
    ['gamble:2/5', 'battle:0/1'],
  );
});

test('parseQuestLog nhận trạng thái xong hết quest + mốc mở lại', () => {
  const parsed = parseQuestLog('You finished all of your quests! Come back <t:1893456000:R>');
  assert.equal(parsed.found, true);
  assert.equal(parsed.allDone, true);
  assert.equal(parsed.untilMs, 1893456000 * 1000 + 60000);
});

test('findClaimButton chỉ chọn nút Claim đang bật', () => {
  const components = [{
    type: 1,
    components: [
      { type: 2, label: 'Claim', custom_id: 'claim_off', disabled: true },
      { type: 2, label: 'Claim all', custom_id: 'claim_on', disabled: false },
    ],
  }];
  assert.equal(findClaimButton(components), 'claim_on');
  assert.equal(findClaimButton([{ type: 1, components: [] }]), null);
});

test('collectComponentText gom text display + collectOwOText đọc được quest log', () => {
  const components = [{
    type: 17,
    components: [
      { type: 10, content: 'Quest Log' },
      { type: 10, content: 'Say "owo" in chat\n2/3' },
    ],
  }];
  assert.match(collectComponentText(components), /Quest Log/);
  const text = collectOwOText({ content: '', embeds: [], components });
  const parsed = parseQuestLog(text);
  assert.equal(parsed.quests[0].key, 'say_owo');
  assert.equal(parsed.quests[0].current, 2);
});
