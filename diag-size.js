"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const secrets_manager_1 = require("./src/config/secrets-manager");
const load_env_1 = require("./src/database/load-env");
const app_module_1 = require("./src/app.module");
const ig_client_service_1 = require("./src/ig-client/ig-client.service");
async function main() {
    (0, load_env_1.loadEnvFile)();
    if (process.env.SECRETS_SOURCE === 'aws') {
        const secrets = await (0, secrets_manager_1.loadSecrets)(process.env.SECRET_NAME_APP);
        Object.assign(process.env, secrets);
    }
    const app = await core_1.NestFactory.createApplicationContext(app_module_1.AppModule, { logger: ['error'] });
    const ig = app.get(ig_client_service_1.IgClientService);
    try {
        const positions = await ig.getOpenPositions();
        console.log('POSITIONS:', JSON.stringify(positions));
        for (const epic of ['UC.D.PYPLVUS.DAILY.IP', 'UB.D.GOOGUS.DAILY.IP']) {
            const raw = (await ig.getMarketDetails(epic));
            const dealingRules = raw.dealingRules;
            const instrument = raw.instrument;
            const snapshot = raw.snapshot;
            console.log(epic, JSON.stringify({
                valueOfOnePip: instrument.valueOfOnePip,
                onePipMeans: instrument.onePipMeans,
                lotSize: instrument.lotSize,
                unit: instrument.currencies?.[0],
                marginFactor: instrument.marginFactor,
                minDealSize: dealingRules.minDealSize,
                bid: snapshot.bid,
                offer: snapshot.offer,
            }));
        }
    }
    finally {
        await app.close();
    }
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
//# sourceMappingURL=diag-size.js.map