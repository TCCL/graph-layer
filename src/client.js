/**
 * client.js
 *
 * @tccl/graph-layer
 */

const MicrosoftGraph = require("@microsoft/microsoft-graph-client");

class Client {
    constructor(token) {
        this.mclient = new MicrosoftGraph.Client.init({
            defaultVersion: "v1.0",
            authProvider(done) {
                done(null,token.getAccessToken());
            }
        });
    }

    api(...args) {
        return this.mclient.api(...args);
    }
}

module.exports = {
    Client
};
