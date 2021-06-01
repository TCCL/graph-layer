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
const { TokenSet } = require("openid-client");

const { JsonMessage } = require("./helpers");

class TokenError extends ErrorF {}

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
        else if (message.action == "check") {
            this.endpoint.doCheck(this,message);
        }
        else if (message.action == "clear") {
            this.endpoint.doClear(this,message);
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
            handler.writeError("Protocol error: appId");
            return;
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
            handler.writeError("Protocol error: appId");
            return;
        }

        if (!message.sessionId && typeof message.sessionId !== "string") {
            handler.writeError("Protocol error: sessionId");
            return;
        }

        if (!message.queryString && typeof message.queryString !== "string") {
            handler.writeError("Protocol error: queryString");
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
            handler.writeError("Protocol error: appId");
            return;
        }

        if (!message.sessionId && typeof message.sessionId !== "string") {
            handler.writeError("Protocol error: sessionId");
            return;
        }

        const { appId, isUser, token: tokenValue } = this.manager.get(message.sessionId);

        if (!tokenValue) {
            handler.writeMessage("failure","No such token");
            return;
        }

        if (appId != message.appId) {
            handler.writeError("App ID mismatch");
            return;
        }

        // Only user-based tokens are allowed for a token endpoint operation. A
        // non-user token should never be queried (in practice).
        if (!isUser) {
            handler.writeError("Session is invalid");
            return;
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
            handler.writeError("Protocol error: appId");
            return;
        }

        if (!message.sessionId && typeof message.sessionId !== "string") {
            handler.writeError("Protocol error: sessionId");
            return;
        }

        const { appId, isUser, token: tokenValue } = this.manager.get(message.sessionId);

        if (!tokenValue) {
            handler.writeMessage("error","Invalid session");
            return;
        }

        if (appId != message.appId) {
            handler.writeError("App ID mismatch");
            return;
        }

        // Only user-based tokens are allowed for a token endpoint operation. A
        // non-user token should never be queried (in practice).
        if (!isUser) {
            handler.writeError("Session is invalid");
            return;
        }

        // Delete the token from the manager storage.
        this.manager.remove(message.sessionId);
        handler.writeMessage("success",{
            message: "Token was removed"
        });
    }
}

/**
 * Encapsulates an access token.
 */
class Token {
    constructor(tokenId,appId,isUser,token) {
        this.id = tokenId;
        this.appId = appId;
        this.isUser = isUser;
        this.token = new TokenSet(token);
    }

    getValue() {
        return this.token;
    }

    getAccessToken() {
        return this.token.access_token;
    }

    isExpired() {
        return this.token.expired();
    }

    isExpiredByDays(ndays) {
        if (!this.token.expired()) {
            return false;
        }

        const now = Math.round(Date.now() / 1000);
        const ts = this.token.expires_at + ndays * 86400;

        return now >= ts;
    }

    async refresh(manager) {
        // We can only refresh if we have the refresh token. This token is only
        // included if the initial request included the "offline_access" scope.

        if (!this.token.refresh_token) {
            return false;
        }

        const app = manager.config.getApplication(this.appId);
        if (!app) {
            throw new TokenError("No such application having ID '%s'",this.appId);
        }

        const newToken = await app.acquireTokenByRefreshToken(this.token);
        manager.update(this.id,this.appId,this.isUser,newToken);
        this.token = newToken;

        return true;
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
        const storage = this.config.getStorage();

        const query =
           `SELECT
              value AS 'value',
              app_id AS 'appId',
              is_user AS 'isUser'
            FROM
              token
            WHERE
              token_id = ?`;

        const vars = [
            id
        ];

        let token;
        const { value, appId, isUser } = storage.get(query,vars);

        try {
            token = JSON.parse(value);
        } catch (err) {
            throw new ErrorF("Cannot parse token for '%s'",id);
        }

        return { appId, isUser: Boolean(isUser), token };
    }

    set(id,appId,isUser,token) {
        const storage = this.config.getStorage();
        const isUserValue = isUser ? 1 : 0;

        const query =
           `INSERT INTO token (
              token_id,
              value,
              app_id,
              is_user
            )
            VALUES (
              ?,?,?,?
            )`;

        const vars = [
            id,
            JSON.stringify(token),
            appId,
            isUserValue
        ];

        storage.run(query,vars);
    }

    update(id,appId,isUser,token) {
        const storage = this.config.getStorage();
        const t = storage.transaction(() => {
            storage.run("DELETE FROM token WHERE token_id = ?",[id]);
            this.set(id,appId,isUser,token);
        });

        t();

        return { appId, isUser, token };
    }

    remove(id) {
        const storage = this.config.getStorage();

        const query = "DELETE FROM token WHERE token_id = ?";
        const vars = [id];

        storage.run(query,vars);
    }

    cleanup() {
        const storage = this.config.getStorage();

        // Clean up any tokens that have expired.
        const t = storage.transaction(() => {
            const del = storage.prepare(
                `DELETE FROM token WHERE token_id = ?`
            );

            const select =
                `SELECT
                   token_id AS 'tokenId',
                   value AS 'value',
                   app_id AS 'appId',
                   is_user AS 'isUser'
                 FROM
                  token`;

            const rm = [];
            for (const record of storage.iterate(select)) {
                let tokenObj;

                try {
                    tokenObj = JSON.parse(record.value);
                } catch (err) {
                    continue;
                }

                const token = new Token(
                    record.tokenId,
                    record.appId,
                    Boolean(record.isUser),
                    tokenObj
                );

                if (token.isExpiredByDays(15)) {
                    rm.push(record.tokenId);
                }
            }

            for (const tokenId of rm) {
                del.run(tokenId);
            }
        });

        t();
    }
}

module.exports = {
    TokenManager,
    TokenEndpoint
};
