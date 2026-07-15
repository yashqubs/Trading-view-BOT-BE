"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const secrets_manager_1 = require("./src/config/secrets-manager");
const load_env_1 = require("./src/database/load-env");
const app_module_1 = require("./src/app.module");
const ig_client_service_1 = require("./src/ig-client/ig-client.service");
const enums_1 = require("./src/common/enums");
const EPIC = 'UC.D.PYPLVUS.DAILY.IP';
function log(label, value) {
    console.log(`\n===== ${label} =====`);
    console.log(JSON.stringify(value, null, 2));
}
async function tryOrder(ig, size) {
    console.log(`\n--- Testing size ${size} ---`);
    const placed = await ig.placeOrder({
        epic: EPIC,
        direction: enums_1.Direction.BUY,
        size,
        orderType: 'MARKET',
    });
    log(`size ${size} placeOrder result`, placed);
    const confirm = await ig.confirmDeal(placed.dealReference);
    log(`size ${size} confirm`, confirm);
    if (confirm.dealStatus === 'ACCEPTED' && confirm.dealId) {
        console.log(`Accepted — closing position ${confirm.dealId} immediately.`);
        const closed = await ig.closePosition({
            dealId: confirm.dealId,
            direction: enums_1.Direction.SELL,
            size,
            orderType: 'MARKET',
        });
        const closeConfirm = await ig.confirmDeal(closed.dealReference);
        log(`size ${size} close confirm`, closeConfirm);
    }
}
async function main() {
    (0, load_env_1.loadEnvFile)();
    if (process.env.SECRETS_SOURCE === 'aws') {
        const secrets = await (0, secrets_manager_1.loadSecrets)(process.env.SECRET_NAME_APP);
        Object.assign(process.env, secrets);
    }
    const app = await core_1.NestFactory.createApplicationContext(app_module_1.AppModule, { logger: ['error', 'warn'] });
    const ig = app.get(ig_client_service_1.IgClientService);
    try {
        await tryOrder(ig, 0.1);
        await tryOrder(ig, 0.24);
    }
    finally {
        await app.close();
    }
}
main().catch((error) => {
    console.error('Diagnostic failed:', error);
    process.exit(1);
});
//# sourceMappingURL=diag-mindealsize.js.map