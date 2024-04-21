const config = require('./config');
const axios = require('axios');
const querystring = require('querystring');
const fs = require('fs');
const path = require('path');
const MongoPool = require("./db-pool");

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Referer: 'https://twitter.com/',
}

const downloads = (filename, url) => {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(filename)) {
            axios({
                method: 'GET',
                url,
                headers: headers,
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
            const id = urls[url].split("/").pop().split("?")[0];
            const get = () => {
                const variables = querystring.escape(JSON.stringify(
                    {
                        "focalTweetId": id,
                        "with_rux_injections": false,
                        "includePromotedContent": true,
                        "withCommunity": true,
                        "withQuickPromoteEligibilityTweetFields": true,
                        "withBirdwatchNotes": true,
                        "withVoice": true,
                        "withV2Timeline": true
                    }
                ));
                axios({
                    method: 'GET',
                    url: `https://twitter.com/i/api/graphql/zJvfJs3gSbrVhC0MKjt_OQ/TweetDetail?variables=${variables}&features=%7B%22rweb_tipjar_consumption_enabled%22%3Atrue%2C%22responsive_web_graphql_exclude_directive_enabled%22%3Atrue%2C%22verified_phone_label_enabled%22%3Afalse%2C%22creator_subscriptions_tweet_preview_api_enabled%22%3Atrue%2C%22responsive_web_graphql_timeline_navigation_enabled%22%3Atrue%2C%22responsive_web_graphql_skip_user_profile_image_extensions_enabled%22%3Afalse%2C%22communities_web_enable_tweet_community_results_fetch%22%3Atrue%2C%22c9s_tweet_anatomy_moderator_badge_enabled%22%3Atrue%2C%22articles_preview_enabled%22%3Afalse%2C%22tweetypie_unmention_optimization_enabled%22%3Atrue%2C%22responsive_web_edit_tweet_api_enabled%22%3Atrue%2C%22graphql_is_translatable_rweb_tweet_is_translatable_enabled%22%3Atrue%2C%22view_counts_everywhere_api_enabled%22%3Atrue%2C%22longform_notetweets_consumption_enabled%22%3Atrue%2C%22responsive_web_twitter_article_tweet_consumption_enabled%22%3Atrue%2C%22tweet_awards_web_tipping_enabled%22%3Afalse%2C%22creator_subscriptions_quote_tweet_preview_enabled%22%3Afalse%2C%22freedom_of_speech_not_reach_fetch_enabled%22%3Atrue%2C%22standardized_nudges_misinfo%22%3Atrue%2C%22tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled%22%3Atrue%2C%22tweet_with_visibility_results_prefer_gql_media_interstitial_enabled%22%3Atrue%2C%22rweb_video_timestamps_enabled%22%3Atrue%2C%22longform_notetweets_rich_text_read_enabled%22%3Atrue%2C%22longform_notetweets_inline_media_enabled%22%3Atrue%2C%22responsive_web_enhance_cards_enabled%22%3Afalse%7D&fieldToggles=%7B%22withArticleRichContentState%22%3Atrue%2C%22withArticlePlainText%22%3Afalse%7D`,
                    headers: {
                        Authorization: config.TWITTER_AUTHORIZATION,
                        Cookie: config.TWITTER_COOKIE,
                        Referer: urls[url],
                        'User-Agent': headers['User-Agent'],
                        'X-Csrf-Token': config.TWITTER_CSRF
                    }
                }).then(async (response) => {
                    const data = response.data.data
                    if (data && data.threaded_conversation_with_injections_v2) {
                        const instructions = data.threaded_conversation_with_injections_v2.instructions;
                        if (instructions && instructions.length > 0) {
                            const entry = instructions[0].entries[0];
                            if (entry && entry.content && entry.content.entryType === "TimelineTimelineItem") {
                                const author = entry.content.itemContent.tweet_results.result.core.user_results.result.legacy;
                                const userLink = `https://twitter.com/${author.screen_name}`;
                                const tweet = entry.content.itemContent.tweet_results.result.legacy;
                                const tweetContent = tweet.full_text;
                                const tweetImageUrl = tweet.entities.media.map(media => media.media_url_https);

                                const filenames = []
                                for (const i in tweetImageUrl) {
                                    const filename = path.join(__dirname, "image", `${id}-${i}.${tweetImageUrl[i].split(".").pop()}`)
                                    filenames.push(filename)
                                    await downloads(filename, tweetImageUrl[i])
                                }

                                MongoPool.getInstance().then(async client => {
                                    const collection = client.db(config.DB_NAME).collection("twitter-images");
                                    await collection.insertOne({
                                        id: id,
                                        link: urls[url],
                                        username: author.name,
                                        userlink: userLink,
                                        post: tweetContent,
                                        filenames: filenames
                                    })
                                }).catch(err => {
                                    console.error(err)
                                })

                                callback(`Link: [${id}](${urls[url]})\nUser: [${author.name}](${userLink})\n\n${tweetContent}`, filenames, chatId, false)
                            }
                        }
                    }
                })
            }

            try {
                if (!isNaN(id)) {
                    MongoPool.getInstance().then(async client => {
                        const collection = client.db(config.DB_NAME).collection("twitter-images");
                        const res = await collection.find({ id: String(id) }).toArray();

                        if (res.length > 0) {
                            callback(`Link: [${res[0].id}](${res[0].link})\nUser: [${res[0].username}](${res[0].userlink})\n\n${res[0].post}`, res[0].filenames, chatId, false)
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
            const collection = client.db(config.DB_NAME).collection("twitter-images");
            const res = await collection.aggregate([{ $sample: { size: 1 } }]).toArray();

            if (res.length > 0) {
                callback(`Link: [${res[0].id}](${res[0].link})\nUser: [${res[0].username}](${res[0].userlink})\n\n${res[0].post}`, res[0].filenames, chatId, false)
            }
        }).catch(err => {
            console.error(err)
        })
    }
}