/**
 * token/manager.js
 *
 * @tccl/graph-layer
 */

const { Token } = require("./token");

/**
 * Manages application and API token associations.
 */
class TokenManager {
    constructor(config) {
        this.config = config;
        this.server = null;
    }

    get(id) {
        const storage = this.config.getStorage();

        const query =
           `SELECT
              value AS 'value',
              app_id AS 'appId',
              is_user AS 'isUser'
            FROM
              token
            WHERE
              token_id = ?`;

        const vars = [
            id
        ];

        let token;
        const { value, appId, isUser } = storage.get(query,vars);

        try {
            token = JSON.parse(value);
        } catch (err) {
            throw new ErrorF("Cannot parse token for '%s'",id);
        }

        return { appId, isUser: Boolean(isUser), token };
    }

    set(id,appId,isUser,token) {
        const storage = this.config.getStorage();
        const isUserValue = isUser ? 1 : 0;

        const query =
           `INSERT INTO token (
              token_id,
              value,
              app_id,
              is_user
            )
            VALUES (
              ?,?,?,?
            )`;

        const vars = [
            id,
            JSON.stringify(token),
            appId,
            isUserValue
        ];

        storage.run(query,vars);
    }

    update(id,appId,isUser,token) {
        const storage = this.config.getStorage();
        const t = storage.transaction(() => {
            storage.run("DELETE FROM token WHERE token_id = ?",[id]);
            this.set(id,appId,isUser,token);
        });

        t();

        return { appId, isUser, token };
    }

    remove(id) {
        const storage = this.config.getStorage();

        const query = "DELETE FROM token WHERE token_id = ?";
        const vars = [id];

        storage.run(query,vars);
    }

    cleanup() {
        const storage = this.config.getStorage();

        // Clean up any tokens that have expired.
        const t = storage.transaction(() => {
            const del = storage.prepare(
                `DELETE FROM token WHERE token_id = ?`
            );

            const select =
                `SELECT
                   token_id AS 'tokenId',
                   value AS 'value',
                   app_id AS 'appId',
                   is_user AS 'isUser'
                 FROM
                  token`;

            const rm = [];
            for (const record of storage.iterate(select)) {
                let tokenObj;

                try {
                    tokenObj = JSON.parse(record.value);
                } catch (err) {
                    continue;
                }

                const token = new Token(
                    record.tokenId,
                    record.appId,
                    Boolean(record.isUser),
                    tokenObj
                );

                if (token.isExpiredByDays(15)) {
                    rm.push(record.tokenId);
                }
            }

            for (const tokenId of rm) {
                del.run(tokenId);
            }
        });

        t();
    }
}

module.exports = {
    TokenManager
};
