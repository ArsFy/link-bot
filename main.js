const config = require('./config');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const MongoPool = require("./db-pool");
const pixiv = require('./pixiv');
const twitter = require('./twitter');

// Rules
const rules = {
    'pixiv.net': pixiv.main,
    'twitter.com': twitter.main,
}
const includes = (msg, callback, chatId, isPhoto) => {
    for (const rule in rules) {
        if (msg.includes(rule)) {
            const regex = new RegExp(`${rule}\/[^ \n]*`, 'gi');
            const matchedURLs = msg.match(regex);
            if (matchedURLs) {
                if (isPhoto && rule != "pixiv.net") continue;
                rules[rule](matchedURLs, !isPhoto ? callback : () => { }, chatId);
            }
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
            case "/set": case "/set@" + username:
                const command = msg.text.split(" ");
                if (command.length == 2) {
                    if (msg.chat.type === "private") {
                        bot.sendMessage(chatId, "This command only works in group")
                        return;
                    } else bot.getChatAdministrators(chatId).then(administrators => {
                        const isAdmin = administrators.some(admin => admin.user.id === msg.from.id);
                        if (isAdmin) {
                            MongoPool.getInstance().then(async client => {
                                const collection = client.db(config.DB_NAME).collection("group");
                                await collection.updateOne({ id: chatId }, { $set: { id: chatId, status: command[1] } }, { upsert: true });
                                bot.sendMessage(chatId, "Success");
                            }).catch(err => {
                                console.error(err)
                                bot.sendMessage(chatId, "Failed to set status")
                            })
                        } else {
                            bot.sendMessage(chatId, "Only administrators can use this command");
                        }
                    }).catch(err => {
                        console.error(err);
                    });
                } else {
                    bot.sendMessage(chatId, "/set [on/off] - Turn on/off the bot in group")
                }
        }
    } else if (msg.text || msg.caption || msg.caption_entities) {
        MongoPool.getInstance().then(async client => {
            const collection = client.db(config.DB_NAME).collection("group");
            const res = await collection.find({ id: chatId }).toArray();

            if (res.length > 0 && res[0].status == "off") return;

            if (msg.text) includes(msg.text, sendPhoto, chatId, false)
            let msgText = [];
            if (msg.caption) msgText.push(msg.caption);
            if (msg.caption_entities && msg.caption_entities.length > 0) {
                for (const entity of msg.caption_entities) {
                    if (entity.type === "text_link") {
                        msgText.push(entity.url);
                    }
                }
            }
            includes(msg.text, sendPhoto, chatId, true)
        }).catch(err => {
            console.error(err)
        })

    }

});

console.log("Bot starting...");