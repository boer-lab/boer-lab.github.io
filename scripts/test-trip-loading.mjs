import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Run the actual page initialization, including manifest validation and fetching.
const html = await readFile(new URL('../trip/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const applyContext = {};
vm.runInNewContext(script.slice(script.indexOf('function itemMatches'), script.indexOf('function reveal')), applyContext);
const sample = { en: { yellowstone: { sections: [] } }, zh: { yellowstone: { sections: [] } } };
for (const locale of ['en', 'zh']) {
  applyContext.applyUpdate(sample, { schemaVersion: 1, operations: [{
    op: 'append', locale, collection: 'yellowstone.sections',
    value: { type: 'list', heading: 'Meals', items: ['Lunch'] }
  }] });
  assert.equal(sample[locale].yellowstone.sections[0].heading, 'Meals');
}
async function load(invalidManifest = false) {
  const elements = new Map();
  const requests = [];
  const context = {
    document: { getElementById(id) {
      if (!elements.has(id)) elements.set(id, { textContent: '', addEventListener() {} });
      return elements.get(id);
    } },
    sessionStorage: { length: 0, getItem() { return null; } },
    fetch: async path => {
      requests.push(path);
      const value = JSON.parse(await readFile(new URL('../trip/' + path, import.meta.url), 'utf8'));
      if (invalidManifest && path === './updates.json') value.updates = ['updates/example.json'];
      return { ok: true, json: async () => value };
    }
  };
  await vm.runInNewContext(script.replace('initialize();', 'return initialize();'), context);
  return { elements, requests };
}
const broken = await load(true);
assert.match(broken.elements.get('gate-err').textContent, /Unable to load trip data/);
const fixed = await load();
assert.equal(fixed.elements.get('gate-err').textContent, '');
assert.equal(fixed.elements.get('gate-btn').disabled, false);
assert.equal(fixed.elements.get('gate-btn').textContent, '解锁 Unlock');
const manifest = JSON.parse(await readFile(new URL('../trip/updates.json', import.meta.url), 'utf8'));
for (const filename of manifest.updates) assert.ok(fixed.requests.includes('./updates/' + filename));
console.log('Dashboard initialization passes; malformed manifest reproduces the reported error.');
