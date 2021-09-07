/**
 * test.js
 *
 * @tccl/graph-layer/test
 */

const { Testbed } = require("./");

async function main(args) {
    const options = {
        plugins: []
    };

    for (const pluginSpec of args) {
        const [ moduleName, key ] = pluginSpec.split(":");

        const module = require(moduleName);

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
