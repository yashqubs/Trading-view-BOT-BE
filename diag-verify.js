"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const typeorm_1 = require("@nestjs/typeorm");
const secrets_manager_1 = require("./src/config/secrets-manager");
const load_env_1 = require("./src/database/load-env");
const app_module_1 = require("./src/app.module");
const mapping_service_1 = require("./src/mapping/mapping.service");
async function main() {
    (0, load_env_1.loadEnvFile)();
    if (process.env.SECRETS_SOURCE === 'aws') {
        const secrets = await (0, secrets_manager_1.loadSecrets)(process.env.SECRET_NAME_APP);
        Object.assign(process.env, secrets);
    }
    const app = await core_1.NestFactory.createApplicationContext(app_module_1.AppModule, { logger: ['error'] });
    const ds = app.get((0, typeorm_1.getDataSourceToken)());
    const cons = await ds.query(`SELECT conname FROM pg_constraint WHERE conrelid = 'stock_mapping'::regclass AND contype = 'u'`);
    const idx = await ds.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'stock_mapping'`);
    console.log('unique constraints:', JSON.stringify(cons));
    console.log('indexes:', JSON.stringify(idx));
    const mappingService = app.get(mapping_service_1.MappingService);
    const all = await mappingService.findAll();
    console.log('existing tickers:', all.map((m) => m.tvTicker));
    if (all.length > 0) {
        const t = all[0].tvTicker;
        const lower = await mappingService.findByTicker(t.toLowerCase());
        const upper = await mappingService.findByTicker(t.toUpperCase());
        console.log(`case-insensitive lookup for "${t}": lower=${!!lower}, upper=${!!upper}`);
    }
    await app.close();
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
//# sourceMappingURL=diag-verify.js.map