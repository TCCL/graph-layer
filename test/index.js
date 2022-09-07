/**
 * index.js
 *
 * @tccl/graph-layer/test
 */

const ejs = require("ejs");
const net = require("net");
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

        const stdRoutes = require("./standard-routes");

        if (!this.options.plugins) {
            this.options.plugins = [];
        }
        this.options.plugins.unshift(stdRoutes.proxy);
        this.options.plugins.unshift(stdRoutes.token);
        this.options.plugins.unshift(stdRoutes.standard);

        this.links = [];
    }

    async start() {
        await this.config.load(CONFIG_FILE);

        const serverOptions = {
            testing: true
        };

        const server = new Server(this.config,serverOptions);
        const app = server.getWebApp();

        // Include static files and routes from plugins. This will at least
        // integrate the standard routes providing the core graph-layer tests.
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

                for (let i = 0;i < plugin.routes.length;++i) {
                    const [ route, handler, linkText ] = plugin.routes[i];
                    const service = new TestbedService(
                        this,
                        handler,
                        plugin
                    );

                    app.get(route,service.makeHandlerFunc());

                    if (linkText) {
                        links.push({
                            route,
                            linkText
                        });
                    }
                }

                if (links.length > 0) {
                    this.links.push(linksEntry);
                }
            }

            if (plugin.postRoutes) {
                app.use(express.json());
                app.use(express.urlencoded({ extended:true }));

                for (let i = 0;i < plugin.postRoutes.length;++i) {
                    const [ route, handler ] = plugin.postRoutes[i];
                    const service = new TestbedService(this,handler,plugin);

                    app.post(route,service.makeHandlerFunc());
                }
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
}

class TestbedService {
    constructor(testbed,handler,plugin) {
        this.testbed = testbed;
        this.handler = handler;
        this.templateViews = [];
        this.defaultAssets = {
            styles: [],
            scripts: []
        };

        if (plugin.templatePath) {
            this.templateViews.push(plugin.templatePath);
        }
        if (plugin.assets) {
            this.defaultAssets.styles = plugin.assets.styles || [];
            this.defaultAssets.scripts = plugin.assets.scripts || [];
        }
    }

    makeHandlerFunc() {
        return (req,res) => {
            let query = querystring.stringify(req.query);
            if (query) {
                query = "?" + query;
            }

            this.log("REQ","%s - %s %s%s",req.ip,req.method,req.path,query);

            return this.handler(this,req,res);
        };
    }

    getApp() {
        const config = this.testbed.config;
        const app = config.get("appsIndexed")[0]; // use first

        return app;
    }

    connect() {
        const config = this.testbed.config;

        const app = config.get("appsIndexed")[0]; // use first
        const [ port, host ] = config.get("tokenEndpoint").get("port","host");

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

        let css = styles || [];
        let js = scripts || [];

        if (this.defaultAssets.styles) {
            css = this.defaultAssets.styles.concat(css);
        }
        if (this.defaultAssets.scripts) {
            js = this.defaultAssets.scripts.concat(js);
        }

        const content = contentName + '.template';
        const data = {
            title,
            content,
            vars: vars || {},
            styles: css,
            scripts: js,
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
        const error = format("[graph-layer/test:%s] %s",heading,printed);
        console.error(error);
        return printed;
    }

    send_error(req,res,message,...args) {
        const error = this.log("ERROR",message,...args);
        res.status(500);
        this.render(req,res,"Server Error","error",{ error });
    }
}

module.exports = {
    Testbed
};
