/**
 * application-manager.js
 *
 * @tccl/graph-layer
 */

const querystring = require("querystring");
const { format } = require("util");
const { URL } = require("url");

const msal = require("@azure/msal-node");
const { RefreshTokenEntity, CredentialType } = require("@azure/msal-common");

class ApplicationWrapper {
    constructor(id,settings) {
        const authority = format(
            "%s/%s",
            settings.cloudUrl || "",
            settings.tenantId
        );

        const clientConfig = {
            auth: {
                clientId: settings.clientId,
                authority
            }
        };

        if (settings.clientSecret) {
            clientConfig.auth.clientSecret = settings.clientSecret;
        }
        else if (settings.clientCertificate) {
            clientConfig.auth.clientCertificate = settings.clientCertificate;
        }
        else if (settings.clientAssertion) {
            clientConfig.auth.clientAssertion = settings.clientAssertion;
        }

        const cca = new msal.ConfidentialClientApplication(clientConfig);

        this.id = id;
        this.cca = cca;
        this.clientId = settings.clientId;
        this.cloudUrl = settings.cloudUrl;
        this.tenantId = settings.tenantId;
        this.authority = authority;
        this.scopes = settings.userScopes;
        this.redirectUri = settings.redirectUri;
        this.postLogoutRedirectUri = settings.postLogoutRedirectUri;
        this.anonymousUser = settings.anonymousUser;
    }

    async getAuthCodeUrl() {
        const authCodeUrlParameters = {
            scopes: this.scopes,
            redirectUri: this.redirectUri
        };

        const response = await this.cca.getAuthCodeUrl(authCodeUrlParameters);

        return response;
    }

    async getLogoutUrl() {
        const urlParts = [
            this.cloudUrl,
            this.tenantId,
            "oauth2/v2.0/logout"
        ];

        const url = new URL(urlParts.join("/"));

        if (this.postLogoutRedirectUri) {
            url.searchParams.set("post_logout_redirect_uri",this.postLogoutRedirectUri);
        }

        return url.toString();
    }

    async acquireTokenByCode(qs) {
        const params = querystring.parse(qs);

        const tokenRequest = {
            code: params.code,
            redirectUri: this.redirectUri,
            scopes: this.scopes
        };

        const authenticationResult = await this.cca.acquireTokenByCode(tokenRequest);

        return this.makeTokenInfo(authenticationResult);
    }

    async acquireTokenByRefreshToken(refreshToken) {
        const refreshTokenRequest = {
            refreshToken,
            scopes: this.scopes
        };

        const authenticationResult = await this.cca.acquireTokenByRefreshToken(refreshTokenRequest);

        return this.makeTokenInfo(authenticationResult);
    }

    async acquireTokenByUsernamePassword(username,password) {
        const usernamePasswordRequest = {
            username,
            password,
            scopes: this.scopes
        };

        const authenticationResult = await this.cca.acquireTokenByUsernamePassword(
            usernamePasswordRequest
        );

        return this.makeTokenInfo(authenticationResult);
    }

    makeTokenInfo(authenticationResult) {
        let {
            accessToken,
            expiresOn,
            familyId,
            account,
            account: {
                homeAccountId,
                environment
            },
            scopes,
            idToken,
            tokenType

        } = authenticationResult;
        let refreshToken = null;

        // Convert expiresOn into UNIX timestamp of nearest second.
        expiresOn = Math.round(expiresOn.getTime() / 1000);

        // Obtain refresh token from the token cache. Unfortunately, MSAL does not
        // give us this directly; it really should, since we need to implement our
        // own token caching mechanism.

        const cache = this.cca.getTokenCache().getKVStore();
        const cacheKey = RefreshTokenEntity.generateCredentialCacheKey(
            homeAccountId,
            environment,
            CredentialType.REFRESH_TOKEN,
            this.clientId,
            null, // realm
            null, // target
            familyId,
            null, // tokenType
            null // requestedClaimsHash
        );

        const refreshTokenEntry = cache[cacheKey];
        if (refreshTokenEntry) {
            refreshToken = refreshTokenEntry.secret;
        }

        return {
            accessToken,
            refreshToken,
            expiresOn,
            scopes,
            idToken,
            tokenType,
            account
        };
    }
}

class ApplicationManager {
    constructor(services) {
        this.config = services.config.get("apps");
        this.apps = new Map();
    }

    getApplication(appId) {
        const app = this.apps.get(appId);
        if (app) {
            return app;
        }

        const appSettings = this.config.get(appId).toObject();
        const wrapper = new ApplicationWrapper(appId,appSettings);
        this.apps.set(appId,wrapper);

        return wrapper;
    }

    clear() {
        this.apps.clear();
    }
}

module.exports = {
    ApplicationManager
};
