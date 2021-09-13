/**
 * helpers.js
 *
 * @tccl/graph-layer
 */

class JsonMessage {
    constructor() {
        this.buffer = "";
        this.message = null;
    }

    receive(chunk) {
        if (chunk instanceof Buffer) {
            this.buffer += chunk.toString("utf8");
        }
        else {
            this.buffer += chunk;
        }

        return this._tryParse();
    }

    getMessage() {
        return this.message;
    }

    _tryParse() {
        const index = this.buffer.indexOf("\n");
        if (index < 0) {
            return false;
        }

        const messageRaw = this.buffer.slice(0,index).trim();
        this.buffer = this.buffer.slice(index+1);

        if (messageRaw.length == 0) {
            return false;
        }

        try {
            const message = JSON.parse(messageRaw);
            if (typeof message !== "object" || message === null) {
                throw new Error("Invalid message");
            }

            this.message = message;
            return true;

        } catch (err) {
            this.message = false;
            return true;
        }

        return false;
    }
}

function unixtime(datetime) {
    const dt = datetime || new Date();
    return Math.floor(dt.getTime() / 1000);
}

module.exports = {
    JsonMessage,
    unixtime
};
