/**
 * test.js
 *
 * @tccl/graph-layer/test
 */

const ejs = require("ejs");
const net = require("net");
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const querystring = require("querystring");
const { format } = require("util");

require("../src/globals");
const { Config } = require("../src/config");
const { Server } = require("../src/server");
const { JsonMessage } = require("../src/helpers");

const CONFIG_FILE = process.env.GRAPH_LAYER_TEST_CONFIG_FILE || "./config.json";

function log(message,...args) {
    const printed = format(message,...args);
    console.error("[test]: " + printed);
    return printed;
}

function render(res,contentName,vars,cb) {
    const options = {
        root: "./test/templates",
        views: ["./test/templates"]
    };

    const content = contentName + '.template';
    const data = {
        content,
        vars: vars || {}
    };

    ejs.renderFile("./test/templates/base.template",data,options,(err,str) => {
        if (err) {
            let html = "";
            html += "<h1>Error!</h1>";
            html += "<h2>Cannot render template</h2>";
            console.error(err);
            res.status(500).send(html);
            return;
        }

        res.send(str);
        if (typeof cb === "function") {
            cb();
        }
    });
}

function send_error(res,message,...args) {
    const error = format(message,...args);
    log("[error]: " + error);

    res.status(500);
    render(res,"error",{ error });
}

function get_index(req,res) {
    render(res,"index",{ cookies: req.cookies });
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
                send_error(res,"Protocol Error: invalid protocol message");
                return;
            }

            if (message.type == "redirect") {
                res.cookie("GRAPH_LAYER_AUTH_SESSID",message.value.sessionId);
                res.redirect(message.value.uri);
            }
            else if (message.type == "error") {
                send_error(res,"Operation Error: %s",message.value);
            }
            else {
                send_error(
                    res,
                    "Client Error: cannot handle message: %s",
                    JSON.stringify(message)
                );
            }

            sock.end();
        }
    });
}

function get_callback(req,res) {
    const code = req.query.code;
    const sessionId = req.cookies.GRAPH_LAYER_AUTH_SESSID;

    if (!code) {
        send_error(res,"Callback Error: Didn't get an authorization code");
        return;
    }

    if (!sessionId) {
        send_error(res,"Session Error: Invalid or missing session");
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
            queryString: querystring.stringify(req.query)
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

                render(
                    res,
                    "callback-message",
                    { sessionId: message.value.sessionId }
                );
            }
            else if (message.type == "error") {
                send_error(res,"Operation Error: %s",message.value);
            }
            else {
                send_error(
                    res,
                    "Client Error: cannot handle message: %s",
                    message.value
                );
            }

            sock.end();
        }
    });
}

function get_check(req,res) {
    const sessionId = req.cookies.GRAPH_LAYER_SESSID;

    if (!sessionId) {
        res.status(500).send("<h2>Invalid session</h2>");
        return;
    }

    const { sock, app } = connect();
    const incoming = new JsonMessage();

    sock.on("connect",() => {
        // Begin login sequence.
        const message = {
            action: "check",
            appId: app.id,
            sessionId
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

            if (message.type == "error") {
                send_error(res,"Operation Error: %s",message.value);
                return;
            }

            if (message.type == "success" || message.type == "failure") {
                render(res,"check-message",{
                    result: message.type,
                    message: message.value
                });
            }
            else {
                send_error(
                    res,
                    "Client Error: cannot handle message: %s",
                    message.value
                );
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

    server.app.get('/',get_index);
    server.app.get('/auth',get_auth);
    server.app.get('/callback',get_callback);
    server.app.get('/check',get_check);

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
