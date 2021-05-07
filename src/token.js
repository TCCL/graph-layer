/**
 * token.js
 *
 * @tccl/graph-layer
 */

const net = require("net");
const crypto = require("crypto");
const { format } = require("util");
const { v4: generateUUID } = require("uuid");
const IPCIDR = require("ip-cidr");

const { JsonMessage } = require("./helpers");

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
        if (message.action == "auth") {
            this.endpoint.doAuth(this,message);
        }
        else if (message.action == "callback") {
            this.endpoint.doCallback(this,message);
        }
        else {
            this.writeError("Message is not understood");
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

/**
 * Implements a net.Server that provides the token endpoint.
 */
class TokenEndpoint extends net.Server {
    constructor(manager) {
        super();

        this.config = manager.config;
        this.manager = manager;

        this.sessions = new Map();
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

            const handler = new ConnectionHandler(sock,this);
            handler.handle();
        });

        this.listen(port,host);
    }

    stop() {
        this.removeAllListeners("connection");
        this.close();
    }

    doAuth(handler,message) {
        if (!message.appId && typeof message.appId !== "string") {
            handler.writeError("Protocol error: appId");
            return;
        }

        // Get application instance.
        const { cca, app } = this.config.getApplication(message.appId);
        if (!app) {
            handler.writeError(
                "No such application having ID '%s'",
                message.appId
            );
            return;
        }

        // Create session.

        const timeout = Math.round(Date.now() / 1000) + 3600;
        const sessionId = generateUUID();

        this.sessions.set(sessionId,{
            state: "pending",
            sessionId,
            timeout,
            appId: message.appId
        });

        // Get the URL used to authenticate the user.

        const params = {
            scopes: app.userScopes,
            redirectUri: app.redirectUri
        };

        cca.getAuthCodeUrl(params).then((url) => {
            handler.writeMessage("redirect",{
                sessionId,
                timeout,
                uri: url
            });
        }).catch((err) => {
            handler.writeError("Failed to initiate authentication");
        });
    }

    doCallback(handler,message) {
        if (!message.appId && typeof message.appId !== "string") {
            handler.writeError("Protocol error: appId");
            return;
        }

        if (!message.sessionId && typeof message.sessionId !== "string") {
            handler.writeError("Protocol error: sessionId");
            return;
        }

        if (!message.code && typeof message.code !== "string") {
            handler.writeError("Protocol error: code");
            return;
        }

        const session = this.sessions.get(message.sessionId);
        if (!session) {
            handler.writeError("Invalid session");
            return;
        }

        if (session.appId != message.appId) {
            handler.writeError("Invalid application");
            return;
        }

        // Get application instance.
        const { cca, app } = this.config.getApplication(session.appId);
        if (!app) {
            handler.writeError(
                "No such application having ID '%s'",
                session.appId
            );
            return;
        }

        const tokenRequest = {
            code: message.code,
            scopes: app.userScopes,
            redirectUri: app.redirectUri
        };

        cca.acquireTokenByCode(tokenRequest).then((response) => {
            this.sessions.delete(session.sessionId);

            const tokenId = crypto.randomBytes(32).toString("base64");
            this.manager.set(tokenId,response);

            handler.writeMessage("complete",{
                sessionId: tokenId
            });

        }).catch((err) => {
            handler.writeError("Failed to acquire access token");
        });
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

    set(id,token) {

    }
}

module.exports = {
    TokenManager,
    TokenEndpoint
};
