import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';
config({ path: '.env', quiet: true });
if (!process.env.DATABASE_URL_UNPOOLED) throw new Error('Direct migration configuration is required.');
export default defineConfig({ dialect: 'postgresql', schema: ['./packages/db/src/schema.ts','./packages/db/src/operations-schema.ts','./packages/db/src/refund-schema.ts','./packages/db/src/recovery-schema.ts'], out: './packages/db/drizzle', dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED } });
