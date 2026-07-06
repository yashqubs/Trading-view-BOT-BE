import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { ensureDbCredentials } from '../load-db-credentials';
import { User } from '../../user/entities/user.entity';
import { TradingRules } from '../../trading-rules/entities/trading-rules.entity';
import { Market } from '../../markets/entities/market.entity';
import { UserRole } from '../../common/enums';
const BCRYPT_COST = 12;
const SINGLETON_ID = 1;

function generateTempPassword(): string {
  return randomBytes(9).toString('base64url');
}

async function seed(): Promise<void> {
  await ensureDbCredentials();
  const { AppDataSource } = await import('../data-source');

  await AppDataSource.initialize();
  const userRepository = AppDataSource.getRepository(User);
  const tradingRulesRepository = AppDataSource.getRepository(TradingRules);
  const marketRepository = AppDataSource.getRepository(Market);

  const existingAdminCount = await userRepository.count({ where: { role: UserRole.ADMIN } });
  if (existingAdminCount === 0) {
    // SEED_ADMIN_PASSWORD lets a deliberate real password be provided via
    // env var (set it in your local, gitignored .env — never hardcode a
    // real credential into this file, it would sit in git history in
    // plaintext forever). Falls back to a random one-time temp password,
    // which is the only value ever printed to the console.
    const explicitPassword = process.env.SEED_ADMIN_PASSWORD;
    const password = explicitPassword ?? generateTempPassword();
    const admin = userRepository.create({
      name: process.env.SEED_ADMIN_NAME ?? 'Yash',
      email: process.env.SEED_ADMIN_EMAIL ?? 'yash@qubs.co.uk',
      passwordHash: await bcrypt.hash(password, BCRYPT_COST),
      role: UserRole.ADMIN,
      active: true,
      twoFactorEnabled: false,
      mustChangePassword: true,
    });
    await userRepository.save(admin);

    console.log(
      'First admin user created (exactly one — this check only runs when none exist yet).',
    );
    console.log(`  email: ${admin.email}`);

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
    console.log('An admin user already exists — skipping admin creation.');
  }

  const existingRules = await tradingRulesRepository.findOne({ where: { id: SINGLETON_ID } });
  if (!existingRules) {
    await tradingRulesRepository.save(tradingRulesRepository.create({ id: SINGLETON_ID }));

    console.log('Default trading_rules row created.');
  } else {
    console.log('trading_rules row already exists — skipping.');
  }

  // Checked per-name, not "table is empty" — the AddMarketToStockMapping
  // migration always creates a "Default (Legacy)" market ahead of this
  // running (even on a fresh install with zero stocks), so the table is
  // never actually empty by the time seed.ts runs.
  const presetMarkets = [
    {
      name: 'UK',
      timezone: 'Europe/London',
      openTime: '08:00',
      closeTime: '16:30',
      weekdaysOnly: true,
    },
    {
      name: 'US',
      timezone: 'America/New_York',
      openTime: '09:30',
      closeTime: '16:00',
      weekdaysOnly: true,
    },
    {
      name: 'India',
      timezone: 'Asia/Kolkata',
      openTime: '09:15',
      closeTime: '15:30',
      weekdaysOnly: true,
    },
  ];
  const missingMarkets = [];
  for (const preset of presetMarkets) {
    const existing = await marketRepository.findOne({ where: { name: preset.name } });
    if (!existing) {
      missingMarkets.push(marketRepository.create(preset));
    }
  }
  if (missingMarkets.length > 0) {
    await marketRepository.save(missingMarkets);
    console.log(`Seeded markets: ${missingMarkets.map((m) => m.name).join(', ')}.`);
  } else {
    console.log('UK/US/India markets already exist — skipping.');
  }

  await AppDataSource.destroy();
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
