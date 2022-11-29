# Graph Layer

Graph Layer is a Node.js application that acts as a middleware layer between Microsoft Graph (Microsoft 365) and a web or desktop application. Graph Layer is designed to obtain and manage access tokens and proxy API calls. Access tokens may be obtained for users (via a user authorization grant) or for your application.

## Overview and Concepts

Graph Layer was primarily designed to separate interaction with the Microsoft Graph away from an application's backend component. This separation allows an application's frontend component to interact indirectly with Microsoft Graph via Graph Layer. An application's backend component need only be employed during authentication to establish a session. Graph Layer stores and manages access tokens on an application's or user's behalf.

### Applications

A Graph Layer application relates directly to an application defined in Azure Active Directory. Whenever a client interacts with Graph Layer, it does so within the context of an application. A single instance of Graph Layer can support multiple applications at once.

The Graph Layer configuration stores the API credentials for each application so it can obtain access tokens on behalf of a user or application.

### Token Endpoint

The token endpoint is used to create Graph Layer sessions. When a Graph Layer session is created, a Microsoft Graph API access token is obtained and associated with the session. The token endpoint can also be used for:
- Checking to see if a session is still valid
- Obtaining user information about a session (via the `/me` endpoint)
- Logging out of a session

The token endpoint is designed to interact with the backend component of a web application.

### Proxy Endpoint

The proxy endpoint is used to proxy API calls to Microsoft Graph. The proxy endpoint maps a Graph Layer session to an API access token used to perform the API call itself. As such, the user agent must be authenticated against Microsoft Graph via Graph Layer in order to work. (See Token Endpoint above)

The proxy endpoint also supports anonymous requests. These requests are for a user agent that does _not_ have a valid Graph Layer session but must still access certain APIs. Such requests utilize an access token obtained from credentials configured on the Graph Layer backend for the application in question.

> Note that anonymous requests can imply certain security risks, so it is important that access is configured correctly. It is only designed for specific scenarios (e.g. private networks). To enable anonymous access, you must define a user account in your Microsoft tenant that will represent any anonymous user. An anonymous user should be configured to have access to resources in your tenant according to your needs.

The proxy endpoint is designed to interact with the frontend component of a web application.

## Installation and Setup

Install as a global tool with `npm`:

	$ npm install -g @tccl/graph-layer

To configure the Graph Layer server, create a configuration file. You may use the template in the repository found in `config.default.json`. A config file is written in JSON format; Javascript-style comments are allowed in the JSON file.

By default, Graph Layer searches for `config.json` in its working directory. However, you can use the `-f` or `--configFile` options to specify a custom path and file name.

## Configuration Guide

### Configuring an application

An application allows Graph Layer to communicate with the Microsoft Graph API. Each application corresponds to an application defined in Azure Active Directory.

The config file contains an `apps` property that defines a list of applications that can connect and utilize the Graph Layer service. Individual applications provide the credentials used to obtain access tokens from the Microsoft Graph API.

Example:

~~~javascript
"apps": [
	// The first entry is used by the test application executed via 'npm run
	// test'.
	{
		"id": "test-app",
		"name": "Test Application",
		/**
		 * Microsoft Graph API credentials.
		 *
		 *  tenantId: Determines which tenant is authorizing. This should
		 *  be your tenant GUID/domain for a specific organization or one
		 *  of:
		 *   - common: Work/school accounts or personal Microsoft accounts
		 *   - organizations: Work/school accounts only
		 *   - consumers: Personal Microsoft accounts only
		 *
		 *  cloudUrl: The base URL for the authentication endpoint. This
		 *  will default to https://login.microsoftonline.com if not
		 *  specified.
		 */
		"clientId": "",
		"clientSecret": "",
		"tenantId": "",
		"cloudUrl": "https://login.microsoftonline.com",

		/**
		 * The scopes to request for access tokens associated with user
		 * identities.
		 */
		"userScopes": [
			"user.read"
		],

		// The redirect URI used during sign in.
		"redirectUri": "https://myorg.example.com/auth/callback",
		// The post logout redirect URI used during sign out.
		"postLogoutRedirectUri": "https://myorg.example.com/",

		/**
		 * The login credentials for a user account to use as the
		 * "anonymous" user. Leave NULL or with empty property values to
		 * disable the anonymous user for this application.
		 */
		"anonymousUser": {
			"username": "",
			"password": ""
		}
	}
],
~~~

When a client connects to the token endpoint, it passes an Application ID corresponding to the `id` in the application configuration. The token endpoint will obtain access tokens on behalf of the client using the configured application credentials. (This means your application doesn't have to store the API credentials and associated metadata. It only has to store the token endpoint connection details and an Application ID.)

### Configuring the token endpoint

The token endpoint is used to create and manage Graph Layer sessions. The endpoint is configured in the configuration file under the `tokenEndpoint` property.

Example configuration:
~~~javascript
"tokenEndpoint": {
	/**
	 * The INET configuration for the endpoint.
	 */
	"host": "0.0.0.0",
	"port": 7000,

	/**
	 * The list of IP addresses that are allowed to connect to the token
	 * endpoint.
	 */
	"whitelist": "0.0.0.0/0",

	/**
	 * The interval (in seconds) between calls to the token cleanup routine.
	 */
	"cleanupInterval": 3600,

	/**
	 * The number of days after expiration before a token is removed from
	 * persistant storage.
	 *
	 * NOTE: Since tokens may be refreshed, you may want to keep this
	 * further out depending on how persistent your application session is.
	 */
	"expireDays": 15
}
~~~

### Configuring the proxy endpoint

The proxy endpoint is responsible for proxying HTTP API requests from a client to Microsoft Graph. The endpoint is configured in the configuration file under the `proxyEndpoint` property.

Example configuration:
~~~javascript
"proxyEndpoint": {
	/**
	 * The INET configuration used by the proxy endpoint to accept incoming HTTP
	 * connections.
	 */
	"host": "0.0.0.0",
	"port": 8000,

	/**
	 * Cookie that contains the graph layer session ID that is used when
	 * making a graph-layer proxy request.
	 */
	"cookie": "GRAPH_LAYER_SESSID",

	/**
	 * Name of the HTTP request header identifies an anonymous graph-layer
	 * proxy request. The header value is the ID of the application to use
	 * for the anonymous request. The indicated application must have an
	 * anonymous user configured for this to work. Set this value to empty
	 * to disable anonymous access.
	 */
	"anonymousHeader": null,

	/**
	 * The base path for all Microsoft graph URIs that are proxied via the proxy
	 * endpoint.
	 *
	 * This is the prefix path component(s) that is matched against any URI
	 * processed by the proxy endpoint. Leave empty (or "/") to proxy URIs
	 * as-is.
	 */
	"basePath": "/graph/layer",

	/**
	 * List of API endpoints that are allowed and will be proxied. Any other
	 * endpoints are not allowed and return HTTP 404. Elements in this list
	 * are glob patterns matched via minimatch.
	 *
	 * An empty list means 'allow all'.
	 *
	 * NOTE: The whitelist *cannot* allow endpoints disallowed by the
	 * blacklist.
	 */
	"whitelist": [],

	/**
	 * List of API endpoints that are not allowed and will return HTTP
	 * 404. Any other endpoints are allowed and will be proxied. Elements in
	 * this list are glob patterns matched via minimatch.
	 *
	 * NOTE: The blacklist can be used to disallow endpoints allowed by the
	 * whitelist.
	 */
	"blacklist": []
}
~~~

The frontend of your application will target the proxy endpoint in order to perform API requests. Typically, you will configure your application's web server to target the proxy endpoint via a reverse proxy; however you can always run the proxy endpoint on another host or port.

### Configuring anonymous access

Anonymous access is designed to allow an unauthenticated user agent to make API calls using a configured anonymous user account. Note that you should understand any security implications before using this feature.

To enable anonymous user access, set the `proxyEndpoint.anonymousHeader` property to valid HTTP header name (e.g. `X-Graph-Layer-Anonymous`). When this property is set, a client can send an application ID in this header field to denote an anonymous request. The anonymous user configured with the indicated application is used to obtain an access token and perform the API call.

The anonymous user is defined via the `anonymousUser` property under the application. You should make sure this user only has the minimal required permissions according to your needs.
