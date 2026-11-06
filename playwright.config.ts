import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./apps/gateway/tests',
  timeout:60_000,
  fullyParallel:false,
  workers:1,
  use:{baseURL:'http://127.0.0.1:3100',headless:true,trace:'off'},
  webServer:{command:'pnpm exec tsx scripts/browser-server.ts',url:'http://127.0.0.1:3100',reuseExistingServer:false,timeout:60_000},
});
