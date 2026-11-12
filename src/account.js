import path from 'node:path';

import { createVoiceSession } from './voiceSession.js';
import { createVoiceConfirm } from './voiceConfirm.js';
import { createAfk } from './afk.js';
import { createStream } from './stream.js';
import { createStreamWatch } from './streamWatch.js';
import { createRPC } from './rpc.js';
import { createOwO } from './owo.js';

// Một "account" = 1 token Discord + toàn bộ runtime state đi kèm.
// Mọi module có state (voice, afk, stream, watch, rpc) đều là factory
// nên mỗi account có một bản riêng, không dùng chung.
export function createAccount({
  id,
  name,
  token,
  config,
  logger,
  stats,
  session,
  root,
  primary = false,
  getPeers = () => [],
}) {
  const acct = {
    id,
    name,
    token,
    config,
    logger,
    stats,
    session,
    client: null,
    ready: false,
    error: '',
    startedAt: 0,
    restarting: false,
    restarts: 0,
    permanentError: false,
  };

  acct.voice = createVoiceSession();
  acct.confirm = createVoiceConfirm();
  acct.afk = createAfk({
    file: path.join(root, primary ? '.afk.json' : `.afk.${id}.json`),
  });
  acct.watch = createStreamWatch({
    voice: acct.voice,
    getStream: () => acct.stream,
  });
  acct.stream = createStream({
    voice: acct.voice,
    confirm: acct.confirm,
    watch: acct.watch,
  });
  acct.rpc = createRPC({
    config,
    logger,
    getClient: () => acct.client,
    stats,
    configPath: path.join(root, primary ? 'rpc.json' : `rpc.${id}.json`),
  });

  acct.owo = createOwO({
    config,
    logger,
    file: path.join(root, primary ? '.owo.json' : `.owo.${id}.json`),
    getClient: () => acct.client,
    getPeers,
  });

  acct.afk.initAfk(config);

  return acct;
}

export function accountSummary(acct) {
  if (!acct) return null;
  const user = acct.client?.user ?? null;
  return {
    id: acct.id,
    name: acct.name,
    ready: acct.ready,
    error: acct.error,
    startedAt: acct.startedAt,
    user: user ? { tag: user.tag, id: user.id } : null,
  };
}
