# Photo Link Bot

![](https://img.shields.io/badge/NodeJS-v20-green)

### ENV
- `TEMP_CHAT` - Empty Chat ID (Save Photo)
- `BOT_TOKEN` - Telegram Bot Token
- `PIXIV_COOKIE` - Pixiv Full Cookie
- `TWITTER_AUTHORIZATION` - Twitter HTTP Auth
- `TWITTER_COOKIE` - Twitter Full Cookie
- `TWITTER_CSRF` - Twitter CSRF Header
- `MONGODB_URI` - MongoDB URI
- `ADMIN` - Your TG ID (Number)
- `ENABLED_NSFWJS` - Enabled nsfw.js (`twitter.js:89`), set `true` or `false`

#### How to get twitter header

```bash
cd twitter-tools
npm i
node main.js
```

### Start
```bash
node main.js
```