const config = {
    MONGODB_URI: process.env.MONGODB_URI,
    BOT_TOKEN: process.env.BOT_TOKEN,
    TEMP_CHAT: process.env.TEMP_CHAT,
    PIXIV_COOKIE: process.env.PIXIV_COOKIE,
    TWITTER_AUTHORIZATION: process.env.TWITTER_AUTHORIZATION,
    TWITTER_COOKIE: process.env.TWITTER_COOKIE,
    TWITTER_CSRF: process.env.TWITTER_CSRF,
    ADMIN: process.env.ADMIN,
    ENABLED_NSFWJS: process.env.ENABLED_NSFWJS == "true",
    ENABLED_SEARCH: process.env.ENABLED_SEARCH == "true",
}

module.exports = config;