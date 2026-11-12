# Lumina Selfbot

Gateway selfbot cho Discord — voice · stream · afk · OwO farm · snipe · RPC · session-based.

---

## ⚠️ Cảnh báo

Đây là **selfbot** — dùng user token, vi phạm Discord Terms of Service.
- Tài khoản có thể bị ban tạm thời hoặc vĩnh viễn
- Chỉ dùng với tài khoản phụ hoặc tài khoản chấp nhận rủi ro
- Không bật mass DM, auto-reply, spam — dễ bị flag
- Farm OwO (hunt/quest/gem/boss) vẫn là automation — OwO bot có thể captcha/cảnh báo, Discord có thể flag; bot tự dừng khi gặp captcha/cảnh báo
- Session khuyến nghị: 2-6 giờ, sau đó nghỉ

---

## Yêu cầu

- **Node.js >= 22.12** — bắt buộc, vì `@discordjs/voice` 0.19 dùng DAVE (E2EE)
- **ffmpeg có libx264** — `npm install` cài `ffmpeg-static` (optional); hoặc cài ffmpeg vào PATH
- **Windows / Linux / macOS**
- Token Discord user account — đọc từ `accounts.json`, `tokens.txt` hoặc biến môi trường `DISCORD_TOKEN` (nhiều account cùng lúc)
- (Tùy chọn) Discord Developer Application — để dùng RPC assets + buttons

---

## Cài đặt

```bash
cd "Selt-Bot-Discord-Beta"
npm install
```

`npm install` có thể lâu hơn bình thường vì `ffmpeg-static` tải binary ffmpeg (optional — nếu fail vẫn cài được, khi đó cần ffmpeg trong PATH).

> `package-lock.json` trong repo được tạo từ bản cũ (voice 0.18). Chạy `npm install` một lần để npm tự đồng bộ lock với `package.json` hiện tại (voice 0.19.2).

Web panel là app React + TypeScript, bản build sẵn nằm ở `src/web-dist` nên chạy là dùng được ngay. Chỉ khi sửa UI mới cần build lại:

```bash
npm --prefix web install   # lần đầu (cài React/Vite cho thư mục web/)
npm run build:web          # build → src/web-dist
```

Nếu chưa build, server tự phục vụ `src/web.html` cũ — panel không bao giờ trắng trang.

### Bước 1 — Token

Tạo `tokens.txt` ở root project:

```
MTIzNDU2Nzg5.MTk4NzY1NDM.WXYZ...
```

- Mỗi dòng 1 token, dòng bắt đầu `#` bị bỏ qua
- **Mỗi dòng = 1 account** — bot chạy song song nhiều account
- `tokens.txt` đã nằm trong `.gitignore` — không commit

Hoặc dùng biến môi trường (chỉ chạy được 1 account):

```bash
# Windows PowerShell
$env:DISCORD_TOKEN="MTIz..."

# Linux / macOS
export DISCORD_TOKEN="MTIz..."
```

Tên biến đổi được qua `config.json` → `tokenEnv`.

> Ưu tiên đọc `accounts.json` → `tokens.txt` → `DISCORD_TOKEN`. Có `accounts.json` hoặc `tokens.txt` nhiều dòng thì biến môi trường bị bỏ qua (có cảnh báo trong log).

### Nhiều account (multi-account)

Bot chạy **N account cùng lúc**, mỗi account có runtime riêng: voice, AFK, stream, xem stream, Rich Presence, RPC file, counter. Một account chết không làm sập account khác.

**Nguồn danh sách account** (theo thứ tự ưu tiên):

| Nguồn | Dùng khi |
|-------|----------|
| `accounts.json` | Muốn tự đặt tên / thứ tự account |
| `tokens.txt` | Tiện nhất — mỗi dòng 1 token |
| `DISCORD_TOKEN` env | Chỉ 1 account, không có file nào |

`accounts.json` (tuỳ chọn, đã nằm trong `.gitignore`):

```json
{
  "accounts": [
    { "name": "Main", "token": "MTIz..." },
    { "name": "Alt", "token": "NDQ4..." }
  ]
}
```

- `name` tuỳ chọn — tự sinh id từ tên (`Main` → `main`, `Alt 2` → `alt-2`), trùng tên tự thêm hậu tố
- `token` tuỳ chọn — bỏ trống thì lấy token theo thứ tự từ `tokens.txt`
- Account không có token → bỏ qua và log cảnh báo, bot vẫn chạy account còn lại

**Mỗi account có file riêng** (không đụng nhau):

| File | Account chính | Account thứ 2+ |
|------|----------------|-----------------|
| Rich Presence | `rpc.json` | `rpc.<id>.json` |
| AFK state | `.afk.json` | `.afk.<id>.json` |
| OwO farm | `.owo.json` | `.owo.<id>.json` |

### Thêm / xoá account trực tiếp trong web panel

Card **Tài khoản** ở tab Tổng quan có ô nhập **tên** (tuỳ chọn) + **token Discord** và nút **Thêm**:

- Token được lưu vào file danh sách account (`accounts.json` nếu có, không thì `tokens.txt`) rồi **đăng nhập ngay**
- Token sai → account hiện lỗi đỏ trong danh sách, các account khác không ảnh hưởng
- Token được **kiểm tra trước khi lưu**: phải có đúng 3 phần và phần 1 phải giải ra Discord ID hợp lệ — thêm xong báo rõ `user 1234567890`. Token của account đã có trong danh sách → báo trùng, không tạo account mới
- Nút **Xoá** bỏ account (xoá cả token khỏi file) — bấm 1 lần để hiện "Xác nhận?", bấm lần 2 mới xoá
- Khi **chưa có account nào login được**, bot vẫn chạy và chờ — mở panel dán token là bot chạy, không cần sửa file rồi restart

**Focus** — chỉ 1 account được "điều khiển" từ console / dashboard TUI / web panel. Đổi focus:

| Cách | Cách làm |
|------|----------|
| Console / chat | `.accounts` xem danh sách → `.account <id>` để chuyển |
| Web panel | Dropdown account ở chân sidebar, hoặc bấm **Chuyển** ở card "Tài khoản" |
| Dashboard TUI | Nhấn phím `Tab` để đảo account |

Mỗi account đăng nhập lệch nhau `accounts.startDelayMs` (mặc định 3s) để không spam gateway.

> **Đổi focus không dừng account cũ.** Account bạn đang chạy vẫn online, vẫn nhận lệnh trong DM/channel, vẫn giữ voice/stream/AFK của riêng nó. Focus chỉ quyết định account nào được console / TUI / web panel điều khiển.

### Bước 2 — Config

Xem section **Config** bên dưới.

### Bước 3 — Chạy

```bash
npm start
```

Selfbot khởi động. Có TTY → dashboard TUI; không có TTY hoặc `dashboard: false` → chạy headless, log ra stdout.

### Chạy 24/7 trên Windows

| File | Việc |
|------|------|
| `scripts\run-forever.cmd` | Chạy bot; crash → thử lại sau 10s (tối đa 4 lần liên tiếp); session hết hạn → nghỉ 5 phút rồi chạy lại; dừng sạch (Ctrl+C, `.exit`, invalidated) → thoát hẳn |
| `scripts\install-autostart.cmd` | Tạo shortcut trong Startup → tự chạy khi đăng nhập Windows (cửa sổ minimized) |
| `scripts\uninstall-autostart.cmd` | Xoá shortcut, tắt tự khởi động |

Exit code để wrapper quyết định: `0` = dừng sạch (không restart), `1` = crash/login fail (restart), `2` = thiếu token / `config.json` hỏng (dừng ngay, không retry), `3` = session hết hạn (restart sau 5 phút). Không cần Task Scheduler hay quyền admin.

### Web panel (localhost)

Bot mở sẵn trang điều khiển tại **http://127.0.0.1:8787** (log có ghi URL khi khởi động) — bấm nút thay vì gõ lệnh. Panel là app **React 19 + TypeScript** (Vite build, code trong `web/`), sidebar trái liệt kê **8 tab**, có **light/dark mode**, chuyển động mượt (tôn trọng `prefers-reduced-motion`) và **trình sửa Rich Presence** đầy đủ. Nếu `src/web-dist` chưa có, server tự rơi về `src/web.html` cũ.

| Tab | Làm được gì |
|-----|-------------|
| Tổng quan | Ping / uptime / % session / số sever, trạng thái từng tính năng, thao tác nhanh, **biểu đồ vùng yêu cầu đã gửi** (rê chuột xem từng phút), counter phiên |
| Voice & Stream | Gộp cả 3: chọn sever + kênh hoặc **dán link kênh Discord** → vào/rời voice (**có ô tìm kiếm**); Go Live **hình đen** hoặc **Mở cam**; tìm người đang stream trong sever → xem (**có ô tìm kiếm** trong danh sách); xem file ghi |
| AFK | Bật/tắt kèm lý do, cooldown, số ping/reply, top người ping |
| OwO Farm | Khai báo channel + bật/tắt hunt/quest/gem/train/roll/daily, **khoảng thời gian ngẫu nhiên (ngắn nhất → lâu nhất)** + nút **Time an toàn**, quest log + nút đọc/làm quest ngay, counter và sự kiện gần đây |
| Rich Presence | Sửa toàn bộ RPC (tên, loại, chi tiết, state, ảnh, nút, party, timestamp) + **xem trước** + Lưu & áp dụng |
| Snipe | Chọn sever + channel → xem tin bị xoá / bị sửa, link mở trong Discord |
| Log | Log trực tiếp (~1.5s), lọc theo nội dung, tự cuộn, xoá màn hình |
| Cài đặt | Chất lượng stream (độ phân giải / FPS / bitrate / encoder) + nguồn hình (chỉ **hình đen**; camera thì bấm **Mở cam** ở tab Voice & Stream) + **tự dựng lại stream khi đứt** (số lần, thời gian chờ) — lưu thẳng `config.json` |

- **Nhiều account**: dropdown ở chân sidebar chọn account đang điều khiển; card **Tài khoản** ở tab Tổng quan liệt kê toàn bộ account (badge **đang chạy** / lỗi, nút **Chuyển** / **Xoá**) kèm ô nhập token để thêm account mới. Mọi request tự kèm account đang chọn.
- **Chuyển account**: account cũ **vẫn chạy**, chỉ đổi account mà panel/console/TUI đang điều khiển.
- **Light/dark mode**: nút góc phải; mặc định theo hệ điều hành, nhớ lựa chọn trong `localStorage`. Ép kiểu bằng query: `?theme=light` / `?theme=dark`.
- **Ép account**: `http://127.0.0.1:8787/?acct=alt` — mở panel điều khiển sẵn account đó.
- **Mở thẳng tab**: `http://127.0.0.1:8787/#rpc`, `#watch`, `#owo`, `#snipe`… (URL tự đổi theo tab đang mở).
- **Rich Presence**: "Lưu & áp dụng" ghi thẳng `rpc.json` (kiểm tra giá trị trước, tạo `rpc.json.bak`, ghi atomic) rồi reload RPC ngay — không cần sửa file tay.
- **OwO Farm**: bấm "Bật farm" là lưu cài đặt hiện tại rồi chạy; tab hiện counter, lịch sử, **quest log** (tiến độ từng quest, nút đọc/làm quest ngay) và lý do dừng (captcha/cảnh báo) màu đỏ kèm link ảnh captcha.
- **OwO — khoảng thời gian ngẫu nhiên**: mỗi module có 2 ô — **ngắn nhất** và **lâu nhất** (giây). Bot bốc ngẫu nhiên trong khoảng đó, mốc lần kế tiếp luôn tính từ lúc lệnh vừa gửi xong nên nhịp **không bị lệch**. Nhanh nhất 15s, lâu nhất 3 giờ. Nút **Time an toàn** (cả bảng) hoặc **An toàn** (từng module) đưa về khoảng mặc định an toàn.
- **OwO — module mới**: thêm **train** (`owo train`), **roll** (`owo roll`), **daily** (`owo daily`) bên cạnh hunt/quest/gem/boss. Hunt xoay vòng qua tất cả channel đã khai báo.
- **Stream — Mở cam**: nguồn hình đổi sang camera máy (Windows: dshow, macOS: avfoundation, Linux: v4l2). Trong panel chỉ hiện **hình đen** vì panel không xem được video — chỉ Discord mới thấy hình.
- **Stream — tự dựng lại**: nếu stream chết bất thường (ffmpeg lỗi, không nhận được frame sau 15s, voice/stream disconnect) bot tự bắt lại sau vài giây, tối đa `stream.autoRestartMax` lần. Bấm Dừng thì không tự bật lại. Panel hiện đang chờ ở lần thứ mấy.
- **Dán link thay vì ID**: ô link trong tab Voice & Stream nhận `https://discord.com/channels/<sever>/<kênh>` (cả `@me`); lệnh `.voice` / `.stream` và ô channel farm OwO cũng nhận link.
- **Cài đặt**: đổi độ phân giải / FPS / bitrate / encoder / nguồn hình ngay trên panel; lưu thẳng `config.json` (có `config.json.bak`) và nạp lại config đang chạy nên lần stream kế tiếp dùng giá trị mới. Mẫu nhanh: Nhẹ 320×180@10 · Vừa 640×360@15 · Rõ 854×480@20.
- **Giao diện**: app React chia component (sidebar, topbar, card, toast, error boundary từng tab) — sidebar trái cố định (logo, 8 tab dọc, trạng thái kết nối, dropdown account, nút đổi theme) + vùng nội dung có tiêu đề riêng, không có dòng phụ. Bảng màu lấy từ logo (pastel mint → lavender + silhouette mèo đen), nền tối có aurora rất nhẹ, card viền 1px trượt vào nhẹ khi đổi tab, dải 4 ô số liệu, badge mềm màu, avatar account là logo được mask, số liệu dùng tabular numerals, 2 theme (dark/light) + focus ring; dưới 900px sidebar gập thành thanh ngang, dưới 720px ô số liệu về 2 cột. Tắt hiệu ứng theo `prefers-reduced-motion`.
- **Polling an toàn**: trạng thái tự cập nhật mỗi 2s nhưng dừng khi tab trình duyệt bị ẩn; form (RPC/OwO/AFK) giữ state riêng nên không bị ghi đè giữa lúc đang sửa.
- Chỉ nghe trên `127.0.0.1` — máy khác trong mạng không truy cập được; POST yêu cầu header riêng nên trang web khác không gọi lén được.
- Tắt/mở trong config: `web.enabled`, đổi cổng bằng `web.port` (1024–65535).
- Web dùng cùng engine với lệnh chat/console — mọi hành động vẫn hiện trong log và dashboard TUI.
- Hợp nhất khi chạy headless 24/7: điều khiển hoàn toàn bằng trình duyệt, khỏi gõ `.cmd`.

#### API của web panel

| Method | Đường dẫn | Việc |
|--------|-----------|------|
| GET | `/api/status` | Trạng thái bot + counter + voice/stream/watch/AFK/RPC + **số yêu cầu theo phút** (discord / owo / web) |
| GET | `/api/guilds` | Danh sách sever + kênh |
| GET | `/api/channels?guild=` | Kênh của 1 sever (dùng cho snipe) |
| GET | `/api/stream/who?guild=` | Ai đang stream trong sever đó |
| GET | `/api/snipe?channel=` | Tin bị xoá / bị sửa của channel |
| GET | `/api/rpc/config` | Nội dung `rpc.json` hiện tại |
| GET | `/api/owo` | Trạng thái farm OwO (module + khoảng min/max, lần chạy kế tiếp, counter, sự kiện, khoảng "an toàn") |
| GET | `/api/config` | Cấu hình hiện tại (phần `stream`) + đường dẫn file |
| POST | `/api/config/save` | Lưu cấu hình stream vào `config.json` (backup + ghi atomic) rồi nạp lại |
| GET | `/api/logs?since=N` | Log mới (cursor tăng dần) |
| GET | `/api/accounts` | Danh sách account + account đang focus |
| POST | `/api/accounts/focus` | Chuyển account đang điều khiển (`{ "id": "..." }`) |
| POST | `/api/accounts` | Thêm account mới (`{ "name": "...", "token": "..." }`) — lưu token + đăng nhập ngay |
| POST | `/api/accounts/remove` | Xoá account + token (`{ "id": "..." }`) |
| POST | `/api/accounts/retry` | Đăng nhập lại 1 account (`{ "id": "..." }`) — dùng khi account rớt hoặc vừa sửa token |
| GET | `/api/metrics` | Metrics Prometheus dạng text (`lumina_*`) — scrape bằng Prometheus/Grafana |
| GET | `/assets/*` | File tĩnh trong `src/assets/` (logo) — chỉ `.png/.jpg/.jpeg/.svg/.webp/.ico`, chặn path traversal |
| GET | `/ui/*` | File build của panel React trong `src/web-dist/ui/` (JS/CSS) — chỉ file đã whitelist, cache dài hạn |
| POST | `/api/voice/join` · `/api/voice/leave` | Vào / rời voice — `/join` nhận `guildId` + `channelId` hoặc `link` (link Discord) |
| POST | `/api/stream/start` · `/stop` · `/pause` | Go Live — `/start` nhận `channelId` hoặc `link`, thêm `source`: `black` (hình đen), `camera`, `screen` |
| POST | `/api/watch/start` · `/api/watch/stop` | Xem stream người khác |
| POST | `/api/afk/on` · `/api/afk/off` | AFK |
| POST | `/api/rpc/reload` · `/api/rpc/off` · `/api/rpc/save` | RPC (reload / tắt / lưu cấu hình) |
| POST | `/api/owo` | Farm OwO — `{ "action": "start" \| "stop" \| "save" \| "quest-refetch" \| "quest-run", "channelIds": [...], "hunt": { "enabled", "minMs", "maxMs" }, ... }` |

Mọi route trên nhận thêm query `?acct=<id>` để chỉ định account — không thì dùng account đang focus.

---

## Watchdog — tự phục hồi account

Bot quét trạng thái mọi account đang chạy. Account nào mất kết nối gateway sẽ được **tự đăng nhập lại** sau một khoảng chờ — không cần restart bot.

| Bước | Việc |
|------|------|
| 1. Quét | Mỗi `health.intervalMs` (mặc định 10s) kiểm tra `client.isReady()` của từng account |
| 2. Chờ | Mất kết nối → chờ thêm `health.graceMs` (mặc định 90s) mới động — mạng chập chờn không bị restart liên tục |
| 3. Xếp hạng | Ưu tiên phục hồi theo thứ tự: đang **voice** → đang **stream** → đang **xem stream** → còn lại |
| 4. Phục hồi | Dừng stream, giữ lại chỗ voice đang đứng, đăng nhập lại, vào lại voice, bật lại stream, nạp lại RPC |
| 5. Nghỉ | Giữa 2 lần phục hồi nghỉ `health.restartSpacingMs` (1.5s) + backoff luỹ tiến (5s → 10s → 20s… tối đa 5 phút) |

- **Token hỏng vĩnh viễn** (`invalidated`) → watchdog **không** thử lại (đánh dấu `permanentError`), chỉ ghi log để bạn sửa token. Account đó hiện badge lỗi + nút **Thử lại** trong web panel — sửa token xong bấm **Thử lại** là vào lại ngay.
- Một account rớt **không** làm sập bot, cũng không ảnh hưởng account khác (trước đây 1 account bị invalidated là cả bot chết).
- Web panel hiện dòng nhắc `watchdog 10s · chờ 90s` kèm số account đang rớt.
- Bật/tắt bằng `health.enabled` — tắt thì bot không tự phục hồi.

---

## Kiểm tra & CI

```bash
npm run check   # node --check toàn bộ src/ + block <script> trong web.html
npm test        # node:test — token parse, config, store account, watchdog, parser OwO
```

| Script | Việc |
|--------|------|
| `npm start` | Chạy selfbot |
| `npm run check` | Check syntax mọi file `src/` (kể cả `src/commands/`) + script trong `web.html` |
| `npm test` | Test tự động (`test/smoke.test.mjs` + `test/owo.test.mjs`) — chạy offline, không cần token |
| `npm run build:web` | Build lại web panel React → `src/web-dist` (cần `npm --prefix web install` một lần) |

`.github/workflows/ci.yml` chạy đúng 2 bước trên trên GitHub Actions (Node 22) — push/PR là biết ngay có gì hỏng.

---

## Cấu trúc thư mục

```
Selt-Bot-Discord-Beta/
├── src/
│   ├── index.js                Entry point — load config, login, orchestrate N account
│   ├── client.js               Gateway wrapper (discord.js-selfbot-v13)
│   ├── account.js              Runtime 1 account (voice/afk/stream/watch/rpc + client)
│   ├── accounts.js             Đọc accounts.json / tokens.txt → danh sách account
│   ├── dashboard.js            TUI — Session / Stats / Commands / Log (có headless)
│   ├── logger.js               Log với ANSI levels
│   ├── shutdown.js             Global shutdown flag
│   ├── session.js              Session timer + log end
│   ├── stats.js                Counter runtime (messages, cmds, voice, stream, rpc...)
│   ├── config.js               Load config + defaults + validate/clamp
│   ├── health.js               Watchdog — quét account rớt + tự đăng nhập lại
│   ├── tokenParse.js           Parse/validate token Discord (ra Discord ID)
│   ├── voiceSession.js         Join/leave voice + auto reconnect
│   ├── stream.js               Go Live — black/screen capture + native stream connection
│   ├── ffmpeg.js               Resolve ffmpeg (ffmpeg-static/PATH) + đưa vào PATH cho tiến trình con
│   ├── streamWatch.js          Xem + ghi stream người khác (native watch + Recorder)
│   ├── web.js                  Web server localhost — REST API + log ring buffer + /assets/* + /ui/*
│   ├── web.html                Panel cũ — fallback khi chưa build React
│   ├── web-dist/               Bản build React (index.html + ui/*.js,*.css)
│   ├── assets/
│   │   ├── logo.png            Logo gốc 256×256 (ảnh dự án)
│   │   ├── logo.jpg            Logo dạng JPEG — topbar + favicon + preview RPC
│   │   └── logo-mark.png       Silhouette mèo nền trong suốt — CSS mask cho avatar / watermark
│   ├── voiceConfirm.js         Trạng thái chờ xác nhận yes/no (scoped theo channel)
│   ├── rpc.js                  Rich Presence — template, hot reload, external assets
│   ├── afk.js                  AFK state, cooldown, template, persist
│   ├── owo.js                  Farm OwO — hunt/quest/gem/boss theo cooldown, tự dừng khi captcha
│   ├── snipe.js                Lưu tin bị xoá / bị sửa theo channel (+ TTL, LRU)
│   ├── messageCache.js         Cache nội dung tin (30 phút, tối đa 2000, LRU)
│   ├── utils.js                Helpers (sleep, randInt, readJson, typing delay...)
│   └── commands/
│       ├── index.js            Registry + dispatcher + console + rate limit
│       ├── cmd.js              .cmd
│       ├── ping.js             .ping
│       ├── uptime.js           .uptime
│       ├── voice.js            .voice
│       ├── stream.js           .stream
│       ├── rpc.js              .rpc
│       ├── afk.js              .afk
│       ├── owo.js              .owo
│       ├── account.js           .accounts + .account
│       ├── snipe.js            .snipe + .editsnipe
│       └── exit.js             .exit (hidden)
│
├── web/                        Source web panel React + TypeScript (Vite) — build ra src/web-dist
│   ├── src/                    App, component, panel, hook, style
│   └── vite.config.ts          base '/', outDir ../src/web-dist, assetsDir ui
│
├── scripts/
│   ├── check-syntax.mjs        npm run check — node --check toàn bộ src/
│   ├── run-forever.cmd         Wrapper tự restart khi crash (Windows)
│   ├── install-autostart.cmd   Bật khởi động cùng Windows
│   └── uninstall-autostart.cmd Tắt khởi động cùng Windows
│
├── test/
│   ├── smoke.test.mjs          Test token / config / store account / watchdog
│   └── owo.test.mjs            Test parser OwO + validate cài đặt farm
├── .github/
│   └── workflows/ci.yml        CI GitHub Actions — check + test
├── config.json                 Config chính
├── accounts.json               Danh sách account (tuỳ chọn, gitignore)
├── rpc.json                    Rich Presence config account chính
├── channel.txt                 Whitelist channel IDs
├── tokens.txt                  Token (1 dòng = 1 account, gitignore)
├── .afk.json                   AFK state account chính (auto-gen, gitignore)
├── .owo.json                   Farm OwO state account chính (auto-gen, gitignore)
├── recordings/                 File ghi từ .stream watch (auto-gen, gitignore)
├── session.log                 Log JSON mỗi session (auto-gen, gitignore)
└── package.json
```

---

## Commands

Prefix mặc định `.` (đổi được trong `config.json` → `commands.prefix`).

Chạy từ **3 nguồn**:
- **Console** — gõ trực tiếp trong terminal
- **DM self** — nhắn tin cho chính tài khoản selfbot
- **Channel whitelist** — chỉ channel có ID trong `channel.txt`

**Không nhận từ người khác.** Code check `msg.author.id === client.user.id` — mọi tin nhắn từ account khác bị ignore hoàn toàn.

### System

| Lệnh | Usage | Mô tả |
|------|-------|-------|
| `.accounts` | `.accounts` | Danh sách account đang chạy (alias `.accts`) |
| `.account` | `.account <id>` | Chuyển account đang focus (alias `.focus`, `.acct`) |
| `.cmd` | `.cmd` | List tất cả command khả dụng |
| `.cmd <name>` | `.cmd rpc` | Chi tiết 1 command (usage, alias, mô tả) |
| `.ping` | `.ping` | Gateway latency (ms) |
| `.uptime` | `.uptime` | Thời gian chạy + phần trăm session |
| `.exit` | `.exit` | Dừng selfbot (hidden — không show trong `.cmd`) |

### Voice

| Lệnh | Usage | Mô tả |
|------|-------|-------|
| `.voice <channel_id>` | `.voice 1234567890` | Vào voice channel (tool tự tìm guild chứa channel) |
| `.voice` | `.voice` | Hỏi xác nhận rời voice channel hiện tại |
| `.voice leave` | `.voice leave` | Hỏi xác nhận rời (tường minh) |
| `.voice status` | `.voice status` | Trạng thái voice + reconnect attempts + lỗi cuối |
| `.voice list [guild_id]` | `.voice list` | Liệt kê voice channel có thể join |

`.voice` không có ID → selfbot hỏi lại. Trả lời **yes** để rời, **no** để ở lại (hết hạn sau 30s).
Xác nhận chỉ có hiệu lực trong **đúng channel** đã gửi lời hỏi — tin "yes"/"no" ở channel khác bị bỏ qua.
Gõ từ **console** thì không có channel để hỏi — `.voice` / `.voice leave` rời voice ngay.

**Lấy channel_id:**
- Bật Developer Mode trong Discord → Settings → Advanced → Developer Mode
- Chuột phải voice channel → Copy ID

### Stream (Go Live)

| Lệnh | Usage | Mô tả |
|------|-------|-------|
| `.stream` | `.stream` | Stream hình đen vào voice channel hiện tại |
| `.stream <channel_id>` | `.stream 1234567890` | Vào channel đó rồi stream |
| `.stream status` | `.stream status` | Trạng thái stream (viewer, paused, region, thời lượng, lỗi cuối) |
| `.stream pause` | `.stream pause` | Tạm dừng stream |
| `.stream resume` | `.stream resume` | Tiếp tục stream |
| `.stream preview` | `.stream preview` | Lấy URL preview của stream hiện tại |
| `.stream stop` | `.stream stop` | Dừng stream + khôi phục voice (nếu `restoreVoice`) |
| `.stream who` | `.stream who` | Liệt kê ai đang stream trong sever nơi gửi lệnh (console thì lấy sever của voice hiện tại) |
| `.stream watch <user_id>` | `.stream watch 1234567890` | Xem + ghi stream của người đó ra file `.mkv` — chỉ xem được người đang stream ở sever nơi gửi lệnh |
| `.stream unwatch` | `.stream unwatch` | Dừng xem, chốt file ghi |

- Stream dùng **native voice stack** của lib để tạo Go Live, nên tạm rời `@discordjs/voice`; khi stop sẽ join lại channel cũ (nếu `restoreVoice: true`).
- Gateway ops do lib xử lý: 18 tạo stream, 20 watch, 19 delete, 21 ping server, 22 pause/resume; viewer + region cập nhật qua `STREAM_UPDATE`.
- `.stream pause` vừa gửi op 22 vừa tạm dừng ffmpeg, nếu không gói video tiếp theo sẽ tự unpause.
- `.stream preview` gọi `GET /streams/{stream_key}/preview` (cần quyền CONNECT).
- Trong lúc stream, `.voice` bị chặn — dừng stream trước khi đổi voice.

**Xem stream người khác (`.stream watch`):**
- Chỉ tìm stream trong **sever nơi gửi lệnh** (nhắn trong channel của sever đó; console/DM thì lấy sever của voice hiện tại). Không xác định được sever → báo lỗi.
- Check trước khi xem: user phải đang Go Live trong đúng sever đó, không thì báo lỗi kèm danh sách ai đang stream (dùng `.stream who` để xem trước).
- Dùng native voice stack riêng — tạm rời `@discordjs/voice` rồi join thẳng channel của người stream (không cần đang ở cùng channel), unwatch thì join lại voice cũ (nếu `restoreVoice: true`).
- Ghi H264 + Opus ra `.mkv` trong `stream.recordDir` (mặc định `recordings/`), mở bằng player thường.
- Streamer dừng stream / rời channel → watch tự dừng và chốt file.
- Trong lúc watch, `.stream` (Go Live) bị chặn — dùng `.stream unwatch` trước.
- Chỉ nhận được audio nếu người stream bật mic nói trong lúc đó.
- Capture mặc định trong config: `"captureSource": "black"` — ffmpeg tự tạo hình đen bằng lavfi, không cần màn hình/display nên chạy được trên host headless. Đổi thành `""` để capture toàn màn hình (Windows `gdigrab`).
- Config hiện tại: 640×360 @ 2fps, 500 kbps — đủ nhẹ để chạy host yếu.
- Stream không gửi âm thanh (video-only qua `playVideo`).
- Video được ép `yuv420p` + keyframe mỗi 2 giây để tránh màn hình đen.

**DAVE/E2EE (quan trọng):** từ 03/2026 Discord bắt buộc DAVE cho voice + Go Live.
`@discordjs/voice` 0.19.2 đã hỗ trợ DAVE nên `.voice` hoạt động bình thường.
Native stack của `discord.js-selfbot-v13` **chưa hỗ trợ DAVE**, nên `.stream` có thể bị Discord từ chối (join fail/timeout) — khi đó code sẽ báo lỗi kèm gợi ý DAVE.

### Presence

| Lệnh | Usage | Mô tả |
|------|-------|-------|
| `.rpc` / `.rpc status` | `.rpc status` | Xem trạng thái RPC hiện tại |
| `.rpc reload` / `.rpc on` | `.rpc reload` | Đọc lại `rpc.json` và áp dụng ngay |
| `.rpc off` | `.rpc off` | Tắt RPC tạm thời (quay về `status` trong config) |

Alias: `.presence`.

### AFK

| Lệnh | Usage | Mô tả |
|------|-------|-------|
| `.afk <reason>` | `.afk đang ngủ` | Bật AFK kèm lý do |
| `.afk` | `.afk` | Bật AFK không lý do (gọi lần 2 = tắt) |
| `.afk off` | `.afk off` | Tắt AFK |
| `.afk status` | `.afk status` | Xem trạng thái + thống kê ping |
| `.afk list` | `.afk list` | Ai đã ping trong lúc AFK |
| `.afk silent on/off` | `.afk silent on` | Chỉ react emoji, không reply |

Khi AFK:
- Ai mention / reply / ping role → selfbot reply (hoặc react nếu silent mode)
- Cooldown mặc định 60s / user (`afk.cooldownMode`: `per_user` | `global` | `none`)
- Tự tắt AFK khi chính cậu gửi tin nhắn, và thông báo "đã trở lại" vào channel cuối cùng có ping

### OwO Farm

Tự gửi lệnh cho **OwO Bot** (`408785106942164992`) trong channel đã khai báo.

| Lệnh | Usage | Mô tả |
|------|-------|-------|
| `.owo` / `.owo status` | `.owo status` | Trạng thái farm, cooldown, counter, lỗi cuối |
| `.owo start` / `.owo stop` | `.owo start` | Bật / tắt farm |
| `.owo channel add <id>` | `.owo channel add 123456789012345678` | Thêm channel farm |
| `.owo channel remove <id>` | `.owo channel remove 123...` | Bỏ channel |
| `.owo channel list` | `.owo channel list` | Danh sách channel đang farm |
| `.owo hunt on/off` | `.owo gem on` | Bật/tắt từng module: `hunt` `quest` `gem` `boss` |

**Cách hoạt động:**

| Module | Việc gửi | Nhịp mặc định |
|--------|----------|----------------|
| hunt | `owo h` | 20s (+ lệch 0-3s) |
| quest | `owo q` → đọc quest log, claim thưởng, tự làm quest (say owo, gamble, action, cookie…) | 5 phút (+ 0-5s) |
| gem | `owo inventory` → dùng gem mạnh nhất mỗi tier (`owo use 3 4`) | 30 phút (+ 0-15s) |
| boss | bấm nút **Fight** khi OwO hiện boss | theo sự kiện |

- Chỉ đọc tin từ OwO bot trong channel đã khai báo — ngoài ra không đụng gì.
- **Không tự giải captcha.** OwO hiện captcha (`captcha (n/5)`) hoặc cảnh báo → farm **tự dừng ngay**, log đỏ; vào server giải tay rồi bấm **Bật farm**. Restart bot cũng không tự bật lại khi đang khoá vì captcha/warning.
- Nhịp cố định + lệch ngẫu nhiên nhỏ để không spam; 2 lệnh cách nhau ≥ 2.5s. Không giả `launch_signature`, client hints hay "humanoid speed" — mấy trò đó để né phát hiện, không dùng.
- Boss: chỉ bấm nút có nhãn/custom_id chứa `fight`, mỗi message bấm 1 lần.
- Quest log: đọc tiến độ từ components của `owo q`, tự bấm **Claim** khi thấy nút bật, và gửi lại `owo q` sau khi claim/hoàn thành để cập nhật.
- Quest solo tự làm: say `owo`, `owo cf 1` / `owo s 1` (gamble), gửi action. Quest cần bạn bè (action/cookie/curse/prayer/battle) tự nhờ **acc phụ** đang online trong panel, gửi trong cùng channel farm; chưa có acc phụ thì các quest đó chờ.
- Tab OwO có **Quest log**: tiến độ từng quest (thanh + `n/m`), tên acc phụ, nút **Đọc quest log** (`owo q` ngay, throttle 10s) và **Làm quest ngay** (bỏ qua quest còn cooldown). Khi dừng vì captcha, panel hiện link **Mở ảnh captcha** + thời gian hạ nghỉ.
- Cài đặt lưu vào `.owo.json` (`enabled`, `paused`, `channelIds`, từng module + interval).
- Interval bị kẹp: hunt ≥ 15s, quest ≥ 2 phút, gem ≥ 5 phút; tối đa 24h.
- Mất kết nối Discord → farm tạm dừng (`offline`), không lặp lỗi; tự chạy lại khi account đăng nhập lại.
- Metrics Prometheus: `lumina_owo_running`, `lumina_owo_sent_total`, `lumina_owo_catches_total`, `lumina_owo_captcha_stops_total`, `lumina_owo_claims_total` (label `account`).

### Snipe

| Lệnh | Usage | Mô tả |
|------|-------|-------|
| `.snipe` | `.snipe` | Tin bị xoá gần nhất trong channel |
| `.snipe <n>` | `.snipe 3` | Tin bị xoá thứ n |
| `.snipe list` | `.snipe list` | Danh sách tin bị xoá |
| `.snipe @user` | `.snipe @someone` | Tin bị xoá của user |
| `.snipe stats` | `.snipe stats` | Thống kê cache |
| `.snipe clear` | `.snipe clear` | Xoá cache snipe của channel |
| `.editsnipe` | như trên | Tin bị sửa (alias `.esnipe`) |

Giới hạn 10 tin / channel. Tin gửi trước khi selfbot online sẽ không có nội dung (chỉ còn metadata).

### Aliases

- `.editsnipe` → `.esnipe`
- `.rpc` → `.presence`

Các command khác gọi bằng tên đầy đủ.

---

## Config — `config.json`

```json
{
  "sessionMaxMinutes": 0,
  "sessionWarnMinutes": 0,
  "sessionAutoStop": true,
  "sessionLogFile": "session.log",
  "dashboard": true,
  "tokenEnv": "DISCORD_TOKEN",

  "health": {
    "enabled": true,
    "intervalMs": 10000,
    "graceMs": 90000,
    "restartSpacingMs": 1500,
    "backoffBaseMs": 5000,
    "backoffMaxMs": 300000
  },

  "status": {
    "type": "PLAYING",
    "text": "quests"
  },

  "commands": {
    "prefix": ".",
    "dmSelfEnabled": true,
    "channelEnabled": true,
    "consoleEnabled": true,
    "rateLimit": {
      "enabled": true,
      "windowMs": 60000,
      "maxCommands": 10,
      "cooldownMs": 1500,
      "ignoreDuplicateMs": 3000,
      "silentOnLimit": true
    }
  },

  "typingDelay": {
    "baseMinMs": 500,
    "baseMaxMs": 1200,
    "perCharMs": 15,
    "maxMs": 3500,
    "jitterMinMs": 0,
    "jitterMaxMs": 800
  },

  "antiDetection": {
    "reactDelayMinMs": 200,
    "reactDelayMaxMs": 800
  },

  "voice": {
    "autoReconnect": true,
    "reconnectMaxAttempts": 3,
    "selfDeaf": true,
    "selfMute": false
  },

  "stream": {
    "enabled": true,
    "width": 640,
    "height": 360,
    "fps": 2,
    "bitrateKbps": 500,
    "preset": "faster",
    "captureSource": "black",
    "captureCursor": true,
    "restoreVoice": true
  },

  "owo": {
    "enabled": false,
    "channelIds": [],
    "hunt": { "enabled": true, "intervalMs": 20000 },
    "quest": { "enabled": true, "intervalMs": 300000 },
    "gem": { "enabled": false, "intervalMs": 1800000 },
    "boss": { "enabled": false }
  },

  "afk": {
    "cooldownMs": 60000,
    "cooldownMode": "per_user",
    "maxReasonLen": 200,
    "replyTemplate": "Đang AFK: {reason} ({duration})",
    "noReasonTemplate": "Đang AFK — sẽ trả lời sau ({duration})",
    "backTemplate": "Đã trở lại — cảm ơn đã ping",
    "reactEmoji": "💤",
    "autoDisableOnActivity": true,
    "announceBack": true,
    "dmReply": false,
    "ignoreBots": true,
    "ignoreUsers": [],
    "ignoreChannels": [],
    "silentMode": false,
    "persist": true
  },

  "debug": false
}
```

### Field reference

**Session:**

| Field | Ý nghĩa |
|-------|---------|
| `sessionMaxMinutes` | Thời gian session tối đa (phút) — tự dừng khi hết. **`0` = vô hạn** (mặc định, không bao giờ tự dừng) |
| `sessionWarnMinutes` | Cảnh báo khi đạt (phút). Bỏ qua khi session vô hạn |
| `sessionAutoStop` | `true` → tự dừng khi hết session |
| `sessionLogFile` | File ghi log cuối mỗi session (đường dẫn tương đối tính từ root project) |
| `dashboard` | `false` → chạy headless (chỉ log ra stdout; cũng tự bật khi không có TTY) |
| `tokenEnv` | Tên biến môi trường chứa token (mặc định `DISCORD_TOKEN`) |
| `accounts.startDelayMs` | Nghỉ giữa các lần đăng nhập account (ms, 0–60000, mặc định 3000) |

**Status + commands:**

| Field | Ý nghĩa |
|-------|---------|
| `status.type` | `PLAYING` / `LISTENING` / `WATCHING` / `STREAMING` / `COMPETING` / `CUSTOM` — set 1 lần khi ready (bị RPC ghi đè nếu RPC bật) |
| `status.text` | Nội dung status |
| `commands.prefix` | Ký tự prefix — mặc định `.` |
| `commands.dmSelfEnabled` | Nhận lệnh từ DM self |
| `commands.channelEnabled` | Nhận lệnh từ channel whitelist |
| `commands.consoleEnabled` | Nhận lệnh từ console |
| `commands.rateLimit.enabled` | Bật rate limit |
| `commands.rateLimit.windowMs` | Cửa sổ thời gian (ms) |
| `commands.rateLimit.maxCommands` | Số lệnh tối đa trong window |
| `commands.rateLimit.cooldownMs` | Cooldown giữa 2 lệnh (ms) |
| `commands.rateLimit.ignoreDuplicateMs` | Bỏ qua lệnh trùng trong X ms |
| `commands.rateLimit.silentOnLimit` | `true` → không reply khi bị limit |

**Delay:**

| Field | Ý nghĩa |
|-------|---------|
| `typingDelay.baseMinMs` / `baseMaxMs` | Delay nền trước khi gửi reply (random trong khoảng) |
| `typingDelay.perCharMs` | Cộng thêm theo độ dài tin nhắn |
| `typingDelay.maxMs` | Trần phần cộng theo độ dài |
| `typingDelay.jitterMinMs` / `jitterMaxMs` | Jitter cộng thêm |
| `antiDetection.reactDelayMinMs` / `reactDelayMaxMs` | Delay trước khi reply trong dispatcher |

**Voice + AFK:**

| Field | Ý nghĩa |
|-------|---------|
| `voice.autoReconnect` | Tự reconnect khi mất kết nối voice |
| `voice.reconnectMaxAttempts` | Số lần thử reconnect tối đa |
| `voice.selfDeaf` | Tự deaf khi vào voice |
| `voice.selfMute` | Tự mute khi vào voice |
| `stream.enabled` | `false` → chặn `.stream` |
| `stream.width` / `height` | Độ phân giải output (mặc định 1280×720) |
| `stream.fps` | Frame rate (1-60, mặc định 30) |
| `stream.bitrateKbps` | Bitrate video (500-8000) |
| `stream.preset` | Preset libx264: `ultrafast` … `veryslow` |
| `stream.captureSource` | Nguồn capture. `"black"` = hình đen lavfi, không cần display (hợp host headless); `""` = màn hình chính. Windows: `desktop`, `title=Tên cửa sổ`, `hwnd=0x...`; Linux: `:0.0`; macOS: `1:none` |
| `stream.captureCursor` | Hiện con trỏ chuột trong stream |
| `stream.autoRestart` | `true` → tự dựng lại stream khi đứt bất thường (bấm Dừng thì không) |
| `stream.autoRestartMax` | Số lần tự dựng lại tối đa mỗi phiên (0–20, mặc định 5) |
| `stream.autoRestartDelayMs` | Chờ giữa các lần dựng lại (3000–600000 ms, mặc định 10000) |
| `stream.restoreVoice` | `true` → join lại voice cũ sau khi stop stream |
| `stream.recordDir` | Thư mục lưu file `.stream watch` (mặc định `recordings/`) |
| `web.enabled` | Bật/tắt web panel (mặc định `true`) |
| `web.port` | Cổng web panel trên 127.0.0.1 (mặc định `8787`, 1024–65535) |
| `owo.enabled` | `true` → tự bật farm khi account ready (bỏ qua nếu đang khoá vì captcha/cảnh báo) |
| `owo.channelIds` | Danh sách channel ID được phép farm — phải có ít nhất 1 mới bật được |
| `owo.hunt` / `quest` / `gem` | `{ enabled, intervalMs }` — interval bị kẹp: hunt ≥ 15000, quest ≥ 120000, gem ≥ 300000 (ms) |
| `owo.boss` | `{ enabled }` — bấm nút Fight khi boss hiện |
| `afk.cooldownMs` | Cooldown giữa 2 lần reply cho cùng người ping |
| `afk.cooldownMode` | `per_user` / `global` / `none` |
| `afk.maxReasonLen` | Độ dài lý do tối đa |
| `afk.replyTemplate` | Template khi có lý do — biến: `{user}` `{tag}` `{reason}` `{duration}` `{pings}` |
| `afk.noReasonTemplate` | Template khi không có lý do |
| `afk.backTemplate` | Tin nhắn "đã trở lại" — biến: `{duration}` |
| `afk.reactEmoji` | Emoji react khi có ping (rỗng = không react) |
| `afk.autoDisableOnActivity` | Tự tắt AFK khi cậu gửi tin nhắn |
| `afk.announceBack` | Gửi tin "đã trở lại" vào channel cuối có ping |
| `afk.dmReply` | Reply cả DM không mention |
| `afk.ignoreBots` | Bỏ qua ping từ bot |
| `afk.ignoreUsers` / `ignoreChannels` | Danh sách ID bỏ qua |
| `afk.silentMode` | Chỉ react, không reply |
| `afk.persist` | Lưu AFK state vào `.afk.json` (account thứ 2+ dùng `.afk.<id>.json`) — khôi phục sau restart, tối đa 24h |
| `debug` | `true` → in log debug |

**Watchdog (health):**

| Field | Ý nghĩa |
|-------|---------|
| `health.enabled` | `false` → tắt watchdog, bot không tự đăng nhập lại |
| `health.intervalMs` | Chu kỳ quét trạng thái account (ms, mặc định 10000) |
| `health.graceMs` | Chờ thêm bao lâu sau khi mất kết nối mới đăng nhập lại (ms, mặc định 90000) |
| `health.restartSpacingMs` | Nghỉ giữa 2 lần phục hồi (ms, mặc định 1500) |
| `health.backoffBaseMs` | Backoff khởi điểm khi phục hồi liên tiếp thất bại (ms, mặc định 5000) |
| `health.backoffMaxMs` | Trần backoff (ms, mặc định 300000 = 5 phút) |

Config được **validate + clamp** khi load: giá trị sai kiểu/ngoài khoảng sẽ bị thay bằng mặc định và log cảnh báo (`Config: ...`). Field thiếu được bù từ defaults trong `src/config.js`.

---

## RPC — `rpc.json`

Rich Presence config riêng. Áp dụng khi ready, **hot reload** khi file thay đổi, và refresh định kỳ.

Account chính dùng `rpc.json`, account thứ 2+ dùng `rpc.<id>.json` (tạo tự động khi cần) — mỗi account một presence riêng.

Sửa nhanh nhất: tab **Rich Presence** trong web panel — form đầy đủ + xem trước, bấm "Lưu & áp dụng" là ghi thẳng `rpc.json` (tự backup `.bak`, kiểm tra giá trị trước, ghi atomic) và reload RPC ngay.

```json
{
  "enabled": true,
  "applyOnReady": true,
  "hotReload": true,
  "refreshInterval": 60,
  "templates": true,
  "status": "online",

  "application_id": "1100000000000000000",
  "application_name": "Visual Studio Code",
  "type": "PLAYING",

  "details": "Editing",
  "state": "index.js",

  "stream_url": "",

  "party_current": 0,
  "party_max": 0,
  "party_id": "",

  "large_image": "",
  "large_text": "",

  "small_image": "",
  "small_text": "",

  "buttons": [
    { "label": "GitHub", "url": "https://github.com/" }
  ],
  "button1_label": "",
  "button1_url": "",
  "button2_label": "",
  "button2_url": "",

  "timestamp_mode": "start",
  "start_timestamp": "now",
  "end_timestamp": 0
}
```

**Cơ chế:**

| Field | Ý nghĩa |
|-------|---------|
| `enabled` | `false` → tắt RPC, dùng `status` trong `config.json` (`.rpc on` bật tạm, bỏ qua cờ này) |
| `applyOnReady` | `false` → không áp dụng lúc khởi động (vẫn dùng được `.rpc reload`) |
| `hotReload` | `true` → tự reload khi `rpc.json` đổi (debounce) |
| `refreshInterval` | Giây giữa các lần refresh; tối thiểu 15, mặc định 60; `0` = tắt |
| `templates` | `true` → render biến trong text (xem bên dưới) |

**Template variables** — dùng trong `details`, `state`, `large_text`, `small_text`, `party_id`, `stream_url`, `button*_label`:

| Biến | Giá trị |
|------|---------|
| `{user}` | Username |
| `{tag}` | Tag đầy đủ |
| `{id}` | User ID |
| `{guilds}` | Số guild |
| `{ping}` | Gateway ping (ms) |
| `{uptime}` | Thời gian selfbot chạy |
| `{clock}` | Giờ hiện tại `HH:MM` |
| `{date}` | Ngày hiện tại `YYYY-MM-DD` |
| `{status}` | Trạng thái online/idle/dnd |

**Buttons:** hỗ trợ tối đa 2 nút. Có thể dùng mảng `buttons: [{ label, url }]`, hoặc 2 cặp `button1_label`/`button1_url`, `button2_label`/`button2_url`. URL phải là `http(s)://`.

Các field `details_url`, `state_url`, `large_url`, `small_url` **không còn được hỗ trợ** — gateway của selfbot không serialize chúng, nên đã bỏ khỏi config mẫu.

Text dùng font "fancy" (mathematical/fullwidth) sẽ bị Discord ẩn — tool tự strip các ký tự đó.

### Cách lấy `application_id` + upload ảnh

**Bắt buộc nếu muốn hiện assets (ảnh) và buttons.**

1. Vào `https://discord.com/developers/applications`
2. **New Application** → đặt tên
3. Copy **Application ID** (18-19 số) → dán vào `rpc.json` → `application_id`
4. Tab **Rich Presence** → **Art Assets** → **Add Image**
5. Upload ảnh PNG/JPG/WebP (min 512×512)
6. Đặt **key** (ví dụ `vscode`, `cross`) → dùng làm `large_image` / `small_image`
7. Đợi Discord duyệt (1-5 phút)

Hoặc dùng external URL (Imgur, GitHub raw):
```json
"large_image": "https://i.imgur.com/abc123.png"
```

Tool sẽ **upload external asset** qua Discord (`RichPresence.getExternal`) rồi dùng path trả về — cache 1 giờ cho URL thành công, 5 phút cho URL lỗi.

**Lưu ý:** URL phải là **direct link** (kết thúc `.png`/`.jpg`/`.webp`). Discord CDN URL dùng trực tiếp được; URL ngoài sẽ upload qua app đã đăng ký (cần `application_id`).

### Timestamp formats

| Input | Kết quả |
|-------|---------|
| `"now"` | Hiện tại |
| `"now - 5h30m"` | 5h30m trước |
| `"now + 2h"` | 2h sau |
| `"now - 3d"` | 3 ngày trước |
| `1730000000` | Unix seconds |
| `1730000000000` | Unix ms (tự convert) |
| `0` / `""` | Không dùng timestamp |

### Timestamp mode

| Mode | Hành vi |
|------|---------|
| `start` | Chỉ dùng `start_timestamp` — hiện "X minutes elapsed" |
| `end` | Chỉ dùng `end_timestamp` — hiện "X minutes left" |
| `both` | Dùng cả 2 |
| `none` | Không timestamp |

### Giới hạn user account

| Field | User account |
|-------|:-:|
| `name`, `type`, `url` | ✅ Luôn hiện |
| `details`, `state` | ✅ Hiện |
| `timestamps` | ✅ Hiện |
| `assets` | ⚠️ Chỉ hiện nếu `application_id` có app registered |
| `buttons` | ⚠️ Tương tự |
| `party` | ⚠️ Tương tự |

**Bot account thấy buttons**, bản thân không thấy. Đây là behavior của Discord, không phải bug.

---

## Bảo mật

### Token

- **Không commit** `tokens.txt` — `.gitignore` đã block
- **Không share** token với ai
- **Không paste** vào chat công khai
- Token bị leak → vào Discord → User Settings → My Account → **Log Out All Known Devices** → reset mật khẩu

### File permissions (Unix)

`tokens.txt` nên `chmod 600`. Selfbot tự warn nếu phát hiện permission mở.

```bash
chmod 600 tokens.txt
chmod 600 rpc.json
chmod 600 session.log
chmod 600 .afk.json
```

### Chỉ nhận lệnh từ chính mình

| Cơ chế | Chi tiết |
|--------|----------|
| **Chặn author** | Chỉ nhận lệnh từ chính selfbot user — `msg.author.id === client.user.id` |
| **Whitelist channel** | Chỉ DM self + channel có ID trong `channel.txt` |
| **Rate limit window** | 10 lệnh / 60s |
| **Cooldown** | 1.5s giữa các lệnh |
| **Duplicate filter** | Bỏ qua lệnh trùng trong 3s |
| **Silent on limit** | Không reply khi bị limit |
| **Session cap** | Tự dừng sau `sessionMaxMinutes` (`0` = không giới hạn) |

### Khi nào có thể bị flag

- Gửi nhiều lệnh liên tục (vượt rate limit)
- Mass DM / auto-reply
- Join/leave voice liên tục
- Chạy 24/7 không nghỉ

---

## API đang dùng

### Gateway Discord (qua `discord.js-selfbot-v13`)

| Opcode | Sự kiện | Mục đích |
|--------|---------|----------|
| Op 2 | IDENTIFY | Kết nối ban đầu với token |
| Op 1 | HEARTBEAT | Duy trì kết nối |
| Op 6 | RESUME | Reconnect sau khi mất kết nối |

**Events lắng nghe:**
- `ready` — client khởi động xong
- `messageCreate` — filter + dispatch command, cache tin, AFK
- `messageDelete`, `messageUpdate` — snipe
- `error`, `warn` — log
- `rateLimited` — log
- `shardDisconnect`, `shardReconnecting`, `shardResume`, `shardError` — log

### Voice Gateway (qua `@discordjs/voice`)

| Opcode | Mục đích |
|--------|----------|
| Op 0 | IDENTIFY — kết nối voice |
| Op 1 | SELECT_PROTOCOL — chọn protocol (UDP) |
| Op 2 | READY — server trả về SSRC + IP + port |
| Op 3 | HEARTBEAT — ping |
| Op 4 | SESSION_DESCRIPTION — server trả về secret key |
| Op 5 | SPEAKING — đánh dấu đang nói |

**Encryption:** `aead_xchacha20_poly1305_rtpsize` (mặc định lib).

**DAVE/E2EE:** `@discordjs/voice` 0.19.2 dùng `@snazzah/davey` — bắt buộc từ 03/2026.

**UDP:** RTP packet qua UDP hole punching.

### Go Live stream (native lib)

| Bước | API |
|------|-----|
| Join voice | `client.voice.joinChannel(channel, { videoCodec: 'H264' })` |
| Tạo stream | `connection.createStreamConnection()` |
| Gửi video | `streamConnection.playVideo(source, { fps, bitrate, inputFFmpegArgs, outputFFmpegArgs })` |

Capture màn hình do ffmpeg đảm nhận (`gdigrab` / `x11grab` / `avfoundation`), encode H264 baseline, đóng gói RTP rồi gửi qua voice UDP.

**Gateway ops:** 18 tạo stream · 19 delete · 20 watch · 21 ping server · 22 set paused.
**Events:** `STREAM_CREATE` (kèm `rtc_server_id` / `rtc_channel_id`) · `STREAM_SERVER_UPDATE` · `STREAM_UPDATE` · `STREAM_DELETE`.
Stream RTC là connection riêng, tách khỏi parent voice; parent voice vẫn phải giữ kết nối.

### Discord Rich Presence (gateway)

Gửi qua `client.user.setPresence()`:
```js
client.user.setPresence({
  activities: [activityObject],
  status: 'online',
});
```

Activity object:
```js
{
  name, type, url,
  details, state,
  timestamps: { start, end },
  assets: { large_image, large_text, small_image, small_text },
  buttons: ['Label 1', 'Label 2'],
  metadata: { button_urls: ['https://...', 'https://...'] },
  party: { id, size: [current, max] },
  application_id,
  ...
}
```

Selfbot gateway serialize buttons dạng `labels + metadata.button_urls` (khác bot thường).

**Không dùng Local RPC** (`127.0.0.1:6463`) — chỉ cần gateway, không cần Discord desktop chạy.

---

## Rate limit — cơ chế

Config:
```json
"rateLimit": {
  "enabled": true,
  "windowMs": 60000,
  "maxCommands": 10,
  "cooldownMs": 1500,
  "ignoreDuplicateMs": 3000,
  "silentOnLimit": true
}
```

**Test:**
- Gửi `.cmd` 2 lần trong 3s → lần 2 bị ignore (duplicate)
- Gửi `.cmd` rồi `.ping` sau 1s → bị block (cooldown 1.5s)
- Gửi 15 lệnh trong 1 phút → lệnh 11+ bị block (window)
- `silentOnLimit: true` → không reply khi bị block

**Console không bị rate limit** — chỉ DM + channel.

---

## Session log

Mặc định session **vô hạn** (`sessionMaxMinutes: 0`) — bot không tự dừng. Muốn giới hạn thì đặt `sessionMaxMinutes` (ví dụ `360` = 6 giờ) và `sessionWarnMinutes` (ví dụ `300` = cảnh báo trước 1 giờ).

File `session.log` (đổi được qua `config.json` → `sessionLogFile`) — JSON Lines format. Mỗi session 1 dòng:

```json
{"startedAt":"2026-09-20T10:00:00.000Z","endedAt":"2026-09-20T16:00:00.000Z","durationSec":21600,"maxSec":21600}
```

- `durationSec` — thời gian thực chạy
- `maxSec` — giới hạn session cấu hình
- Nếu `durationSec < maxSec` → session dừng sớm (user tắt hoặc crash)
- File tự xoay vòng khi > 1 MB: đổi tên thành `session.log.1` (giữ 1 bản), rồi tạo file mới

Xem log cũ:
```bash
type session.log
# hoặc
tail -f session.log   # Unix
```

---

## Troubleshooting

### Thiếu deps / `Cannot find module`
```bash
npm install
```

Nếu `npm install` báo lockfile lệch (`@discordjs/voice` 0.18 vs 0.19.2), chạy lại `npm install` để npm cập nhật `package-lock.json`; không cần xoá lock.

### `Không có token — đặt DISCORD_TOKEN hoặc tạo ...tokens.txt`
- Đặt biến môi trường `DISCORD_TOKEN` (hoặc tên trong `config.tokenEnv`), hoặc
- Tạo `tokens.txt` ở root project, mỗi dòng 1 token
- Bỏ dòng trống và comment (`#`)

### `Không account nào đăng nhập được — thoát`
- Log có `An invalid token was provided.` → token sai/hết hạn, sửa lại dòng tương ứng
- Token bị chặn 2FA → không login được, phải bỏ 2FA
- Tất cả account đều fail → kiểm tra mạng/VPN
- Bot vẫn chạy được nếu **ít nhất 1** account login thành công; account lỗi được đánh dấu `lỗi` trong `.accounts` / web panel

### Voice timeout 30s
- Firewall block UDP → mở port hoặc tắt firewall tạm
- VPN đang bật → tắt
- Thử voice channel khác
- Node < 22.12 hoặc `@discordjs/voice` < 0.19.2 → không có DAVE, Discord chặn

### Voice crash / process tự thoát
- Đã thêm listener `error` cho voice connection + bắt `unhandledRejection` / `uncaughtException`
- Nếu vẫn thoát: bật `debug: true`, chạy lại, gửi log quanh thời điểm crash
- Kiểm tra Node >= 22.12 và đã `npm install` lại sau khi update

### `.stream` báo không tìm thấy ffmpeg
- Chạy `npm install` để cài `ffmpeg-static` (optional)
- Hoặc cài ffmpeg có libx264 vào PATH, kiểm tra:
  ```bash
  ffmpeg -hide_banner -encoders | findstr libx264
  ```

### `.stream` join fail / timeout (DAVE)
- Discord bắt buộc DAVE/E2EE từ 03/2026; native stack chưa hỗ trợ → Go Live có thể bị từ chối
- `.stream watch` cũng đi qua native stack → chịu rủi ro DAVE giống Go Live
- `.voice` vẫn dùng `@discordjs/voice` 0.19.2 (DAVE OK), chỉ `.stream` bị ảnh hưởng

### Stream vào nhưng màn hình đen
- Nếu `stream.captureSource: "black"` → đen là đúng thiết kế
- DRM / protected content (Netflix, app exclusive-fullscreen) → luôn đen, không sửa được
- Thử chạy app ở windowed/borderless thay vì exclusive fullscreen
- Capture màn hình thật: đặt `stream.captureSource: ""` (Linux cần `DISPLAY`)
- Bật `debug: true` để xem log ffmpeg (`ffmpeg:` trong dashboard)

### `.cmd` gửi trong DM không reply
- Token đúng chưa? Login thành công chưa?
- `dmSelfEnabled: true` trong config?
- Debug: bật `debug: true`, chạy lại, xem log có `Recv:` không

### `.snipe` không có nội dung tin
- Tin đó gửi trước khi selfbot online → không có trong cache
- Cache giữ 30 phút / tối đa 2000 tin

### Console không nhận lệnh
- `consoleEnabled: true` trong config?
- Dashboard chiếm stdin — gõ lệnh trực tiếp vào terminal đang chạy, không mở terminal khác

### RPC không hiện assets
- `application_id` hợp lệ chưa (18-19 số)?
- Ảnh đã upload vào app chưa?
- Key đúng chưa (case-sensitive)?
- Đợi 1-5 phút sau khi upload
- URL ngoài Discord phải là direct link; tool upload qua `getExternal` — xem log `RPC:` nếu lỗi
- User account không tự thấy buttons của chính mình; nhờ account khác/bot kiểm tra

### `.rpc` không áp dụng
- `rpc.json` sai JSON → log `RPC: ... sai JSON`
- `enabled: false` hoặc đang `applyOnReady: false` → dùng `.rpc reload`
- Đã `.rpc off` trước đó → `.rpc on`
- `refreshInterval` < 15 sẽ bị kẹp về 15

### Dashboard không hiện
- Thiếu TTY / chạy qua pipe → tự chuyển headless (log thẳng ra stdout)
- `dashboard: false` trong config → luôn headless
- Console vẫn gõ lệnh được ở headless

### Session không tự dừng
- `sessionAutoStop: true` trong config?
- Timer check mỗi 60s — có thể trễ tối đa 1 phút

### Account rớt / không tự vào lại
- Watchdog bật chưa? (`health.enabled`) — log lúc khởi động có dòng `Watchdog: quét mỗi Xs, chờ Ys rồi đăng nhập lại`
- Mất kết nối → phải chờ đủ `health.graceMs` (mặc định 90s) mới được thử lại
- Token hỏng vĩnh viễn (`invalidated`) → watchdog cố tình **không** thử; sửa token rồi bấm **Thử lại** trong web panel
- Account đang voice/stream được phục hồi trước, các account khác chờ sau
- Tắt hẳn watchdog khi debug: `health.enabled: false`

---

## License

Private use. Not for redistribution.

## Credits

Built by Lumina
