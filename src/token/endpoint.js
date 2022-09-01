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
const { Client } = require("../client");
const { isFatalError } = require("../helpers");

/**
 * Implements a net.Server that provides the token endpoint.
 */
class TokenEndpoint extends net.Server {
    constructor(services) {
        super();

        this.config = services.getConfig();
        this.appManager = services.getAppManager();
        this.tokenManager = services.getTokenManager();
        this.logger = services.getLogger();
        this.cleanupInterval = null;

        // The sessions map stores temporary login sessions.
        this.sessions = new Map();
    }

    start() {
        if (this.listening) {
            throw new Error("TokenEndpoint is already started");
        }

        const [ port, host, whitelist, cleanupInterval ]
              = this.config.get("tokenEndpoint")
                           .get("port","host","whitelist","cleanupInterval");

        if (typeof host != "string"
            || host == ""
            || typeof port != "number"
            || port <= 0
            || port > 65535)
        {
            throw new ErrorF("Invalid TCP config for 'tokenEndpoint': '%s:%d'",host,port);
        }

        if (typeof cleanupInterval != "number" || cleanupInterval < 1) {
            throw new ErrorF("Cleanup interval '%d' is invalid",cleanupInterval);
        }

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

        const cleanupfn = this.tokenManager.cleanup.bind(this.tokenManager);
        this.cleanupInterval = setInterval(cleanupfn,cleanupInterval * 1000);
        this.tokenManager.cleanup();
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
        const app = this.appManager.getApplication(message.appId);
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
            handler.writeError("Failed to initiate authentication");
            this.handleError(err);
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
        const app = this.appManager.getApplication(session.appId);
        if (!app) {
            throw new EndpointError("No such application having ID '%s'",session.appId);
        }

        app.acquireTokenByCode(message.queryString).then((tokenInfo) => {
            this.sessions.delete(session.sessionId);

            const tokenId = crypto.randomBytes(32).toString("base64");
            this.tokenManager.set(tokenId,session.appId,true,tokenInfo);

            handler.writeMessage("complete",{
                sessionId: tokenId
            });

        }).catch((err) => {
            handler.writeError("Failed to acquire access token");
            this.handleError(err,"Failed to acquire access token");
        });
    }

    doCheck(handler,message) {
        if (!message.appId && typeof message.appId !== "string") {
            throw new EndpointError("Message missing appId");
        }

        if (!message.sessionId && typeof message.sessionId !== "string") {
            throw new EndpointError("Message missing sessionId");
        }

        const { appId, isUser, tokenInfo } = this.tokenManager.get(message.sessionId);

        if (!tokenInfo) {
            throw new EndpointError("The session is invalid: no token for session");
        }

        if (appId != message.appId) {
            throw new EndpointError("The associated token does not belong to the indicated application");
        }

        // Only user-based tokens are allowed for a token endpoint operation. A
        // non-user token should never be queried (in practice).
        if (!isUser) {
            throw new EndpointError("The session token is invalid");
        }

        // Create client instance for checking token. If token is not valid,
        // attempt refresh. If the refresh fails, then we will have to fail.

        const token = new Token(message.sessionId,appId,isUser,tokenInfo);
        if (!token.isExpired()) {
            handler.writeMessage("success",{
                message: "Token is valid",
                type: "reuse"
            });
            return;
        }

        this.tokenManager.refresh(token).then(() => {
            handler.writeMessage("success",{
                message: "Token is valid",
                type: "refresh"
            });

        }, (err) => {
            if (err instanceof TokenError) {
                handler.writeError(err.toString());
            }
            else {
                console.error(err);
                handler.writeError("Check operation failed");
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

        const { appId, isUser, tokenInfo } = this.tokenManager.get(message.sessionId);

        if (!tokenInfo) {
            throw new EndpointError("The session is invalid: no token for session");
        }

        if (appId != message.appId) {
            throw new EndpointError("The associated token does not belong to the indicated application");
        }

        // Only user-based tokens are allowed for a token endpoint operation. A
        // non-user token should never be queried (in practice).
        if (!isUser) {
            throw new EndpointError("The session token is invalid");
        }

        const app = this.appManager.getApplication(appId);
        if (!app) {
            throw new EndpointError("No such application having ID '%s'",appId);
        }

        // Delete the token from the manager storage.
        this.tokenManager.remove(message.sessionId);

        app.getLogoutUrl().then((logoutUrl) => {
            handler.writeMessage("success",{
                message: "Token was removed",
                logoutUrl
            });
        });
    }

    doUserInfo(handler,message) {
        if (!message.appId && typeof message.appId !== "string") {
            throw new EndpointError("Protocol message missing property 'appId'");
        }

        if (!message.sessionId && typeof message.sessionId !== "string") {
            throw new EndpointError("Protocol message missing property 'sessionId'");
        }

        const select = message.select || [];

        if (!Array.isArray(select)) {
            if (typeof select !== "string") {
                throw new EndpointError("Invalid 'select' property in message");
            }

            select = [select];
        }

        this.tokenManager.getToken(message.sessionId).then(async (token) => {
            if (token.getAppId() != message.appId) {
                handler.writeError("The token does not belong to the correct application.");
                return;
            }

            if (!token.isUserToken()) {
                handler.writeError("The token is invalid");
                return;
            }

            const client = new Client(token);
            const call = client.api("/me");

            if (select.length > 0) {
                for (let i = 0;i < select.length;++i) {
                    call.select(select[i]);
                }
            }

            const result = await call.get();
            handler.writeMessage("success",result);

        }).catch((err) => {
            if (err instanceof TokenError) {
                handler.writeError(err.toString());
            }
            else {
                console.error(err);
                handler.writeError("User Info operation failed");
            }
        });
    }

    handleError(error,context) {
        if (context) {
            this.logger.errorLog(context);
        }
        this.logger.errorLog(error);

        if (isFatalError(error)) {
            process.exit(1);
        }
    }
}

module.exports = {
    TokenEndpoint
};
