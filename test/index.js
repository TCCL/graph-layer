/**
 * index.js
 *
 * @tccl/graph-layer/test
 */

const ejs = require("ejs");
const net = require("net");
const path = require("path");
const express = require("express");
const querystring = require("querystring");
const { format } = require("util");

require("../src/globals");
const { Config } = require("../src/config");
const { Server } = require("../src/server");

const CONFIG_FILE = process.env.GRAPH_LAYER_TEST_CONFIG_FILE || "./config.json";

class Testbed {
    constructor(options) {
        this.options = options || {};
        this.config = new Config();
        this.server = null;

        if (!this.options.plugins) {
            this.options.plugins = [];
        }
        this.options.plugins.unshift(require("./standard-routes"));

        this.links = [];
    }

    async start() {
        await this.config.load(CONFIG_FILE);

        const serverOptions = {
            testing: true
        };

        const server = new Server(this.config,serverOptions);
        const app = server.getApp();

        // Include core static files.
        app.use(express.static(path.join(__dirname,"public")));

        // Include static files and routes from plugins. This will at least
        // integrate the standard routes providing the core graph-layer tests.
        this.templateViews = ['./test/templates'];
        this.options.plugins.forEach((plugin) => {
            if (plugin.static) {
                for (let i = 0;i < plugin.static.length;++i) {
                    const [ vpath, assetsPath ] = plugin.static[i];

                    if (vpath) {
                        app.use(vpath,express.static(assetsPath));
                    }
                    else {
                        app.use(express.static(assetsPath));
                    }
                }
            }

            if (plugin.routes) {
                const linksEntry = [plugin.title || '???',[]];
                const links = linksEntry[1];

                this.links.push(linksEntry);
                for (let i = 0;i < plugin.routes.length;++i) {
                    const [ route, handler, linkText ] = plugin.routes[i];
                    app.get(route,this._makeHandlerFunction(handler));
                    if (linkText) {
                        links.push({
                            route,
                            linkText
                        });
                    }
                }
            }

            if (plugin.templatePath) {
                this.templateViews.push(plugin.templatePath);
            }
        });

        server.start();
        this.server = server;

        const stop = this.stop.bind(this);
        process.once("SIGINT",stop);
        process.once("SIGQUIT",stop);
        process.once("SIGTERM",stop);
    }

    stop() {
        this.server.stop();
        this.config = new Config();
        this.server = null;
    }

    connect() {
        const app = this.config.get("apps")[0]; // use first
        const [ port, host ] = this.config.get("tokenEndpoint").get("port","host");

        const sock = new net.Socket();
        sock.setEncoding("utf8");
        sock.connect(port,host);

        return { sock, app };
    }

    render(req,res,title,contentName,vars,styles,scripts,cb) {
        const options = {
            root: "./test/templates",
            views: this.templateViews
        };

        const content = contentName + '.template';
        const data = {
            title,
            content,
            vars: vars || {},
            styles: [],
            scripts: [],
            index: ( req.path == '/' )
        };

        ejs.renderFile("./test/templates/base.template",data,options,(err,str) => {
            if (err) {
                this.log("RENDER-ERROR","Cannot render template: %s",err);

                let html = "";
                html += "<h1>Error!</h1>";
                html += "<h2>Cannot render template</h2>";
                res.status(500).send(html);
            }
            else {
                res.send(str);
                if (typeof cb === "function") {
                    cb();
                }
            }
        });
    }

    log(heading,message,...args) {
        const printed = format(message,...args);
        const error = format("[grap-layer/test:%s] %s",heading,printed);
        console.error(error);
        return printed;
    }

    send_error(res,message,...args) {
        const error = this.log("ERROR",message,...args);
        res.status(500);
        this.render(res,"Server Error","error",{ error });
    }

    _makeHandlerFunction(handler) {
        return (req,res) => {
            let query = querystring.stringify(req.query);
            if (query) {
                query = "?" + query;
            }

            this.log("REQ","%s - %s %s%s",req.ip,req.method,req.path,query);

            return handler(this,req,res);
        };
    }
}

module.exports = {
    Testbed
};
