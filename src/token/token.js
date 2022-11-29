/**
 * token/token.js
 *
 * @tccl/graph-layer
 */

const { TokenError } = require("./error");

/**
 * Encapsulates an access token.
 */
class Token {
    constructor(tokenId,appId,isUser,tokenInfo) {
        this.id = tokenId;
        this.appId = appId;
        this.isUser = isUser;
        this.tokenInfo = tokenInfo;
    }

    getAppId() {
        return this.appId;
    }

    isUserToken() {
        return !!this.isUser;
    }

    getAccessToken() {
        return this.tokenInfo.accessToken;
    }

    getRefreshToken() {
        return this.tokenInfo.refreshToken;
    }

    isExpired() {
        const now = Math.round(Date.now() / 1000);

        return now >= this.tokenInfo.expiresOn;
    }

    isExpiredByDays(ndays) {
        const now = Math.round(Date.now() / 1000);
        const ts = this.tokenInfo.expiresOn + ndays*86400;

        return now >= ts;
    }

    refresh(tokenInfo) {
        this.tokenInfo = tokenInfo;
    }
}

module.exports = {
    Token
};
