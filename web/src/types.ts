// Kiểu dữ liệu dùng chung — khớp với payload của src/web.js

export interface ApiResult {
  ok: boolean;
  message?: string;
  error?: string;
}

export interface MsgState {
  kind: 'ok' | 'err';
  text: string;
}

export interface AccountUser {
  tag: string;
  id: string;
}

export interface AccountInfo {
  id: string;
  name: string;
  ready: boolean;
  error?: string | null;
  startedAt?: number;
  user?: AccountUser | null;
  restarts?: number;
  permanentError?: boolean;
}

export interface GuildChannel {
  id: string;
  name: string;
}

export interface Guild {
  id: string;
  name: string;
  channels: GuildChannel[];
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: number | string;
}

export interface SessionState {
  unlimited?: boolean;
  maxMs?: number;
  elapsed?: number;
  remaining?: number;
}

export interface StatsState {
  uptimeMs?: number;
  messagesReceived?: number;
  commandsExecuted?: number;
  commandsFailed?: number;
  voiceJoins?: number;
  streamStarts?: number;
  streamWatches?: number;
  afkPings?: number;
  afkReplies?: number;
  messagesDeleted?: number;
  errors?: number;
  [key: string]: number | undefined;
}

export interface HealthAccount {
  id: string;
  downMs?: number;
  restarts?: number;
}

export interface HealthState {
  enabled: boolean;
  intervalMs: number;
  graceMs: number;
  accounts?: HealthAccount[];
}

export interface VoiceState {
  connected?: boolean;
  connecting?: boolean;
  guildId?: string;
  channelId?: string;
  status?: string;
  reconnectAttempts?: number;
  lastError?: string;
}

export interface StreamConfigInfo {
  width?: number;
  height?: number;
  fps?: number;
  bitrateKbps?: number;
  captureSource?: string;
  cameraDevice?: string;
  preset?: string;
  autoRestart?: boolean;
  autoRestartMax?: number;
  autoRestartDelayMs?: number;
}

export interface StreamState {
  active?: boolean;
  starting?: boolean;
  paused?: boolean;
  startedAt?: number;
  viewerCount?: number;
  region?: string;
  guildId?: string;
  guildName?: string;
  channelId?: string;
  channelName?: string;
  lastError?: string;
  /** Đang chờ watchdog dựng lại stream */
  autoRestarting?: boolean;
  autoRestarts?: number;
  autoRestartMax?: number;
  config?: StreamConfigInfo;
}

export interface WatchState {
  active?: boolean;
  starting?: boolean;
  userId?: string;
  username?: string;
  guildId?: string;
  guildName?: string;
  channelName?: string;
  startedAt?: number;
  file?: string;
  lastError?: string;
}

export interface TopPinger {
  tag: string;
  count: number;
}

export interface AfkState {
  enabled?: boolean;
  reason?: string;
  setAt?: number;
  duration?: number;
  totalPings?: number;
  totalReplies?: number;
  silentMode?: boolean;
  reactEmoji?: string;
  topPingers?: TopPinger[];
}

export interface RpcState {
  enabled?: boolean;
  applied?: boolean;
  type?: string;
  name?: string;
  lastError?: string;
}

export interface QuestItem {
  key: string;
  label: string;
  current: number;
  total: number;
  readyInMs?: number;
}

export interface OwoFeature {
  enabled: boolean;
  minMs: number;
  maxMs: number;
  /** Cũ — panel cũ vẫn đọc. */
  intervalMs?: number;
  nextAt?: number;
}

export interface OwoSafeRange {
  minMs: number;
  maxMs: number;
}

export interface OwoEventItem {
  kind: string;
  text: string;
  at: number;
}

export interface OwoCounters {
  commands?: number;
  hunts?: number;
  quests?: number;
  gemChecks?: number;
  gemsUsed?: number;
  bossClicks?: number;
  catches?: number;
  questsDone?: number;
  claims?: number;
  questActions?: number;
  captchaStops?: number;
  warnings?: number;
  [key: string]: number | undefined;
}

export interface OwoState {
  supported?: boolean;
  enabled: boolean;
  paused?: string;
  pausedAt?: number;
  channels: string[];
  features: {
    hunt: OwoFeature;
    quest: OwoFeature;
    gem: OwoFeature;
    boss: { enabled: boolean };
    train?: OwoFeature;
    roll?: OwoFeature;
    daily?: OwoFeature;
  };
  safe?: Record<string, OwoSafeRange>;
  counters?: OwoCounters;
  quests?: QuestItem[];
  questsAllDone?: boolean;
  questsUntil?: number;
  peers?: number;
  peerNames?: string[];
  lastError?: string;
  lastSentAt?: number;
  captcha?: { url?: string; at?: number; cooldownRemainingMs?: number };
  events?: OwoEventItem[];
}

export interface RequestBucket {
  t: number;
  discord: number;
  owo: number;
  web: number;
}

export interface RequestsState {
  buckets?: RequestBucket[];
  totals?: { discord: number; owo: number; web: number };
}

export interface ConfigStream {
  enabled?: boolean;
  width?: number;
  height?: number;
  fps?: number;
  bitrateKbps?: number;
  preset?: string;
  captureSource?: string;
  cameraDevice?: string;
  captureCursor?: boolean;
  autoRestart?: boolean;
  autoRestartMax?: number;
  autoRestartDelayMs?: number;
}

export interface ConfigState extends ApiResult {
  path?: string;
  config?: { stream?: ConfigStream };
}

export interface Status extends ApiResult {
  now?: number;
  account?: { id: string; name: string } | null;
  accounts: AccountInfo[];
  focusedId?: string | null;
  loggedIn: boolean;
  user?: AccountUser | null;
  ping: number;
  guildCount: number;
  stats?: StatsState | null;
  session?: SessionState | null;
  health?: HealthState | null;
  voice?: VoiceState;
  stream?: StreamState;
  watch?: WatchState;
  afk?: AfkState;
  rpc?: RpcState;
  owo?: OwoState | null;
  requests?: RequestsState;
}

export interface Streamer {
  id: string;
  name: string;
  channelId: string;
  channelName: string;
  camera?: boolean;
}

export interface WhoResult extends ApiResult {
  guildId?: string;
  guildName?: string;
  streamers?: Streamer[];
}

export interface SnipeEntry {
  authorTag?: string;
  content?: string;
  oldContent?: string;
  newContent?: string;
  deletedAt?: number;
  editedAt?: number;
  guildId?: string;
  channelId?: string;
  messageId?: string;
}

export interface SnipeResult extends ApiResult {
  deleted?: SnipeEntry[];
  edited?: SnipeEntry[];
}

export interface LogEntry {
  n: number;
  line: string;
}

export interface LogsResult extends ApiResult {
  cursor?: number;
  lines?: LogEntry[];
}

export interface RpcConfig {
  enabled?: boolean;
  applyOnReady?: boolean;
  hotReload?: boolean;
  templates?: boolean;
  refreshInterval?: number;
  status?: string;
  application_id?: string;
  application_name?: string;
  type?: string;
  details?: string;
  state?: string;
  stream_url?: string;
  party_current?: number;
  party_max?: number;
  party_id?: string;
  large_image?: string;
  large_text?: string;
  small_image?: string;
  small_text?: string;
  button1_label?: string;
  button1_url?: string;
  button2_label?: string;
  button2_url?: string;
  timestamp_mode?: string;
  start_timestamp?: string | number;
  end_timestamp?: string | number;
  [key: string]: unknown;
}

export type Tab = 'overview' | 'media' | 'afk' | 'owo' | 'rpc' | 'snipe' | 'log' | 'settings';
