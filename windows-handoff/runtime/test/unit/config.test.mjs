import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config/load.mjs';
import { validateConfig } from '../../src/config/validate.mjs';
import { DEFAULT_CONFIG, deepMerge } from '../../src/config/defaults.mjs';
import { extractGoodsId } from '../../src/shared/ids.mjs';

test('structured config resolves local paths and exposes the unchanged legacy runtime shape', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'temu-config-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = JSON.parse(await fs.readFile(new URL('../../config.example.json', import.meta.url), 'utf8'));
  source.catalog.jobs[0].url = 'https://www.temu.com/category';
  const configPath = path.join(directory, 'config.json');
  await fs.writeFile(configPath, JSON.stringify(source));
  const config = await loadConfig(configPath);
  assert.equal(config.app.databasePath, path.join(directory, 'data', 'temu_research_v2.db'));
  assert.equal(config.databasePath, config.app.legacyDatabasePath);
  assert.equal(config.jobs, config.catalog.jobs);
  assert.equal(config.profileDir, config.browser.profileDir);
});

test('validation reports the complete field path', () => {
  const config = deepMerge(DEFAULT_CONFIG, { catalog: { jobs: [] } });
  assert.throws(() => validateConfig(config), error => {
    assert.equal(error.code, 'CONFIG_INVALID');
    assert.equal(error.details.fieldPath, 'catalog.jobs');
    assert.match(error.message, /catalog\.jobs/);
    return true;
  });
});

test('validation rejects an illegal numeric boundary with the complete field path', () => {
  const config = deepMerge(DEFAULT_CONFIG, {
    catalog: { jobs: [{ url: 'https://www.temu.com/category', primaryCategory: 'A', subcategory: 'B', sortOrder: 'Top Sales' }] },
    browser: { minimumDelayMs: 3000, maximumDelayMs: 1000 }
  });
  assert.throws(() => validateConfig(config), error => {
    assert.equal(error.details.fieldPath, 'browser.maximumDelayMs');
    assert.match(error.message, /browser\.maximumDelayMs/);
    return true;
  });
});

test('external CDP mode requires an explicit endpoint',() => {
  const config=deepMerge(DEFAULT_CONFIG,{
    browser:{ mode:'external_cdp',cdpEndpoint:'' },
    catalog:{ jobs:[{ url:'https://www.temu.com/category',primaryCategory:'A',subcategory:'B',sortOrder:'Top Sales' }] }
  });
  assert.throws(() => validateConfig(config),error => error.details.fieldPath === 'browser.cdpEndpoint');
  config.browser.cdpEndpoint='http://127.0.0.1:9222';
  assert.equal(validateConfig(config),config);
});

test('legacy config keeps the old collector database isolated from the v2 database', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'temu-legacy-config-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, 'config.json');
  await fs.writeFile(configPath, JSON.stringify({
    databasePath: './data/company-v1.db',
    outputDir: './outputs',
    profileDir: './browser-profile',
    jobs: [{ url: 'https://www.temu.com/category', primaryCategory: 'A', subcategory: 'B', sortOrder: 'Top Sales' }],
    selectionRules: { minPriceEur: 5, minRating: 4.6, minRecentDailyReviews: 3 }
  }));
  const config = await loadConfig(configPath);
  assert.equal(config.databasePath, path.join(directory, 'data', 'company-v1.db'));
  assert.equal(config.app.databasePath, path.join(directory, 'data', 'temu_research_v2.db'));
  assert.notEqual(config.databasePath, config.app.databasePath);
});

test('goods_id extraction supports query and localized slug URLs', () => {
  assert.equal(extractGoodsId('https://www.temu.com/goods.html?goods_id=123456&x=1'), '123456');
  assert.equal(extractGoodsId('https://www.temu.com/de-en/item-g-998877.html'), '998877');
  assert.equal(extractGoodsId('https://www.temu.com/category'), null);
});
