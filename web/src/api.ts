import type { ApiResult } from './types';

// Account đang điều khiển — gắn vào mọi request giống bản cũ
let acctId = '';

export function setAcct(id: string): void {
  acctId = id || '';
}

export function getAcct(): string {
  return acctId;
}

function withAcct(path: string): string {
  if (!acctId) return path;
  return path + (path.includes('?') ? '&' : '?') + 'acct=' + encodeURIComponent(acctId);
}

async function request<T extends ApiResult>(path: string, init?: RequestInit): Promise<T> {
  try {
    const r = await fetch(withAcct(path), init);
    const data = (await r.json().catch(() => null)) as ApiResult | null;
    if (!data || typeof data !== 'object') {
      return { ok: false, error: r.ok ? 'Phản hồi không hợp lệ' : `HTTP ${r.status}` } as T;
    }
    return data as T;
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || 'Không kết nối được server' } as T;
  }
}

export function apiGet<T extends ApiResult = ApiResult>(path: string): Promise<T> {
  return request<T>(path, { headers: { accept: 'application/json' } });
}

export function apiPost<T extends ApiResult = ApiResult>(path: string, body?: unknown): Promise<T> {
  const payload: Record<string, unknown> = { ...(body as Record<string, unknown> | undefined) };
  if (acctId) payload.acct = acctId;
  return request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lumina': 'web' },
    body: JSON.stringify(payload),
  });
}
