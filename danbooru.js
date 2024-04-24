const axios = require('axios')
const cheerio = require('cheerio')
const fs = require('fs')
const path = require('path')
const FormData = require('form-data')
const { imageHashAsync, hammingDistance } = require('./phash')

const downloadImage = (url, image) => {
    return new Promise((resolve, reject) => {
        axios({
            method: "GET",
            url: url,
            responseType: "stream"
        }).then((res) => {
            res.data.pipe(fs.createWriteStream(path.join(__dirname, `image/${image}`))
                .on('finish', () => {
                    resolve()
                }).on('error', (err) => {
                    reject(err)
                }))
        }).catch((err) => {
            reject(err)
        })
    })
}

const danbooru = (url, image) => {
    return new Promise((resolve, reject) => {
        axios.get(url).then((res) => {
            const $ = cheerio.load(res.data)
            const sourceUrl = $('#post-info-source').find('a').attr('href');
            const imageUrl = $('picture > img').attr('src');
            const imageFilename = imageUrl.split('/').pop();
            downloadImage(imageUrl, imageFilename).then(() => {
                const thisHash = imageHashAsync(path.join(__dirname, `image/${image}`), 16, true);
                const thatHash = imageHashAsync(path.join(__dirname, `image/${imageFilename}`), 16, true);

                Promise.all([thisHash, thatHash]).then((hashes) => {
                    const distance = hammingDistance(hashes[0], hashes[1]);
                    fs.unlinkSync(path.join(__dirname, `image/${image}`));
                    fs.unlinkSync(path.join(__dirname, `image/${imageFilename}`));
                    if (distance > 0.8) {
                        resolve(sourceUrl);
                    } else reject('Image not found')
                }).catch((err) => reject(err))
            }).catch((err) => reject(err))
        }).catch((err) => reject(err))
    })
}

const search = (image) => {
    return new Promise((resolve, reject) => {
        const form = new FormData();
        form.append("file", fs.createReadStream(path.join(__dirname, `image/${image}`)));
        form.append("MAX_FILE_SIZE", "8388608");

        axios({
            method: "POST",
            url: 'https://danbooru.iqdb.org/',
            data: form,
            headers: form.getHeaders()
        }).then((res) => {
            const $ = cheerio.load(res.data)
            const result = []
            $('div#pages > div').each((index, element) => {
                const url = $(element).find('td > a').attr('href')
                if (url) result.push(url)
            })

            danbooru(result[0], image).then((res) => {
                resolve(res)
            }).catch((err) => reject(err))
        }).catch((err) => reject(err))
    })
}

module.exports = { search }