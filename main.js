const config = require('./config');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const MongoPool = require("./db-pool");
const pixiv = require('./pixiv');
const twitter = require('./twitter');

// Group Setting Cache
const groupSetting = {};

// Rules
const rules = {
    'pixiv.net': pixiv.main,
    'twitter.com': twitter.main,
    'x.com': twitter.main
}
const includes = (msg, callback, chatId, isPhoto, formId) => {
    for (const rule in rules) {
        if (msg.includes(rule)) {
            const regex = new RegExp(`${rule}\/[^ \n]*`, 'gi');
            const matchedURLs = msg.match(regex);
            if (matchedURLs) {
                if (rule == "pixiv.net") bot.setMessageReaction(chatId, formId, { reaction: [{ type: 'emoji', emoji: '❤️' }] });
                rules[rule](matchedURLs, !isPhoto ? callback : () => {
                    bot.setMessageReaction(chatId, formId, {
                        reaction: [{ type: 'emoji', emoji: '🥰' }]
                    });
                }, chatId);
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
                    const fromChat = await bot.getChat(chatId)
                    let chatName = fromChat.title || fromChat.username || 'Unknown Chat';
                    let chatLink = fromChat.username ? `https://t.me/${fromChat.username}` : '';
                    let r = await bot.sendPhoto(config.TEMP_CHAT, fs.readFileSync(photoPath), {
                        caption: msg + `\n\nFrom [${chatName}](${chatLink})`,
                        parse_mode: 'Markdown'
                    });
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
        const command = msg.text.split(" ");
        switch (command[0]) {
            case "/random": case "/random@" + username:
                [pixiv.random, twitter.random][Math.floor(Math.random() * functions.length)](sendPhoto, chatId);
                break;
            case "/start": case "/start@" + username:
                bot.sendMessage(chatId, "This Bot will parse the link and send pictures/text when a specific link appears in the group.\nUse /help to see the list of commands\n\nRepo: https://github.com/ArsFy/link-bot")
                break;
            case "/status": case "/status@" + username:
                MongoPool.getInstance().then(async client => {
                    const pixiv = client.db(config.DB_NAME).collection("pixiv-images");
                    const pixivCount = await pixiv.countDocuments();
                    const twitter = client.db(config.DB_NAME).collection("twitter-images");
                    const twitterCount = await twitter.countDocuments();
                    bot.sendMessage(chatId, `Pixiv: ${pixivCount}\nTwitter: ${twitterCount}`)
                })
                break;
            case "/delete": case "/delete@" + username:
                if (config.ADMIN && msg.from.id == config.ADMIN) {
                    if (command.length == 3) {
                        const collectionName = command[1] == "pixiv" ? "pixiv-images" : "twitter-images";
                        MongoPool.getInstance().then(async client => {
                            const collection = client.db(config.DB_NAME).collection(collectionName);
                            await collection.deleteOne({ id: command[1] });
                            bot.sendMessage(chatId, "Success")
                        }).catch(err => {
                            console.error(err)
                            bot.sendMessage(chatId, "Failed to delete")
                        })
                    } else {
                        bot.sendMessage(chatId, "/delete [pixiv/twitter] [id]")
                    }
                } else {
                    bot.sendMessage(chatId, "You are not authorized to use this command")
                }
            case "/help": case "/help@" + username:
                bot.sendMessage(chatId, "/status - Bot Status\n/random - Random image from pixiv or twitter\n/set [on/off] - Turn on/off the bot in group\n/help - Show this message")
                break;
            case "/set": case "/set@" + username:
                if (command.length == 2) {
                    if (msg.chat.type === "private") {
                        bot.sendMessage(chatId, "This command only works in group")
                        return;
                    } else bot.getChatAdministrators(chatId).then(administrators => {
                        const isAdmin = administrators.some(admin => admin.user.id === msg.from.id);
                        if (isAdmin) {
                            if (command[1] != "on" && command[1] != "off") {
                                bot.sendMessage(chatId, "/set [on/off] - Turn on/off the bot in group")
                            } else MongoPool.getInstance().then(async client => {
                                const collection = client.db(config.DB_NAME).collection("group");
                                await collection.updateOne({ id: chatId }, { $set: { id: chatId, status: command[1] } }, { upsert: true });
                                groupSetting[chatId] = command[1];
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
    } else if (msg.chat.type != "private" && (msg.text || msg.caption || msg.caption_entities)) {
        const run = () => {
            if (msg.text) includes(msg.text, sendPhoto, chatId, false, msg.message_id)
            let msgText = [];
            if (msg.caption) msgText.push(msg.caption);
            if (msg.caption_entities && msg.caption_entities.length > 0) {
                for (const entity of msg.caption_entities) {
                    if (entity.type === "text_link") {
                        msgText.push(entity.url);
                    }
                }
            }
            includes(msgText.join(" "), sendPhoto, chatId, true, msg.message_id)
        }

        if (groupSetting[chatId] == undefined) {
            MongoPool.getInstance().then(async client => {
                const collection = client.db(config.DB_NAME).collection("group");
                const res = await collection.find({ id: chatId }).toArray();

                if (res.length > 0 && res[0].status == "off") {
                    groupSetting[chatId] = "off";
                    return;
                } else groupSetting[chatId] = "on";

                run()
            }).catch(err => {
                console.error(err)
            })
        } else if (groupSetting[chatId] == "on") run()
    }

});

console.log("Bot starting...");