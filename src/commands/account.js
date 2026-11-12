export async function register({ registerCommand }) {
  registerCommand('accounts', {
    category: 'System',
    description: 'Danh sách account đang chạy',
    usage: '.accounts',
    aliases: ['accts'],
    handler: async ({ reply, getAccounts, getFocusedId }) => {
      const list = getAccounts?.() || [];
      if (!list.length) return reply('Chưa có account nào.');

      const focused = getFocusedId?.();
      const lines = [`Accounts (${list.length}) — dùng .account <id> để chuyển:`];
      for (const a of list) {
        const mark = a.id === focused ? ' ←' : '';
        const state = a.ready
          ? (a.user ? a.user.tag : 'online')
          : (a.error ? `lỗi: ${a.error}` : 'đang kết nối');
        lines.push(`- ${a.id} — ${a.name} · ${state}${mark}`);
      }
      return reply(lines.join('\n'));
    },
  });

  registerCommand('account', {
    category: 'System',
    description: 'Chuyển account đang focus',
    usage: '.account <id>',
    aliases: ['focus', 'acct'],
    handler: async ({ args, reply, getAccounts, focusAccount }) => {
      const list = getAccounts?.() || [];
      const id = String(args[0] || '').trim();

      if (!id) {
        return reply('Usage: .account <id> — xem .accounts để biết id');
      }

      const found = list.find((a) => a.id.toLowerCase() === id.toLowerCase());
      if (!found) {
        const names = list.map((a) => a.id).join(', ') || '(không có)';
        return reply(`Không tìm thấy account "${id}". Có: ${names}`);
      }

      const ok = focusAccount?.(found.id);
      if (!ok) return reply(`Không chuyển được sang "${found.id}"`);
      return reply(`✓ Đã chuyển focus sang ${found.name} (${found.id})`);
    },
  });
}
