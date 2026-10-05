import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Offline UI regression: fake settings only; every network request is blocked.
const { chromium } = (await import(pathToFileURL(process.argv[2]).href)).default;
const bundle = await build({
  stdin: { resolveDir: process.cwd(), contents: `
    import { mountPromptingPage } from './src/prompting/prompting-page.ts';
    import { defaultSettings } from './src/settings/model.ts';
    const settings = defaultSettings();
    settings.sending.enabledModuleIds = ['journal'];
    settings.sending.selectedGroupIds = ['region.demo-region'];
    mountPromptingPage(document.body, {
      load: () => settings, latestMessageId: () => 4,
      chapters: () => [], currentChapterId: () => undefined,
      modelGroups: () => [{ id: 'region.demo-region', module: 'travel', label: '示例地区' }],
      save: async next => { window.saved = next; },
    });
  ` }, bundle: true, format: 'iife', platform: 'browser', write: false,
});
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<body></body>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const module = page.locator('[data-module-id="travel"] input');
  const person = page.locator('[data-group-id="region.demo-region"]');
  assert.equal(await person.isChecked(), false, 'old saved selection is cleared for a disabled module');
  assert.equal(await person.isDisabled(), true);
  await module.check();
  assert.equal(await person.isEnabled(), true);
  assert.equal(await person.isChecked(), false, 'enabling a module must not silently reselect its objects');
  await person.check();
  await module.uncheck();
  assert.equal(await person.isChecked(), false, 'switching the module off clears its objects immediately');
  assert.equal(await person.isDisabled(), true);
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.saved.sending.selectedGroupIds), []);
  assert.deepEqual(errors, []);
  console.log('PASS: disabled modules clear and disable their objects on load/change/save; no network.');
} finally {
  await browser.close();
}
