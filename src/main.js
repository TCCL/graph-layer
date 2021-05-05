/**
 * main.js
 *
 * @tccl/graph-worker
 */

const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

function start(argv) {

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
