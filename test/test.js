/**
 * test.js
 *
 * @tccl/graph-layer/test
 */

const net = require("net");
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const { format } = require("util");

const { Config } = require("../src/config");
const { Server } = require("../src/server");
const { JsonMessage } = require("../src/helpers");

const CONFIG_FILE = process.env.GRAPH_LAYER_TEST_CONFIG_FILE || "./config.json";

function log(message,...args) {
    console.error("[test]: " + format(message,...args));
}

function get_auth(req,res) {
    const { sock, app } = connect();
    const incoming = new JsonMessage();

    sock.on("connect",() => {
        // Begin login sequence.
        const message = {
            action: "auth",
            appId: app.id
        };

        sock.write(JSON.stringify(message) + "\n");
    });

    sock.on("data",(chunk) => {
        if (incoming.receive(chunk)) {
            const message = incoming.getMessage();
            if (message === false) {
                log("[error]: invalid protocol message");
                return;
            }

            if (message.type == "redirect") {
                res.cookie("GRAPH_LAYER_AUTH_SESSID",message.value.sessionId);
                res.redirect(message.value.uri);
            }
            else if (message.type == "error") {
                log("[error-from-server]: %s",message.value);
            }
            else {
                log("[error]: cannot handle message: %s",JSON.stringify(message));
            }

            sock.end();
        }
    });
}

function get_callback(req,res) {
    const code = req.query.code;
    const sessionId = req.cookies.GRAPH_LAYER_AUTH_SESSID;

    if (!code) {
        res.status(500).send("<h2>Didn't get an authorization code</h2>");
        return;
    }

    if (!sessionId) {
        res.status(500).send("<h2>Invalid session</h2>");
        return;
    }

    const { sock, app } = connect();
    const incoming = new JsonMessage();

    sock.on("connect",() => {
        // Begin login sequence.
        const message = {
            action: "callback",
            appId: app.id,
            sessionId,
            code
        };

        sock.write(JSON.stringify(message) + "\n");
    });

    sock.on("data",(chunk) => {
        if (incoming.receive(chunk)) {
            const message = incoming.getMessage();
            if (message === false) {
                log("[error]: invalid protocol message");
                return;
            }

            if (message.type == "complete") {
                res.clearCookie("GRAPH_LAYER_AUTH_SESSID");
                res.cookie("GRAPH_LAYER_SESSID",message.value.sessionId);

                res.send(
                    format(
                        "<p>Session ID: <code>%s</code></p>"
                            + "<p><a href=\"/\">Continue</a></p>",
                        message.value.sessionId
                    )
                );
            }
            else if (message.type == "error") {
                log("[error-from-server]: %s",message.value);
            }
            else {
                log("[error]: cannot handle message: %s",JSON.stringify(message));
            }

            sock.end();
        }
    });
}

function main(config) {
    const server = new Server(config);

    server.app.use(cookieParser());
    server.app.use(express.static(path.join(__dirname,"public")));
    server.start();

    server.app.get('/auth',get_auth);
    server.app.get('/callback',get_callback);

    const stop = server.stop.bind(server);

    process.once("SIGINT",stop);
    process.once("SIGQUIT",stop);
    process.once("SIGTERM",stop);
}

function connect() {
    const app = config.get("apps")[0]; // use first
    const [ port, host ] = config.get("tokenEndpoint").get("port","host");

    const sock = new net.Socket();
    sock.setEncoding("utf8");
    sock.connect(port,host);

    return { sock, app };
}

const config = new Config();
config.load(CONFIG_FILE).then(main).catch(console.error);
