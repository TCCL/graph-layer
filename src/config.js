/**
 * config.js
 *
 * @tccl/graph-layer
 */

const fs = require("fs");
const { promisify: p } = require("util");
const commentJSON = require("comment-json");

class Config {
    constructor() {

    }

    async load(configFile) {
        const data = await p(fs.readFile)(configFile,"utf8");
        const cfg = commentJSON.parse(data,null,false);

        Object.assign(this,cfg);
    }
}

module.exports = {
    Config
};
