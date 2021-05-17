/**
 * main.js
 *
 * @tccl/graph-layer
 */

const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

require("./globals");
const { Config } = require("./config");
const { Server } = require("./server");

function start(argv) {
    const config = new Config();

    config.load(argv.configFile).then(() => {
        const server = new Server(config);
        server.start();

        const stop = server.stop.bind(server);

        process.once("SIGINT",stop);
        process.once("SIGQUIT",stop);
        process.once("SIGTERM",stop);

    }).catch((err) => {
        console.error(err);
    });
}

yargs(hideBin(process.argv))
    .command(
        ["start","$0"],
        "start the server",
        {
            configFile: {
                alias: "f",
                default: "./config.json"
            }
        },
        start
    )
    .demandCommand(1)
    .help()
    .argv;
