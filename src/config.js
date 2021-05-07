/**
 * config.js
 *
 * @tccl/graph-layer
 */

const fs = require("fs");
const { promisify: p, format } = require("util");
const commentJSON = require("comment-json");
const msal = require("@azure/msal-node");

const { Storage } = require("./storage");

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
        this.storage = null;
        this.msalApps = new Map();
    }

    get(...keys) {
        return this.cfg.get(...keys);
    }

    async load(configFile) {
        if (this.storage) {
            this.storage.close();
            this.storage = null;
        }
        this.msalApps.clear();
        this.cfg = new ConfigObject(configFile);

        const data = await p(fs.readFile)(configFile,"utf8");
        const cfg = commentJSON.parse(data,null,false);

        // Create map for looking up apps entries by id.
        if (cfg.apps && Array.isArray(cfg.apps)) {
            const map = new Map();
            cfg.apps.forEach((ent) => map.set(ent.id,ent));
            cfg.appsMap = map;
        }

        this.cfg.assign(cfg);

        return this;
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

    getApplication(appId) {
        let payload = this.msalApps.get(appId);
        if (payload) {
            return payload
        }

        const app = this.get("appsMap").get(appId);
        if (!app) {
            return false;
        }

        const config = {
            auth: {
                clientId: app.client_id,
                authority: format("%s/%s",app.cloud_id,app.tenant_id),
                clientSecret: app.client_secret
            }
        };

        payload = {
            cca: new msal.ConfidentialClientApplication(config),
            app
        };
        this.msalApps.set(appId,payload);

        return payload;
    }
}

module.exports = {
    Config
};
