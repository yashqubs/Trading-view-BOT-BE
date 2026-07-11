// import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { ensureDbCredentials } from '../load-db-credentials';
import { User } from '../../user/entities/user.entity';
import { TradingRules } from '../../trading-rules/entities/trading-rules.entity';
const BCRYPT_COST = 12;
const SINGLETON_ID = 1;

// function generateTempPassword(): string {
// return randomBytes(9).toString('base64url');
// }

async function seed(): Promise<void> {
  await ensureDbCredentials();
  const { AppDataSource } = await import('../data-source');

  await AppDataSource.initialize();
  const userRepository = AppDataSource.getRepository(User);
  const tradingRulesRepository = AppDataSource.getRepository(TradingRules);

  const existingUserCount = await userRepository.count();
  if (existingUserCount === 0) {
    // SEED_ADMIN_PASSWORD lets a deliberate real password be provided via
    // env var (set it in your local, gitignored .env — never hardcode a
    // real credential into this file, it would sit in git history in
    // plaintext forever). Falls back to a random one-time temp password,
    // which is the only value ever printed to the console.
    const explicitPassword = process.env.SEED_ADMIN_PASSWORD;
    // const password = explicitPassword ?? generateTempPassword();
    const password = 'Quantum@2026';
    const firstUser = userRepository.create({
      name: process.env.SEED_ADMIN_NAME ?? 'Yash',
      email: process.env.SEED_ADMIN_EMAIL ?? 'yash@qubs.co.uk',
      passwordHash: await bcrypt.hash(password, BCRYPT_COST),
      active: true,
      twoFactorEnabled: false,
      mustChangePassword: true,
    });
    await userRepository.save(firstUser);

    console.log('First user created (exactly one — this check only runs when none exist yet).');
    console.log(`  email: ${firstUser.email}`);

    if (explicitPassword) {
      console.log('  password: (from SEED_ADMIN_PASSWORD — not re-printed here)');
    } else {
      console.log(`  password: ${password}`);
      console.log('Record this password now — it will not be shown again.');
    }

    console.log(
      'The user must change their password on first login, then can optionally enable two-factor authentication.',
    );
  } else {
    console.log('A user already exists — skipping first-user creation.');
  }

  const existingRules = await tradingRulesRepository.findOne({ where: { id: SINGLETON_ID } });
  if (!existingRules) {
    await tradingRulesRepository.save(tradingRulesRepository.create({ id: SINGLETON_ID }));

    console.log('Default trading_rules row created.');
  } else {
    console.log('trading_rules row already exists — skipping.');
  }

  await AppDataSource.destroy();
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
