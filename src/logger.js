/**
 * logger.js
 *
 * @tccl/graph-layer
 */

const { format } = require("util");

const { unixtime } = require("./helpers");

class Logger {
    constructor(services) {
        this.storage = services.getStorage();
        this.proxyLogInsert = null;

        // Apply options from config.

        const logConfig = services.config.get("logging");
        const [ type, duration ] = logConfig.get("type","duration");

        this.types = new Set();
        if (type) {
            const types = type.split("+").map(s => s.trim());
            for (let i = 0;i < types.length;++i) {
                switch (types[i]) {
                case "storage":
                case "stdio":
                    this.types.add(types[i]);
                    break;
                default:
                    throw new ErrorF("Logging type '%s' is not defined",types[i]);
                }
            }
        }
        if (this.types.size == 0) {
            this.types.add("stdio");
        }

        if (duration) {
            if (typeof duration != "number" || duration <= 0) {
                throw new ErrorF("Logging duration '%s' is incorrect",duration);
            }
            this.duration = duration;
        }
        else {
            this.duration = 30;
        }

        this.cleanupInterval = null;
    }

    start() {
        // Create prepared statements for common queries.

        if (this.types.has("storage")) {
            this.proxyLogInsert = this.storage.prepare(
                `INSERT INTO proxy_log (
                   entry_date,
                   client,
                   request_method,
                   request_uri,
                   status,
                   response_size,
                   response_time
                 ) VALUES (
                   datetime(?,'unixepoch'),
                   ?,
                   ?,
                   ?,
                   ?,
                   ?,
                   ?
                 )`
            );
        }

        // Set up task to cleanup logs periodically.
        const cleanupfn = this.cleanup.bind(this);
        this.cleanupInterval = setInterval(cleanupfn,86400000);
        cleanupfn();
    }

    stop() {
        clearInterval(this.cleanupInterval);
        this.proxyLogInsert = null;
    }

    errorLog(error,...args) {
        const dt = new Date();
        const errorMessage = format(error,...args);
        console.error("[graph-layer/error] [%s] %s",dt.toISOString(),errorMessage);
    }

    proxyLog(dt,info) {
        const {
            client,
            requestMethod,
            requestUri,
            status,
            responseSize,
            responseTime
        } = info;

        if (this.types.has("stdio")) {
            const message = format(
                "[graph-layer/proxy] %s - [%s] [%s %s] %d (%d:%d)",
                client,
                dt.toISOString(),
                requestMethod,
                requestUri,
                status,
                responseSize,
                responseTime
            );

            console.log(message);
        }

        if (this.types.has("storage") && this.proxyLogInsert) {
            const ts = unixtime(dt);

            this.proxyLogInsert.run(
                ts,
                client,
                requestMethod,
                requestUri,
                status,
                responseSize,
                responseTime
            );
        }
    }

    cleanup() {
        if (this.types.has("storage")) {
            let ts = unixtime();
            ts -= this.duration * 86400;

            this.storage.run(
                "DELETE FROM proxy_log WHERE entry_date < datetime(?,'unixepoch')",
                [ts]
            );
        }
    }
}

module.exports = {
    Logger
};
