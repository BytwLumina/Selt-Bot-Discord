import fs from 'node:fs';

const DEFAULTS = {
  sessionMaxMinutes: 0,
  sessionWarnMinutes: 0,
  sessionAutoStop: true,
  sessionLogFile: 'session.log',
  dashboard: true,
  tokenEnv: 'DISCORD_TOKEN',

  status: {
    type: 'PLAYING',
    text: '',
  },

  commands: {
    prefix: '.',
    dmSelfEnabled: true,
    channelEnabled: true,
    consoleEnabled: true,
    rateLimit: {
      enabled: true,
      windowMs: 60000,
      maxCommands: 10,
      cooldownMs: 1500,
      ignoreDuplicateMs: 3000,
      silentOnLimit: true,
    },
  },

  typingDelay: {
    baseMinMs: 500,
    baseMaxMs: 1200,
    perCharMs: 15,
    maxMs: 3500,
    jitterMinMs: 0,
    jitterMaxMs: 800,
  },

  antiDetection: {
    reactDelayMinMs: 200,
    reactDelayMaxMs: 800,

    // Nhịp gửi lệnh — khoảng cách tối thiểu giữa hai lệnh và hạn mức lệnh
    // trong một cửa sổ thời gian.
    commandGapMinMs: 2500,
    commandGapMaxMs: 4500,
    budgetWindowMs: 60000,
    budgetMaxCommands: 20,

    // Nới rộng interval quanh giá trị cấu hình (0.15 = ±15%).
    intervalSpreadRatio: 0.15,

    // Khoảng nghỉ dài chèn ngẫu nhiên giữa các lần chạy.
    longPauseChance: 0.05,
    longPauseMinMs: 180000,
    longPauseMaxMs: 600000,

    // Khung giờ được phép chạy (0–23). startHour > endHour nghĩa là khung
    // vắt qua nửa đêm, ví dụ 22 → 6.
    activityWindow: {
      enabled: false,
      startHour: 8,
      endHour: 23,
    },

    // Chu kỳ làm việc / nghỉ ngơi (giờ).
    workCycle: {
      enabled: false,
      workMinHours: 3,
      workMaxHours: 5,
      breakMinHours: 8,
      breakMaxHours: 12,
      daySkipThreshold: 0,
      daySkipDurationHours: 24,
    },

    // Hạ nghỉ sau khi dính captcha — bot phải nằm yên chờ người giải tay.
    captchaCooldownMs: 300000,
  },

  voice: {
    autoReconnect: true,
    reconnectMaxAttempts: 3,
    selfDeaf: true,
    selfMute: false,
  },

  stream: {
    enabled: true,
    width: 640,
    height: 360,
    fps: 15,
    bitrateKbps: 1200,
    preset: 'faster',
    captureSource: '',
    captureCursor: true,
    cameraDevice: '',
    autoRestart: true,
    autoRestartMax: 5,
    autoRestartDelayMs: 10000,
    restoreVoice: true,
    recordDir: 'recordings',
  },

  afk: {
    cooldownMs: 60000,
    cooldownMode: 'per_user',
    maxReasonLen: 200,
    replyTemplate: 'Đang AFK: {reason} ({duration})',
    noReasonTemplate: 'Đang AFK — sẽ trả lời sau ({duration})',
    backTemplate: 'Đã trở lại — cảm ơn đã ping',
    reactEmoji: '💤',
    autoDisableOnActivity: true,
    announceBack: true,
    dmReply: false,
    ignoreBots: true,
    ignoreUsers: [],
    ignoreChannels: [],
    silentMode: false,
    persist: true,
  },

  owo: {
    enabled: false,
    channelIds: [],
    hunt: { enabled: true, minMs: 20000, maxMs: 45000 },
    quest: { enabled: true, minMs: 300000, maxMs: 600000 },
    gem: { enabled: false, minMs: 1800000, maxMs: 3600000 },
    boss: { enabled: false },
    train: { enabled: false, minMs: 600000, maxMs: 900000 },
    roll: { enabled: false, minMs: 300000, maxMs: 600000 },
    daily: { enabled: false, minMs: 3600000, maxMs: 7200000 },
  },

  web: {
    enabled: true,
    port: 8787,
  },

  accounts: {
    startDelayMs: 3000,
    startDelayJitterMs: 1500,
  },

  health: {
    enabled: true,
    intervalMs: 10000,
    graceMs: 90000,
    restartSpacingMs: 1500,
    restartSpacingJitterMs: 750,
    backoffBaseMs: 5000,
    backoffMaxMs: 300000,
    backoffJitterRatio: 0.25,
  },

  debug: false,
};

const STREAM_PRESETS = new Set([
  'ultrafast', 'superfast', 'veryfast', 'faster',
  'fast', 'medium', 'slow', 'slower', 'veryslow',
]);

const STATUS_TYPES = new Set(['PLAYING', 'STREAMING', 'LISTENING', 'WATCHING', 'CUSTOM', 'COMPETING']);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = clone(v);
    return out;
  }
  return value;
}

function merge(base, override) {
  if (!isPlainObject(override)) return clone(base);
  const out = clone(base);
  for (const [k, v] of Object.entries(override)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? merge(out[k], v) : clone(v);
  }
  return out;
}

function intIn(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Giữ nguyên phần thập — dùng cho tỉ lệ, intIn sẽ làm tròn mất.
function numIn(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function boolOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function stringOr(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

function ensureEven(n) {
  return n % 2 === 0 ? n : n - 1;
}

function validate(config, warnings) {
  const warn = (msg) => warnings.push(msg);

  for (const key of ['status', 'commands', 'typingDelay', 'antiDetection', 'voice', 'stream', 'afk', 'owo', 'web', 'accounts', 'health']) {
    if (!isPlainObject(config[key])) {
      config[key] = clone(DEFAULTS[key]);
      warn(`${key} phải là object — dùng mặc định`);
    }
  }
  if (!isPlainObject(config.commands.rateLimit)) {
    config.commands.rateLimit = clone(DEFAULTS.commands.rateLimit);
    warn('commands.rateLimit phải là object — dùng mặc định');
  }

  const maxMin = intIn(config.sessionMaxMinutes, DEFAULTS.sessionMaxMinutes, 0, 24 * 60);
  if (maxMin !== config.sessionMaxMinutes) warn(`sessionMaxMinutes không hợp lệ — dùng ${maxMin}`);
  config.sessionMaxMinutes = maxMin;

  let warnMin = intIn(config.sessionWarnMinutes, DEFAULTS.sessionWarnMinutes, 0, 24 * 60);
  if (warnMin >= maxMin) warnMin = Math.max(0, maxMin - 1);
  if (warnMin !== config.sessionWarnMinutes) warn(`sessionWarnMinutes không hợp lệ — dùng ${warnMin}`);
  config.sessionWarnMinutes = warnMin;

  config.sessionAutoStop = boolOr(config.sessionAutoStop, DEFAULTS.sessionAutoStop);
  config.sessionLogFile = stringOr(config.sessionLogFile, DEFAULTS.sessionLogFile).trim() || DEFAULTS.sessionLogFile;
  config.dashboard = boolOr(config.dashboard, DEFAULTS.dashboard);
  config.tokenEnv = stringOr(config.tokenEnv, DEFAULTS.tokenEnv).trim();
  config.debug = boolOr(config.debug, DEFAULTS.debug);

  const status = config.status;
  status.type = String(status.type || 'PLAYING').toUpperCase();
  if (!STATUS_TYPES.has(status.type)) {
    warn(`status.type "${status.type}" không hợp lệ — dùng PLAYING`);
    status.type = 'PLAYING';
  }
  status.text = String(status.text ?? '').slice(0, 128);

  const cmd = config.commands;
  cmd.prefix = stringOr(cmd.prefix, DEFAULTS.commands.prefix);
  if (!cmd.prefix) {
    warn('commands.prefix rỗng — dùng "."');
    cmd.prefix = '.';
  }
  cmd.dmSelfEnabled = boolOr(cmd.dmSelfEnabled, true);
  cmd.channelEnabled = boolOr(cmd.channelEnabled, true);
  cmd.consoleEnabled = boolOr(cmd.consoleEnabled, true);

  const rl = cmd.rateLimit;
  rl.enabled = boolOr(rl.enabled, true);
  rl.windowMs = intIn(rl.windowMs, 60000, 1000, 60 * 60 * 1000);
  rl.maxCommands = intIn(rl.maxCommands, 10, 1, 1000);
  rl.cooldownMs = intIn(rl.cooldownMs, 1500, 0, 60 * 60 * 1000);
  rl.ignoreDuplicateMs = intIn(rl.ignoreDuplicateMs, 3000, 0, 60 * 60 * 1000);
  rl.silentOnLimit = boolOr(rl.silentOnLimit, true);

  const td = config.typingDelay;
  td.baseMinMs = intIn(td.baseMinMs, 500, 0, 60000);
  td.baseMaxMs = intIn(td.baseMaxMs, 1200, td.baseMinMs, 60000);
  td.perCharMs = intIn(td.perCharMs, 15, 0, 1000);
  td.maxMs = intIn(td.maxMs, 3500, 0, 60000);
  td.jitterMinMs = intIn(td.jitterMinMs, 0, 0, 60000);
  td.jitterMaxMs = intIn(td.jitterMaxMs, 800, td.jitterMinMs, 60000);

  const anti = config.antiDetection;
  anti.reactDelayMinMs = intIn(anti.reactDelayMinMs, 200, 0, 60000);
  anti.reactDelayMaxMs = intIn(anti.reactDelayMaxMs, 800, anti.reactDelayMinMs, 60000);
  anti.commandGapMinMs = intIn(anti.commandGapMinMs, 2500, 0, 3600000);
  anti.commandGapMaxMs = intIn(anti.commandGapMaxMs, 4500, anti.commandGapMinMs, 3600000);
  anti.budgetWindowMs = intIn(anti.budgetWindowMs, 60000, 1000, 3600000);
  anti.budgetMaxCommands = intIn(anti.budgetMaxCommands, 20, 1, 10000);
  anti.intervalSpreadRatio = numIn(anti.intervalSpreadRatio, 0.15, 0, 0.9);
  anti.longPauseChance = numIn(anti.longPauseChance, 0.05, 0, 1);
  anti.longPauseMinMs = intIn(anti.longPauseMinMs, 180000, 0, 86400000);
  anti.longPauseMaxMs = intIn(anti.longPauseMaxMs, 600000, anti.longPauseMinMs, 86400000);
  anti.captchaCooldownMs = intIn(anti.captchaCooldownMs, 300000, 0, 86400000);

  if (!isPlainObject(anti.activityWindow)) {
    anti.activityWindow = clone(DEFAULTS.antiDetection.activityWindow);
    warn('antiDetection.activityWindow phải là object — dùng mặc định');
  }
  const aw = anti.activityWindow;
  aw.enabled = boolOr(aw.enabled, false);
  aw.startHour = intIn(aw.startHour, 8, 0, 23);
  aw.endHour = intIn(aw.endHour, 23, 0, 23);

  if (!isPlainObject(anti.workCycle)) {
    anti.workCycle = clone(DEFAULTS.antiDetection.workCycle);
    warn('antiDetection.workCycle phải là object — dùng mặc định');
  }
  const wc = anti.workCycle;
  wc.enabled = boolOr(wc.enabled, false);
  wc.workMinHours = numIn(wc.workMinHours, 3, 0.1, 24);
  wc.workMaxHours = numIn(wc.workMaxHours, 5, wc.workMinHours, 24);
  wc.breakMinHours = numIn(wc.breakMinHours, 8, 0.1, 24);
  wc.breakMaxHours = numIn(wc.breakMaxHours, 12, wc.breakMinHours, 24);
  wc.daySkipThreshold = intIn(wc.daySkipThreshold, 0, 0, 100);
  wc.daySkipDurationHours = numIn(wc.daySkipDurationHours, 24, 1, 168);

  const voice = config.voice;
  voice.autoReconnect = boolOr(voice.autoReconnect, true);
  voice.reconnectMaxAttempts = intIn(voice.reconnectMaxAttempts, 3, 0, 20);
  voice.selfDeaf = boolOr(voice.selfDeaf, true);
  voice.selfMute = boolOr(voice.selfMute, false);

  const stream = config.stream;
  stream.enabled = boolOr(stream.enabled, true);
  stream.width = ensureEven(intIn(stream.width, 1280, 320, 2560));
  stream.height = ensureEven(intIn(stream.height, 720, 240, 1440));
  stream.fps = intIn(stream.fps, 30, 1, 60);
  stream.bitrateKbps = intIn(stream.bitrateKbps, 2500, 500, 8000);
  stream.preset = String(stream.preset || 'faster').toLowerCase();
  if (!STREAM_PRESETS.has(stream.preset)) {
    warn(`stream.preset "${stream.preset}" không hợp lệ — dùng faster`);
    stream.preset = 'faster';
  }
  stream.captureSource = stringOr(stream.captureSource, '');
  stream.cameraDevice = stringOr(stream.cameraDevice, '');
  stream.autoRestart = boolOr(stream.autoRestart, true);
  stream.autoRestartMax = intIn(stream.autoRestartMax, 5, 0, 20);
  stream.autoRestartDelayMs = intIn(stream.autoRestartDelayMs, 10000, 3000, 600000);
  stream.captureCursor = boolOr(stream.captureCursor, true);
  stream.restoreVoice = boolOr(stream.restoreVoice, true);
  stream.recordDir = stringOr(stream.recordDir, 'recordings');

  const afk = config.afk;
  afk.cooldownMs = intIn(afk.cooldownMs, 60000, 0, 24 * 60 * 60 * 1000);
  afk.cooldownMode = ['per_user', 'global', 'none'].includes(afk.cooldownMode)
    ? afk.cooldownMode
    : 'per_user';
  afk.maxReasonLen = intIn(afk.maxReasonLen, 200, 1, 1000);
  afk.replyTemplate = stringOr(afk.replyTemplate, DEFAULTS.afk.replyTemplate);
  afk.noReasonTemplate = stringOr(afk.noReasonTemplate, DEFAULTS.afk.noReasonTemplate);
  afk.backTemplate = stringOr(afk.backTemplate, DEFAULTS.afk.backTemplate);
  afk.reactEmoji = String(afk.reactEmoji ?? '');
  afk.autoDisableOnActivity = boolOr(afk.autoDisableOnActivity, true);
  afk.announceBack = boolOr(afk.announceBack, true);
  afk.dmReply = boolOr(afk.dmReply, false);
  afk.ignoreBots = boolOr(afk.ignoreBots, true);
  afk.ignoreUsers = Array.isArray(afk.ignoreUsers) ? afk.ignoreUsers.map(String) : [];
  afk.ignoreChannels = Array.isArray(afk.ignoreChannels) ? afk.ignoreChannels.map(String) : [];
  afk.silentMode = boolOr(afk.silentMode, false);
  afk.persist = boolOr(afk.persist, true);

  const owo = config.owo;
  owo.enabled = boolOr(owo.enabled, false);
  owo.channelIds = Array.isArray(owo.channelIds)
    ? [...new Set(owo.channelIds.map(String).filter((id) => /^\d{17,20}$/.test(id)))]
    : [];
  for (const name of ['hunt', 'quest', 'gem']) {
    if (!isPlainObject(owo[name])) {
      owo[name] = clone(DEFAULTS.owo[name]);
      warn(`owo.${name} phải là object — dùng mặc định`);
    }
  }
  if (!isPlainObject(owo.boss)) owo.boss = clone(DEFAULTS.owo.boss);
  owo.boss.enabled = boolOr(owo.boss.enabled, false);

  const web = config.web;
  web.enabled = boolOr(web.enabled, true);
  web.port = intIn(web.port, 8787, 1024, 65535);

  const accounts = config.accounts;
  accounts.startDelayMs = intIn(accounts.startDelayMs, 3000, 0,  60000);
  accounts.startDelayJitterMs = intIn(accounts.startDelayJitterMs, 1500, 0, 60000);

  const health = config.health;
  health.enabled = boolOr(health.enabled, DEFAULTS.health.enabled);
  health.intervalMs = intIn(health.intervalMs, DEFAULTS.health.intervalMs, 2000, 600000);
  health.graceMs = intIn(health.graceMs, DEFAULTS.health.graceMs, 0, 900000);
  health.restartSpacingMs = intIn(health.restartSpacingMs, DEFAULTS.health.restartSpacingMs, 0, 60000);
  health.restartSpacingJitterMs = intIn(health.restartSpacingJitterMs, DEFAULTS.health.restartSpacingJitterMs, 0, 60000);
  health.backoffBaseMs = intIn(health.backoffBaseMs, DEFAULTS.health.backoffBaseMs, 500, 600000);
  health.backoffMaxMs = intIn(health.backoffMaxMs, DEFAULTS.health.backoffMaxMs, 1000, 3600000);
  health.backoffJitterRatio = numIn(health.backoffJitterRatio, DEFAULTS.health.backoffJitterRatio, 0, 1);

  return config;
}

export function loadConfig(file) {
  let rawText;
  try {
    rawText = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch (e) {
    throw new Error(e.code === 'ENOENT' ? `Không tìm thấy ${file}` : `Đọc ${file} fail: ${e.message}`);
  }

  let raw;
  try {
    raw = JSON.parse(rawText || '{}');
  } catch (e) {
    throw new Error(`${file} sai JSON: ${e.message}`);
  }

  if (!isPlainObject(raw)) throw new Error(`${file} phải là object`);

  const warnings = [];
  const config = validate(merge(DEFAULTS, raw), warnings);
  return { config, warnings };
}

export { DEFAULTS };
