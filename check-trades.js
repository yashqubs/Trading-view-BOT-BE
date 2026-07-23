"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const load_db_credentials_1 = require("./src/database/load-db-credentials");
async function main() {
    await (0, load_db_credentials_1.ensureDbCredentials)();
    const { AppDataSource } = await Promise.resolve().then(() => __importStar(require('./src/database/data-source')));
    await AppDataSource.initialize();
    const result = await AppDataSource.query(`SELECT id, tv_ticker, ig_epic, direction, signal_price, status, skip_reason, error_message, deal_reference, deal_id, signal_received_at, executed_at
     FROM trade_log
     WHERE tv_ticker ILIKE 'ZETA%' OR tv_ticker ILIKE 'MLGO%'
     ORDER BY signal_received_at DESC
     LIMIT 20`);
    console.log(JSON.stringify(result, null, 2));
    await AppDataSource.destroy();
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
//# sourceMappingURL=check-trades.js.map