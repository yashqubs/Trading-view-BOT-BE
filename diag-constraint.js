"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const typeorm_1 = require("@nestjs/typeorm");
const secrets_manager_1 = require("./src/config/secrets-manager");
const load_env_1 = require("./src/database/load-env");
const app_module_1 = require("./src/app.module");
async function main() {
    (0, load_env_1.loadEnvFile)();
    if (process.env.SECRETS_SOURCE === 'aws') {
        const secrets = await (0, secrets_manager_1.loadSecrets)(process.env.SECRET_NAME_APP);
        Object.assign(process.env, secrets);
    }
    const app = await core_1.NestFactory.createApplicationContext(app_module_1.AppModule, { logger: ['error'] });
    const ds = app.get((0, typeorm_1.getDataSourceToken)());
    const rows = await ds.query(`SELECT conname, contype FROM pg_constraint WHERE conrelid = 'stock_mapping'::regclass AND contype = 'u'`);
    console.log(JSON.stringify(rows));
    await app.close();
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
//# sourceMappingURL=diag-constraint.js.map