import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Offline check: real UI mounts and host CSS, fake data only; no API or account storage.
const [playwrightModule, tavernCssPath] = process.argv.slice(2);
if (!playwrightModule || !tavernCssPath) throw new Error('Usage: node scripts/check-frontend-layout.mjs <playwright-module> <SillyTavern-style.css>');
const { chromium } = (await import(pathToFileURL(playwrightModule).href)).default;
const root = path.resolve(import.meta.dirname, '..');
const bundle = await build({
  stdin: { resolveDir: root, contents: `
    import { mountJournal } from './src/frontend/journal.ts';
    import { mountSettingsPage } from './src/settings/settings-page.ts';
    import { mountPromptingPage } from './src/prompting/prompting-page.ts';
    import { defaultSettings } from './src/settings/model.ts';
    import { buildPlayerView, exampleCatalog, emptyAchievementSave } from './src/domain/index.ts';
    const settings = defaultSettings();
    const bookName = '世界书：' + 'VeryLongWorldbookName'.repeat(12);
    settings.worldbooks.keywordBooks = [{worldbookName:bookName,entryUids:null}];
    const settingsController = {
      load: () => ({settings,hasTextApiKey:false}), initialize: async () => {},
      worldbookNames: () => [bookName],
      worldbookEntries: async () => Array.from({length:6},(_,uid)=>({uid,name:'条目：'+ 'LongEntryName'.repeat(12),content:'',keys:['LongKeyword'.repeat(24)],strategy:'selective'})),
    };
    const promptingController = {
      load: () => settings, latestMessageId: () => 12,
      chapters: () => exampleCatalog.modules.adventure.chapters, currentChapterId: () => 'chapter.2',
      modelGroups: () => Array.from({length:12},(_,i)=>({id:'region.'+i,module:'travel',label:'地区：'+ 'LongTreeName'.repeat(12)})),
    };
    mountJournal(document.querySelector('#host'), {
      getPlayerView: () => buildPlayerView(exampleCatalog,emptyAchievementSave),
      mountSettings: el => mountSettingsPage(el,settingsController),
      mountPrompting: el => mountPromptingPage(el,promptingController),
    }, {onClose:()=>{}});
  ` },
  bundle: true, format: 'iife', platform: 'browser', write: false,
});
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<div id="host" class="goblin-journal-overlay"></div>');
  await page.addStyleTag({ content: fs.readFileSync(tavernCssPath, 'utf8') });
  await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'src/frontend/journal.css'), 'utf8') });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const name of ['设置', '提示词与发送']) {
      await page.locator('.journal-admin-nav').getByRole('button', {name,exact:true}).click();
      await page.waitForSelector('.journal-admin-form input[type="checkbox"]');
      const metrics = await page.evaluate(() => ({
        checks: [...document.querySelectorAll('.journal-admin-form input[type="checkbox"]')].map(input => ({
          width:input.getBoundingClientRect().width,height:input.getBoundingClientRect().height,
          row:getComputedStyle(input.closest('label')).display,padding:getComputedStyle(input).padding,
        })),
        selects:[...document.querySelectorAll('.journal-admin-form select')].map(select=>getComputedStyle(select).color),
        notes:[...document.querySelectorAll('.journal-admin-form small')].map(note=>({color:getComputedStyle(note).color,opacity:getComputedStyle(note).opacity})),
        overflow:[...document.querySelectorAll('.travel-journal,.journal-content')].map(el=>el.scrollWidth-el.clientWidth),
        shadow:getComputedStyle(document.querySelector('.journal-header h1')).textShadow,
      }));
      for (const checkbox of metrics.checks) {
        assert.ok(checkbox.width >= 14 && checkbox.width <= 24, `${width}/${name}: checkbox width ${checkbox.width}`);
        assert.ok(checkbox.height >= 14 && checkbox.height <= 24, `${width}/${name}: checkbox height ${checkbox.height}`);
        assert.equal(checkbox.row, 'flex', `${width}/${name}: checkbox label layout`);
        assert.equal(checkbox.padding, '0px', `${width}/${name}: checkbox padding`);
      }
      assert.ok(metrics.selects.every(color=>color==='rgb(57, 58, 52)'), `${width}/${name}: select text color`);
      assert.ok(metrics.notes.every(note=>note.color==='rgb(119, 120, 108)'&&note.opacity==='1'), `${width}/${name}: helper text`);
      assert.ok(metrics.overflow.every(px=>px<=1), `${width}/${name}: horizontal overflow ${metrics.overflow}`);
      assert.equal(metrics.shadow, 'none', `${width}/${name}: host text shadow`);
      if (width === 1440 || width === 320) {
        const filename = `frontend-${name==='设置'?'settings':'prompting'}-${width}.png`;
        await page.screenshot({path:path.join(root,'experiments',filename)});
        await page.locator(name==='设置'?'[data-worldbooks-form]':'[data-group-switches]').scrollIntoViewIfNeeded();
        const listFilename = `frontend-${name==='设置'?'worldbooks':'groups'}-${width}.png`;
        await page.screenshot({path:path.join(root,'experiments',listFilename)});
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: 8 offline views; compact checkboxes, readable controls, no horizontal overflow or script errors.');
} finally {
  await browser.close();
}
