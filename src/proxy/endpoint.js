/**
 * proxy/endpoint.js
 *
 * @tccl/graph-layer
 */

const express = require("express");

class ProxyEndpoint {
    constructor(tokenManager,config) {
        this.tokenManager = tokenManager;
        this.config = config;
        this.app = express();
        this.server = null;
    }

    start() {
        if (this.server) {
            return;
        }

        const [ port, host ] = this.config.get("port","host");
        this.server = this.app.listen(port,host);
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
    ProxyEndpoint
};
