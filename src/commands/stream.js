import { fmtDur, parseChannelRef } from '../utils.js';

export async function register({ registerCommand }) {
  registerCommand('stream', {
    category: 'Voice',
    description: 'Go Live — stream hình đen vào voice + xem stream người khác',
    usage: '.stream [channel_id] | .stream status | .stream stop | .stream pause | .stream resume | .stream preview | .stream who | .stream watch <user_id> | .stream unwatch',
    handler: async ({ args, msg, client, config, logger, stats, reply, acct }) => {
      const sub = (args[0] || '').trim();
      const cmd = sub.toLowerCase();
      const stream = acct.stream;
      const watch = acct.watch;

      if (cmd === 'status') {
        const st = stream.getStreamState();
        const lines = ['Stream status:'];
        lines.push(`- Active: ${st.active ? 'có' : 'không'}`);
        lines.push(`- Starting: ${st.starting ? 'có' : 'không'}`);
        lines.push(`- Guild: ${st.guildName || st.guildId || '—'}`);
        lines.push(`- Channel: ${st.channelName || st.channelId || '—'}`);
        lines.push(`- Viewers: ${st.viewerCount}`);
        lines.push(`- Paused: ${st.paused ? 'có' : 'không'}`);
        if (st.region) lines.push(`- Region: ${st.region}`);
        if (st.active && st.startedAt) {
          lines.push(`- Duration: ${fmtDur((Date.now() - st.startedAt) / 1000)}`);
        }
        if (st.lastError) lines.push(`- Last error: ${st.lastError}`);

        const w = watch.getWatchState();
        if (w.active || w.starting) {
          lines.push('- Watch:');
          lines.push(`  - User: ${w.username || '—'} (${w.userId || '—'})`);
          lines.push(`  - Channel: ${w.channelName || w.channelId || '—'}`);
          lines.push(`  - Viewers: ${w.viewers}${w.paused ? ' (paused)' : ''}`);
          if (w.active && w.startedAt) {
            lines.push(`  - Duration: ${fmtDur((Date.now() - w.startedAt) / 1000)}`);
          }
          lines.push(`  - Record: ${w.file || '—'}`);
          if (w.lastError) lines.push(`  - Last error: ${w.lastError}`);
        }
        return reply(lines.join('\n'));
      }

      if (cmd === 'pause' || cmd === 'resume') {
        const paused = cmd === 'pause';
        try {
          stream.setStreamPaused(paused, { logger });
          return reply(paused ? '✓ Đã pause stream' : '✓ Đã resume stream');
        } catch (e) {
          return reply(`Không ${paused ? 'pause' : 'resume'} được: ${e.message}`);
        }
      }

      if (cmd === 'preview') {
        try {
          const url = await stream.getStreamPreview({ client });
          return reply(url ? `Preview: ${url}` : 'Chưa có preview (thử lại sau vài giây)');
        } catch (e) {
          return reply(`Không lấy được preview: ${e.message}`);
        }
      }

      if (cmd === 'who') {
        const list = watch.listStreamers({ client, guild: msg?.guild ?? null });
        if (!list) {
          return reply('Nhắn lệnh trong sever (hoặc vào voice) để biết tìm ở đâu.');
        }
        if (!list.streamers.length) {
          return reply(`Không ai đang stream ở ${list.guildName || 'sever này'}.`);
        }
        const lines = [`Đang stream ở ${list.guildName}:`];
        for (const s of list.streamers) {
          lines.push(`- ${s.id} — ${s.name} @ ${s.channelName}${s.camera ? ' (camera)' : ''}`);
        }
        return reply(lines.join('\n'));
      }

      if (cmd === 'watch') {
        const id = (args[1] || '').trim();
        if (!id) {
          return reply('Usage: .stream watch <user_id> — dùng .stream who để lấy ID');
        }
        try {
          const res = await watch.watchStream({
            client,
            userId: id,
            guild: msg?.guild ?? null,
            config,
            logger,
            stats,
          });
          return reply(
            `✓ Đang xem stream của ${res.username} (${res.guildName}/${res.channelName})\n` +
            `Ghi vào: ${res.file}\nDừng: .stream unwatch`,
          );
        } catch (e) {
          return reply(`Watch fail: ${e.message}`);
        }
      }

      if (cmd === 'unwatch') {
        const w = watch.getWatchState();
        if (!w.active && !w.starting) return reply('Chưa xem stream nào.');
        const file = w.file;
        await watch.stopWatch({ client, config, logger, stats });
        return reply(`✓ Đã dừng xem${file ? ` — ghi vào ${file}` : ''}`);
      }

      if (cmd === 'stop') {
        const st = stream.getStreamState();
        if (!st.active && !st.starting) {
          return reply('Chưa stream.');
        }
        await stream.stopStream({ client, config, logger, stats });
        return reply('✓ Đã dừng stream');
      }

      const ref = parseChannelRef(sub);
      const res = await stream.startStream({
        client,
        channelId: ref?.channelId || sub,
        config,
        logger,
        stats,
      });

      reply(`✓ Đang stream hình đen vào ${res.channelName} (${res.guildName})`);
    },
  });
}
