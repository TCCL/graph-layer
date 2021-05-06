/**
 * server.js
 *
 * @tccl/graph-layer
 */

const express = require("express");

const { TokenManager, TokenEndpoint } = require("./token");

class Server {
    constructor(config) {
        this.config = config;
        this.app = express();
        this.server = null;
        this.manager = new TokenManager(config);
        this.tokenEndpoint = new TokenEndpoint(this.manager);
    }

    start() {
        if (this.server) {
            return;
        }

        const [ port, host ] = this.config.get("port","host");
        this.server = this.app.listen(port,host);

        this.tokenEndpoint.start();
    }

    stop() {
        if (!this.server) {
            return;
        }

        this.tokenEndpoint.stop();

        this.server.close();
        this.server = null;
    }
}

module.exports = {
    Server
};
