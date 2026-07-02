const test = require('node:test');
const assert = require('node:assert/strict');

const catalog = require('../web/js/sticker-catalog.js');
const achievementsModule = require('../web/js/sticker-achievements.js');
const stickerStoreModule = require('../web/js/sticker-store.js');

function memoryStorage(seed) {
  const data = new Map(Object.entries(seed || {}));
  return {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    dump: () => Object.fromEntries(data),
  };
}

test('catalog exposes the twelve phase-two stickers and one default sticker', () => {
  assert.equal(catalog.stickers.length, 12);
  assert.deepEqual(catalog.stickers.filter(item => item.source_type === 'default').map(item => item.id), ['sticker_begin_think']);
  assert.equal(catalog.getSticker('sticker_wait_more').price, 50);
  assert.equal(catalog.getSticker('sticker_today_safe').price, 100);
  assert.equal(catalog.getSticker('sticker_let_go').price, 180);
  assert.deepEqual(catalog.listOwned(['sticker_begin_think']).map(item => item.id), ['sticker_begin_think']);
});

test('guest achievement state contains only the default sticker and never calls Supabase', async () => {
  let calls = 0;
  const client = achievementsModule.createAchievementClient({
    catalog,
    rpc: async () => { calls += 1; throw new Error('unexpected rpc'); },
  });
  const state = await client.init(null);
  assert.deepEqual(state.owned_ids, ['sticker_begin_think']);
  assert.equal(state.mode, 'guest');
  assert.equal(await client.recordEvent('daily_visit', '2026-06-30'), null);
  await assert.rejects(() => client.purchase('sticker_wait_more'), /登录/);
  assert.equal(calls, 0);
});

test('logged-in events are idempotently addressed and merge newly unlocked stickers', async () => {
  const calls = [];
  const client = achievementsModule.createAchievementClient({
    catalog,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'bootstrap_stickers') return { owned_ids: ['sticker_begin_think'], new_stickers: [], stats: {}, coins: 80 };
      return { owned_ids: ['sticker_begin_think', 'sticker_first_calm'], new_stickers: ['sticker_first_calm'], stats: { report_count: 1 }, coins: 80 };
    },
  });
  await client.init('user-a');
  const result = await client.recordEvent('report_generated', 'report:s-1', { has_pricing: true });
  assert.deepEqual(calls[1], ['record_sticker_event', {
    p_event_type: 'report_generated',
    p_event_id: 'report:s-1',
    p_metadata: { has_pricing: true },
  }]);
  assert.deepEqual(result.new_stickers, ['sticker_first_calm']);
  assert.equal(client.isOwned('sticker_first_calm'), true);
});

test('purchase flushes coin writes before calling the atomic RPC', async () => {
  const order = [];
  const client = achievementsModule.createAchievementClient({
    catalog,
    flushCoins: async () => { order.push('flush'); return true; },
    rpc: async (name) => {
      order.push(name);
      if (name === 'bootstrap_stickers') return { owned_ids: ['sticker_begin_think'], new_stickers: [], stats: {}, coins: 80 };
      return { owned_ids: ['sticker_begin_think', 'sticker_wait_more'], new_stickers: ['sticker_wait_more'], stats: { sticker_purchase_count: 1 }, coins: 30 };
    },
  });
  await client.init('user-a');
  const result = await client.purchase('sticker_wait_more');
  assert.deepEqual(order, ['bootstrap_stickers', 'flush', 'purchase_sticker']);
  assert.equal(result.coins, 30);
  assert.equal(client.isOwned('sticker_wait_more'), true);
});

test('v2 guest layout ignores v1 data and filters out locked stickers', async () => {
  const v1 = JSON.stringify({ version: 1, owner_id: 'guest', scenes: { scene_riverside: [{
    instance_id: 'old', sticker_id: 'sticker_first_calm', x: 10, y: 10, scale: 1, rotation: 0, z_index: 1,
  }] } });
  const storage = memoryStorage({ 'calm_sticker_scene_layouts.v1.guest': v1 });
  const store = stickerStoreModule.createStickerStore({ storage, catalog, model: require('../web/js/sticker-model.js') });
  await store.initOwner(null, ['sticker_begin_think']);
  assert.deepEqual(store.loadSceneLayout('scene_riverside'), []);
  store.saveSceneLayout('scene_riverside', [
    { instance_id: 'ok', sticker_id: 'sticker_begin_think', x: 100, y: 100, scale: 1, rotation: 0, z_index: 1 },
    { instance_id: 'locked', sticker_id: 'sticker_first_calm', x: 200, y: 100, scale: 1, rotation: 0, z_index: 2 },
  ]);
  const saved = JSON.parse(storage.dump()['calm_sticker_scene_layouts.v2.guest']);
  assert.deepEqual(saved.scenes.scene_riverside.map(item => item.sticker_id), ['sticker_begin_think']);
});

test('account scene init keeps pending local layout visible over stale cloud rows', async () => {
  const model = require('../web/js/sticker-model.js');
  const user = 'user-a';
  const localItem = { instance_id: 'local-1', sticker_id: 'sticker_begin_think', x: 100, y: 100, scale: 1, rotation: 0, z_index: 1 };
  const localDoc = {
    version: 2,
    owner_id: user,
    updated_at: '2026-07-02T00:00:00.000Z',
    scenes: { scene_riverside: [localItem], scene_room: [], scene_pool: [] },
    recent_sticker_ids: ['sticker_begin_think'],
  };
  const queue = [{ scene_id: 'scene_riverside', layout_json: [localItem], updated_at: '2026-07-02T00:01:00.000Z' }];
  const storage = memoryStorage({
    ['calm_sticker_scene_layouts.v2.user.' + user]: JSON.stringify(localDoc),
    ['calm_sticker_scene_layouts.v2.queue.' + user]: JSON.stringify(queue),
  });
  const writes = [];
  const client = {
    from: () => ({
      select: () => ({ eq: async () => ({ data: [{ scene_id: 'scene_riverside', layout_json: [], updated_at: '2026-07-01T00:00:00.000Z' }], error: null }) }),
      upsert: async row => { writes.push(row); return { error: null }; },
    }),
  };
  const store = stickerStoreModule.createStickerStore({ storage, catalog, model, getClient: () => client });
  await store.initOwner(user, ['sticker_begin_think']);
  assert.deepEqual(store.loadSceneLayout('scene_riverside'), [localItem]);
  assert.deepEqual(writes.map(row => row.layout_json), [[localItem]]);
  assert.equal(store.getStatus().pending, 0);
});

test('account scene init keeps failed pending layouts visible for retry', async () => {
  const model = require('../web/js/sticker-model.js');
  const user = 'user-a';
  const localItem = { instance_id: 'retry-1', sticker_id: 'sticker_begin_think', x: 260, y: 180, scale: 1.2, rotation: 15, z_index: 2 };
  const localDoc = {
    version: 2,
    owner_id: user,
    updated_at: '2026-07-02T00:00:00.000Z',
    scenes: { scene_riverside: [localItem], scene_room: [], scene_pool: [] },
    recent_sticker_ids: ['sticker_begin_think'],
  };
  const storage = memoryStorage({
    ['calm_sticker_scene_layouts.v2.user.' + user]: JSON.stringify(localDoc),
    ['calm_sticker_scene_layouts.v2.queue.' + user]: JSON.stringify([{ scene_id: 'scene_riverside', layout_json: [localItem], updated_at: '2026-07-02T00:02:00.000Z' }]),
  });
  const client = {
    from: () => ({
      select: () => ({ eq: async () => ({ data: [{ scene_id: 'scene_riverside', layout_json: [], updated_at: '2026-07-01T00:00:00.000Z' }], error: null }) }),
      upsert: async () => ({ error: new Error('offline') }),
    }),
  };
  const store = stickerStoreModule.createStickerStore({ storage, catalog, model, getClient: () => client });
  await store.initOwner(user, ['sticker_begin_think']);
  assert.deepEqual(store.loadSceneLayout('scene_riverside'), [localItem]);
  assert.equal(store.getStatus().pending, 1);
});

test('account scene init keeps and requeues a newer local scene even when pending queue is empty', async () => {
  const model = require('../web/js/sticker-model.js');
  const user = 'user-newer-local';
  const localItem = { instance_id: 'local-newer', sticker_id: 'sticker_begin_think', x: 320, y: 220, scale: 1.1, rotation: 15, z_index: 1 };
  const storage = memoryStorage({
    ['calm_sticker_scene_layouts.v2.user.' + user]: JSON.stringify({
      version: 2,
      owner_id: user,
      updated_at: '2026-07-02T10:00:00.000Z',
      scene_updated_at: { scene_riverside: '2026-07-02T10:00:00.000Z' },
      scenes: { scene_riverside: [localItem], scene_room: [], scene_pool: [] },
      recent_sticker_ids: ['sticker_begin_think'],
    }),
    ['calm_sticker_scene_layouts.v2.queue.' + user]: '[]',
  });
  const writes = [];
  const client = {
    from: () => ({
      select: () => ({ eq: async () => ({ data: [{ scene_id: 'scene_riverside', layout_json: [], updated_at: '2026-07-02T09:00:00.000Z' }], error: null }) }),
      upsert: async row => { writes.push(row); return { error: null }; },
    }),
  };
  const store = stickerStoreModule.createStickerStore({ storage, catalog, model, getClient: () => client });
  await store.initOwner(user, ['sticker_begin_think']);
  assert.deepEqual(store.loadSceneLayout('scene_riverside'), [localItem]);
  assert.deepEqual(writes.map(row => row.layout_json), [[localItem]]);
  assert.equal(store.getStatus().pending, 0);
});

test('migration defines protected sticker tables and atomic RPCs', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260630_sticker_phase2.sql'), 'utf8');
  for (const table of ['sticker_definitions', 'user_stickers', 'user_achievement_stats', 'achievement_events', 'user_scene_layouts']) {
    assert.match(sql, new RegExp('create table if not exists public\\.' + table, 'i'));
  }
  for (const fn of ['bootstrap_stickers', 'record_sticker_event', 'purchase_sticker', 'mark_stickers_seen']) {
    assert.match(sql, new RegExp('function public\\.' + fn, 'i'));
  }
  assert.match(sql, /security definer/i);
  assert.match(sql, /enable row level security/i);
});


test('reward queue de-duplicates stickers and marks them seen in order', async () => {
  const rewardModule = require('../web/js/sticker-reward.js');
  const seen = [];
  const queue = rewardModule.createRewardQueue({ catalog, markSeen: async ids => seen.push(...ids) });
  queue.enqueue(['sticker_first_calm', 'sticker_first_calm', 'sticker_put_pool']);
  assert.equal(queue.next().id, 'sticker_first_calm');
  await queue.dismiss();
  assert.equal(queue.next().id, 'sticker_put_pool');
  await queue.dismiss();
  assert.deepEqual(seen, ['sticker_first_calm', 'sticker_put_pool']);
  assert.equal(queue.next(), null);
});

test('reward queue keeps unseen stickers queued while presentation is gated', async () => {
  const rewardModule = require('../web/js/sticker-reward.js');
  let canPresent = false;
  const queue = rewardModule.createRewardQueue({ catalog, markSeen: async () => true });
  queue.setPresentationGate(() => canPresent);
  queue.enqueue(['sticker_first_calm']);
  assert.equal(queue.next(), null);
  assert.deepEqual(queue.getPending(), { active: null, queued: ['sticker_first_calm'] });
  canPresent = true;
  assert.equal(queue.next().id, 'sticker_first_calm');
});
test('sticker wall and editor mount gated sticker rewards', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wall = fs.readFileSync(path.join(__dirname, '../web/sticker-wall.html'), 'utf8');
  const editor = fs.readFileSync(path.join(__dirname, '../web/sticker.html'), 'utf8');
  const wallJs = fs.readFileSync(path.join(__dirname, '../web/js/sticker-wall.js'), 'utf8');
  const editorJs = fs.readFileSync(path.join(__dirname, '../web/js/sticker-editor.js'), 'utf8');
  assert.match(wall, /id="stickerReward"/);
  assert.match(wall, /sticker-reward\.js/);
  assert.match(wallJs, /setPresentationGate/);
  assert.match(wallJs, /purchaseSheet\.classList\.contains\('show'\)/);
  assert.match(editor, /id="stickerReward"/);
  assert.match(editor, /sticker-reward\.js/);
  assert.match(editorJs, /setPresentationGate/);
  assert.match(editorJs, /clearConfirm\.classList\.contains\('show'\)/);
});


test('main flow emits the required phase-two achievement events', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const main = fs.readFileSync(path.join(__dirname, '../web/js/main.js'), 'utf8');
  for (const event of ['report_generated', 'decision_saved', 'item_added_to_pool', 'purchase_cancelled', 'daily_visit']) {
    assert.match(main, new RegExp("recordStickerEvent\\('" + event));
  }
});

test('yard is a sticker summary with an editor CTA and no legacy decoration shop', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const index = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
  assert.match(index, /href="sticker\.html"[^>]*>[^<]*去布置贴纸/);
  assert.match(index, /sticker-wall\.html\?filter=shop/);
  assert.doesNotMatch(index, /用河币装点小院|河边小盆栽|暖光纸灯笼|河边小黄鸭摆件/);
  assert.doesNotMatch(index, /class="btn-buy"/);
  assert.doesNotMatch(index, /\u6536\u96c6\u56fe\u9274/);
  assert.match(index, /sticker-achievements\.js/);
  assert.match(index, /sticker-reward\.js/);
});

test('home gates sticker rewards only while a blocking interaction is open', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const main = fs.readFileSync(path.join(__dirname, '../web/js/main.js'), 'utf8');
  assert.match(main, /setPresentationGate/);
  assert.match(main, /ljg:reward-context-changed/);
  assert.match(main, /qpanel\.classList\.contains\('show'\)/);
  assert.doesNotMatch(main, /currentView\s*!==\s*['"]home['"]/);
});

test('sticker purchases use an accessible bottom sheet instead of browser confirm', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '../web/sticker-wall.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../web/js/sticker-wall.js'), 'utf8');
  assert.match(html, /id="purchaseSheet"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /data-purchase-after/);
  assert.doesNotMatch(js, /\bconfirm\s*\(/);
  assert.match(js, /function openPurchaseSheet/);
});

test('sticker wall restores phone chrome and main-page coin chip styling', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '../web/sticker-wall.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../web/css/sticker-wall.css'), 'utf8');
  assert.match(html, /class="statusbar"/);
  assert.match(html, /class="wall-coins coinchip"/);
  assert.match(html, /<svg viewBox="0 0 58 58"/);
  assert.match(css, /\.wall-device::before/);
  assert.match(css, /\.statusbar/);
  assert.match(css, /\.coinchip svg/);
});

test('atomic coin refresh does not recursively emit coins-updated', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const store = fs.readFileSync(path.join(__dirname, '../web/js/store.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../web/js/main.js'), 'utf8');
  assert.match(store, /function applyRemoteCoins\(n, silent\)/);
  assert.match(main, /applyRemoteCoins\(n,true\)/);
});


test('a later event does not erase an unseen sticker returned by bootstrap', async () => {
  let calls = 0;
  const client = achievementsModule.createAchievementClient({
    catalog,
    rpc: async () => {
      calls += 1;
      if (calls === 1) return { owned_ids: ['sticker_begin_think'], new_stickers: ['sticker_begin_think'], stats: {}, coins: 0 };
      return { owned_ids: ['sticker_begin_think'], new_stickers: [], stats: { daily_visit_count: 1 }, coins: 0 };
    },
  });
  await client.init('user-a');
  await client.recordEvent('daily_visit', '2026-06-30');
  assert.deepEqual(client.getState().new_stickers, ['sticker_begin_think']);
});

test('sticker wall starts coin synchronization before enabling purchases', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wall = fs.readFileSync(path.join(__dirname, '../web/js/sticker-wall.js'), 'utf8');
  assert.match(wall, /const coinSync=window\.LJG_STORE\?LJG_STORE\.init\(uid\)/);
  assert.match(wall, /buy\.disabled=!canPurchase/);
});


test('concurrent scene flushes serialize without duplicate cloud writes', async () => {
  const storage = memoryStorage();
  const writes = [];
  const client = {
    from: () => ({
      select: () => ({ eq: async () => ({ data: [], error: null }) }),
      upsert: async row => {
        await new Promise(resolve => setTimeout(resolve, 8));
        writes.push(row.scene_id);
        return { error: null };
      },
    }),
  };
  const store = stickerStoreModule.createStickerStore({ storage, catalog, model: require('../web/js/sticker-model.js'), getClient: () => client });
  await store.initOwner('user-a', ['sticker_begin_think']);
  const item = id => [{ instance_id: id, sticker_id: 'sticker_begin_think', x: 100, y: 100, scale: 1, rotation: 0, z_index: 1 }];
  store.saveSceneLayout('scene_riverside', item('a'));
  store.saveSceneLayout('scene_room', item('b'));
  await Promise.all([store.flushQueue(), store.flushQueue()]);
  assert.deepEqual(writes.sort(), ['scene_riverside', 'scene_room']);
  assert.equal(store.getStatus().pending, 0);
});

test('all sticker and scene assets referenced by the catalog exist', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const item of catalog.stickers) assert.equal(fs.existsSync(path.join(__dirname, '../web', item.image)), true, item.image);
  for (const scene of catalog.scenes) assert.equal(fs.existsSync(path.join(__dirname, '../web', scene.background)), true, scene.background);
});


test('owned sticker cards expose a detail dialog and editor link', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '../web/sticker-wall.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../web/js/sticker-wall.js'), 'utf8');
  assert.match(html, /id="wallDetail"/);
  assert.match(html, /href="sticker\.html"/);
  assert.match(js, /function openDetail/);
});


test('failed achievement events stay queued and retry idempotently', async () => {
  const storage = memoryStorage();
  let fail = true;
  const calls = [];
  const client = achievementsModule.createAchievementClient({
    catalog, storage,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'bootstrap_stickers') return { owned_ids: ['sticker_begin_think'], new_stickers: [], stats: {}, coins: 0 };
      if (fail) throw new Error('offline');
      return { owned_ids: ['sticker_begin_think', 'sticker_first_calm'], new_stickers: ['sticker_first_calm'], stats: { report_count: 1 }, coins: 0 };
    },
  });
  await client.init('user-a');
  await assert.rejects(() => client.recordEvent('report_generated', 'report:s-2', {}), /pending retry/);
  fail = false;
  assert.equal(await client.flushPendingEvents(), true);
  assert.equal(client.isOwned('sticker_first_calm'), true);
  assert.equal(calls.filter(call => call[0] === 'record_sticker_event').length, 2);
});

test('achievement state hydrates synchronously from an account-isolated cache', () => {
  const storage = memoryStorage({
    'calm_sticker_state.v2.user.user-a': JSON.stringify({
      version: 2,
      owner_id: 'user-a',
      updated_at: '2026-07-02T10:00:00.000Z',
      owned_ids: ['sticker_begin_think', 'sticker_first_calm', 'unknown'],
      new_stickers: ['sticker_first_calm'],
      stats: { report_count: 1 },
      coins: 75,
    }),
  });
  const client = achievementsModule.createAchievementClient({ catalog, storage });
  const cached = client.hydrate('user-a');
  assert.equal(cached.mode, 'account');
  assert.equal(cached.ready, true);
  assert.deepEqual(cached.owned_ids, ['sticker_begin_think', 'sticker_first_calm']);
  assert.deepEqual(cached.new_stickers, ['sticker_first_calm']);
  assert.equal(cached.coins, 75);

  const other = client.hydrate('user-b');
  assert.deepEqual(other.owned_ids, ['sticker_begin_think']);
  assert.equal(other.coins, null);
});

test('auth exposes a local-only session restore for cache-first pages', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const auth = fs.readFileSync(path.join(__dirname, '../web/js/auth.js'), 'utf8');
  assert.match(auth, /async function restoreUserFromSession/);
  assert.match(auth, /sb: client, restoreUserFromSession, refreshUser/);
});

test('sticker wall hydrates cached state before parallel background synchronization', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wall = fs.readFileSync(path.join(__dirname, '../web/js/sticker-wall.js'), 'utf8');
  assert.match(wall, /A\.hydrate\(uid\)/);
  assert.match(wall, /Promise\.allSettled/);
  assert.match(wall, /purchaseSyncState/);
  assert.doesNotMatch(wall, /await LJG_STORE\.init\(uid\)/);
});

test('sticker editor reports local and remote save states and saves when hidden', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const editor = fs.readFileSync(path.join(__dirname, '../web/js/sticker-editor.js'), 'utf8');
  assert.match(editor, /\u5df2\u4fdd\u5b58\u5230\u672c\u673a · \u4e91\u7aef\u540c\u6b65\u4e2d/);
  assert.match(editor, /\u79bb\u7ebf\u4fdd\u5b58/);
  assert.match(editor, /visibilitychange/);
});

test('a newer cloud scene replaces an older local scene without requeueing', async () => {
  const model = require('../web/js/sticker-model.js');
  const user = 'user-cloud-newer';
  const localItem = { instance_id: 'old-local', sticker_id: 'sticker_begin_think', x: 100, y: 100, scale: 1, rotation: 0, z_index: 1 };
  const cloudItem = { instance_id: 'new-cloud', sticker_id: 'sticker_begin_think', x: 500, y: 300, scale: 1.2, rotation: 30, z_index: 1 };
  const storage = memoryStorage({
    ['calm_sticker_scene_layouts.v2.user.' + user]: JSON.stringify({
      version: 2, owner_id: user, updated_at: '2026-07-02T09:00:00.000Z',
      scene_updated_at: { scene_riverside: '2026-07-02T09:00:00.000Z' },
      scenes: { scene_riverside: [localItem], scene_room: [], scene_pool: [] }, recent_sticker_ids: [],
    }),
  });
  const writes = [];
  const client = { from: () => ({
    select: () => ({ eq: async () => ({ data: [{ scene_id: 'scene_riverside', layout_json: [cloudItem], updated_at: '2026-07-02T10:00:00.000Z' }], error: null }) }),
    upsert: async row => { writes.push(row); return { error: null }; },
  }) };
  const store = stickerStoreModule.createStickerStore({ storage, catalog, model, getClient: () => client });
  await store.initOwner(user, ['sticker_begin_think']);
  assert.deepEqual(store.loadSceneLayout('scene_riverside'), [cloudItem]);
  assert.deepEqual(writes, []);
});

test('a newer local clear beats an older non-empty cloud scene', async () => {
  const model = require('../web/js/sticker-model.js');
  const user = 'user-local-clear';
  const cloudItem = { instance_id: 'old-cloud', sticker_id: 'sticker_begin_think', x: 400, y: 300, scale: 1, rotation: 0, z_index: 1 };
  const storage = memoryStorage({
    ['calm_sticker_scene_layouts.v2.user.' + user]: JSON.stringify({
      version: 2, owner_id: user, updated_at: '2026-07-02T10:00:00.000Z',
      scene_updated_at: { scene_riverside: '2026-07-02T10:00:00.000Z' },
      scenes: { scene_riverside: [], scene_room: [], scene_pool: [] }, recent_sticker_ids: [],
    }),
  });
  const writes = [];
  const client = { from: () => ({
    select: () => ({ eq: async () => ({ data: [{ scene_id: 'scene_riverside', layout_json: [cloudItem], updated_at: '2026-07-02T09:00:00.000Z' }], error: null }) }),
    upsert: async row => { writes.push(row); return { error: null }; },
  }) };
  const store = stickerStoreModule.createStickerStore({ storage, catalog, model, getClient: () => client });
  await store.initOwner(user, ['sticker_begin_think']);
  assert.deepEqual(store.loadSceneLayout('scene_riverside'), []);
  assert.deepEqual(writes.map(row => row.layout_json), [[]]);
});

test('achievement refresh and markSeen persist the account cache', async () => {
  const storage = memoryStorage();
  const client = achievementsModule.createAchievementClient({
    catalog, storage,
    rpc: async name => {
      if (name === 'bootstrap_stickers') return { owned_ids: ['sticker_begin_think', 'sticker_first_calm'], new_stickers: ['sticker_first_calm'], stats: { report_count: 1 }, coins: 70 };
      return {};
    },
  });
  await client.init('cache-user');
  let cached = JSON.parse(storage.dump()['calm_sticker_state.v2.user.cache-user']);
  assert.deepEqual(cached.owned_ids, ['sticker_begin_think', 'sticker_first_calm']);
  assert.deepEqual(cached.new_stickers, ['sticker_first_calm']);
  assert.equal(cached.coins, 70);
  await client.markSeen(['sticker_first_calm']);
  cached = JSON.parse(storage.dump()['calm_sticker_state.v2.user.cache-user']);
  assert.deepEqual(cached.new_stickers, []);
});
test('shared coin store executes decisions and coin reads in parallel', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const store = fs.readFileSync(path.join(__dirname, '../web/js/store.js'), 'utf8');
  assert.match(store, /Promise\.allSettled\(\[decisionsRequest, statsRequest\]\)/);
});