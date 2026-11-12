// Token Discord user gồm 3 phần base64url: <userId>.<issuedAt>.<hmac>
// Phần 1 decode ra chính Discord ID, phần 2 là timestamp phát hành.
// Bản port từ afterlife (bot/center/shared/token_parse.py) — chỉ giữ phần
// parse, bỏ phần so sánh id/rollback vì ở đây mỗi account là 1 người dùng.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const TOKEN_EPOCH = 1293840000;

// base64url không padding, bit cuối thường lủng củng → bỏ qua bit thừa
// (giống base64.urlsafe_b64decode của Python).
function b64urlToBytes(input) {
  const out = [];
  let value = 0;
  let bits = 0;
  for (const ch of String(input ?? '')) {
    const idx = B64.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

export function parseUserToken(token) {
  const raw = String(token ?? '').trim();
  if (!raw) return { ok: false, error: 'Token rỗng' };
  if (/\s/.test(raw)) return { ok: false, error: 'Token chứa khoảng trắng' };
  if (raw.length > 200) return { ok: false, error: 'Token quá dài' };

  const parts = raw.split('.');
  if (parts.length !== 3) {
    return { ok: false, error: `Token phải có 3 phần (đang có ${parts.length})` };
  }
  if (!parts[2]) return { ok: false, error: 'Token thiếu phần chữ ký' };

  const discordId = b64urlToBytes(parts[0]).toString('utf8');
  if (!/^\d{15,22}$/.test(discordId)) {
    return { ok: false, error: 'Phần 1 của token không phải Discord ID' };
  }

  const tsBytes = b64urlToBytes(parts[1]);
  if (!tsBytes.length) return { ok: false, error: 'Phần 2 của token không hợp lệ' };

  let acc = 0n;
  for (const b of tsBytes) acc = (acc << 8n) | BigInt(b);
  const issuedAt = Number(acc < 1500000000n ? acc + BigInt(TOKEN_EPOCH) : acc);

  return {
    ok: true,
    discordId,
    issuedAt,
    issuedAtIso: new Date(issuedAt * 1000).toISOString(),
  };
}

export function isUserToken(token) {
  return parseUserToken(token).ok;
}

export function maskToken(token) {
  const t = String(token ?? '').trim();
  if (t.length <= 12) return '***';
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}
