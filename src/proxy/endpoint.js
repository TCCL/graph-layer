/**
 * proxy/endpoint.js
 *
 * @tccl/graph-layer
 */

const express = require("express");
const cookieParser = require("cookie-parser");
const { ResponseType } = require("@microsoft/microsoft-graph-client");

const { Client } = require("../client");

const HEADER_BLACKLIST = [
    "server"
];

const FORWARD_HEADERS = [
    "accept",
    "accept-encoding",
    "accept-language",
    "cache-control",
    "pragma"
];

function makePathPrefix(basePath) {
    const m = basePath.match("^/*(.*[^/]?)/*$");

    let expr = m[1];
    if (expr.length > 0) {
        expr = "/" + expr;
    }

    return expr + "(/*)";
}

class ProxyEndpoint {
    constructor(tokenManager,config,_options) {
        const options = _options || {};

        this.tokenManager = tokenManager;
        this.config = config.get("proxyEndpoint");
        this.server = null;

        const [ cookieName, basePath ] = this.config.get("cookie","basePath");
        this.cookieName = cookieName;
        this.basePath = basePath;

        const proxyHandler = this.proxy.bind(this);

        this.app = express();
        this.app.disable("x-powered-by");
        this.app.use(cookieParser());
        this.app.get(makePathPrefix(basePath),proxyHandler);
        if (!options.testing) {
            this.app.get("*",(req,res,next) => {
                res.status(404).json({
                    status: 404,
                    error: "Not Found",
                    message: "The resource you requested does not exist"
                });
            });
        }
    }

    start() {
        if (this.server) {
            return;
        }

        const [ port, host ] = this.config.get("port","host");
        this.server = this.app.listen(port,host);
    }

    stop() {
        if (!this.server) {
            return;
        }

        this.server.close();
        this.server = null;
    }

    proxy(req,res,next) {
        const sessionId = req.cookies[this.cookieName];
        if (!sessionId) {
            res.status(401).json({
                status: 401,
                error: "Not Authorized",
                message: "The graph-layer session is not active."
            });

            return;
        }

        this.graphAPI(sessionId,req).then((graphResponse) => {
            // Transfer headers.
            for (const name of graphResponse.headers.keys()) {
                if (HEADER_BLACKLIST.indexOf(name) >= 0) {
                    continue;
                }

                res.setHeader(name,graphResponse.headers.get(name));
            }

            // Transfer response body.
            graphResponse.body.pipe(res);

        }).catch((err) => {
            console.error(err);
            res.status(500).json({
                status: 500,
                error: "Server Error",
                message: "An error occurred on the server while processing the request."
            });
        });
    }

    async graphAPI(sessionId,downReq) {
        const token = await this.tokenManager.getToken(sessionId);
        const client = new Client(token);

        const upReq = client.api(downReq.params[0]);
        upReq.query(downReq.query);
        upReq.option("compress",false);
        upReq.responseType(ResponseType.RAW);
        upReq.header("User-Agent","tccl/graph-layer");

        // Forward specific headers if provided.
        for (const name of FORWARD_HEADERS) {
            const hdr = downReq.get(name);
            if (hdr) {
                upReq.header(name,hdr);
            }
        }

        if (downReq.method == "GET") {
            return await upReq.get();
        }

        if (method != "DELETE") {
            // Forward the Content-Type header if provided.
            const requestContentType = downReq.get("Content-Type");
            if (requestContentType) {
                upReq.header("Content-Type",requestContentType);
            }

            // Transfer any content from the downstream request to the upstream
            // request.
            upReq.option("body",downReq);
        }

        if (method == "POST") {
            return await upReq.post();
        }

        if (method == "PUT") {
            return await upReq.put();
        }

        if (method == "PATCH") {
            return await upReq.patch();
        }

        if (method == "DELETE") {
            return await upReq.delete();
        }

        throw new ErrorF("Graph API proxy: method '%s' is not supported");
    }
}

module.exports = {
    ProxyEndpoint
};
