/**
 * server.js
 *
 * @tccl/graph-layer
 */

const { Logger } = require("./logger");
const { ProxyEndpoint } = require("./proxy");
const { TokenManager, TokenEndpoint } = require("./token");

class Server {
    constructor(config,_options) {
        const options = _options || {};

        this.config = config;
        this.logger = new Logger(this);
        this.manager = new TokenManager(this);
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
    }

    getApp() {
        return this.proxyEndpoint.app;
    }
}

module.exports = {
    Server
};
