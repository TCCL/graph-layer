/**
 * storage.js
 *
 * @tccl/graph-layer
 */

const sqlite3 = require("better-sqlite3");

const SCHEMA_REVISION = 1;

const SCHEMA = [
    {
        sql: [
            "CREATE TABLE config (key TEXT,value BLOB,is_serialized SMALLINT)",
            "CREATE UNIQUE INDEX idx_config_key ON config (key)"
        ],
        updates: {},
        intro: 1
    },
    {
        sql: [
            "CREATE TABLE token (token_id TEXT,value BLOB,app_id TEXT,is_user SMALLINT)",
            "CREATE UNIQUE INDEX idx_token_id ON token (token_id)"
        ],
        updates: {},
        intro: 1
    }
];

class Storage {
    constructor(databaseFile) {
        this.database = sqlite3(databaseFile);
        this._checkSchemas();
    }

    close() {
        this.database.close();
        this.database = null;
    }

    getConfig(key) {
        const select = this.database.prepare(
            "SELECT value, is_serialized FROM config WHERE key = ?"
        );

        const row = select.get(key);
        if (row) {
            let result = row.value;
            if (row.is_serialized) {
                result = JSON.parse(result);
            }
            return result;
        }

        return undefined;
    }

    setConfig(key,value) {
        let blob;
        let isSerialized;
        if (typeof value !== "string" && !(value instanceof Buffer)) {
            blob = JSON.stringify(value);
            isSerialized = 1;
        }
        else {
            blob = value;
            isSerialized = 0;
        }

        const replace = this.database.prepare(
            "REPLACE INTO config (key,value,is_serialized) VALUES (?,?,?)"
        );

        replace.run(key,blob,isSerialized);
    }

    _checkSchemas() {
        let rev;
        try {
            rev = this.getConfig("core.rev") || 0;
        } catch (err) {
            if (err instanceof sqlite3.SqliteError) {
                rev = 0;
            }
            else {
                throw err;
            }
        }

        const updateSchema = this.database.transaction((schema,startRev,endRev) => {
            for (let r = startRev+1;r <= endRev;++r) {
                schema.forEach(({ sql, updates, intro }) => {
                    if (intro == r) {
                        let install = sql;
                        if (!Array.isArray(install)) {
                            install = [install];
                        }

                        install = install.join("; ");
                        this.database.exec(install);
                    }

                    if (r in updates) {
                        this.database.exec(updates[r]);
                    }
                });
            }

            if (startRev != endRev) {
                this.setConfig("core.rev",endRev);
            }
        });

        updateSchema(SCHEMA,rev,SCHEMA_REVISION);
    }
}

module.exports = {
    Storage
};
