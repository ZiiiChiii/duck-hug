# 抱抱鴨・接住小鴨 🦆

手機上玩的 3D 小遊戲：小鴨從天上掉下來，看準時機按「接住！」。

- **單人模式**：連續接越多隻，掉落花招越多（彈跳、飄浮、衝刺、搖擺、隱形、二段跳、組合技）
- **雙人連線**：建立房間、把 4 位數房號或邀請連結傳給朋友，輪流拋鴨、接鴨
- **排行榜**：輸入名字登記成績，單人與雙人合作分開排名，可以分享給朋友

## 架構

整個遊戲跑在一個 Cloudflare Worker 上：

| 路徑 | 用途 |
|---|---|
| `public/` | 網頁（Three.js 3D 鴨子、遊戲邏輯） |
| `src/worker.js` | 伺服器：`/api/room/{房號}` 雙人連線（WebSocket）、`/api/scores` 排行榜 |
| `wrangler.toml` | Cloudflare 設定（Durable Objects：Room、Board） |

## 部署

這個 repo 連到 Cloudflare Workers 後，每次推到 `main` 就會自動更新網站。
