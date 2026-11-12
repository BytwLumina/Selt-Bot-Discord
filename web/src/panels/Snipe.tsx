import { useEffect, useState } from 'react';
import { apiGet } from '../api';
import { useApp } from '../context';
import { useAction } from '../hooks/useAction';
import { fmtDur } from '../lib/format';
import { Card, Empty, Msg } from '../components/ui';
import type { DiscordChannel, SnipeEntry, SnipeResult } from '../types';

function isTextChannel(type: number | string): boolean {
  return (
    type === 0 ||
    type === 'GUILD_TEXT' ||
    type === 'DM' ||
    type === 'GUILD_NEWS'
  );
}

function typeLabel(type: number | string): string {
  if (type === 0 || type === 'GUILD_TEXT') return 'văn bản';
  if (type === 'DM') return 'tin nhắn';
  if (type === 'GUILD_NEWS') return 'tin tức';
  return 'kênh';
}

function EntryList({ entries, kind }: { entries: SnipeEntry[]; kind: 'del' | 'edit' }) {
  if (!entries.length) {
    return (
      <Empty>
        {kind === 'del'
          ? 'Chưa có tin nào bị xoá trong channel này'
          : 'Chưa có tin nào bị sửa trong channel này'}
      </Empty>
    );
  }
  return (
    <>
      {entries.map((e) => {
        const ts = e.deletedAt || e.editedAt || 0;
        const body =
          kind === 'del'
            ? e.content || '(không có text)'
            : `"${e.oldContent || ''}" → "${e.newContent || ''}"`;
        const href = `https://discord.com/channels/${e.guildId || '@me'}/${e.channelId}/${e.messageId}`;
        return (
          <div className="item" key={`${e.messageId}-${ts}`}>
            <div className="left">
              <div>
                <div className="who">
                  {(e.authorTag || '?') + ' — ' + fmtDur((Date.now() - ts) / 1000) + ' trước'}
                </div>
                <div className="sub">{body.slice(0, 160)}</div>
              </div>
            </div>
            <div className="right">
              <a href={href} target="_blank" rel="noreferrer" className="link-open">
                Mở
              </a>
            </div>
          </div>
        );
      })}
    </>
  );
}

export function SnipePanel() {
  const { guilds, reloadGuilds } = useApp();
  const act = useAction();
  const [guildId, setGuildId] = useState('');
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [picked, setPicked] = useState('');
  const [deleted, setDeleted] = useState<SnipeEntry[]>([]);
  const [edited, setEdited] = useState<SnipeEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const effectiveGuildId = guilds.some((g) => g.id === guildId) ? guildId : guilds[0]?.id || '';
  const channelId = channels.some((c) => c.id === picked) ? picked : channels[0]?.id || '';

  useEffect(() => {
    if (!effectiveGuildId) {
      setChannels([]);
      return;
    }
    let alive = true;
    void (async () => {
      const res = await apiGet<{ ok: boolean; channels?: DiscordChannel[] }>(
        '/api/channels?guild=' + encodeURIComponent(effectiveGuildId),
      );
      if (!alive) return;
      const list = res.ok && Array.isArray(res.channels) ? res.channels : [];
      const text = list.filter((c) => isTextChannel(c.type));
      setChannels(text.length ? text : list);
    })();
    return () => {
      alive = false;
    };
  }, [effectiveGuildId]);

  const load = async () => {
    if (!channelId) {
      act.setMsg({ kind: 'err', text: 'Lỗi: Chọn channel trước' });
      return;
    }
    await act.run(async () => {
      const res = await apiGet<SnipeResult>('/api/snipe?channel=' + encodeURIComponent(channelId));
      if (res.ok) {
        setDeleted(Array.isArray(res.deleted) ? res.deleted : []);
        setEdited(Array.isArray(res.edited) ? res.edited : []);
        setLoaded(true);
      }
      return {
        ...res,
        message: res.ok
          ? `Đã tải (${res.deleted?.length || 0} bị xoá, ${res.edited?.length || 0} bị sửa)`
          : undefined,
      };
    });
  };

  return (
    <div className="panel">
      <Card title="Xem tin bị xoá / bị sửa" i={0}>
        <div className="row wrap">
          <select
            className="grow"
            value={effectiveGuildId}
            disabled={!guilds.length}
            onChange={(e) => {
              setGuildId(e.target.value);
              setPicked('');
              setDeleted([]);
              setEdited([]);
              setLoaded(false);
            }}
            aria-label="Chọn sever"
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
          <select
            className="grow"
            value={channelId}
            disabled={!channels.length}
            onChange={(e) => setPicked(e.target.value)}
            aria-label="Chọn channel"
          >
            {channels.length ? (
              channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {typeLabel(c.type)}
                </option>
              ))
            ) : (
              <option value="">Không có channel</option>
            )}
          </select>
          <button className="primary" disabled={act.busy || !channelId} onClick={() => void load()}>
            Tải
          </button>
          <button className="small" disabled={act.busy} onClick={() => void reloadGuilds()}>
            Tải lại sever
          </button>
        </div>
        <Msg state={act.msg} />
      </Card>

      <div className="grid two">
        <Card title="Tin bị xoá" hint={loaded ? `${deleted.length}` : ''} i={1}>
          <div className="list">
            {loaded ? <EntryList entries={deleted} kind="del" /> : <Empty>Chọn channel rồi bấm "Tải"</Empty>}
          </div>
        </Card>
        <Card title="Tin bị sửa" hint={loaded ? `${edited.length}` : ''} i={2}>
          <div className="list">
            {loaded ? <EntryList entries={edited} kind="edit" /> : <Empty>Chọn channel rồi bấm "Tải"</Empty>}
          </div>
        </Card>
      </div>
    </div>
  );
}
