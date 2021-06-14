/**
 * endpoint.js
 *
 * @tccl/graph-layer
 */

const net = require("net");
const crypto = require("crypto");
const { v4: generateUUID } = require("uuid");
const IPCIDR = require("ip-cidr");

const { Token } = require("./token");
const { TokenError, EndpointError } = require("./error");
const { ConnectionHandler } = require("./handler");

/**
 * Implements a net.Server that provides the token endpoint.
 */
class TokenEndpoint extends net.Server {
    constructor(manager) {
        super();

        this.config = manager.config;
        this.manager = manager;
        this.cleanupInterval = null;

        this.sessions = new Map();
    }

    start() {
        if (this.listening) {
            throw new Error("TokenEndpoint is already started");
        }

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

        this.cleanupInterval = setInterval(
            () => {
                this.manager.cleanup();
            },
            3600
        );
        this.manager.cleanup();
    }

    stop() {
        if (!this.listening) {
            throw new Error("TokenEndpoint is not started");
        }

        this.removeAllListeners("connection");
        this.close();

        clearInterval(this.cleanupInterval);
    }

    doAuth(handler,message) {
        if (!message.appId && typeof message.appId !== "string") {
            throw new EndpointError("Message missing appId");
        }

        // Get application instance.
        const app = this.config.getApplication(message.appId);
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

        app.getAuthCodeUrl().then((url) => {
            handler.writeMessage("redirect",{
                sessionId,
                timeout,
                uri: url
            });
        }).catch((err) => {
            console.error(err);
            handler.writeError("Failed to initiate authentication");
        });
    }

    doCallback(handler,message) {
        if (!message.appId && typeof message.appId !== "string") {
            throw new EndpointError("Message missing appId");
        }

        if (!message.sessionId && typeof message.sessionId !== "string") {
            throw new EndpointError("Message missing sessionId");
        }

        if (!message.queryString && typeof message.queryString !== "string") {
            throw new EndpointError("Message missing queryString");
        }

        const session = this.sessions.get(message.sessionId);
        if (!session) {
            throw new EndpointError("Invalid session");
        }

        if (session.appId != message.appId) {
            throw new EndpointError("Invalid application");
        }

        // Get application instance.
        const app = this.config.getApplication(session.appId);
        if (!app) {
            handler.writeError(
                "No such application having ID '%s'",
                session.appId
            );
            return;
        }

        app.acquireTokenByCode(message.queryString).then((tokenSet) => {
            this.sessions.delete(session.sessionId);

            const tokenId = crypto.randomBytes(32).toString("base64");
            this.manager.set(tokenId,session.appId,true,tokenSet);

            handler.writeMessage("complete",{
                sessionId: tokenId
            });

        }).catch((err) => {
            console.error(err);
            handler.writeError("Failed to acquire access token");
        });
    }

    doCheck(handler,message) {
        if (!message.appId && typeof message.appId !== "string") {
            throw new EndpointError("Message missing appId");
        }

        if (!message.sessionId && typeof message.sessionId !== "string") {
            throw new EndpointError("Message missing sessionId");
        }

        const { appId, isUser, token: tokenValue } = this.manager.get(message.sessionId);

        if (!tokenValue) {
            throw new EndpointError("failure","No such token");
        }

        if (appId != message.appId) {
            throw new EndpointError("App ID mismatch");
        }

        // Only user-based tokens are allowed for a token endpoint operation. A
        // non-user token should never be queried (in practice).
        if (!isUser) {
            throw new EndpointError("Session is invalid");
        }

        // Create client instance for checking token. If token is not valid,
        // attempt refresh. If the refresh fails, then we will have to fail.

        const token = new Token(message.sessionId,appId,isUser,tokenValue);
        if (!token.isExpired()) {
            handler.writeMessage("success",{
                message: "Token is valid",
                type: "reuse"
            });
            return;
        }

        token.refresh(this.manager).then((success) => {
            if (success) {
                handler.writeMessage("success",{
                    message: "Token is valid",
                    type: "refresh"
                });
            }
            else {
                handler.writeMessage("failure","Token is invalid");
            }

        }, (err) => {
            if (err instanceof TokenError) {
                handler.writeError(err.toString());
            }
            else {
                console.error(err);
                handler.writeError("Failed to check token");
            }
        });
    }

    doClear(handler,message) {
        if (!message.appId && typeof message.appId !== "string") {
            throw new EndpointError("Message missing appId");
        }

        if (!message.sessionId && typeof message.sessionId !== "string") {
            throw new EndpointError("Message missing sessionId");
        }

        const { appId, isUser, token: tokenValue } = this.manager.get(message.sessionId);

        if (!tokenValue) {
            throw new EndpointError("Invalid session");
        }

        if (appId != message.appId) {
            throw new EndpointError("App ID mismatch");
        }

        // Only user-based tokens are allowed for a token endpoint operation. A
        // non-user token should never be queried (in practice).
        if (!isUser) {
            throw new EndpointError("Session is invalid");
        }

        // Delete the token from the manager storage.
        this.manager.remove(message.sessionId);
        handler.writeMessage("success",{
            message: "Token was removed"
        });
    }
}

module.exports = {
    TokenEndpoint
};
