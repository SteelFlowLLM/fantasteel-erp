import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  // .env가 없으면 npm run db 로 띄운 로컬 DB를 쓴다 (클론 → npm i → npm run dev 만으로 실행)
  datasource: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:54322/fantasteel' },
});
