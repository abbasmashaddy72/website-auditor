// Optional Playwright integration: npm run test:auth:browser
// Requires installed Chromium, but no MongoDB/RustFS/Insure360 services.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { encrypt } from '../src/lib/crypto.ts';
import { discoverNavigationLinks, loginAndSession } from '../worker/scanner.ts';
const PORT = 8887;
const url = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['scripts/fixture-server.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, FIXTURE_PORT: String(PORT) },
  stdio: 'ignore',
});
let browser;
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(url + '/login');
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      await sleep(100);
    }
  }
  assert.ok(ready, 'fixture service must be reachable');
  process.env.AUTH_ENCRYPTION_KEY = 'a'.repeat(64);
  const site = {
    name: 'Auth fixture',
    baseUrl: url + '/',
    environment: 'local',
    allowedHosts: ['127.0.0.1'],
    allowedPorts: [PORT],
    allowLocalhost: true,
    allowPrivateNetwork: false,
    ignoreHTTPSErrors: false,
    maxPages: 20,
    maxDepth: 3,
    concurrency: 1,
    timeoutMs: 10000,
    authProfileIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const profile = {
    siteId: 'fixture',
    name: 'Private Fixture',
    loginUrl: url + '/login',
    username: 'fixture@example.test',
    encryptedPassword: encrypt('fixture-only-password'),
    createdAt: new Date(),
  };
  browser = await chromium.launch({ headless: true });
  const session = await loginAndSession(browser, site, profile);
  assert.equal(session.landingUrl, url + '/private/dashboard');
  // Emulate a Filament/Livewire JS-submitted form at a hashed Livewire endpoint.
  const livewireSession = await loginAndSession(browser, site, {
    ...profile,
    loginUrl: url + '/livewire-login',
  });
  assert.equal(livewireSession.landingUrl, url + '/private/dashboard');
  const context = await browser.newContext({ storageState: session.storageState });
  const page = await context.newPage();
  await page.goto(session.landingUrl);
  assert.equal(page.url(), url + '/private/dashboard');
  const links = await discoverNavigationLinks(page);
  assert.ok(links.includes(url + '/private/report'), 'expanded menu discovers private report');
  assert.ok(links.includes(url + '/private/settings'), 'expanded menu discovers private settings');
  await page.goto(url + '/private/report');
  assert.equal(page.url(), url + '/private/report');
  await context.close();
  console.log(
    'PASS: cookie login, hashed Livewire XHR login, private landing, expanded menu, protected routes',
  );
} finally {
  await browser?.close();
  child.kill('SIGTERM');
}
