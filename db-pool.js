const config = require('./config');
const { MongoClient, ServerApiVersion } = require('mongodb');

let client;

const uri = config.MONGODB_URI;
const initPool = async () => {
    if (!client) {
        try {
            client = new MongoClient(uri, {
                serverApi: {
                    version: ServerApiVersion.v1,
                    strict: true,
                    deprecationErrors: true,
                },
                connectTimeoutMS: 1000,
            });
            await client.connect();
        } catch (err) {
            console.error(err);
            throw err;
        }
    }
    return client;
};

const getInstance = async () => {
    if (!client) {
        return await initPool();
    }
    return client;
};

module.exports = {
    initPool,
    getInstance,
};