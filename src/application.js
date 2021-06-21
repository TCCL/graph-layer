/**
 * application.js
 *
 * @tccl/graph-layer
 */

const { Issuer } = require("openid-client");

/**
 * Encapsulates openid-client to implement OAuth application authentication
 * flow against Microsoft Graph service.
 */
class Application {
    constructor(appId,options) {
        this.id = appId;

        this.issuer = null;
        this.client = null;

        this.options = options;
    }

    async getAuthCodeUrl(state) {
        const client = await this._getClient();

        const params = {
            scope: "openid " + this.options.scopes.join(" ")
        };

        if (state) {
            params.state = state;
        }

        return client.authorizationUrl(params);
    }

    async acquireTokenByCode(queryString) {
        const client = await this._getClient();
        const params = client.callbackParams("/?" + queryString);

        return client.callback(this.options.redirectUri,params);
    }

    async acquireTokenByRefreshToken(tokenSet) {
        const client = await this._getClient();

        return client.refresh(tokenSet);
    }

    async getLogoutUrl() {
        const client = await this._getClient();

        return client.endSessionUrl();
    }

    async _getClient() {
        if (!this.issuer) {
            let uri = this.options.cloudId;
            uri += '/';
            uri += this.options.tenantId;
            uri += '/v2.0';

            this.issuer = await Issuer.discover(uri);
        }

        if (!this.client) {
            this.client = new this.issuer.Client({
                client_id: this.options.clientId,
                client_secret: this.options.clientSecret,
                redirect_uris: [this.options.redirectUri],
                response_types: ['code']
            });
        }

        return this.client;
    }
}

module.exports = {
    Application
};
