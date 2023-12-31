/**
 * token/manager.js
 *
 * @tccl/graph-layer
 */

const { format } = require("util");

const { Token } = require("./token");
const { TokenError } = require("./error");
const { Mutex } = require("../helpers");

const ANONYMOUS_ID_FORMAT = '__anonymous-%s__';

/**
 * Manages application and API token associations.
 */
class TokenManager {
    constructor(services) {
        this.config = services.getConfig();
        this.appManager = services.getAppManager();
        this.storage = services.getStorage();
        this.server = null;
        this.mutexes = {
            acquire: new Map(),
            refresh: new Map()
        };

        const tokenEndpointConfig = this.config.get("tokenEndpoint");
        this.expireDays = tokenEndpointConfig.get("expireDays");
        if (typeof this.expireDays != "number" || this.expireDays < 1) {
            throw new Errorf(
                "Invalid 'tokenEndpoint'.'expireDays' value: %s",
                this.expireDays
            );
        }
    }

    get(id) {
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

        const result = this.storage.get(query,vars);
        if (!result) {
            return {};
        }

        const { value, appId, isUser } = result;

        let tokenInfo;
        try {
            tokenInfo = JSON.parse(value);
        } catch (err) {
            throw new ErrorF("Cannot parse token for '%s'",id);
        }

        return { appId, isUser: Boolean(isUser), tokenInfo };
    }

    /**
     * Obtain access token by ID. This is a high-level variant that ensures the
     * token is not expired.
     */
    async getToken(id) {
        const { appId, isUser, tokenInfo } = this.get(id);
        if (!tokenInfo) {
            throw new TokenError("Token having id='%s' does not exist",id);
        }

        // Create token object and attempt refresh if expired.
        const token = new Token(id,appId,isUser,tokenInfo);
        if (token.isExpired()) {
            await this.refreshToken(token);
        }

        return token;
    }

    /**
     * Obtain access token for the anonymous user.
     */
    async getAnonymousToken(appId) {
        const app = this.appManager.getApplication(appId);
        if (!app) {
            throw new TokenError("Application '%s' is not configured",appId);
        }

        // Ensure we do not use anonymous tokens if the anonymous user is
        // disabled/not configured for the indicated application. We could have
        // a token left over in the persistent DB from a previous invocation.
        if (!app.anonymousUser || !app.anonymousUser.username || !app.anonymousUser.password) {
            throw new TokenError(
                "The 'anonymousUser' property is not configured for application '%s'",
                appId
            );
        }

        const id = format(ANONYMOUS_ID_FORMAT,appId);

        // Try loading an existing anonymous token. Attempt refresh if expired.
        const { appId: appIdVerify, isUser, tokenInfo } = this.get(id);
        if (tokenInfo && appId == appIdVerify) {
            let mutex = null;

            try {
                let token = new Token(id,appId,isUser,tokenInfo);
                if (!token.isExpired()) {
                    return token;
                }

                // Attempt a refresh. (The token may not have a refresh token
                // property.) Ensure that only one request attempts the acquire.
                mutex = this._getMutex("refresh",appId);
                token = await mutex.enter(async () => {
                    await this.refreshToken(token);
                    return token;
                });

                mutex.leave();

                return token;

            } catch (ex) {
                if (mutex) {
                    mutex.leave();
                }

                // If there was no refresh token, continue below to re-acquire a
                // new token.
                if (!(ex instanceof TokenError)) {
                    throw ex;
                }
            }
        }

        // Aquire anonymous token using configured anonymous user for
        // application. Ensure only one request attempts the acquire.

        const mutex = this._getMutex("acquire",appId);
        const token = await mutex.enter(async () => {
            const { username, password } = app.anonymousUser;
            const newTokenInfo = await app.acquireTokenByUsernamePassword(username,password);
            this.update(id,appId,false,newTokenInfo);
            return new Token(id,appId,false,newTokenInfo);
        });

        mutex.leave();

        return token;
    }

    /**
     * Attempts to refresh the indicated token object. The token object is
     * updated in-place.
     */
    async refreshToken(token) {
        // Attempt refresh of token if we have a refresh token on hand.
        const refreshToken = token.getRefreshToken();
        if (refreshToken) {
            const appId = token.getAppId();
            const app = this.appManager.getApplication(appId);
            if (!app) {
                throw new TokenError("Application '%s' is not available",appId);
            }

            const newTokenInfo = await app.acquireTokenByRefreshToken(refreshToken);
            this.update(token.id,token.appId,token.isUser,newTokenInfo);
            token.refresh(newTokenInfo);
        }
        else {
            throw new TokenError("Token is expired and cannot be refreshed");
        }
    }

    set(id,appId,isUser,tokenInfo) {
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
            JSON.stringify(tokenInfo),
            appId,
            isUserValue
        ];

        this.storage.run(query,vars);
    }

    update(id,appId,isUser,tokenInfo) {
        const t = this.storage.transaction(() => {
            this.storage.run("DELETE FROM token WHERE token_id = ?",[id]);
            this.set(id,appId,isUser,tokenInfo);
        });

        t();

        return { appId, isUser, tokenInfo };
    }

    remove(id) {
        const query = "DELETE FROM token WHERE token_id = ?";
        const vars = [id];

        this.storage.run(query,vars);
    }

    cleanup() {
        // Clean up any tokens that have expired.
        const t = this.storage.transaction(() => {
            const del = this.storage.prepare(
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
            for (const record of this.storage.iterate(select)) {
                let tokenInfo;

                try {
                    tokenInfo = JSON.parse(record.value);
                } catch (err) {
                    continue;
                }

                if (tokenInfo !== null && typeof tokenInfo === "object") {
                    const token = new Token(
                        record.tokenId,
                        record.appId,
                        Boolean(record.isUser),
                        tokenInfo
                    );

                    if (token.isExpiredByDays(this.expireDays)) {
                        rm.push(record.tokenId);
                    }
                }
                else {
                    rm.push(record.tokenId);
                }
            }

            for (const tokenId of rm) {
                del.run(tokenId);
            }
        });

        t();
    }

    _getMutex(type,appId) {
        const bucket = this.mutexes[type];

        let mutex = bucket.get(appId);
        if (!mutex) {
            mutex = new Mutex();
            bucket.set(appId,mutex);
        }

        return mutex;
    }
}

module.exports = {
    TokenManager
};
