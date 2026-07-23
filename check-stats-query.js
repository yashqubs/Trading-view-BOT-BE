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
    const { TradeLog } = await Promise.resolve().then(() => __importStar(require('./src/trade/entities/trade-log.entity')));
    const repo = AppDataSource.getRepository(TradeLog);
    const qb = repo
        .createQueryBuilder('trade')
        .select('COALESCE(SUM(trade.tradeValue), 0)', 'total')
        .where('trade.status = :status', { status: 'SUCCESS' })
        .andWhere('trade.isClosingTrade = false')
        .andWhere('trade.createdAt BETWEEN :start AND :end', {
        start: new Date('2026-06-25'),
        end: new Date('2026-07-24'),
    });
    console.log('SQL:', qb.getSql());
    const result = await qb.getRawOne();
    console.log('RESULT:', JSON.stringify(result));
    await AppDataSource.destroy();
}
main().catch((e) => {
    console.error('ERROR:', e);
    process.exit(1);
});
//# sourceMappingURL=check-stats-query.js.map