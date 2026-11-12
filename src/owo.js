import fs from 'node:fs';
import {
  createActivityWindow,
  createPacer,
  createWorkCycle,
} from './antiDetect.js';
import { extractChannelIds, writeJson } from './utils.js';

export const OWO_BOT_ID = '408785106942164992';

export const OWO_DEFAULTS = {
  enabled: false,
  channelIds: [],
  hunt: { enabled: true, minMs: 20000, maxMs: 45000 },
  quest: { enabled: true, minMs: 300000, maxMs: 600000 },
  gem: { enabled: false, minMs: 1800000, maxMs: 3600000 },
  boss: { enabled: false },
  train: { enabled: false, minMs: 600000, maxMs: 900000 },
  roll: { enabled: false, minMs: 300000, maxMs: 600000 },
  daily: { enabled: false, minMs: 3600000, maxMs: 7200000 },
};

// Khoảng thời gian được phép cài: nhanh nhất 15s, lâu nhất 3 giờ.
const MIN_INTERVAL = 15000;
const MAX_INTERVAL = 3 * 60 * 60 * 1000;

// Bộ thời gian "an toàn" — panel bấm một cái là về đúng khoảng này.
export const OWO_SAFE = {
  hunt: { minMs: 45000, maxMs: 90000 },
  quest: { minMs: 300000, maxMs: 600000 },
  gem: { minMs: 1800000, maxMs: 3600000 },
  train: { minMs: 600000, maxMs: 900000 },
  roll: { minMs: 300000, maxMs: 600000 },
  daily: { minMs: 3600000, maxMs: 7200000 },
};

const FEATURE_NAMES = ['hunt', 'quest', 'gem', 'train', 'roll', 'daily'];
const SEND_GAP_MS = 2500;
const INVENTORY_WAIT_MS = 25000;
const OWO_SAY_GAP_MS = 30000;

const QUEST_PATTERNS = [
  ['battle', ['battle with a friend']],
  ['send_action', ['send an action to a friend', 'use an action command']],
  ['action_from_friend', ['action from a friend']],
  ['cookie', ['receive cookies', 'receive a cookie']],
  ['curse', ['receive curses', 'curse you']],
  ['prayer', ['receive prayers', 'pray to you']],
  ['say_owo', ["say 'owo'", 'say "owo"', 'say owo']],
  ['gamble', ['gamble your cowoncy', 'gamble']],
];

const QUEST_LABELS = {
  battle: 'Battle với bạn',
  send_action: 'Gửi action cho bạn',
  action_from_friend: 'Nhận action từ bạn',
  cookie: 'Nhận cookie',
  curse: 'Nhận curse',
  prayer: 'Nhận prayer',
  say_owo: 'Nói "owo"',
  gamble: 'Gamble cowoncy',
};

const QUEST_GAP_MS = {
  battle: 600000,
  send_action: 120000,
  action_from_friend: 120000,
  cookie: 120000,
  curse: 300000,
  prayer: 300000,
  say_owo: 60000,
  gamble: 120000,
};

const QUEST_ACTIONS = ['punch', 'slap', 'pat', 'hug', 'kiss', 'cuddle'];

// Ngưỡng chờ tối thiểu sau khi dính captcha: bot phải để người giải tay trước,
// rồi mới chạy lại — bật lại ngay lập tức chỉ là đâm vào cùng cái bẫy lần hai.
const DEFAULT_CAPTCHA_COOLDOWN_MS = 5 * 60 * 1000;

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}



export function normalizeOwOText(text) {
  return String(text ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '');
}

export function isCaptchaPrompt(text) {
  const t = normalizeOwOText(text).toLowerCase();
  if (!t.includes('captcha')) return false;
  return t.includes('verify') || t.includes('letters') || /\(\s*\d\s*\/\s*5\s*\)/.test(t);
}

export function isWarning(text) {
  const t = normalizeOwOText(text).toLowerCase();
  if (isCaptchaPrompt(t)) return false;
  return /\bwarn(?:ing|ed)\b/.test(t) && t.includes('owo');
}

export function parseHuntCatch(text) {
  const t = normalizeOwOText(text).replace(/[*_`~]/g, '');
  const m = t.match(/caught\s+(?:a|an|the)\s+([A-Za-zÀ-ỹ]{2,40})/i)
    || t.match(/caught\s+([A-Za-zÀ-ỹ]{2,40})/i);
  return m ? m[1].trim() : '';
}

export function isQuestComplete(text) {
  const t = normalizeOwOText(text).toLowerCase();
  return /quest\b[^.]{0,40}\b(?:completed|complete|finished)\b/.test(t)
    || /\b(?:completed|finished)\b[^.]{0,20}\bquest\b/.test(t);
}

export function parseQuestSay(text) {
  const t = normalizeOwOText(text).toLowerCase();
  if (!t.includes('quest')) return false;
  return /say\s*['"`]?owo['"`]?/.test(t);
}

const GEM_RARITY = ['f', 'l', 'm', 'e', 'r', 'u', 'c'];

export function findClaimButton(components) {
  let found = null;
  const walk = (node) => {
    if (!node || found) return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    const raw = typeof node.toJSON === 'function' ? node.toJSON() : node;
    if (!raw || typeof raw !== 'object') return;
    if (raw.type === 2) {
      const label = String(raw.label || '').toLowerCase();
      if (label.includes('claim') && !raw.disabled) {
        found = raw.custom_id || raw.customId || null;
        return;
      }
    }
    if (raw.components) walk(raw.components);
  };
  walk(components);
  return found;
}

export function collectComponentText(components) {
  const parts = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    const raw = typeof node.toJSON === 'function' ? node.toJSON() : node;
    if (!raw || typeof raw !== 'object') return;
    if (typeof raw.content === 'string') parts.push(raw.content);
    if (raw.components) walk(raw.components);
  };
  walk(components);
  return parts.join('\n');
}

export function parseQuestLog(text) {
  const raw = normalizeOwOText(text);
  const low = raw.toLowerCase();
  const result = { found: false, allDone: false, untilMs: 0, quests: [] };
  if (!low.includes('quest')) return result;

  if (low.includes('you finished all of your quests')) {
    result.found = true;
    result.allDone = true;
    const t = raw.match(/<t:(\d{9,})/);
    result.untilMs = t ? Number(t[1]) * 1000 + 60000 : Date.now() + 12 * 3600000;
    return result;
  }

  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    let key = '';
    for (const [k, words] of QUEST_PATTERNS) {
      if (words.some((w) => line.includes(w))) {
        key = k;
        break;
      }
    }
    if (!key) continue;
    if (result.quests.some((q) => q.key === key)) continue;
    // Tiến độ có thể nằm ngay trên dòng nhãn ("Gamble 2/5") hoặc vài dòng dưới;
    // cho phép backtick/markdown chen giữa số và dấu "/".
    for (let j = i; j < Math.min(i + 6, lines.length); j++) {
      const m = lines[j].match(/(\d{1,7})[\s`*_|]*\/[\s`*_|]*(\d{1,7})/);
      if (m) {
        result.quests.push({
          key,
          label: QUEST_LABELS[key] || key,
          current: Number(m[1]),
          total: Number(m[2]),
        });
        break;
      }
    }
  }
  // Chỉ coi là quest log khi đọc được ít nhất một quest có tiến độ;
  // câu nhắc "say owo" đơn lẻ vẫn để luồng fallback xử lý.
  result.found = result.quests.length > 0;
  return result;
}

export function parseGemSlots(text) {
  const raw = normalizeOwOText(text);
  const best = new Map();
  const re = /`?(\d+)`?\s*<a?:([a-z])gem([1-4]):\d+>/gi;
  let m;
  while ((m = re.exec(raw))) {
    const slot = m[1];
    const rarity = m[2].toLowerCase();
    const tier = m[3];
    if (!GEM_RARITY.includes(rarity)) continue;
    const rank = GEM_RARITY.indexOf(rarity);
    const cur = best.get(tier);
    if (!cur || rank < cur.rank) best.set(tier, { slot, rank });
  }
  return [...best.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, v]) => v.slot);
}

export function findFightButton(components) {
  let found = null;
  const walk = (node) => {
    if (!node || found) return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    const raw = typeof node.toJSON === 'function' ? node.toJSON() : node;
    if (!raw || typeof raw !== 'object') return;
    if (raw.type === 2) {
      const label = String(raw.label || '').toLowerCase();
      const cid = String(raw.custom_id || raw.customId || '').toLowerCase();
      if ((label.includes('fight') || cid.includes('fight')) && !raw.disabled) {
        found = raw.custom_id || raw.customId || null;
        return;
      }
    }
    if (raw.components) walk(raw.components);
  };
  walk(components);
  return found;
}

export function collectOwOText(msg) {
  const parts = [msg?.content || ''];
  for (const e of msg?.embeds || []) {
    const raw = typeof e.toJSON === 'function' ? e.toJSON() : e;
    for (const v of [raw?.title, raw?.description, raw?.footer?.text, raw?.author?.name]) {
      if (v) parts.push(v);
    }
    for (const f of raw?.fields || []) parts.push(f.name || '', f.value || '');
  }
  const comp = collectComponentText(msg?.components);
  if (comp) parts.push(comp);
  return normalizeOwOText(parts.join('\n'));
}

/**
 * Lấy URL ảnh captcha từ message để người dùng mở ra giải tay.
 *
 * OwO đính kèm ảnh captcha qua attachment hoặc embed image; đôi khi chỉ có
 * URL nằm trong field của embed. Ta thu thập mọi ứng viên rồi trả về cái đầu
 * tiên — mục đích chỉ là đưa link lên panel, không phải tự động đọc ảnh.
 */
export function extractCaptchaUrl(msg) {
  const candidates = [];

  const push = (value) => {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) candidates.push(value);
  };

  const attachments = msg?.attachments;
  const attachList = attachments?.values ? [...attachments.values()] : (attachments || []);
  for (const a of attachList) push(a?.url);

  for (const e of msg?.embeds || []) {
    const raw = typeof e.toJSON === 'function' ? e.toJSON() : e;
    push(raw?.image?.url);
    push(raw?.thumbnail?.url);
    push(raw?.url);
    for (const f of raw?.fields || []) {
      const m = String(f?.value ?? '').match(/https?:\/\/[^\s)>"'\\]+/i);
      if (m) push(m[0]);
    }
  }

  return candidates[0] || '';
}

export function createOwO({ config, logger, file, getClient, getPeers = () => [] }) {
  const log = logger;
  const baseCfg = isPlainObject(config?.owo) ? config.owo : {};
  const antiCfg = isPlainObject(config?.antiDetection) ? config.antiDetection : {};

  // Bộ nhịp: điều tiết tốc độ lệnh, cửa sổ giờ hoạt động, chu kỳ làm/nghỉ.
  // Cửa sổ và chu kỳ mặc định tắt — bật lên thì bot có nhịp thở, giống người
  // dùng máy chứ không phải một tiến trình gửi lệnh đều đặn 24/7.
  const activityWindow = createActivityWindow(antiCfg.activityWindow);
  const workCycle = createWorkCycle(antiCfg.workCycle);
  const pacer = createPacer({
    gapMinMs: Math.max(SEND_GAP_MS, antiCfg.commandGapMinMs ?? SEND_GAP_MS),
    gapMaxMs: Math.max(SEND_GAP_MS, antiCfg.commandGapMaxMs ?? 4500),
    windowMs: antiCfg.budgetWindowMs ?? 60000,
    maxPerWindow: antiCfg.budgetMaxCommands ?? 20,
  });

  // Nhịp gửi giờ nằm trong khoảng [min, max] mà cậu khai trong panel nên các
  // nút "interval spread"/"long pause" cũ không còn tác dụng.
  const captchaCooldownMs = antiCfg.captchaCooldownMs ?? DEFAULT_CAPTCHA_COOLDOWN_MS;

  const state = {
    running: false,
    paused: '',
    pausedAt: 0,
    lastError: '',
    lastSentAt: 0,
    nextAt: { hunt: 0, quest: 0, gem: 0, train: 0, roll: 0, daily: 0 },
    counters: {
      commands: 0,
      hunts: 0,
      quests: 0,
      gemChecks: 0,
      gemsUsed: 0,
      bossClicks: 0,
      catches: 0,
      questsDone: 0,
      captchaStops: 0,
      warnings: 0,
      claims: 0,
      questActions: 0,
      trains: 0,
      rolls: 0,
      dailies: 0,
    },
    quests: [],
    questsAllDone: false,
    questsUntil: 0,
    events: [],
  };

  const timers = new Map();
  let huntCursor = 0;
  let lastSendAt = 0;
  let lastOwoSayAt = 0;
  let pendingInventoryAt = 0;
  let pendingInventoryChannel = '';
  let activeChannelId = '';
  let questBusy = false;
  let lastQuestFetchAt = 0;
  let battleBusy = false;
  let gambleFlip = false;
  let pendingQuestRefetchAt = 0;
  const questCooldowns = new Map();
  const clickedMessages = new Set();

  /**
   * Chuẩn hoá cài đặt một module: giữ khoảng thời gian dạng [min, max].
   * Cài cũ chỉ có `intervalMs` — coi như một mốc cố định cho cả hai đầu.
   */
  function sanitizeFeature(name, raw, fallback) {
    const src = isPlainObject(raw) ? raw : {};
    const fb = isPlainObject(fallback) ? fallback : OWO_DEFAULTS[name] || {};

    let minMs = Number.parseInt(src.minMs, 10);
    let maxMs = Number.parseInt(src.maxMs, 10);

    if (!Number.isFinite(minMs) && !Number.isFinite(maxMs)) {
      const legacy = Number.parseInt(src.intervalMs, 10);
      if (Number.isFinite(legacy)) {
        minMs = legacy;
        maxMs = legacy;
      }
    }

    if (!Number.isFinite(minMs)) {
      minMs = Number.parseInt(fb.minMs, 10);
      if (!Number.isFinite(minMs)) minMs = MIN_INTERVAL;
    }
    if (!Number.isFinite(maxMs)) {
      maxMs = Number.parseInt(fb.maxMs, 10);
      if (!Number.isFinite(maxMs)) maxMs = minMs;
    }

    minMs = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, minMs));
    maxMs = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, maxMs));
    if (maxMs < minMs) maxMs = minMs;

    return {
      enabled: typeof src.enabled === 'boolean' ? src.enabled : !!fb.enabled,
      minMs,
      maxMs,
    };
  }

  function loadSettings() {
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    if (!isPlainObject(saved)) saved = {};
    const src = {
      ...baseCfg,
      ...saved,
      hunt: { ...(baseCfg.hunt || {}), ...(saved.hunt || {}) },
      quest: { ...(baseCfg.quest || {}), ...(saved.quest || {}) },
      gem: { ...(baseCfg.gem || {}), ...(saved.gem || {}) },
      boss: { ...(baseCfg.boss || {}), ...(saved.boss || {}) },
      train: { ...(baseCfg.train || {}), ...(saved.train || {}) },
      roll: { ...(baseCfg.roll || {}), ...(saved.roll || {}) },
      daily: { ...(baseCfg.daily || {}), ...(saved.daily || {}) },
    };
    const channelIds = Array.isArray(src.channelIds)
      ? [...new Set(src.channelIds.map(String).filter((id) => /^\d{17,20}$/.test(id)))]
      : [];
    return {
      enabled: typeof saved.enabled === 'boolean' ? saved.enabled : !!src.enabled,
      paused: typeof saved.paused === 'string' ? saved.paused : '',
      // Lưu cả thời điểm dính captcha để hạ nghỉ còn hiệu lực sau cả khi
      // restart tiến trình — nếu không, bot lại lao vào captcha ngay khi bật.
      captchaAt: Number.isFinite(Number(saved.captchaAt)) ? Number(saved.captchaAt) : 0,
      captchaUrl: typeof saved.captchaUrl === 'string' ? saved.captchaUrl : '',
      channelIds,
      hunt: sanitizeFeature('hunt', src.hunt, OWO_DEFAULTS.hunt),
      quest: sanitizeFeature('quest', src.quest, OWO_DEFAULTS.quest),
      gem: sanitizeFeature('gem', src.gem, OWO_DEFAULTS.gem),
      boss: { enabled: typeof src.boss.enabled === 'boolean' ? src.boss.enabled : OWO_DEFAULTS.boss.enabled },
      train: sanitizeFeature('train', src.train, OWO_DEFAULTS.train),
      roll: sanitizeFeature('roll', src.roll, OWO_DEFAULTS.roll),
      daily: sanitizeFeature('daily', src.daily, OWO_DEFAULTS.daily),
    };
  }

  let settings = loadSettings();

  function saveSettings() {
    const data = {
      enabled: settings.enabled,
      paused: state.paused,
      captchaAt: settings.captchaAt,
      captchaUrl: settings.captchaUrl,
      channelIds: settings.channelIds,
      hunt: settings.hunt,
      quest: settings.quest,
      gem: settings.gem,
      boss: settings.boss,
      train: settings.train,
      roll: settings.roll,
      daily: settings.daily,
    };
    // Ghi atomic (tmp + rename, quyền 600) — hỏng giữa chừng không mất state cũ
    if (!writeJson(file, data)) {
      log.debug('OwO save: không ghi được file state');
    }
  }

  function event(kind, text) {
    state.events.push({ at: Date.now(), kind, text });
    if (state.events.length > 12) state.events.splice(0, state.events.length - 12);
  }

  function clearTimers() {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    state.nextAt = { hunt: 0, quest: 0, gem: 0, train: 0, roll: 0, daily: 0 };
  }

  function canRun() {
    return state.running && !state.paused;
  }

  function schedule(key, delayMs, fn) {
    const old = timers.get(key);
    if (old) clearTimeout(old);
    const t = setTimeout(() => {
      timers.delete(key);
      Promise.resolve().then(fn).catch((e) => log.debug(`OwO ${key}: ${e.message}`));
    }, Math.max(0, delayMs));
    timers.set(key, t);
  }

  /**
   * Khoảng chờ tới lần chạy kế tiếp: bốc ngẫu nhiên trong khoảng [min, max]
   * mà cậu khai trong panel.
   *
   * Mốc kế tiếp luôn tính từ lúc lệnh vừa gửi xong nên nhịp không bị trôi
   * ("lệch") dù có lệnh khác chen vào giữa — mỗi lần đều hẹn lại từ đầu.
   */
  function nextIntervalMs(feature) {
    const cfg = settings[feature] || {};
    const lo = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Number(cfg.minMs) || MIN_INTERVAL));
    const hi = Math.min(MAX_INTERVAL, Math.max(lo, Number(cfg.maxMs) || lo));
    if (hi <= lo) return lo;
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }

  /**
   * Đẩy một mốc chạy tới khoảng thời gian hợp lệ theo cửa sổ hoạt động và
   * chu kỳ làm/nghỉ. Mọi lịch đều đi qua đây để không có đường nào lách được
   * hai ràng buộc này.
   */
  function gateDelay(delayMs) {
    let delay = Math.max(0, delayMs);
    const now = Date.now();

    if (activityWindow.enabled) {
      const at = new Date(now);
      if (!activityWindow.isOpen(at)) {
        delay = Math.max(delay, activityWindow.msUntilOpen(at));
      } else {
        const close = activityWindow.closeAt(at);
        if (close && now + delay >= close) {
          // Lần chạy sắp tới rơi ra ngoài khung giờ → dời sang lần mở kế tiếp
          delay = Math.max(delay, activityWindow.msUntilOpen(new Date(close)));
        }
      }
    }

    if (workCycle.enabled && !workCycle.isWorking(now)) {
      delay = Math.max(delay, workCycle.msUntilWork(now));
    }

    return delay;
  }

  async function resolveChannel(preferId) {
    const client = getClient?.();
    if (!client?.user) throw new Error('Selfbot chưa đăng nhập');
    const ids = settings.channelIds;
    if (!ids.length) throw new Error('Chưa có channel farm — kiểm tra lại ID');
    const order = preferId ? [preferId, ...ids.filter((id) => id !== preferId)] : ids;
    for (const id of order) {
      const cached = client.channels?.cache?.get?.(id);
      if (cached?.send) return cached;
      try {
        const fetched = await client.channels.fetch(id);
        if (fetched?.send) return fetched;
      } catch {}
    }
    throw new Error('Không tìm thấy channel farm — kiểm tra lại ID');
  }

  // Hunt xoay vòng giữa các channel đã khai báo để farm được nhiều hơn.
  function nextHuntChannel() {
    const ids = settings.channelIds;
    if (!ids.length) return '';
    if (ids.length === 1) return ids[0];
    const id = ids[huntCursor % ids.length];
    huntCursor = (huntCursor + 1) % ids.length;
    return id;
  }

  async function sendCommand(text, channelId) {
    const ch = await resolveChannel(channelId);

    // Đang trong giờ nghỉ của chu kỳ làm việc thì không phát lệnh — scheduler
    // sẽ hẹn lại tới khi phiên làm việc kế tiếp bắt đầu.
    if (workCycle.enabled && !workCycle.isWorking(Date.now())) {
      const err = new Error('Đang trong giờ nghỉ — sẽ chạy lại khi vào phiên làm việc');
      err.code = 'OWO_WORK_CYCLE';
      throw err;
    }

    // Pacer giữ khoảng cách giữa hai lệnh và hạn mức lệnh theo cửa sổ.
    await pacer.acquire();

    await ch.send(text);
    lastSendAt = Date.now();
    activeChannelId = ch.id || activeChannelId;
    state.lastSentAt = lastSendAt;
    state.counters.commands += 1;
    state.lastError = '';
    log.debug(`OwO → ${text}`);
    return ch;
  }

  // Gửi lệnh hộ account khác (acc phụ giúp quest bạn bè)
  async function sendHelper(text, channelId) {
    const chId = channelId || settings.channelIds[0] || '';
    const client = getClient?.();
    if (!client?.user) throw new Error('Acc phụ chưa đăng nhập');
    let ch = client.channels?.cache?.get?.(chId);
    if (!ch?.send) {
      try { ch = await client.channels.fetch(chId); } catch {}
    }
    if (!ch?.send) throw new Error('Acc phụ không vào được channel farm');
    await pacer.acquire();
    const gap = SEND_GAP_MS - (Date.now() - lastSendAt);
    if (gap > 0) await sleep(gap);
    await ch.send(text);
    lastSendAt = Date.now();
    activeChannelId = ch.id || activeChannelId;
    state.lastSentAt = lastSendAt;
    state.counters.commands += 1;
    log.debug(`OwO (helper) → ${text}`);
    return ch;
  }

  function fail(e) {
    state.lastError = e?.message || String(e);
    log.warn(`OwO: ${state.lastError}`);
  }

  function scheduleHunt(delay = 1500) {
    if (!canRun() || !settings.hunt.enabled) return;
    const wait = gateDelay(delay);
    state.nextAt.hunt = Date.now() + wait;
    schedule('hunt', wait, async () => {
      if (!canRun() || !settings.hunt.enabled) return;
      try {
        await sendCommand('owo h', nextHuntChannel());
        state.counters.hunts += 1;
        scheduleHunt(nextIntervalMs('hunt'));
      } catch (e) {
        fail(e);
        if (getClient?.()?.user) scheduleHunt(gateDelay(30000));
        else pause('offline', 'Mất kết nối Discord — sẽ tự bật lại khi đăng nhập lại');
      }
    });
  }

  function scheduleQuest(delay = 3500) {
    if (!canRun() || !settings.quest.enabled) return;
    const wait = gateDelay(delay);
    state.nextAt.quest = Date.now() + wait;
    schedule('quest', wait, async () => {
      if (!canRun() || !settings.quest.enabled) return;
      try {
        await sendCommand('owo q');
        state.counters.quests += 1;
        let delay = nextIntervalMs('quest');
        if (pendingQuestRefetchAt) {
          const remain = pendingQuestRefetchAt - Date.now();
          // Đã trễ hẹn refetch (pacer/lệnh khác chen ngang) thì gửi bù sớm,
          // đừng nuốt mất lần refetch rồi chờ cả interval.
          delay = remain > 800 ? Math.min(delay, remain) : 1500;
          pendingQuestRefetchAt = 0;
        }
        scheduleQuest(delay);
      } catch (e) {
        fail(e);
        if (getClient?.()?.user) scheduleQuest(gateDelay(60000));
        else pause('offline', 'Mất kết nối Discord — sẽ tự bật lại khi đăng nhập lại');
      }
    });
  }

  function scheduleGem(delay = 6000) {
    if (!canRun() || !settings.gem.enabled) return;
    const wait = gateDelay(delay);
    state.nextAt.gem = Date.now() + wait;
    schedule('gem', wait, async () => {
      if (!canRun() || !settings.gem.enabled) return;
      try {
        const ch = await sendCommand('owo inventory');
        state.counters.gemChecks += 1;
        pendingInventoryAt = Date.now();
        pendingInventoryChannel = ch?.id || '';
        scheduleGem(nextIntervalMs('gem'));
      } catch (e) {
        fail(e);
        if (getClient?.()?.user) scheduleGem(gateDelay(120000));
        else pause('offline', 'Mất kết nối Discord — sẽ tự bật lại khi đăng nhập lại');
      }
    });
  }

  function scheduleSimple(key, command, counter, delay, retryMs) {
    if (!canRun() || !settings[key]?.enabled) return;
    const wait = gateDelay(delay);
    state.nextAt[key] = Date.now() + wait;
    schedule(key, wait, async () => {
      if (!canRun() || !settings[key]?.enabled) return;
      try {
        await sendCommand(command);
        state.counters[counter] += 1;
        scheduleSimple(key, command, counter, nextIntervalMs(key), retryMs);
      } catch (e) {
        fail(e);
        if (getClient?.()?.user) scheduleSimple(key, command, counter, gateDelay(retryMs), retryMs);
        else pause('offline', 'Mất kết nối Discord — sẽ tự bật lại khi đăng nhập lại');
      }
    });
  }

  function scheduleAll(keep = false) {
    const now = Date.now();
    const rem = (key, def) => (keep && state.nextAt[key] ? Math.max(800, state.nextAt[key] - now) : def);
    const huntDelay = rem('hunt', 1500);
    const questDelay = rem('quest', 3500);
    const gemDelay = rem('gem', 6000);
    const trainDelay = rem('train', 8000);
    const rollDelay = rem('roll', 10000);
    const dailyDelay = rem('daily', 12000);
    clearTimers();
    scheduleHunt(huntDelay);
    scheduleQuest(questDelay);
    scheduleGem(gemDelay);
    scheduleSimple('train', 'owo train', 'trains', trainDelay, 120000);
    scheduleSimple('roll', 'owo roll', 'rolls', rollDelay, 120000);
    scheduleSimple('daily', 'owo daily', 'dailies', dailyDelay, 300000);
  }

  function start() {
    if (!getClient?.()?.user) return { ok: false, error: 'Selfbot chưa đăng nhập' };
    if (state.running && !state.paused) return { ok: true, message: 'Farm OwO đang chạy' };
    if (!settings.channelIds.length) {
      return { ok: false, error: 'Chưa có channel farm — thêm channel ID trước (tab OwO hoặc .owo channel add <id>)' };
    }
    const anyModule = FEATURE_NAMES.some((name) => settings[name]?.enabled) || settings.boss.enabled;
    if (!anyModule) {
      return { ok: false, error: 'Chưa bật module nào (hunt/quest/gem/train/roll/daily/boss)' };
    }

    // Hạ nghỉ sau captcha: đợi người dùng giải tay và để bot nằm yên một lúc
    // trước khi chạy lại. Bật lại tức thì chỉ là đâm vào cùng cái bẫy lần hai.
    if (settings.paused === 'captcha' && settings.captchaAt) {
      const elapsed = Date.now() - settings.captchaAt;
      if (elapsed < captchaCooldownMs) {
        const remain = Math.ceil((captchaCooldownMs - elapsed) / 1000);
        return { ok: false, error: `Còn ${remain}s hạ nghỉ sau captcha — giải tay xong hãy bật lại` };
      }
    }
    state.running = true;
    state.paused = '';
    state.pausedAt = 0;
    state.lastError = '';
    settings.enabled = true;
    saveSettings();
    scheduleAll();
    event('start', 'Bắt đầu farm');
    log.cmd(`OwO: farm ON · channel ${settings.channelIds.join(', ')}`);
    return { ok: true, message: 'Đã bật farm OwO' };
  }

  function stop(reason = '') {
    clearTimers();
    pendingQuestRefetchAt = 0;
    state.running = false;
    state.paused = '';
    state.pausedAt = 0;
    settings.enabled = false;
    pendingInventoryAt = 0;
    saveSettings();
    event('stop', reason ? `Dừng: ${reason}` : 'Đã tắt farm');
    log.cmd(`OwO: farm OFF${reason ? ` (${reason})` : ''}`);
    return { ok: true, message: 'Đã tắt farm OwO' };
  }

  function pause(reason, detail = '', extra = {}) {
    clearTimers();
    pendingQuestRefetchAt = 0;
    state.running = false;
    state.paused = reason;
    state.pausedAt = Date.now();
    pendingInventoryAt = 0;
    if (reason === 'captcha') {
      settings.captchaAt = state.pausedAt;
      if (extra.url) settings.captchaUrl = extra.url;
    }
    saveSettings();
    event('pause', detail || `Tạm dừng: ${reason}`);
    log.error(`OwO: DỪNG — ${detail || reason}. Giải captcha/kiểm tra xong rồi bật lại.`);
  }

  function autoStart() {
    if (!settings.enabled) return { ok: false, error: 'disabled' };
    if (settings.paused === 'captcha' || settings.paused === 'warning') {
      state.paused = settings.paused;
      state.pausedAt = Date.now();
      log.warn(`OwO: không tự bật lại (đang khoá vì ${settings.paused}) — mở panel bật tay khi đã xử lý xong`);
      return { ok: false, error: `paused:${settings.paused}` };
    }
    return start();
  }

  function setSettings(patch = {}) {
    if (Array.isArray(patch.channelIds)) {
      const ids = patch.channelIds.flatMap((v) => extractChannelIds(v));
      settings.channelIds = [...new Set(ids)];
    }
    for (const name of FEATURE_NAMES) {
      if (!isPlainObject(patch[name])) continue;
      const merged = { ...settings[name], ...patch[name] };
      // Bản cũ (panel vanilla, lệnh .owo) gửi intervalMs — coi như một mốc
      // cố định khi không có min/max.
      if (patch[name].intervalMs !== undefined
        && patch[name].minMs === undefined
        && patch[name].maxMs === undefined) {
        merged.minMs = patch[name].intervalMs;
        merged.maxMs = patch[name].intervalMs;
      }
      settings[name] = sanitizeFeature(name, merged, settings[name]);
    }
    if (isPlainObject(patch.boss) && typeof patch.boss.enabled === 'boolean') {
      settings.boss.enabled = patch.boss.enabled;
    }
    saveSettings();
    if (state.running) scheduleAll(true);
    return getState();
  }

  async function clickBoss(msg, customId) {
    if (clickedMessages.has(msg.id)) return;
    clickedMessages.add(msg.id);
    if (clickedMessages.size > 200) clickedMessages.clear();
    try {
      await msg.clickButton(customId);
      state.counters.bossClicks += 1;
      event('boss', 'Đã bấm Fight boss');
      log.cmd('OwO: bấm Fight boss');
    } catch (e) {
      state.lastError = e?.message || String(e);
      log.warn(`OwO boss: ${state.lastError}`);
    }
  }

  function requestQuestRefetch(ms = 6000) {
    const at = Date.now() + Math.max(1000, ms);
    if (!pendingQuestRefetchAt || at < pendingQuestRefetchAt) pendingQuestRefetchAt = at;
    if (!canRun() || !settings.quest.enabled) return;
    if (state.nextAt.quest && state.nextAt.quest <= pendingQuestRefetchAt) return;
    scheduleQuest(Math.max(800, pendingQuestRefetchAt - Date.now()));
  }

  // Đọc quest log ngay từ panel (không đợi tới nhịp 5 phút).
  async function refetchQuests() {
    if (!canRun()) return { ok: false, error: 'Farm đang tắt — bật farm trước' };
    if (!settings.quest.enabled) return { ok: false, error: 'Module quest đang tắt' };
    const wait = 10000 - (Date.now() - lastQuestFetchAt);
    if (wait > 0) return { ok: false, error: `Vừa đọc quest log — đợi ${Math.ceil(wait / 1000)}s` };
    lastQuestFetchAt = Date.now();
    try {
      await sendCommand('owo q');
      state.counters.quests += 1;
      return { ok: true, message: 'Đã gửi owo q — quest log về trong vài giây' };
    } catch (e) {
      lastQuestFetchAt = 0;
      return { ok: false, error: e?.message || String(e) };
    }
  }

  // Chạy các quest đang sẵn sàng; quest còn cooldown thì để auto chạy tiếp.
  async function runQuestsNow() {
    if (!canRun()) return { ok: false, error: 'Farm đang tắt — bật farm trước' };
    if (!settings.quest.enabled) return { ok: false, error: 'Module quest đang tắt' };
    if (!state.quests.length) return { ok: false, error: 'Chưa đọc quest log — bấm "Đọc quest log" trước' };
    if (state.questsAllDone) return { ok: false, error: 'Đã xong hết quest — chờ quest mới' };
    if (questBusy) return { ok: false, error: 'Đang chạy quest rồi' };
    const now = Date.now();
    const todo = state.quests.filter((q) => q.current < q.total && now >= (questCooldowns.get(q.key) || 0));
    if (!todo.length) return { ok: true, message: 'Mọi quest đang chờ cooldown — sẽ tự chạy tiếp' };
    void runQuests();
    return { ok: true, message: `Đang làm ${todo.length} quest` };
  }

  async function clickClaim(msg, customId) {
    if (!canRun()) return;
    const key = `claim:${msg.id}`;
    if (clickedMessages.has(key)) return;
    clickedMessages.add(key);
    if (clickedMessages.size > 300) clickedMessages.clear();
    try {
      await msg.clickButton(customId);
      state.counters.claims += 1;
      event('quest', 'Đã bấm Claim thưởng quest');
      log.cmd('OwO: claim quest');
      requestQuestRefetch(8000);
    } catch (e) {
      state.lastError = e?.message || String(e);
      log.warn(`OwO claim: ${state.lastError}`);
    }
  }

  function peerList() {
    try {
      return (getPeers?.() || []).filter((p) => p?.client?.user && p.owo?.sendHelper);
    } catch {
      return [];
    }
  }

  function pickAction() {
    return QUEST_ACTIONS[Math.floor(Math.random() * QUEST_ACTIONS.length)];
  }

  function markQuest(key, ms) {
    questCooldowns.set(key, Date.now() + (ms || QUEST_GAP_MS[key] || 120000));
  }

  function bumpQuest(key) {
    const q = state.quests.find((x) => x.key === key);
    if (!q) return;
    if (q.current < q.total) q.current += 1;
    state.counters.questActions += 1;
    if (q.current >= q.total) requestQuestRefetch(6000);
  }

  async function runQuestAction(q, peer, meId) {
    const key = q.key;
    const target = peer?.client?.user?.id || '';
    if (key === 'say_owo') {
      await sendCommand('owo');
      lastOwoSayAt = Date.now();
      markQuest(key);
      bumpQuest(key);
      return;
    }
    if (key === 'gamble') {
      gambleFlip = !gambleFlip;
      await sendCommand(`owo ${gambleFlip ? 'cf' : 's'} 1`);
      markQuest(key);
      bumpQuest(key);
      return;
    }
    if (key === 'send_action') {
      if (!target) return;
      await sendCommand(`owo ${pickAction()} <@${target}>`);
      markQuest(key);
      bumpQuest(key);
      return;
    }
    if (key === 'action_from_friend' || key === 'cookie' || key === 'curse' || key === 'prayer') {
      if (!peer) return;
      const cmd = key === 'cookie'
        ? 'owo rep'
        : key === 'curse'
          ? 'owo curse'
          : key === 'prayer'
            ? 'owo pray'
            : `owo ${pickAction()}`;
      await helperSend(peer, `${cmd} <@${meId}>`);
      markQuest(key);
      bumpQuest(key);
      return;
    }
    if (key === 'battle') {
      if (!target || battleBusy) return;
      battleBusy = true;
      try {
        await sendCommand(`owo b <@${target}>`);
        await sleep(4000);
        await helperSend(peer, 'owo ab');
        markQuest(key);
        bumpQuest(key);
      } finally {
        battleBusy = false;
      }
    }
  }

  async function helperSend(peer, text) {
    const channelId = activeChannelId || settings.channelIds[0] || '';
    if (!channelId) throw new Error('Chưa có channel farm');
    return peer.owo.sendHelper(text, channelId);
  }

  async function runQuests() {
    if (questBusy || !canRun() || !settings.quest.enabled) return;
    const meId = getClient?.()?.user?.id || '';
    questBusy = true;
    try {
      for (const q of state.quests) {
        if (!canRun() || !settings.quest.enabled) break;
        if (!q || q.current >= q.total) continue;
        if (Date.now() < (questCooldowns.get(q.key) || 0)) continue;
        if (q.key === 'say_owo' && Date.now() - lastOwoSayAt < OWO_SAY_GAP_MS) continue;
        const needsPeer = ['send_action', 'action_from_friend', 'cookie', 'curse', 'prayer', 'battle'].includes(q.key);
        const peer = needsPeer ? peerList()[0] : null;
        if (needsPeer && !peer) {
          questCooldowns.set(q.key, Date.now() + 60000);
          continue;
        }
        try {
          await runQuestAction(q, peer, meId);
          await sleep(300);
        } catch (e) {
          fail(e);
          markQuest(q.key);
        }
      }
    } finally {
      questBusy = false;
    }
  }

  function onMessage(msg) {
    if (!msg || msg.author?.id !== OWO_BOT_ID) return;
    const channelId = msg.channel?.id || '';
    if (!settings.channelIds.includes(channelId)) return;

    const haystack = collectOwOText(msg);
    if (!haystack) return;

    if (isCaptchaPrompt(haystack)) {
      state.counters.captchaStops += 1;
      const m = haystack.match(/\(\s*(\d)\s*\/\s*5\s*\)/);
      // Gom URL ảnh để panel/.owo status chỉ ra chỗ cần giải tay.
      pause(
        'captcha',
        `OwO yêu cầu captcha${m ? ` (${m[1]}/5)` : ''} — vào server giải tay rồi bật lại`,
        { url: extractCaptchaUrl(msg) },
      );
      return;
    }

    if (isWarning(haystack)) {
      state.counters.warnings += 1;
      pause('warning', 'OwO vừa cảnh báo — dừng ngay để tránh ăn thêm warning');
      return;
    }

    if (parseHuntCatch(haystack)) state.counters.catches += 1;
    if (isQuestComplete(haystack)) state.counters.questsDone += 1;

    const questLog = parseQuestLog(haystack);
    if (!questLog.found && parseQuestSay(haystack) && canRun() && Date.now() - lastOwoSayAt > OWO_SAY_GAP_MS) {
      lastOwoSayAt = Date.now();
      sendCommand('owo').catch(fail);
    }

    if (pendingInventoryAt && Date.now() - pendingInventoryAt < INVENTORY_WAIT_MS) {
      if (!pendingInventoryChannel || channelId === pendingInventoryChannel) {
        const slots = parseGemSlots(haystack);
        if (slots.length > 0) {
          pendingInventoryAt = 0;
          if (settings.gem.enabled && canRun()) {
            sendCommand(`owo use ${slots.join(' ')}`)
              .then(() => {
                state.counters.gemsUsed += slots.length;
                event('gem', `Dùng ${slots.length} gem (slot ${slots.join(', ')})`);
              })
              .catch(fail);
          }
        }
      }
    }

    if (settings.boss.enabled && canRun()) {
      const buttonId = findFightButton(msg.components);
      if (buttonId) clickBoss(msg, buttonId);
    }

    if (questLog.found) {
      const prevCount = state.quests.length;
      state.quests = questLog.quests.map((q) => ({ ...q }));
      state.questsAllDone = questLog.allDone;
      state.questsUntil = questLog.untilMs;
      if (questLog.allDone) {
        if (settings.quest.enabled && canRun()) {
          const delay = Math.max(60000, (questLog.untilMs || Date.now() + 12 * 3600000) - Date.now());
          pendingQuestRefetchAt = 0;
          scheduleQuest(delay);
        }
        event('quest', 'Xong hết quest — chờ quest mới');
      } else if (questLog.quests.length) {
        if (questLog.quests.length !== prevCount) {
          event('quest', `Quest log: ${questLog.quests.length} quest đang chạy`);
        }
      }
      const claimId = findClaimButton(msg.components);
      if (claimId) void clickClaim(msg, claimId);
    }
    if (state.quests.length && !state.questsAllDone) void runQuests();
  }

  function featureState(name) {
    const cfg = settings[name] || {};
    const minMs = Number(cfg.minMs) || 0;
    return {
      enabled: !!cfg.enabled,
      minMs,
      maxMs: Number(cfg.maxMs) || 0,
      // Panel cũ và lệnh chat vẫn đọc intervalMs — giữ lại cho khớp.
      intervalMs: minMs,
      nextAt: state.nextAt[name] || 0,
    };
  }

  function getState() {
    return {
      supported: true,
      enabled: state.running,
      paused: state.paused,
      pausedAt: state.pausedAt,
      channels: settings.channelIds.slice(),
      features: {
        hunt: featureState('hunt'),
        quest: featureState('quest'),
        gem: featureState('gem'),
        boss: { enabled: settings.boss.enabled },
        train: featureState('train'),
        roll: featureState('roll'),
        daily: featureState('daily'),
      },
      safe: OWO_SAFE,
      counters: { ...state.counters },
      quests: state.quests.map((q) => ({
        ...q,
        readyInMs: Math.max(0, (questCooldowns.get(q.key) || 0) - Date.now()),
      })),
      questsAllDone: state.questsAllDone,
      questsUntil: state.questsUntil,
      peers: peerList().length,
      peerNames: peerList().map((p) => p.client?.user?.username || p.id).slice(0, 5),
      lastError: state.lastError,
      lastSentAt: state.lastSentAt,
      captcha: {
        url: settings.captchaUrl,
        at: settings.captchaAt,
        cooldownRemainingMs: settings.captchaAt
          ? Math.max(0, captchaCooldownMs - (Date.now() - settings.captchaAt))
          : 0,
      },
      pacing: {
        pacer: pacer.snapshot(),
        activityWindow: {
          enabled: activityWindow.enabled,
          startHour: activityWindow.startHour,
          endHour: activityWindow.endHour,
          open: activityWindow.isOpen(new Date()),
          openUntil: activityWindow.closeAt(new Date()),
        },
        workCycle: workCycle.snapshot(Date.now()),
      },
      events: state.events.slice(-8),
      file,
      botId: OWO_BOT_ID,
    };
  }

  function dispose() {
    clearTimers();
    state.running = false;
  }

  return {
    start, stop, pause, autoStart, setSettings, getState, onMessage, dispose, sendHelper,
    refetchQuests, runQuestsNow, OWO_BOT_ID,
  };
}
