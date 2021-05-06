/**
 * server.js
 *
 * @tccl/graph-layer
 */

const express = require("express");

class Server {
    constructor(config) {
        this.config = config;
        this.app = express();
        this.server = null;
    }

    start() {
        if (this.server) {
            return;
        }

        this.server = this.app.listen(this.config.port,this.config.host);
    }

    stop() {
        if (!this.server) {
            return;
        }

        this.server.close();
        this.server = null;
    }
}

module.exports = {
    Server
};
