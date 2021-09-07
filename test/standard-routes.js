/**
 * standard-routes.js
 *
 * @tccl/graph-layer/test
 */

const querystring = require("querystring");

const { JsonMessage } = require("../src/helpers");

function get_index(testbed,req,res) {
    testbed.render(req,res,"","index",{
        cookies: req.cookies,
        links: testbed.links
    });
}

function get_auth(testbed,req,res) {
    const { sock, app } = testbed.connect();
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
                testbed.send_error(res,"Protocol Error: invalid protocol message");
                return;
            }

            if (message.type == "redirect") {
                res.cookie("GRAPH_LAYER_AUTH_SESSID",message.value.sessionId);
                res.redirect(message.value.uri);
            }
            else if (message.type == "error") {
                testbed.send_error(res,"Operation Error: %s",message.value);
            }
            else {
                testbed.send_error(
                    res,
                    "Client Error: cannot handle message: %s",
                    JSON.stringify(message)
                );
            }

            sock.end();
        }
    });
}

function get_callback(testbed,req,res) {
    const code = req.query.code;
    const sessionId = req.cookies.GRAPH_LAYER_AUTH_SESSID;

    if (!code) {
        testbed.send_error(res,"Callback Error: Didn't get an authorization code");
        return;
    }

    if (!sessionId) {
        testbed.send_error(res,"Session Error: Invalid or missing session");
        return;
    }

    const { sock, app } = testbed.connect();
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

                testbed.render(
                    res,
                    "Callback Completed",
                    "callback-message",
                    {
                        sessionId: message.value.sessionId
                    }
                );
            }
            else if (message.type == "error") {
                testbed.send_error(res,"Operation Error: %s",message.value);
            }
            else {
                testbed.send_error(
                    res,
                    "Client Error: cannot handle message: %s",
                    message.value
                );
            }

            sock.end();
        }
    });
}

function get_check(testbed,req,res) {
    const sessionId = req.cookies.GRAPH_LAYER_SESSID;

    if (!sessionId) {
        testbed.send_error(res,"Invalid session");
        return;
    }

    const { sock, app } = testbed.connect();
    const incoming = new JsonMessage();

    sock.on("connect",() => {
        // Send check sequence.
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
                testbed.send_error(res,"Operation Error: %s",message.value);
                return;
            }

            if (message.type == "success" || message.type == "failure") {
                testbed.render(req,res,"Check","check-message",{
                    result: message.type,
                    message: message.value.message,
                    type: message.value.type
                });
            }
            else {
                testbed.send_error(
                    res,
                    "Client Error: cannot handle message: %s",
                    message.value
                );
            }

            sock.end();
        }
    });
}

function get_clear(testbed,req,res) {
    const sessionId = req.cookies.GRAPH_LAYER_SESSID;

    if (!sessionId) {
        testbed.send_error(res,"Invalid session: you are already logged out");
        return;
    }

    const { sock, app } = testbed.connect();
    const incoming = new JsonMessage();

    sock.on("connect",() => {
        // Send check sequence.
        const message = {
            action: "clear",
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
                testbed.send_error(res,"Operation Error: %s",message.value);
                return;
            }

            if (message.type == "success") {
                res.clearCookie("GRAPH_LAYER_SESSID");
                testbed.render(req,res,"Logout","clear",{
                    logoutUrl: message.value.logoutUrl
                });
            }
            else {
                testbed.send_error(
                    res,
                    "Client Error: cannot handle message: %s",
                    message.value
                );
            }

            sock.end();
        }
    });
}

function get_userinfo(testbed,req,res) {
    const sessionId = req.cookies.GRAPH_LAYER_SESSID;

    if (!sessionId) {
        testbed.send_error(res,"Invalid session: you are not logged in");
        return;
    }

    const { sock, app } = testbed.connect();
    const incoming = new JsonMessage();

    sock.on("connect",() => {
        // Send check sequence.
        const message = {
            action: "userInfo",
            appId: app.id,
            sessionId,
            select: ['id','displayName','mail','onPremisesSamAccountName']
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

            if (message.type != "success") {
                testbed.send_error(
                    res,
                    "Client Error: cannot handle message: %s",
                    message.value
                );
                return;
            }

            testbed.render(req,res,"User Info","userinfo",{
                result: message.value
            });
        }
    });
}

module.exports = {
    title: 'Standard Tests',

    routes: [
        ['/',get_index],
        ['/auth',get_auth,'Perform login'],
        ['/callback',get_callback],
        ['/check',get_check,'Check authentication'],
        ['/clear',get_clear,'Perform logout'],
        ['/userinfo',get_userinfo,'Get user information']
    ]
};
