/**
 * test.js
 *
 * @tccl/graph-layer/test
 */

const { Testbed } = require("./");

const testbed = new Testbed();
testbed.start().catch(console.error);
