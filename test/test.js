/**
 * test.js
 *
 * @tccl/graph-layer/test
 */

const net = require("net");
const path = require("path");
const express = require("express");
const { format } = require("util");

const { Config } = require("../src/config");
const { Server } = require("../src/server");
const { JsonMessage } = require("../src/helpers");

const CONFIG_FILE = process.env.GRAPH_LAYER_TEST_CONFIG_FILE || "./config.json";

function log(message,...args) {
    console.error("[test]: " + format(message,...args));
}

function get_auth(req,res) {
    const app = this.get("apps")[0]; // use first
    const [ port, host ] = this.get("tokenEndpoint").get("port","host");

    const incoming = new JsonMessage();
    const sock = new net.Socket();
    sock.setEncoding("utf8");
    sock.connect(port,host);

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
    res.send("Hello, World");
}

function main(config) {
    const server = new Server(config);

    server.app.use(express.static(path.join(__dirname,"public")));
    server.start();

    server.app.get('/auth',get_auth.bind(config));
    server.app.get('/callback',get_callback.bind(config));

    const stop = server.stop.bind(server);

    process.once("SIGINT",stop);
    process.once("SIGQUIT",stop);
    process.once("SIGTERM",stop);
}

const config = new Config();
config.load(CONFIG_FILE).then(main).catch(console.error);
