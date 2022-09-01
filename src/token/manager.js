/**
 * token/manager.js
 *
 * @tccl/graph-layer
 */

const { Token } = require("./token");
const { TokenError } = require("./error");

/**
 * Manages application and API token associations.
 */
class TokenManager {
    constructor(services) {
        this.config = services.getConfig();
        this.appManager = services.getAppManager();
        this.storage = services.getStorage();
        this.server = null;

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
     * Attempts to refresh the indicated token object. The token object is
     * updated in-place.
     */
    async refreshToken(token) {
        // Attempt refresh of token if we have a refresh token on hand.
        const refreshToken = token.getRefreshToken();
        if (refreshToken) {
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

            for (const tokenId of rm) {
                del.run(tokenId);
            }
        });

        t();
    }
}

module.exports = {
    TokenManager
};
