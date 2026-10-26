import 'dotenv/config';
import { chromium } from 'playwright';
import { ObjectId } from 'mongodb';
import { database } from '../src/lib/db';
import { assertTargetAllowed } from '../src/lib/scope';
import { configureContext, loginAndState } from '../worker/scanner';
import type { Site, AuthProfile } from '../src/lib/types';
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
async function main() {
  if (args.includes('--help')) {
    console.log(
      'npm run live -- --site-id SITE_ID --url https://authorized.example/path [--profile-id PROFILE_ID]',
    );
    return;
  }
  const siteId = flag('site-id'),
    url = flag('url'),
    profileId = flag('profile-id');
  if (!siteId || !url) throw Error('--site-id and --url are required');
  const db = await database();
  const site = await db.collection<Site>('sites').findOne({ _id: new ObjectId(siteId) });
  if (!site) throw Error('Site not registered');
  await assertTargetAllowed(url, site);
  const browser = await chromium.launch({ headless: false });
  try {
    const profile = profileId
      ? await db.collection<AuthProfile>('profiles').findOne({ _id: new ObjectId(profileId), siteId })
      : null;
    const storage = profile ? await loginAndState(browser, site, profile) : undefined;
    const context = await browser.newContext({
      storageState: storage,
      ignoreHTTPSErrors: site.ignoreHTTPSErrors,
    });
    // Visible inspection permits normal interaction, but network still stays within configured scope.
    await configureContext(context, site, true);
    const page = await context.newPage();
    await page.goto(url);
    console.log(`Managed browser opened: ${page.url()}`);
    console.log('Close this browser or press Ctrl+C to stop the live inspection session.');
    await new Promise<void>((resolve) => browser.on('disconnected', () => resolve()));
  } finally {
    await browser.close().catch(() => {});
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
