/**
 * config.js
 *
 * @tccl/graph-layer
 */

const fs = require("fs");
const { promisify: p } = require("util");
const commentJSON = require("comment-json");

const { Storage } = require("./storage");

class Config {
    constructor() {
        this.cfg = {};
        this.storage = null;
    }

    get(...keys) {
        if (keys.length == 0) {
            return 0;
        }
        if (keys.length == 1) {
            return this.cfg[keys[0]];
        }

        return keys.map((key) => this.cfg[key]);
    }

    async load(configFile) {
        const data = await p(fs.readFile)(configFile,"utf8");
        const cfg = commentJSON.parse(data,null,false);

        Object.assign(this.cfg,cfg);
    }

    getStorage() {
        if (this.storage) {
            return this.storage;
        }

        const databaseFile = this.get("storage");
        if (typeof databaseFile !== "string" || !databaseFile) {
            throw new ErrorF("Invalid storage file path: '%s'",databaseFile);
        }

        this.storage = new Storage(databaseFile);

        return this.storage;
    }
}

module.exports = {
    Config
};
