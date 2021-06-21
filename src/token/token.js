/**
 * token/token.js
 *
 * @tccl/graph-layer
 */

const { TokenSet } = require("openid-client");

const { TokenError } = require("./error");

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

module.exports = {
    Token
};
