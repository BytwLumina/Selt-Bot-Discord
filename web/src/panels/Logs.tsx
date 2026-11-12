import { useEffect, useRef, useState } from 'react';
import { apiGet } from '../api';
import { Card, Empty, Toggle } from '../components/ui';
import type { LogsResult } from '../types';

interface LogLine {
  n: number;
  line: string;
}

// Giữ log khi đổi tab — panel mount lại vẫn thấy log cũ
const store: { lines: LogLine[]; cursor: number } = { lines: [], cursor: 0 };

const LEVEL_RE = /\[(ERR|WARN| DBG|INFO|  OK|  WS|VOICE| CMD)\]/;

export function LogsPanel() {
  const [lines, setLines] = useState<LogLine[]>(store.lines);
  const [search, setSearch] = useState('');
  const [auto, setAuto] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const res = await apiGet<LogsResult>('/api/logs?since=' + store.cursor);
      if (!alive || !res.ok) return;
      if (typeof res.cursor === 'number') store.cursor = res.cursor;
      const incoming = res.lines || [];
      if (!incoming.length) return;
      const seen = new Set(store.lines.map((l) => l.n));
      const added = incoming.filter((l) => !seen.has(l.n));
      if (!added.length) return;
      store.lines = [...store.lines, ...added].slice(-1000);
      setLines(store.lines);
    };
    void poll();
    const timer = window.setInterval(() => {
      if (!document.hidden) void poll();
    }, 1500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const q = search.trim().toLowerCase();
  const shown = q ? lines.filter((l) => l.line.toLowerCase().includes(q)) : lines;

  useEffect(() => {
    const box = boxRef.current;
    if (auto && box) box.scrollTop = box.scrollHeight;
  }, [lines, auto, q]);

  return (
    <div className="panel">
      <Card title="Log trực tiếp" hint={`${shown.length} dòng`} i={0}>
        <div className="row" style={{ marginBottom: 10 }}>
          <input
            type="text"
            className="grow"
            value={search}
            placeholder="Lọc theo nội dung..."
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Lọc log"
          />
          <Toggle checked={auto} onChange={setAuto}>
            Tự cuộn
          </Toggle>
          <button
            className="small"
            onClick={() => {
              store.lines = [];
              setLines([]);
            }}
          >
            Xoá màn hình
          </button>
        </div>
        <div className="logbox" ref={boxRef} aria-live="polite">
          {shown.length ? (
            shown.map((l) => {
              const lv = l.line.match(LEVEL_RE);
              const cls = lv ? (lv[1] === 'ERR' ? 'err' : lv[1] === 'WARN' ? 'warn' : '') : '';
              return (
                <div className={cls} key={l.n}>
                  {l.line}
                </div>
              );
            })
          ) : (
            <Empty>
              {lines.length
                ? 'Không có dòng nào khớp với từ khoá'
                : 'Chưa có log nào — log của bot sẽ hiện ở đây'}
            </Empty>
          )}
        </div>
        <div className="meta" style={{ marginTop: 8 }}>
          {store.lines.length >= 1000 ? 'Giữ 1000 dòng gần nhất' : ''}
        </div>
      </Card>
    </div>
  );
}
