import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AppDataSource } from '../data-source';
import { User } from '../../user/entities/user.entity';
import { TradingRules } from '../../trading-rules/entities/trading-rules.entity';
import { UserRole } from '../../common/enums';

const BCRYPT_COST = 12;
const SINGLETON_ID = 1;

function generateTempPassword(): string {
  return randomBytes(9).toString('base64url');
}

async function seed(): Promise<void> {
  await AppDataSource.initialize();

  const userRepository = AppDataSource.getRepository(User);
  const tradingRulesRepository = AppDataSource.getRepository(TradingRules);

  const existingAdmin = await userRepository.findOne({ where: { role: UserRole.ADMIN } });
  if (!existingAdmin) {
    const tempPassword = generateTempPassword();
    const admin = userRepository.create({
      name: process.env.SEED_ADMIN_NAME ?? 'Admin',
      email: process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com',
      passwordHash: await bcrypt.hash(tempPassword, BCRYPT_COST),
      role: UserRole.ADMIN,
      active: true,
      totpEnabled: false,
      mustChangePassword: true,
    });
    await userRepository.save(admin);

    console.log('First admin user created.');

    console.log(`  email:    ${admin.email}`);

    console.log(`  password: ${tempPassword}`);

    console.log(
      'Record this password now — it will not be shown again. The user must change it and set up 2FA on first login.',
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

  await AppDataSource.destroy();
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
