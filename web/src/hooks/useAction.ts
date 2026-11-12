import { useCallback, useState } from 'react';
import { useApp } from '../context';
import type { ApiResult, MsgState } from '../types';

// Gói thao tác API: khoá nút, ghi dòng thông báo, toast khi xong
export function useAction() {
  const { notify } = useApp();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<MsgState | null>(null);

  const run = useCallback(
    async <T extends ApiResult>(fn: () => Promise<T>): Promise<T> => {
      setBusy(true);
      let res: T;
      try {
        res = await fn();
      } catch (e) {
        res = { ok: false, error: (e as Error)?.message || 'Lỗi không rõ' } as T;
      }
      if (res?.ok) setMsg({ kind: 'ok', text: res.message || 'Đã xong' });
      else setMsg({ kind: 'err', text: 'Lỗi: ' + (res?.error || 'không rõ') });

      if (res?.ok) {
        if (res.message) notify(res.message, 'ok');
      } else {
        notify(res?.error || 'Lỗi không rõ', 'err');
      }
      setBusy(false);
      return res;
    },
    [notify],
  );

  return { busy, msg, setMsg, run };
}
