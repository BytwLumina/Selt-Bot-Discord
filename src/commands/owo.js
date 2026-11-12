import { fmtDur } from '../utils.js';

function onOff(v) {
  return v ? 'on' : 'off';
}

export async function register({ registerCommand }) {
  registerCommand('owo', {
    category: 'OwO',
    description: 'Tự động hunt / quest / gem / boss cho OwO bot',
    usage: '.owo [start|stop|status|channel add <id>|channel remove <id>|hunt|quest|gem|boss on|off]',
    handler: async ({ args, reply, acct }) => {
      const owo = acct.owo;
      if (!owo) return reply('Module OwO chưa sẵn sàng');
      const sub = (args[0] || '').toLowerCase();

      if (!sub || sub === 'status' || sub === 'info') {
        const st = owo.getState();
        const f = st.features;
        const next = (t) => (t && t > Date.now() ? ` · tới ${Math.round((t - Date.now()) / 1000)}s` : '');
        const range = (x) => {
          if (!x || !x.enabled) return '';
          const min = Math.round((x.minMs || 0) / 1000);
          const max = Math.round((x.maxMs || 0) / 1000);
          return max > min ? ` ${min}s–${max}s` : ` ${min}s`;
        };
        const lines = [
          `OwO farm: ${st.enabled ? 'BẬT' : 'TẮT'}${st.paused ? ` — tạm dừng (${st.paused})` : ''}`,
          `Channel: ${st.channels.length ? st.channels.join(', ') : 'chưa có'}`,
          `Hunt ${onOff(f.hunt.enabled)} ${range(f.hunt)}${next(f.hunt.nextAt)} · Quest ${onOff(f.quest.enabled)} ${range(f.quest)}${next(f.quest.nextAt)}`,
          `Gem ${onOff(f.gem.enabled)} ${range(f.gem)} · Train ${onOff(f.train?.enabled)} ${range(f.train)}`,
          `Roll ${onOff(f.roll?.enabled)} ${range(f.roll)} · Daily ${onOff(f.daily?.enabled)} ${range(f.daily)} · Boss ${onOff(f.boss.enabled)}`,
          `Quest log: ${st.questsAllDone ? 'xong hết' : (st.quests?.length ? st.quests.map((q) => `${q.label} ${q.current}/${q.total}`).join(' · ') : 'chưa đọc')} · ${st.peers || 0} acc phụ`,
          `Đã gửi ${st.counters.commands} lệnh · hunt ${st.counters.hunts} · quest ${st.counters.quests} · gem dùng ${st.counters.gemsUsed} · boss ${st.counters.bossClicks}`,
          `Bắt được ${st.counters.catches} · quest xong ${st.counters.questsDone} · claim ${st.counters.claims} · quest acts ${st.counters.questActions} · captcha ${st.counters.captchaStops} · warning ${st.counters.warnings}`,
        ];
        if (st.lastError) lines.push(`Lỗi cuối: ${st.lastError}`);
        if (st.pausedAt) lines.push(`Tạm dừng từ ${fmtDur((Date.now() - st.pausedAt) / 1000)} trước`);
        return reply(lines.join('\n'));
      }

      if (sub === 'start') {
        const res = owo.start();
        return reply(res.ok ? `✓ ${res.message}` : `✗ ${res.error}`);
      }

      if (sub === 'stop') {
        const res = owo.stop('tắt từ chat');
        return reply(`✓ ${res.message}`);
      }

      if (sub === 'channel') {
        const st = owo.getState();
        const action = (args[1] || '').toLowerCase();
        const id = (args[2] || '').trim();
        if (action === 'add') {
          if (!/^\d{17,20}$/.test(id)) return reply('Channel ID phải là 17–20 chữ số');
          owo.setSettings({ channelIds: [...st.channels, id] });
          return reply(`✓ Đã thêm channel ${id}`);
        }
        if (action === 'remove' || action === 'rm') {
          owo.setSettings({ channelIds: st.channels.filter((c) => c !== id) });
          return reply(`✓ Đã bỏ channel ${id}`);
        }
        return reply(`Channel farm: ${st.channels.length ? st.channels.join(', ') : 'chưa có'}`);
      }

      if (['hunt', 'quest', 'gem', 'boss'].includes(sub)) {
        const value = (args[1] || '').toLowerCase();
        if (value !== 'on' && value !== 'off') return reply(`Dùng: .owo ${sub} on|off`);
        owo.setSettings({ [sub]: { enabled: value === 'on' } });
        return reply(`✓ ${sub}: ${value.toUpperCase()}`);
      }

      return reply('Lệnh: .owo [start|stop|status|channel add <id>|hunt|quest|gem|boss on|off]');
    },
  });
}
