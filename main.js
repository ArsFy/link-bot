const config = require('./config');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const MongoPool = require("./db-pool");
const pixiv = require('./pixiv');
const twitter = require('./twitter');
const { imageHashAsync, searchImage } = require('./phash');

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
                    const chatName = fromChat.title || fromChat.username || 'Unknown Chat';
                    const chatLink = fromChat.username ? `https://t.me/${fromChat.username}` : '';
                    const msgInfo = await bot.sendPhoto(config.TEMP_CHAT, fs.readFileSync(photoPath), {
                        caption: msg + `\n\nFrom [${chatName}](${chatLink})`,
                        parse_mode: 'Markdown'
                    });
                    let imageHash, parts;
                    if (config.ENABLED_SEARCH) {
                        imageHash = await imageHashAsync(photoPath, 16, true);
                        parts = [
                            imageHash.substring(0, imageHash.length / 4),
                            imageHash.substring(imageHash.length / 4, imageHash.length / 2),
                            imageHash.substring(imageHash.length / 2, imageHash.length * 3 / 4),
                            imageHash.substring(imageHash.length * 3 / 4),
                        ];
                    }
                    resolve({
                        ...msgInfo,
                        photoPath: String(photoPath),
                        ...(config.ENABLED_SEARCH ? {
                            hash: imageHash,
                            hashPart1: parts[0],
                            hashPart2: parts[1],
                            hashPart3: parts[2],
                            hashPart4: parts[3]
                        } : {})
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
                collection.insertOne({
                    photo_path: r[i].photoPath,
                    file_id,
                    ...(config.ENABLED_SEARCH ? {
                        hash: r[i].hash,
                        hashPart1: r[i].hashPart1,
                        hashPart2: r[i].hashPart2,
                        hashPart3: r[i].hashPart3,
                        hashPart4: r[i].hashPart4
                    } : {})
                }).then(() => { }).catch(err => console.error(err));
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
                [pixiv.random, twitter.random][Math.floor(Math.random() * 2)](sendPhoto, chatId);
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
            case "/search": case "/search@" + username:
                if (config.ENABLED_SEARCH) if (msg.reply_to_message && msg.reply_to_message.photo) {
                    const this_file = msg.reply_to_message.photo.pop();
                    const this_file_id = this_file.file_id;
                    bot.downloadFile(this_file_id, "./image/").then((filepath) => {
                        MongoPool.getInstance().then(async client => {
                            const db = client.db(config.DB_NAME);
                            searchImage(filepath, 16, true, db, 0.8).then(results => {
                                try { fs.unlink(filepath) } catch (e) { }
                                if (results.length > 0) {
                                    const photoPath = results[0].image.photo_path;
                                    db.collection("pixiv-images").find({ filenames: { $in: [photoPath] } }).toArray().then(res => {
                                        if (res.length > 0) {
                                            const illust = res[0];
                                            const tags = illust.tags;
                                            const filenames = illust.filenames;
                                            sendPhoto(`ID: [${illust.id}](https://pixiv.net/i/${illust.id})\nTitle: ${illust.title}\nUser: [${illust.userName}](https://pixiv.net/users/${illust.userId})\n\nTags: #${tags.join('  #')}`, filenames, chatId, tags.indexOf("R18") !== -1)
                                        }
                                    }).catch(err => {
                                        console.error(err)
                                        bot.sendMessage(chatId, "Failed to search")
                                    })
                                    db.collection("twitter-images").find({ filenames: { $in: [photoPath] } }).toArray().then(res => {
                                        if (res.length > 0) {
                                            const tweet = res[0];
                                            const filenames = tweet.filenames;
                                            sendPhoto(`ID: [${tweet.id}](${tweet.link})\nUser: [${tweet.username}](${tweet.userlink})\n\n${tweet.post}`, filenames, chatId, !!tweet.isHentai)
                                        }
                                    }).catch(err => {
                                        console.error(err)
                                        bot.sendMessage(chatId, "Failed to search")
                                    })
                                } else bot.sendMessage(chatId, "No similar images found")
                            }).catch(err => {
                                console.error(err)
                                bot.sendMessage(chatId, "Failed to search")
                            })
                        }).catch(err => {
                            console.error(err)
                            bot.sendMessage(chatId, "Failed to search")
                        })
                    })
                } else {
                    bot.sendMessage(chatId, "Reply to a photo to search")
                } else bot.sendMessage(chatId, "Search is disabled")
                break;
            case "/help": case "/help@" + username:
                bot.sendMessage(chatId, [
                    "/status - Bot Status",
                    "/random - Random image from pixiv or twitter",
                    "/search - Search similar image from database",
                    "/set [on/off] - Turn on/off the bot in group",
                    "/help - Show this message"
                ].join("\n"))
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