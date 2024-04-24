const config = require('./config');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const MongoPool = require("./db-pool");
const pixiv = require('./pixiv');
const twitter = require('./twitter');
const danbooru = require('./danbooru');
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
let username = "", me_id = -1;
const bot = new TelegramBot(config.BOT_TOKEN, { polling: true });
bot.on("polling_error", console.log);
bot.getMe().then(me => {
    username = me.username;
    me_id = me.id;
});

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

const i18n = {
    'zh': {
        "start": "這個 Bot 會解析連結，當特定連結出現在群組時，會發送圖片/文字。\n使用 /help 來查看指令列表\n\nRepo: https://github.com/ArsFy/link-bot",
        "new_chat": "在把這個 Bot 加入到新的群組時，需要先得到白名單才能正常使用。\n如果您想要在您的群組中使用這個 Bot，請聯繫 @{username} 並提供群組 ID。",
        "new_chat_allow": "您的群組已經被授權使用此 Bot，使用 /help 來查看指令列表。",
        "failed_to_del": "刪除失敗",
        "failed_to_search": "搜尋失敗",
        "failed_to_set_status": "設置狀態失敗",
        "success": "成功",
        "auth": "您未被授權使用此指令",
        "no_similar_image": "沒有找到相似的圖片",
        "reply_photo_search": "回覆一張圖片來搜尋",
        "search_disabled": "搜尋已禁用",
        "help": [
            "/status - Bot 狀態",
            "/random - 從 pixiv 或 twitter 發送隨機圖片",
            "/search - 從 數據庫/danbooru 搜尋相似圖片",
            "/set [on/off] - 在群組中開啟/關閉 Bot",
            "/help - 顯示這條訊息"
        ],
        "only_group": "此指令僅在群組中有效"
    },
    'en': {
        "start": "This Bot will parse the link and send pictures/text when a specific link appears in the group.\nUse /help to see the list of commands\n\nRepo: https://github.com/ArsFy/link-bot",
        "new_chat": "When adding this Bot to a new group, you need to get whitelisted before you can use it normally.\nIf you want to use this Bot in your group, please contact @{username} and provide the group ID.",
        "new_chat_allow": "Your group has been authorized to use this Bot, use /help to see the list of commands.",
        "failed_to_del": "Failed to delete",
        "failed_to_search": "Failed to search",
        "failed_to_set_status": "Failed to set status",
        "success": "Success",
        "auth": "You are not authorized to use this command",
        "no_similar_image": "No similar images found",
        "reply_photo_search": "Reply to a photo to search",
        "search_disabled": "Search is disabled",
        "help": [
            "/status - Bot Status",
            "/random - Random image from pixiv or twitter",
            "/search - Search similar image from database / danbooru",
            "/set [on/off] - Turn on/off the bot in group",
            "/help - Show this message"
        ],
        "only_group": "This command only works in group"
    }
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
                bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].start)
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
                            bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].success)
                        }).catch(err => {
                            console.error(err)
                            bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].failed_to_del)
                        })
                    } else {
                        bot.sendMessage(chatId, "/delete [pixiv/twitter] [id]")
                    }
                } else {
                    bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].auth)
                }
                break;
            case "/search": case "/search@" + username:
                if (config.ENABLED_SEARCH) if (msg.reply_to_message && msg.reply_to_message.photo) {
                    bot.setMessageReaction(chatId, msg.message_id, {
                        reaction: [{ type: 'emoji', emoji: '👌' }]
                    });

                    const this_file = msg.reply_to_message.photo.pop();
                    const this_file_id = this_file.file_id;
                    bot.downloadFile(this_file_id, "./image/").then((filepath) => {
                        MongoPool.getInstance().then(async client => {
                            const db = client.db(config.DB_NAME);
                            searchImage(filepath, 16, true, db, 0.8).then(async results => {
                                if (results.length > 0) {
                                    const searchAndSendPhoto = async (collectionName, photoPath, chatId) => {
                                        try {
                                            const res = await db.collection(collectionName).find({ filenames: { $in: [photoPath] } }).toArray();
                                            if (res.length > 0) {
                                                const item = res[0];
                                                const filenames = item.filenames;
                                                if (collectionName === "pixiv-images") {
                                                    const tags = item.tags;
                                                    sendPhoto(`ID: [${item.id}](https://pixiv.net/i/${item.id})\nTitle: ${item.title}\nUser: [${item.userName}](https://pixiv.net/users/${item.userId})\n\nTags: #${tags.join('  #')}`, filenames, chatId, tags.indexOf("R18") !== -1);
                                                } else if (collectionName === "twitter-images") {
                                                    sendPhoto(`ID: [${item.id}](${item.link})\nUser: [${item.username}](${item.userlink})\n\n${item.post}`, filenames, chatId, !!item.isHentai);
                                                }
                                                return true;
                                            } else return false;
                                        } catch (err) {
                                            console.error(err);
                                            bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].failed_to_search);
                                            return false;
                                        }
                                    }
                                    const photoPath = results[0].image.photo_path;
                                    if (await searchAndSendPhoto("pixiv-images", photoPath, chatId)) {
                                        try { fs.unlink(filepath) } catch (e) { }
                                        return;
                                    }
                                    if (await searchAndSendPhoto("twitter-images", photoPath, chatId)) {
                                        try { fs.unlink(filepath) } catch (e) { }
                                        return;
                                    }
                                }

                                danbooru.search(filepath.split("/").pop()).then(async (res) => {
                                    try { fs.unlink(filepath) } catch (e) { }
                                    includes(res, sendPhoto, chatId, false, msg.message_id)
                                }).catch(err => {
                                    console.error(err)
                                    try { fs.unlink(filepath) } catch (e) { }
                                    if (err === "Image not found") bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].no_similar_image)
                                    else bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].failed_to_search + " (Danbooru)")
                                })
                            }).catch(err => {
                                console.error(err)
                                bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].failed_to_search + " (pHash)")
                            })
                        }).catch(err => {
                            console.error(err)
                            bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].failed_to_search + " (DB)")
                        })
                    })
                } else {
                    bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].reply_photo_search)
                } else bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].search_disabled)
                break;
            case "/help": case "/help@" + username:
                bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].help.join("\n"))
                break;
            case "/set": case "/set@" + username:
                if (command.length == 2) {
                    if (msg.chat.type === "private") {
                        bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].only_group)
                        return;
                    } else bot.getChatAdministrators(chatId).then(administrators => {
                        const isAdmin = administrators.some(admin => admin.user.id === msg.from.id);
                        if (isAdmin) {
                            if (command[1] != "on" && command[1] != "off") {
                                bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].help[3])
                            } else MongoPool.getInstance().then(async client => {
                                const collection = client.db(config.DB_NAME).collection("group");
                                await collection.updateOne({ id: chatId }, { $set: { id: chatId, status: command[1] } }, { upsert: true });
                                groupSetting[chatId] = command[1];
                                bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].success);
                            }).catch(err => {
                                console.error(err)
                                bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].failed_to_set_status)
                            })
                        } else {
                            bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].auth);
                        }
                    }).catch(err => {
                        console.error(err);
                    });
                } else {
                    bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].help[3])
                }
                break
            case "/allow": case "/allow@" + username:
                if (config.ADMIN && msg.from.id == config.ADMIN) {
                    if (command.length == 2) {
                        const thisChatId = Number(command[1]);
                        if (isNaN(thisChatId)) {
                            bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].failed_to_set_status)
                            return;
                        }
                        MongoPool.getInstance().then(async client => {
                            const collection = client.db(config.DB_NAME).collection("group-allow");
                            await collection.updateOne({ id: thisChatId }, { $set: { id: thisChatId } }, { upsert: true });
                            bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].success);
                        }).catch(err => {
                            console.error(err)
                            bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].failed_to_set_status)
                        })
                    } else {
                        bot.sendMessage(chatId, "/allow [chatId]")
                    }
                } else {
                    bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].auth)
                }
                break;
            case "/disallow": case "/disallow@" + username:
                if (config.ADMIN && msg.from.id == config.ADMIN) {
                    if (command.length == 2) {
                        const thisChatId = Number(command[1]);
                        if (isNaN(thisChatId)) {
                            bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].failed_to_set_status)
                            return;
                        }
                        MongoPool.getInstance().then(async client => {
                            const collection = client.db(config.DB_NAME).collection("group-allow");
                            await collection.deleteOne({ id: thisChatId });
                            bot.leaveChat(thisChatId);
                            bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].success);
                        }).catch(err => {
                            console.error(err)
                            bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].failed_to_del)
                        })
                    } else {
                        bot.sendMessage(chatId, "/disallow [chatId]")
                    }
                } else {
                    bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].auth)
                }
                break;
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

bot.on('new_chat_members', (msg) => {
    const chatId = msg.chat.id;
    const newMembers = msg.new_chat_members;
    newMembers.forEach((member) => {
        if (member.id === me_id) {
            MongoPool.getInstance().then(async client => {
                const collection = client.db(config.DB_NAME).collection("group-allow");
                const res = await collection.find({ id: chatId }).toArray();
                if (res.length == 0) {
                    const adminInfo = await bot.getChat(config.ADMIN)
                    bot.sendMessage(
                        chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"]
                            .new_chat.replace("{username}", adminInfo.username)
                    )
                    bot.leaveChat(chatId);
                } else {
                    bot.sendMessage(chatId, i18n[msg.from.language_code.startsWith("zh") ? "zh" : "en"].new_chat_allow)
                }
            })
        }
    });
});

console.log("Bot starting...");