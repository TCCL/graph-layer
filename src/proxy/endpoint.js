/**
 * proxy/endpoint.js
 *
 * @tccl/graph-layer
 */

const express = require("express");
const cookieParser = require("cookie-parser");
const { Minimatch } = require("minimatch");
const { ResponseType } = require("@microsoft/microsoft-graph-client");
const querystring = require("querystring");

const { Client } = require("../client");
const { unixtime, isFatalError } = require("../helpers");
const { TokenError } = require("../token/error");

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

function makeRequestUri(req) {
    let uri = req.params[0];
    const qs = querystring.stringify(req.query);
    if (qs) {
        uri += "?" + qs;
    }
    return uri;
}

function createList(list) {
    if (!Array.isArray(list)) {
        return createList([list]);
    }

    return list.map((pattern) => new Minimatch(pattern));
}

function listMatches(endpoint) {
    return (mm) => mm.match(endpoint);
}

function unauthorized(req,res,next) {
    res.status(401).json({
        status: 401,
        error: "Not Authorized",
        message: "The graph-layer session is not active."
    });
}

function notFound(req,res,next) {
    res.status(404).json({
        status: 404,
        error: "Not Found",
        message: "The resource you requested does not exist"
    });
}

function serverError(req,res,next) {
    res.status(500).json({
        status: 500,
        error: "Server Error",
        message: "An error occurred on the server while processing the request."
    });
}

function makePathPrefix(basePath) {
    const m = basePath.match("^/*(.*[^/]?)/*$");

    let expr = m[1];
    if (expr.length > 0) {
        expr = "/" + expr;
    }

    return expr + "(/*)";
}

class ProxyEndpoint {
    constructor(services,_options) {
        const options = _options || {};

        this.logger = services.getLogger();
        this.tokenManager = services.getTokenManager();
        this.config = services.getConfig().get("proxyEndpoint");
        this.server = null;

        const [
            cookieName,
            anonymousHeaderName,
            basePath,
            whitelist,
            blacklist
        ] = this.config.get(
            "cookie",
            "anonymousHeader",
            "basePath",
            "whitelist",
            "blacklist"
        );

        this.cookieName = cookieName;
        this.anonymousHeaderName = anonymousHeaderName;
        this.basePath = basePath;
        this.whitelist = createList(whitelist);
        this.blacklist = createList(blacklist);

        const proxyHandler = this.proxy.bind(this);

        this.app = express();
        this.app.disable("x-powered-by");
        this.app.use(cookieParser());
        this.app.get(makePathPrefix(basePath),proxyHandler);
        if (!options.testing) {
            this.app.get("*",notFound);
        }
    }

    /**
     * Starts the proxy server.
     */
    start() {
        if (this.server) {
            return;
        }

        const [ port, host ] = this.config.get("port","host");
        this.server = this.app.listen(port,host);
    }

    /**
     * Closes and stops the proxy server.
     */
    stop() {
        if (!this.server) {
            return;
        }

        this.server.close();
        this.server = null;
    }

    /**
     * Handler for requests to the proxy handler.
     *
     * @param {object} req
     * @param {object} res
     * @param {function} next
     */
    proxy(req,res,next) {
        const log = {
            client: req.ip,
            start: unixtime(),
            end: null,
            requestMethod: req.method,
            requestUri: makeRequestUri(req),
            status: 0,
            responseSize: 0,
            responseTime: 0
        };

        res.on("finish",() => {
            const dt = new Date();

            log.status = res.statusCode;
            log.end = unixtime();
            log.responseTime = log.end - log.start;

            this.logger.proxyLog(dt,log);
        });

        // Exclude endpoints that are blacklisted or not whitelisted.
        const testfn = listMatches(req.params[0]);
        const disallow = this.blacklist.some(testfn);
        if (disallow
            || (this.whitelist.length > 0
                && !this.whitelist.some(testfn)))
        {
            notFound(req,res,next);
            return;
        }

        let promise;

        // Figure out which proxy method to use: anonymous or session-based.
        if (this.anonymousHeaderName && req.get(this.anonymousHeaderName)) {
            // Pull application ID from cookies.
            const anonAppId = req.get(this.anonymousHeaderName);
            promise = this.proxyRequestAnonymous(anonAppId,req);
        }
        else if (this.cookieName in req.cookies) {
            // Pull session ID (i.e. token ID) from cookies.
            const sessionId = req.cookies[this.cookieName];
            promise = this.proxyRequestWithSession(sessionId,req);
        }
        else {
            unauthorized(req,res,next);
            return;
        }

        // Do proxy of upstream request.
        promise.then((graphResponse) => {
            if (!graphResponse) {
                unauthorized(req,res,next);
                return;
            }

            res.status(graphResponse.status);

            // Transfer headers.
            for (const name of graphResponse.headers.keys()) {
                if (HEADER_BLACKLIST.indexOf(name) >= 0) {
                    continue;
                }

                res.setHeader(name,graphResponse.headers.get(name));
            }

            // Transfer response body.
            graphResponse.body.on("data",(chunk) => {
                log.responseSize += chunk.length;
            }).pipe(res);

        }).catch((err) => {
            if (err instanceof TokenError) {
                unauthorized(req,res,next);
            }
            else {
                serverError(req,res,next);
            }
            this.handleError(err,"Error occurred during Graph API proxy");
        });
    }

    async proxyRequestWithSession(sessionId,downReq) {
        if (!sessionId) {
            return null;
        }

        // Load token by session ID.
        const token = await this.tokenManager.getToken(sessionId);

        return this.proxyRequest(token,downReq);
    }

    async proxyRequestAnonymous(appId,downReq) {
        if (!appId) {
            return null;
        }

        // Load token by application ID.
        const token = await this.tokenManager.getAnonymousToken(appId);

        return this.proxyRequest(token,downReq);
    }

    async proxyRequest(token,downReq) {
        // Create client using indicated token.
        const client = new Client(token);

        // Prepare upstream request.
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

        if (downReq.method != "DELETE") {
            // Forward the Content-Type header if provided.
            const requestContentType = downReq.get("Content-Type");
            if (requestContentType) {
                upReq.header("Content-Type",requestContentType);
            }

            // Transfer any content from the downstream request to the upstream
            // request.
            upReq.option("body",downReq);
        }

        if (downReq.method == "POST") {
            return await upReq.post();
        }

        if (downReq.method == "PUT") {
            return await upReq.put();
        }

        if (downReq.method == "PATCH") {
            return await upReq.patch();
        }

        if (downReq.method == "DELETE") {
            return await upReq.delete();
        }

        throw new ErrorF("Graph API proxy: method '%s' is not supported");
    }

    handleError(error,context) {
        if (context) {
            this.logger.errorLog(context);
        }
        this.logger.errorLog(error);

        if (isFatalError(error)) {
            process.exit(1);
        }
    }
}

module.exports = {
    ProxyEndpoint
};
