# Graph Layer

Graph Layer is a Node.js application that acts as a middleware layer between Microsoft Graph (Microsoft 365) and a web or desktop application. Graph Layer is designed to obtain and manage access tokens and proxy API calls. Access tokens may be obtained for users (via a user authorization grant) or for your application.

## Overview

Graph Layer was primarily designed to separate interaction with the Microsoft Graph away from an application's backend component. This separation allows an application's frontend component to interact indirectly with Microsoft Graph via the Graph Layer process. An application's backend component need only be employed during authentication. Graph Layer stores and manages access tokens on an application's/user's behalf.

Graph Layer implements two endpoints: proxy and token.

### Proxy Endpoint

The proxy endpoint is used to proxy API calls to Microsoft Graph. The proxy endpoint maps a local session cookie to a user token which is used to perform the API call. It also supports application tokens that can be used to allow any user access to particular resources. (The user must be authenticated with a valid Graph Layer session in order to access application resources.)

The proxy endpoint is designed to interact with the frontend component of a web application.

### Token Endpoint

The token endpoint is used to create Graph Layer sessions, which obtain access tokens. (A Graph Layer session is a key that maps to an access token.) The token endpoint can also be used for:
- Checking to see if a session is still valid
- Obtaining user information about a session (via the `/me` endpoint)
- for logging out of a session

The token endpoint is designed to interact with the backend component of a web application.

## Installation and Setup

Install as a global tool with npm:

	$ npm install -g @tccl/graph-layer

To configure the Graph Layer server, create a configuration file. You may use the template in the repository found in `config.default.json`. A config file is written in JSON format; Javascript-style comments are allowed in the JSON file.

By default, Graph Layer searches for `config.json` in its working directory. However, you can use the `-f` or `--configFile` options to specify a custom path and file name.

### Configuring an application

The config file contains an `apps` section that defines the applications that can connect to and utilize the Graph Layer service. Entries under this section also define the credentials used to obtain access tokens from the Microsoft Graph API.

Example:

~~~javascript
{
  // Configure an application
    "id": "test-app",
    "name": "Test Application",

    "cookie": "GRAPH_LAYER_SESSID",

    "client_id": "d1ecd865-19a8-49f9-b448-ab50f9609342",
    "client_secret": "*not-telling*",
    "tenant_id": "024382c7-bd8e-41c5-a376-acf030f8c04c",
    "cloud_id": "https://login.microsoftonline.com",

    "userScopes": [
        "user.read"
    ],
    "redirectUri": "http://localhost:8000/callback"
}
~~~

When a client connects to the token endpoint, it passes an Application ID. The token endpoint will obtain access tokens using the application credentials that correspond to the indicated Application ID. (This means your application doesn't have to store the API credentials and associated metadata. It only has to store the token endpoint connection details and an Application ID.)
