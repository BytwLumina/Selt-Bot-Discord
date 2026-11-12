import fs from 'node:fs';
import path from 'node:path';

const ACCOUNTS_FILE = 'accounts.json';
const TOKENS_FILE = 'tokens.txt';

function slug(value) {
  const s = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.slice(0, 32);
}

export function makeAccountId(name, usedIds) {
  let id = slug(name) || 'account';
  if (usedIds.has(id)) {
    let n = 2;
    while (usedIds.has(`${id}-${n}`)) n++;
    id = `${id}-${n}`;
  }
  usedIds.add(id);
  return id;
}

function readTokens(file) {
  try {
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

// Đọc danh sách account từ accounts.json + tokens.txt.
// - accounts.json (tuỳ chọn): { "accounts": [ { "name": "Main", "token": "..." } ] }
// - tokens.txt: mỗi dòng 1 token — dùng làm fallback và bổ sung cho account thiếu token
export function loadAccountDefs({ root }) {
  const warnings = [];
  const tokens = readTokens(path.join(root, TOKENS_FILE));
  const defsFile = path.join(root, ACCOUNTS_FILE);

  let entries = null;
  if (fs.existsSync(defsFile)) {
    try {
      const raw = JSON.parse(
        fs.readFileSync(defsFile, 'utf8').replace(/^\uFEFF/, '') || '{}',
      );
      const list = Array.isArray(raw) ? raw : raw?.accounts;
      if (Array.isArray(list)) entries = list;
      else warnings.push('accounts.json thiếu mảng "accounts" — bỏ qua, dùng tokens.txt');
    } catch (e) {
      warnings.push(`accounts.json sai JSON (${e.message}) — dùng tokens.txt`);
    }
  }

  const raw = [];
  let file = TOKENS_FILE;
  if (entries && entries.length) {
    file = ACCOUNTS_FILE;
    let tokenIndex = 0;
    entries.forEach((item, index) => {
      const obj = typeof item === 'string' ? { token: item } : item;
      const entry = obj && typeof obj === 'object' ? obj : {};
      const token = String(entry.token || '').trim() || tokens[tokenIndex++] || '';
      raw.push({
        name: String(entry.name || '').trim(),
        token,
        index,
      });
    });
  } else {
    tokens.forEach((token, index) => raw.push({ name: `Account ${index + 1}`, token, index }));
  }

  const usedIds = new Set();
  const accounts = raw.map((item, i) => {
    const fallbackName = `Account ${i + 1}`;
    const name = item.name || fallbackName;
    const id = makeAccountId(name, usedIds);

    if (!item.token) {
      warnings.push(`Account "${name}" không có token — sẽ không đăng nhập được`);
    }

    return {
      id,
      name,
      token: item.token,
      primary: i === 0,
      file,
      index: item.index,
    };
  });

  return { accounts, warnings, file };
}

// ── Ghi thêm / xoá account trong file nguồn ────────────────────
function readAccountsFile(root) {
  const p = path.join(root, ACCOUNTS_FILE);
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '') || '{}');
    const list = Array.isArray(raw) ? raw : raw?.accounts;
    if (!Array.isArray(list)) return [];
    return list.map((x) => (typeof x === 'string' ? { token: x } : x && typeof x === 'object' ? x : {}));
  } catch {
    return [];
  }
}

// Ghi atomic + 0600: token không bị lộ quyền và không bị cắt cụt nếu crash
function writeAtomic(p, text) {
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  try {
    fs.renameSync(tmp, p);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
  try {
    if (process.platform !== 'win32') fs.chmodSync(p, 0o600);
  } catch {}
}

function writeAccountsFile(root, list) {
  const p = path.join(root, ACCOUNTS_FILE);
  writeAtomic(p, JSON.stringify({ accounts: list }, null, 2) + '\n');
}

function writeTokensFile(root, lines) {
  const p = path.join(root, TOKENS_FILE);
  writeAtomic(p, lines.length ? lines.join('\n') + '\n' : '');
}

export function addAccountToStore({ root, file, name, token }) {
  if (file === ACCOUNTS_FILE) {
    const list = readAccountsFile(root);
    list.push({ name: name || '', token });
    writeAccountsFile(root, list);
    return list.length - 1;
  }
  const lines = readTokens(path.join(root, TOKENS_FILE));
  lines.push(token);
  writeTokensFile(root, lines);
  return lines.length - 1;
}

export function removeAccountFromStore({ root, file, index }) {
  if (!Number.isInteger(index) || index < 0) return false;
  if (file === ACCOUNTS_FILE) {
    const list = readAccountsFile(root);
    if (index >= list.length) return false;
    list.splice(index, 1);
    writeAccountsFile(root, list);
    return true;
  }
  const lines = readTokens(path.join(root, TOKENS_FILE));
  if (index >= lines.length) return false;
  lines.splice(index, 1);
  writeTokensFile(root, lines);
  return true;
}
