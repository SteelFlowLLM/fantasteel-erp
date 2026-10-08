// 접속 주소가 로컬 DB(npm run db, localhost:54322)인지 본다. 공용 DB(Supabase)를 자동으로 바꾸지 않으려고 DB 스크립트들이 함께 쓴다.
import 'dotenv/config';

export const LOCAL_DATABASE_URL = 'postgresql://postgres:postgres@localhost:54322/fantasteel';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** 서버·시드가 쓰는 주소와 마이그레이션이 쓰는 주소 (prisma.config.ts와 같은 순서로 고른다) */
export const databaseUrl = process.env.DATABASE_URL ?? LOCAL_DATABASE_URL;
export const migrateUrl = process.env.DIRECT_URL ?? databaseUrl;

const isLocal = (url) => {
  const { hostname, port } = new URL(url);
  return LOCAL_HOSTS.has(hostname) && port === '54322';
};

/** 로컬이 아닌 주소. 둘 다 로컬이면 undefined */
export const remoteUrl = [databaseUrl, migrateUrl].find((url) => !isLocal(url));

/** 화면에 보여 줄 대상 (사용자·비밀번호 빼고) */
export const describeDatabase = (url) => {
  const { hostname, port, pathname } = new URL(url);
  return `${hostname}:${port}${pathname}`;
};
