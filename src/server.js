/**
 * server.js
 *
 * @tccl/graph-layer
 */

const { ProxyEndpoint } = require("./proxy");
const { TokenManager, TokenEndpoint } = require("./token");

class Server {
    constructor(config) {
        this.config = config;
        this.manager = new TokenManager(config);
        this.proxyEndpoint = new ProxyEndpoint(this.manager,config);
        this.tokenEndpoint = new TokenEndpoint(this.manager);
    }

    start() {
        this.proxyEndpoint.start();
        this.tokenEndpoint.start();
    }

    stop() {
        this.tokenEndpoint.stop();
        this.proxyEndpoint.stop();
    }

    getApp() {
        return this.proxyEndpoint.app;
    }
}

module.exports = {
    Server
};
