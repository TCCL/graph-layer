/**
 * token.js
 *
 * @tccl/graph-layer
 */

const net = require("net");
const { v4: generateUUID } = require("uuid");
const IPCIDR = require("ip-cidr");

class ConnectionHandler {
    constructor(sock,manager) {
        sock.setEncoding("utf8");
        this.id = generateUUID();
        this.sock = sock;
        this.manager = manager;
        this.state = "initial";
        this.buffer = "";
    }

    handle() {
        this.sock.on("data",(chunk) => {
            this.buffer += chunk;
            this.tryMessage();
        });
    }

    tryMessage() {
        const index = this.buffer.indexOf("\n");
        if (index < 0) {
            return;
        }

        const messageRaw = this.buffer.slice(0,index).trim();
        this.buffer = this.buffer.slice(index+1);

        if (messageRaw.length == 0) {
            return;
        }

        try {
            const message = JSON.parse(messageRaw);
            if (typeof message !== "object" || message === null) {
                throw new Error("Invalid message");
            }

            this.processMessage(message);

        } catch (err) {
            this.writeError("Invalid message");
        }
    }

    processMessage(message) {
        console.log(message);

        if (message.action != "auth" && message.id != this.id) {
            this.writeError("ID mismatch");
            return;
        }

        if (message.action == "auth") {

        }
        else if (message.action == "callback") {

        }
    }

    writeMessage(type,value) {
        const payload = {
            id: this.id,
            type,
            state: this.state,
            value
        };

        this.sock.write(JSON.stringify(payload));
    }

    writeError(message) {
        this.writeMessage("error",message);
    }
}

/**
 * Implements a net.Server that provides the token endpoint.
 */
class TokenEndpoint extends net.Server {
    constructor(manager) {
        super();
        this.config = manager.config;
        this.manager = manager;
    }

    start() {
        const [ port, host, whitelist ] = this.config.get("tokenEndpoint")
              .get("port","host","whitelist");

        // Convert whitelist items into IPCIDR instances. Only keep an instance
        // if itwas valid. This allows us to match both singular ip addresses
        // (e.g. 8.8.8.8) and ranges (e.g. 8.8.0.0/16)
        if (Array.isArray(whitelist)) {
            for (let i = 0;i < whitelist.length;++i) {
                if (typeof whitelist === "string") {
                    const cand = new IPCIDR(whitelist[i]);
                    if (cand.isValid()) {
                        whitelist[i] = cand;
                    }
                }
            }
        }

        this.on("connection",(sock) => {
            // Close connection if remote host is not in whitelist.
            if (Array.isArray(whitelist) && whitelist.length > 0) {
                if (!whitelist.some((item) => {
                    if (item instanceof IPCIDR) {
                        return item.contains(sock.remoteAddr);
                    }

                    return item == sock.remoteAddr;
                }))
                {
                    sock.destroy();
                    return;
                }
            }

            const handler = new ConnectionHandler(sock,this.manager);
            handler.handle();
        });

        this.listen(port,host);
    }

    stop() {
        this.removeAllListeners("connection");
        this.close();
    }
}

/**
 * Manages application and API token associations.
 */
class TokenManager {
    constructor(config) {
        this.config = config;
        this.server = null;
    }

    get(id) {

    }

    set(appId,tokenId,value) {

    }    
}

module.exports = {
    TokenManager,
    TokenEndpoint
};
