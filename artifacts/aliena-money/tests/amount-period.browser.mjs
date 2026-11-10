import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = 19611;
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '0.0.0.0'], {
  cwd: appDir,
  env: { ...process.env, PORT: String(port), BASE_PATH: '/' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let browser;

try {
  let serverOutput = '';
  server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

  let ready = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Vite exited before starting:\n${serverOutput}`);
    try {
      const response = await fetch(`${baseUrl}/test/amount-entry.html`);
      if (response.ok) { ready = true; break; }
    } catch {}
    await delay(250);
  }
  assert.ok(ready, `Vite did not become ready:\n${serverOutput}`);

  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  await page.goto(`${baseUrl}/test/amount-entry.html?amount=150.25`);
  const amount = page.getByRole('textbox', { name: 'Amount' });
  assert.equal(await amount.getAttribute('inputmode'), 'decimal');
  assert.equal(await page.getByLabel('Monthly equivalent').textContent(), 'Monthly equivalent: $150.25');

  await page.getByRole('button', { name: 'Per year' }).tap();
  await page.waitForFunction(() => document.querySelector('input[aria-label="Amount"]')?.value === '1803');
  assert.equal(await page.getByLabel('Monthly equivalent').textContent(), 'Monthly equivalent: $150.25');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Amount');

  await page.keyboard.press('End');
  await page.keyboard.type('4');
  assert.equal(await amount.inputValue(), '18034', 'the focused amount field remains editable after switching periods');

  await page.goto(`${baseUrl}/test/amount-entry.html?amount=1234.56&period=year`);
  const annualAmount = page.getByRole('textbox', { name: 'Amount' });
  assert.equal(await annualAmount.inputValue(), '1234.56');
  assert.equal(await page.getByLabel('Monthly equivalent').textContent(), 'Monthly equivalent: $102.88');
  await page.getByRole('button', { name: 'Per month' }).tap();
  await page.waitForFunction(() => document.querySelector('input[aria-label="Amount"]')?.value === '102.88');
  assert.equal(await page.getByLabel('Monthly equivalent').textContent(), 'Monthly equivalent: $102.88');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Amount');

  console.log('Mobile amount-period browser checks passed.');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
