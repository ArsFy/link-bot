const config = require('./config');
const TelegramBot = require('node-telegram-bot-api');
const pixiv = require('./pixiv');
const fs = require('fs');
const MongoPool = require("./db-pool")

// Rules
const rules = {
    'pixiv.net': pixiv.main
}
const includes = (msg, callback, chatId) => {
    for (const rule in rules) {
        if (msg.includes(rule)) {
            const regex = new RegExp(`${rule}\/[^ \n]*`, 'gi');
            const matchedURLs = msg.match(regex);
            if (matchedURLs) rules[rule](matchedURLs, callback, chatId);
        }
    }
}

// Create image folder
try { fs.mkdirSync("./image") } catch (e) { }

// Init DB
MongoPool.initPool()

// Init Bot
let username = "";
const bot = new TelegramBot(config.BOT_TOKEN, { polling: true });
bot.on("polling_error", console.log);
bot.getMe().then(me => username = me.username);

const sendPhoto = (msg, filenames, chatId, hasSpoiler) => {
    filenames = filenames.slice(0, 6);
    const tasks = filenames.map(photoPath => {
        return new Promise(async (resolve, reject) => {
            try {
                const client = await MongoPool.getInstance();
                const collection = client.db(config.DB_NAME).collection("file-cache");
                const res = await collection.find({ photo_path: photoPath }).toArray();

                if (res.length > 0) {
                    resolve({ photo: [{ file_id: res[0].file_id, photoPath }] });
                } else {
                    let r = await bot.sendPhoto(config.TEMP_CHAT, fs.readFileSync(photoPath));
                    resolve({
                        ...r,
                        photoPath: String(photoPath),
                    });
                }
            } catch (err) {
                console.error(err);
                reject(err);
            }
        });
    });

    Promise.all(tasks).then((r) => {
        const images = []
        for (let i = 0; i < r.length; i++) {
            const file_id = r[i].photo.pop().file_id;
            images.push({
                type: 'photo',
                media: file_id,
                ...(i == 0 ? { caption: msg, parse_mode: 'Markdown' } : {}),
                has_spoiler: hasSpoiler
            })
            if (r[i].photoPath) MongoPool.getInstance().then(client => {
                const collection = client.db(config.DB_NAME).collection("file-cache");
                collection.insertOne({ photo_path: r[i].photoPath, file_id })
                    .then(() => { })
                    .catch(err => console.error(err));
            }).catch(err => {
                console.error(err);
            });
        }

        bot.sendMediaGroup(chatId, images)
    }).catch(console.error);
}

bot.on('message', (msg) => {
    const chatId = msg.chat.id;

    if (msg.text && msg.text.startsWith("/")) {
        switch (msg.text) {
            case "/random": case "/random@" + username:
                pixiv.random(sendPhoto, chatId)
                break;
            case "/help": case "/help@" + username:
                bot.sendMessage(chatId, "/random - Random image from pixiv\n/help - Show this message")
                break;
        }
    } else if (msg.text || msg.caption || msg.caption_entities) {
        let msgText = [];
        if (msg.text) msgText.push(msg.text);
        if (msg.caption) msgText.push(msg.caption);
        if (msg.caption_entities && msg.caption_entities.length > 0) {
            for (const entity of msg.caption_entities) {
                if (entity.type === "text_link") {
                    msgText.push(entity.url);
                }
            }
        }
        includes(msgText.join(" "), sendPhoto, chatId)
    }

});

console.log("Bot starting...");