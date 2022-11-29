/**
 * server.js
 *
 * @tccl/graph-layer
 */

const { ApplicationManager } = require("./application-manager");
const { Logger } = require("./logger");
const { ProxyEndpoint } = require("./proxy");
const { Storage } = require("./storage");
const { TokenManager, TokenEndpoint } = require("./token");

class Server {
    constructor(config,_options) {
        const options = _options || {};

        this.config = config;
        this.storage = null;
        this.logger = new Logger(this);
        this.appManager = new ApplicationManager(this);
        this.tokenManager = new TokenManager(this);
        this.proxyEndpoint = new ProxyEndpoint(this,options);
        this.tokenEndpoint = new TokenEndpoint(this);
    }

    start() {
        this.logger.start();
        this.proxyEndpoint.start();
        this.tokenEndpoint.start();
    }

    stop() {
        this.tokenEndpoint.stop();
        this.proxyEndpoint.stop();
        this.logger.stop();
        this.appManager.clear();
        this.config.clear();
    }

    getWebApp() {
        return this.proxyEndpoint.app;
    }

    getConfig() {
        return this.config;
    }

    getLogger() {
        return this.logger;
    }

    getAppManager() {
        return this.appManager;
    }

    getTokenManager() {
        return this.tokenManager;
    }

    getStorage() {
        if (this.storage) {
            return this.storage;
        }

        const databaseFile = this.config.get("storage");
        if (typeof databaseFile !== "string" || !databaseFile) {
            throw new ErrorF("Invalid storage file path: '%s'",databaseFile);
        }

        this.storage = new Storage(databaseFile);

        return this.storage;
    }
}

module.exports = {
    Server
};
