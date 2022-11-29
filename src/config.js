/**
 * config.js
 *
 * @tccl/graph-layer
 */

const fs = require("fs");
const { promisify, format } = require("util");

const commentJSON = require("comment-json");

class ConfigObject {
    constructor(context,...parts) {
        this.context = format(context,...parts);
        this.cfg = {};
    }

    get(...keys) {
        if (keys.length == 0) {
            return 0;
        }
        if (keys.length == 1) {
            if (keys[0] in this.cfg) {
                return this.cfg[keys[0]];
            }

            throw new ErrorF("%s.%s is not defined",this.context,keys[0]);
        }

        return keys.map((key) => {
            if (!(key in this.cfg)) {
                throw new ErrorF("%s.%s is not defined",this.context,key);
            }

            return this.cfg[key];
        });
    }

    toObject() {
        const obj = {};
        const keys = Object.keys(this.cfg);

        for (let i = 0;i < keys.length;++i) {
            const k = keys[i];
            if (this.cfg[k] instanceof ConfigObject) {
                obj[k] = this.cfg[k].toObject();
            }
            else {
                obj[k] = this.cfg[k];
            }
        }

        return obj;
    }

    assign(vs) {
        for (const key in vs) {
            if (vs[key] !== null && vs[key].constructor === Object) {
                this.cfg[key] = new ConfigObject("%s.%s",this.context,key);
                this.cfg[key].assign(vs[key]);
            }
            else {
                this.cfg[key] = vs[key];
            }
        }
    }
}

class Config {
    constructor() {
        this.cfg = new ConfigObject("[Config]");
    }

    get(...keys) {
        return this.cfg.get(...keys);
    }

    async load(configFile) {
        this.cfg = new ConfigObject("["+configFile+"]");

        const data = await promisify(fs.readFile)(configFile,"utf8");
        const cfg = commentJSON.parse(data,null,false);

        // Special case: convert 'apps' section into dictionary.
        if (cfg.apps && Array.isArray(cfg.apps)) {
            cfg.appsIndexed = cfg.apps;

            const dict = {};
            cfg.apps.forEach((ent) => (dict[ent.id] = ent));
            cfg.apps = dict;
        }

        this.cfg.assign(cfg);

        return this;
    }

    clear() {
        this.cfg = new ConfigObject("[Config]");
    }
}

module.exports = {
    Config
};
