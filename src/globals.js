/**
 * globals.js
 *
 * @tccl/graph-layer
 */

const { format } = require("util");

global.ErrorF = class extends Error {
    constructor(fmt,...args) {
        super(format(fmt,...args));
    }
};

global.GraphLayerError = class extends ErrorF {

};
