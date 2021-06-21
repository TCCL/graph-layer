/**
 * token/handler.js
 *
 * @tccl/graph-layer
 */

const { format } = require("util");

const { EndpointError } = require("./error");
const { JsonMessage } = require("../helpers");

/**
 * Implements the connection handler for the token endpoint.
 */
class ConnectionHandler {
    constructor(sock,endpoint) {
        sock.setEncoding("utf8");
        sock.setTimeout(3000);
        this.sock = sock;

        this.endpoint = endpoint;
        this.incoming = new JsonMessage();
    }

    handle() {
        this.sock.on("data",(chunk) => {
            if (this.incoming.receive(chunk)) {
                const message = this.incoming.getMessage();
                if (message === false) {
                    this.writeError("Protocol error");
                    return;
                }

                this.processMessage(message);
            }
        });
    }

    processMessage(message) {
        try {
            if (message.action == "auth") {
                this.endpoint.doAuth(this,message);
            }
            else if (message.action == "callback") {
                this.endpoint.doCallback(this,message);
            }
            else if (message.action == "check") {
                this.endpoint.doCheck(this,message);
            }
            else if (message.action == "clear") {
                this.endpoint.doClear(this,message);
            }
            else if (message.action == "userInfo") {
                this.endpoint.doUserInfo(this,message);
            }
            else {
                this.writeError("Message is not understood");
            }
        } catch (err) {
            if (err instanceof EndpointError) {
                this.writeError(err.toString());
            }
            else {
                throw err;
            }
        }
    }

    writeMessage(type,value) {
        const payload = {
            type,
            value
        };

        this.sock.write(JSON.stringify(payload) + "\n");
    }

    writeError(message,...args) {
        this.writeMessage("error",format(message,...args));
    }
}

module.exports = {
    ConnectionHandler
};
