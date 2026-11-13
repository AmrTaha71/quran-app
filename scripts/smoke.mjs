// Browser smoke test: loads the locally served build, checks that the page
// renders visible text, opens the self-test entry, and prints a JSON summary.
// Starts no server; run `npx vite preview --port 4173` first.
import { chromium } from '/tmp/pwt/node_modules/playwright-core/index.mjs';

const BASE = 'http://localhost:4173/';
const CHROME = '/usr/bin/google-chrome';
const VIEWPORT = { width: 820, height: 1180 };
const RENDER_TIMEOUT_MS = 20000;

const consoleErrors = [];
const failedRequests = [];

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: VIEWPORT });

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => {
    failedRequests.push({ url: req.url(), error: req.failure()?.errorText ?? 'failed' });
  });
  page.on('response', (res) => {
    if (res.status() >= 400) failedRequests.push({ url: res.url(), status: res.status() });
  });

  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });

  // Wait for visible body text (the blank-page check).
  let rendered = true;
  try {
    await page.waitForFunction(
      () => (document.body?.innerText ?? '').trim().length > 0,
      null,
      { timeout: RENDER_TIMEOUT_MS },
    );
  } catch {
    rendered = false;
  }

  await page.screenshot({ path: '/tmp/pwt/home.png' });

  // Open the self-test page through a link or button whose text contains «اختبر».
  let openedSelfTest = false;
  const entry = page
    .locator('a, button, [role="button"]')
    .filter({ hasText: 'اختبر' })
    .first();
  if (rendered && (await entry.count()) > 0) {
    try {
      await entry.click({ timeout: 5000 });
      await page.waitForTimeout(1500);
      openedSelfTest = true;
    } catch {
      openedSelfTest = false;
    }
  }
  if (openedSelfTest) {
    await page.screenshot({ path: '/tmp/pwt/selftest.png' });
  }

  const title = await page.title();
  const bodyText = (await page.evaluate(() => document.body?.innerText ?? '')).trim();

  console.log(
    JSON.stringify(
      {
        title,
        rendered,
        openedSelfTest,
        bodyTextSample: bodyText.slice(0, 200),
        consoleErrors,
        failedRequests,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
