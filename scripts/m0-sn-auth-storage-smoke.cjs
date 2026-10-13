'use strict';
// Native browser storage regression only. Does not claim an SNAuth server login.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { chromium } = require(process.env.M0_PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const local = require('./m0-local-api.cjs');

async function smoke() {
  const executable = process.env.M0_CHROMIUM_EXECUTABLE_PATH || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'ms-playwright/chromium-1234/chrome-win64/chrome.exe');
  const browser = await chromium.launch(fs.existsSync(executable) ? { executablePath: executable } : {});
  try {
    const context = await browser.newContext();
    const allowedOrigins = new Set(['https://localhost:8080', local.REPOSITORY, local.AUTHORITY]);
    await context.route('**/*', route => allowedOrigins.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    const fixture = 'storage-smoke-' + crypto.randomUUID();
    const profile = { repositoryUrl:'https://repository.example', authority:'https://auth.example', clientId:fixture };
    const open = async value => {
      const page = await context.newPage();
      await page.goto('https://localhost:8080');
      await page.evaluate(async profile => {
        const { bindSnAuthStorage } = await import('/context/snAuthStorage.mjs');
        bindSnAuthStorage(localStorage, profile);
      }, value);
      return page;
    };
    const first = await open(profile);
    const second = await open({ ...profile, repositoryUrl:'https://other-repository.example' });
    await first.evaluate(() => localStorage.setItem('sn-auth-access-token', 'late-refresh-test'));
    const isolated = await second.evaluate(() => localStorage.getItem('sn-auth-access-token') === null);
    await second.evaluate(() => localStorage.setItem('sn-auth-access-token', 'other-profile-test'));
    const retained = await first.evaluate(() => localStorage.getItem('sn-auth-access-token') === 'late-refresh-test');
    const reopened = await open(profile);
    const reopenedRetained = await reopened.evaluate(() => localStorage.getItem('sn-auth-access-token') === 'late-refresh-test');
    const sessionUnaffected = await first.evaluate(() => { sessionStorage.setItem('sn-auth-access-token', 'session-test'); return sessionStorage.getItem('sn-auth-access-token') === 'session-test'; });
    const unchangedKeys = await first.evaluate(fixture => { localStorage.setItem(fixture, 'unrelated'); return localStorage.getItem(fixture) === 'unrelated'; }, fixture);
    const result = { checkedAt:new Date().toISOString(), nativeBrowserStorage:true, isolated, retained, reopenedRetained, sessionUnaffected, unchangedKeys };
    result.pass = Object.entries(result).filter(([, value]) => typeof value === 'boolean').every(([, value]) => value);
    fs.writeFileSync(path.join(local.ROOT, 'sn-auth-storage-smoke.json'), JSON.stringify(result, null, 2));
    if (!result.pass) throw new Error('Native browser authentication storage isolation failed.');
    console.log(JSON.stringify(result));
    return result;
  } finally { await browser.close(); }
}
module.exports = { smoke };
if (require.main === module) smoke().catch(error => { console.error(error.message); process.exitCode=1; });
