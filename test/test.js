/**
 * test.js
 *
 * @tccl/graph-layer/test
 */

const path = require("path");

const { Testbed } = require("./");

async function main(args) {
    const options = {
        plugins: []
    };

    const cwd = process.cwd();
    for (const pluginSpec of args) {
        const [ moduleName, key ] = pluginSpec.split(":");

        const module = require(path.resolve(cwd,moduleName));

        if (key) {
            options.plugins.push(module[key]);
        }
        else {
            options.plugins.push(module);
        }
    }

    const testbed = new Testbed(options);
    await testbed.start();
}

main(process.argv.slice(2)).catch(console.error);
