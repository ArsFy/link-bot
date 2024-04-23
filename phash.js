const { imageHash } = require("image-hash");

const imageHashAsync = (src, bits, method) => {
    return new Promise((resolve, reject) => imageHash(src, bits, method, (error, data) => {
        if (error) reject(error);
        else resolve(data);
    }))
}

const hammingDistance = (hash1, hash2) => {
    const size = hash1.length;
    if (size !== hash2.length) {
        throw new Error('Hashes must be of the same length');
    }
    let distance = 0;
    for (let i = 0; i < hash1.length; i++) {
        if (hash1[i] !== hash2[i]) distance++;
    }
    return (size - distance) / size;
}

const searchImage = async (src, bits, method, db, threshold = 0.8) => {
    const targetHash = await imageHashAsync(src, bits, method);
    const parts = [
        targetHash.substring(0, targetHash.length / 4),
        targetHash.substring(targetHash.length / 4, targetHash.length / 2),
        targetHash.substring(targetHash.length / 2, targetHash.length * 3 / 4),
        targetHash.substring(targetHash.length * 3 / 4),
    ];

    const cursor = db.collection('file-cache').find({
        $or: [
            { hashPart1: parts[0] },
            { hashPart2: parts[1] },
            { hashPart3: parts[2] },
            { hashPart4: parts[3] },
        ],
    });

    const results = [];
    while (await cursor.hasNext()) {
        const image = await cursor.next();
        const distance = hammingDistance(targetHash, image.hash);
        if (distance > threshold) results.push({ image, distance });
    }
    results.sort((a, b) => a.distance - b.distance);

    return results;
}

module.exports = {
    imageHashAsync,
    hammingDistance,
    searchImage
}