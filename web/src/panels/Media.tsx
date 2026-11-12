import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../api';
import { useApp } from '../context';
import { useAction } from '../hooks/useAction';
import { fmtDur } from '../lib/format';
import { Badge, Card, Empty, KV, Msg } from '../components/ui';
import type { Streamer, StreamConfigInfo, StreamState, VoiceState, WatchState, WhoResult } from '../types';

export function MediaPanel() {
  const { status, guilds, reloadGuilds, refresh } = useApp();
  const voiceAct = useAction();
  const streamAct = useAction();
  const watchAct = useAction();
  const search = useAction();

  const voice: VoiceState = status?.voice || {};
  const st: StreamState = status?.stream || {};
  const w: WatchState = status?.watch || {};
  const cfg: StreamConfigInfo = st.config || {};

  // ── Voice ────────────────────────────────────────────────
  const [guildId, setGuildId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [voiceQuery, setVoiceQuery] = useState('');
  const [linkInput, setLinkInput] = useState('');

  // Ô tìm kiếm lọc cả danh sách sever lẫn kênh của sever đang chọn.
  // Không có kết quả thì giữ nguyên danh sách đầy đủ cho dễ chọn.
  const vq = voiceQuery.trim().toLowerCase();
  const guildHits = vq ? guilds.filter((g) => g.name.toLowerCase().includes(vq)) : guilds;
  const guildOptions = guildHits.length ? guildHits : guilds;

  const voiceGuild = guilds.find((g) => g.id === voice.guildId);
  const effectiveGuildId = guildOptions.some((g) => g.id === guildId)
    ? guildId
    : guildOptions.some((g) => g.id === voice.guildId)
      ? voice.guildId
      : guildOptions[0]?.id || '';

  const guild = guilds.find((g) => g.id === effectiveGuildId);
  const channels = guild?.channels || [];
  const preferred = voice.guildId === effectiveGuildId ? voice.channelId : '';
  const channelHits = vq ? channels.filter((c) => c.name.toLowerCase().includes(vq)) : channels;
  const channelOptions = channelHits.length ? channelHits : channels;
  const effectiveChannelId = channelOptions.some((c) => c.id === channelId)
    ? channelId
    : channelOptions.some((c) => c.id === preferred)
      ? preferred
      : channelOptions[0]?.id || '';

  // Dán link kênh Discord → chọn đúng sever + kênh
  const useLink = () => {
    const text = linkInput.trim();
    const m = text.match(/discord(?:app)?\.com\/channels\/(@me|\d{15,22})\/(\d{15,22})/i);
    const ref = m
      ? { guildId: m[1].toLowerCase() === '@me' ? '' : m[1], channelId: m[2] }
      : null;
    if (!ref) {
      voiceAct.setMsg({
        kind: 'err',
        text: 'Lỗi: Link không hợp lệ — cần dạng https://discord.com/channels/<sever>/<kênh>',
      });
      return;
    }
    const g =
      guilds.find((x) => x.id === ref.guildId) ||
      guilds.find((x) => x.channels.some((c) => c.id === ref.channelId));
    if (!g) {
      voiceAct.setMsg({ kind: 'err', text: 'Lỗi: Không thấy sever của kênh này (bot đã vào sever chưa?)' });
      return;
    }
    const ch = g.channels.find((c) => c.id === ref.channelId);
    if (!ch) {
      voiceAct.setMsg({ kind: 'err', text: `Lỗi: Sever "${g.name}" không có kênh ${ref.channelId}` });
      return;
    }
    setGuildId(g.id);
    setChannelId(ch.id);
    voiceAct.setMsg({ kind: 'ok', text: `Đã chọn ${g.name} · ${ch.name}` });
  };

  const joinVoice = async () => {
    if (!effectiveGuildId || !effectiveChannelId) {
      voiceAct.setMsg({ kind: 'err', text: 'Lỗi: Chọn sever và kênh thoại trước' });
      return;
    }
    await voiceAct.run(() =>
      apiPost('/api/voice/join', { guildId: effectiveGuildId, channelId: effectiveChannelId }),
    );
    await refresh();
  };

  // ── Stream ───────────────────────────────────────────────
  const live = !!st.active || !!st.starting;
  const runStream = async (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => {
    await streamAct.run(fn);
    await refresh();
  };

  // ── Xem stream ───────────────────────────────────────────
  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [guildName, setGuildName] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [whoQuery, setWhoQuery] = useState('');
  const autoRan = useRef(false);

  const watchGuildId = guilds.some((g) => g.id === guildId)
    ? guildId
    : guilds.find((g) => g.id === w.guildId)?.id || guilds[0]?.id || '';

  const find = useCallback(
    async (gid?: string) => {
      const id = gid ?? watchGuildId;
      return search.run(async () => {
        const r = await apiGet<WhoResult>(
          '/api/stream/who' + (id ? '?guild=' + encodeURIComponent(id) : ''),
        );
        if (r.ok) {
          setStreamers(Array.isArray(r.streamers) ? r.streamers : []);
          setGuildName(r.guildName || '');
          setLoaded(true);
        }
        return r;
      });
    },
    [watchGuildId, search],
  );

  useEffect(() => {
    if (autoRan.current || !guilds.length) return;
    autoRan.current = true;
    void find();
  }, [guilds.length, find]);

  const watching = !!w.active || !!w.starting;

  // Lọc danh sách người đang stream theo tên hoặc kênh.
  const wq = whoQuery.trim().toLowerCase();
  const shownStreamers = wq
    ? streamers.filter(
        (s) =>
          (s.name || '').toLowerCase().includes(wq) ||
          (s.channelName || '').toLowerCase().includes(wq),
      )
    : streamers;

  return (
    <div className="panel">
      <div className="grid two">
        <Card
          title="Đang ở voice"
          hint={voice.connected ? <Badge tone="good">đã kết nối</Badge> : null}
          i={0}
        >
          <KV
            k="Trạng thái"
            v={voice.connected ? 'Đã vào' : voice.connecting ? 'Đang kết nối' : 'Chưa ở voice nào'}
            tone={voice.connected ? 'good' : ''}
          />
          <KV k="Sever" v={voiceGuild?.name || voice.guildId || '—'} />
          <KV k="Kênh" v={voice.channelId || '—'} />
          <KV k="Reconnect" v={String(voice.reconnectAttempts || 0)} />
          <KV k="Lỗi cuối" v={voice.lastError || '—'} tone={voice.lastError ? 'bad' : ''} />

          <div className="row" style={{ marginTop: 12 }}>
            <input
              type="text"
              className="grow"
              value={linkInput}
              placeholder="Dán link kênh Discord..."
              aria-label="Dán link kênh Discord"
              onChange={(e) => setLinkInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  useLink();
                }
              }}
            />
            <button className="small" type="button" disabled={!linkInput.trim()} onClick={useLink}>
              Dùng link
            </button>
          </div>
          <div className="row">
            <input
              type="text"
              className="grow"
              value={voiceQuery}
              placeholder="Tìm sever hoặc kênh..."
              aria-label="Tìm sever hoặc kênh"
              onChange={(e) => setVoiceQuery(e.target.value)}
            />
          </div>
          <div className="row">
            <select
              className="grow"
              value={effectiveGuildId}
              disabled={!guilds.length}
              onChange={(e) => {
                setGuildId(e.target.value);
                setChannelId('');
              }}
              aria-label="Chọn sever"
            >
              {guilds.length ? (
                guildOptions.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))
              ) : (
                <option value="">Chưa có sever</option>
              )}
            </select>
            <button className="small" disabled={voiceAct.busy} onClick={() => void reloadGuilds()}>
              Tải lại
            </button>
          </div>
          <div className="row">
            <select
              className="grow"
              value={effectiveChannelId}
              disabled={!channels.length}
              onChange={(e) => setChannelId(e.target.value)}
              aria-label="Chọn kênh thoại"
            >
              {channels.length ? (
                channelOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))
              ) : (
                <option value="">{guild ? 'Không có kênh voice' : 'Chọn sever trước'}</option>
              )}
            </select>
            <button
              className="primary"
              disabled={voiceAct.busy || !effectiveChannelId}
              onClick={() => void joinVoice()}
            >
              Vào voice
            </button>
            <button
              className="danger"
              disabled={voiceAct.busy || !voice.connected}
              onClick={() => void voiceAct.run(() => apiPost('/api/voice/leave'))}
            >
              Rời voice
            </button>
          </div>
          <Msg state={voiceAct.msg} />
        </Card>

        <Card
          title="Go Live"
          hint={st.active ? (st.paused ? <Badge tone="warn">tạm dừng</Badge> : <Badge tone="bad">LIVE</Badge>) : null}
          i={1}
        >
          <KV
            k="Trạng thái"
            v={st.active ? (st.paused ? 'LIVE (tạm dừng)' : 'LIVE') : st.starting ? 'Đang bắt đầu' : 'Tắt'}
            tone={st.active ? 'bad' : ''}
          />
          <KV
            k="Sever / kênh"
            v={
              live
                ? `${st.guildName || st.guildId || '?'} / ${st.channelName || st.channelId || '?'}`
                : '—'
            }
          />
          <KV k="Người xem" v={String(st.viewerCount ?? 0)} />
          <KV
            k="Thời lượng"
            v={st.active && st.startedAt ? fmtDur((Date.now() - st.startedAt) / 1000) : '—'}
          />
          <KV k="Region" v={st.region || '—'} />
          <KV
            k="Tự dựng lại"
            v={
              cfg.autoRestart === false
                ? 'tắt'
                : st.autoRestarting
                  ? `đang chờ${st.autoRestarts ? ` · lần ${st.autoRestarts}` : ''}`
                  : st.autoRestarts
                    ? `đã dựng lại ${st.autoRestarts} lần`
                    : 'bật · chờ sự cố'
            }
            tone={st.autoRestarting ? 'warn' : ''}
          />
          <KV k="Lỗi cuối" v={st.lastError || '—'} tone={st.lastError ? 'bad' : ''} />

          <div className="preview-box" aria-hidden="true">
            <span className="pv-label">
              {st.active ? (cfg.captureSource === 'camera' ? 'Camera đang chạy' : 'Hình đen') : 'Chưa stream'}
            </span>
            {st.active ? <span className="pv-live">LIVE</span> : null}
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="primary"
              disabled={streamAct.busy || live}
              onClick={() => void runStream(() => apiPost('/api/stream/start', { source: 'black' }))}
            >
              Go Live
            </button>
            <button
              disabled={streamAct.busy || live}
              onClick={() => void runStream(() => apiPost('/api/stream/start', { source: 'camera' }))}
            >
              Mở cam
            </button>
            <button
              className="danger"
              disabled={streamAct.busy || !live}
              onClick={() => void runStream(() => apiPost('/api/stream/stop'))}
            >
              Dừng
            </button>
            <button
              disabled={streamAct.busy || !st.active}
              onClick={() => void runStream(() => apiPost('/api/stream/pause', { paused: !st.paused }))}
            >
              {st.paused ? 'Tiếp tục' : 'Tạm dừng'}
            </button>
          </div>
          <Msg state={streamAct.msg} />
        </Card>
      </div>

      <div className="grid two">
        <Card
          title="Cấu hình stream"
          hint={cfg.captureSource === 'camera' ? 'nguồn: camera' : cfg.captureSource === 'black' ? 'nguồn: hình đen' : 'nguồn: màn hình'}
          i={2}
        >
          <KV k="Nguồn" v={cfg.captureSource === 'camera' ? 'Camera máy' : cfg.captureSource === 'screen' ? 'Màn hình máy' : 'Hình đen'} />
          <KV
            k="Kích thước"
            v={cfg.width && cfg.height ? `${cfg.width} × ${cfg.height}` : 'theo config.json'}
          />
          <KV k="FPS" v={cfg.fps ? String(cfg.fps) : 'theo config.json'} />
          <KV k="Bitrate" v={cfg.bitrateKbps ? `${cfg.bitrateKbps} kbps` : 'theo config.json'} />
          <KV k="Âm thanh" v="không gửi (chỉ video)" />
          {cfg.cameraDevice ? <KV k="Camera" v={cfg.cameraDevice} /> : null}
        </Card>

        <Card title="Xem stream người khác" hint={watching ? <Badge tone="accent">đang xem</Badge> : null} i={3}>
          <KV k="Người stream" v={watching ? w.username || w.userId || '?' : '—'} />
          <KV k="Sever / kênh" v={watching ? `${w.guildName || '?'} / ${w.channelName || '?'}` : '—'} />
          <KV
            k="Thời lượng"
            v={watching && w.startedAt ? fmtDur((Date.now() - w.startedAt) / 1000) : '—'}
          />
          <KV k="File ghi" v={w.file || '—'} />
          <KV k="Lỗi cuối" v={w.lastError || '—'} tone={w.lastError ? 'bad' : ''} />

          <div className="row" style={{ marginTop: 10 }}>
            <select
              className="grow"
              value={watchGuildId}
              disabled={!guilds.length}
              onChange={(e) => {
                setGuildId(e.target.value);
                setStreamers([]);
                setLoaded(false);
                setGuildName('');
              }}
              aria-label="Chọn sever để tìm"
            >
              {guilds.length ? (
                guilds.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))
              ) : (
                <option value="">Chưa có sever</option>
              )}
            </select>
            <button
              className="primary"
              disabled={search.busy || !guilds.length}
              onClick={() => void find()}
            >
              Tìm người stream
            </button>
            <button
              className="danger"
              disabled={watchAct.busy || !watching}
              onClick={() =>
                void watchAct.run(async () => {
                  const res = await apiPost('/api/watch/stop');
                  await refresh();
                  return res;
                })
              }
            >
              Dừng xem
            </button>
          </div>

          {loaded ? (
            <div className="row" style={{ marginTop: 10, marginBottom: 2 }}>
              <input
                type="text"
                className="grow"
                value={whoQuery}
                placeholder="Tìm người stream..."
                aria-label="Tìm người stream"
                onChange={(e) => setWhoQuery(e.target.value)}
              />
              {whoQuery ? (
                <button className="small ghost" type="button" onClick={() => setWhoQuery('')}>
                  Xoá
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="list">
            {shownStreamers.length ? (
              shownStreamers.map((s) => (
                <div className="item" key={s.id}>
                  <div className="left">
                    <div>
                      <div className="who">
                        {s.name} · {s.channelName}
                        {s.camera ? ' (camera)' : ''}
                      </div>
                      <div className="sub">{s.id}</div>
                    </div>
                  </div>
                  <div className="right">
                    <button
                      className="primary small"
                      disabled={watchAct.busy}
                      onClick={() =>
                        void watchAct.run(async () => {
                          const res = await apiPost('/api/watch/start', {
                            userId: s.id,
                            guildId: watchGuildId,
                          });
                          await refresh();
                          return res;
                        })
                      }
                    >
                      Xem
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <Empty>
                {loaded
                  ? wq
                    ? `Không có ai khớp "${whoQuery}"`
                    : `Không ai đang stream ở ${guildName || 'sever này'}`
                  : 'Chọn sever rồi bấm "Tìm người stream"'}
              </Empty>
            )}
          </div>
          <Msg state={search.msg} />
        </Card>
      </div>
    </div>
  );
}
