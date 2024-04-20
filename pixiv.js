const config = require('./config');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');
const MongoPool = require("./db-pool");

const headers = {
    "Accept-Language": "zh-TW;q=0.9,zh-CN;q=0.8,zh-HK;",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Cookie": config.PIXIV_COOKIE,
}

const downloads = (filename, url) => {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(filename)) {
            axios({
                method: 'GET',
                url,
                headers: {
                    ...headers,
                    'referer': 'https://www.pixiv.net/'
                },
                responseType: 'stream'
            }).then((response) => {
                const writer = fs.createWriteStream(filename);
                response.data.pipe(writer);
                writer.on('finish', () => {
                    resolve()
                });
            })
        } else resolve()
    })
}

module.exports = {
    main: (urls, callback, chatId) => {
        for (const url in urls) {
            const get = () => {
                axios({
                    method: "GET",
                    url: "https://" + urls[url],
                    headers
                }).then(async r => {
                    const $ = cheerio.load(r.data);
                    const metaContent = $('meta[id="meta-preload-data"]').attr('content');
                    const data = JSON.parse(metaContent);
                    const illust = (() => { for (let i in data.illust) return data.illust[i] })();

                    const tags = [];
                    for (let i in illust.tags.tags) tags.push(illust.tags.tags[i].tag.replace("-", '').replace(":", '').replace(/\(.*?\)/g, ''))

                    MongoPool.getInstance().then(async client => {
                        const collection = client.db(config.DB_NAME).collection("pixiv-images");
                        const res = await collection.find({ id: String(illust.id) }).toArray();

                        if (res.length > 0) {
                            const filenames = res[0].filenames.map(filename => path.join(__dirname, "image", filename));
                            callback(`ID: [${res[0].id}](https://pixiv.net/i/${res[0].id})\nTitle: ${res[0].title}\nUser: [${res[0].userName}](https://pixiv.net/users/${res[0].userId})\n\nTags: #${res[0].tags.join('  #')}`, filenames, chatId)
                        } else {
                            axios({
                                method: 'GET',
                                url: `https://www.pixiv.net/ajax/illust/${illust.id}/pages`,
                                headers: {
                                    ...headers,
                                    'referer': 'https://www.pixiv.net/'
                                },
                            }).then(async res => {
                                const filenames = []
                                for (const i in res.data.body) {
                                    const filename = path.join(__dirname, "image", `${illust.id}-${i}.${res.data.body[i].urls.original.split(".").pop()}`)
                                    filenames.push(filename)
                                    await downloads(filename, res.data.body[i].urls.original)
                                }

                                MongoPool.getInstance().then(async client => {
                                    const collection = client.db(config.DB_NAME).collection("pixiv-images");
                                    await collection.insertOne({
                                        id: illust.id,
                                        title: illust.title,
                                        userId: illust.userId,
                                        userName: illust.userName,
                                        tags,
                                        filenames
                                    })
                                }).catch(err => {
                                    console.error(err)
                                })

                                callback(`ID: [${illust.id}](https://pixiv.net/i/${illust.id})\nTitle: ${illust.title}\nUser: [${illust.userName}](https://pixiv.net/users/${illust.userId})\n\nTags: #${tags.join('  #')}`, filenames, chatId)
                            }).catch(err => {
                                console.error(err)
                            })
                        }
                    }).catch(err => {
                        console.error(err)
                    })
                }).catch(err => {
                    console.error(err)
                })
            }

            try {
                const urlId = Number(urls[url].split("/").pop().split("?")[0]);
                if (isNaN(urlId)) { get() } else {
                    MongoPool.getInstance().then(async client => {
                        const collection = client.db(config.DB_NAME).collection("pixiv-images");
                        const res = await collection.find({ id: String(urlId) }).toArray();

                        if (res.length > 0) {
                            const filenames = res[0].filenames.map(filename => filename);
                            callback(`ID: [${res[0].id}](https://pixiv.net/i/${res[0].id})\nTitle: ${res[0].title}\nUser: [${res[0].userName}](https://pixiv.net/users/${res[0].userId})\n\nTags: #${res[0].tags.join('  #')}`, filenames, chatId)
                        } else get()
                    }).catch(err => {
                        console.error(err)
                    })
                }
            } catch (e) {
                console.error(e)
            }
        }
    },
    random: (callback, chatId) => {
        MongoPool.getInstance().then(async client => {
            const collection = client.db(config.DB_NAME).collection("pixiv-images");
            const res = await collection.aggregate([{ $sample: { size: 1 } }]).toArray();

            if (res.length > 0) {
                const filenames = res[0].filenames.map(filename => filename);
                callback(`ID: [${res[0].id}](https://pixiv.net/i/${res[0].id})\nTitle: ${res[0].title}\nUser: [${res[0].userName}](https://pixiv.net/users/${res[0].userId})\n\nTags: #${res[0].tags.join('  #')}`, filenames, chatId)
            }
        }).catch(err => {
            console.error(err)
        })
    }
}