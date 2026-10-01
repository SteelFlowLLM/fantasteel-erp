import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  // .env가 없어도 npm install(prisma generate)은 되게 한다. 마이그레이션·시드는 DIRECT_URL이 있어야 한다
  datasource: { url: process.env.DIRECT_URL ?? '' },
});
