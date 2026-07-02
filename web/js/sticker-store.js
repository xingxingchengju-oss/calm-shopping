/* 冷静购 · 二期贴纸布局：游客本地、账号 Supabase + 本地重试 */
(function (root, factory) {
  let catalog = root && root.LJG_STICKER_CATALOG;
  let model = root && root.LJG_STICKER_MODEL;
  if (typeof module === 'object' && module.exports) {
    catalog = require('./sticker-catalog.js');
    model = require('./sticker-model.js');
  }
  const singleton = factory({ storage: root && root.localStorage, catalog, model, getClient: () => root && root.LJG_AUTH && root.LJG_AUTH.sb && root.LJG_AUTH.sb() });
  singleton.createStickerStore = options => factory(Object.assign({ catalog, model }, options || {}));
  if (typeof module === 'object' && module.exports) module.exports = singleton;
  if (root) root.LJG_STICKER_STORE = singleton;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (options) {
  'use strict';
  const VERSION = 2;
  const catalog = options.catalog;
  const model = options.model;
  const storage = options.storage || null;
  const getClient = options.getClient || (() => null);
  const sceneIds = catalog.scenes.map(scene => scene.id);
  let ownerId = 'guest';
  let currentDoc = null;
  let ownedIds = new Set(catalog.defaultStickerIds ? catalog.defaultStickerIds() : ['sticker_begin_think']);
  let status = { persistent: !!storage, remote: false, pending: 0, error: null };

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function keyFor(owner) { return owner === 'guest' ? 'calm_sticker_scene_layouts.v2.guest' : 'calm_sticker_scene_layouts.v2.user.' + owner; }
  function queueKey(owner) { return 'calm_sticker_scene_layouts.v2.queue.' + (owner || ownerId); }
  function validTimestamp(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
  function timestampValue(value) { return validTimestamp(value) ? Date.parse(value) : 0; }
  function sameItems(left, right) { return JSON.stringify(left || []) === JSON.stringify(right || []); }
  function blankDocument() {
    const scenes = {}, sceneUpdatedAt = {};
    sceneIds.forEach(id => { scenes[id] = []; sceneUpdatedAt[id] = null; });
    return { version: VERSION, owner_id: ownerId, updated_at: new Date().toISOString(), scene_updated_at: sceneUpdatedAt, scenes, recent_sticker_ids: [] };
  }
  function numberOr(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
  function sanitizeItem(raw) {
    if (!raw || typeof raw.instance_id !== 'string' || !raw.instance_id || !catalog.getSticker(raw.sticker_id)) return null;
    if (!ownedIds.has(raw.sticker_id)) return null;
    return {
      instance_id: raw.instance_id, sticker_id: raw.sticker_id,
      x: Math.min(model.LOGICAL_WIDTH, Math.max(0, numberOr(raw.x, model.LOGICAL_WIDTH / 2))),
      y: Math.min(model.LOGICAL_HEIGHT, Math.max(0, numberOr(raw.y, model.LOGICAL_HEIGHT / 2))),
      scale: Math.round(Math.min(model.MAX_SCALE, Math.max(model.MIN_SCALE, numberOr(raw.scale, 1))) * 10) / 10,
      rotation: ((Math.round(numberOr(raw.rotation, 0)) % 360) + 360) % 360,
      z_index: Math.max(1, Math.round(numberOr(raw.z_index, 1))),
    };
  }
  function sanitizeItems(items) {
    const seen = new Set();
    return (Array.isArray(items) ? items : []).map(sanitizeItem).filter(item => {
      if (!item || seen.has(item.instance_id)) return false;
      seen.add(item.instance_id); return true;
    });
  }
  function sanitizeDocument(raw) {
    if (!raw || raw.version !== VERSION || !raw.scenes) return blankDocument();
    const doc = blankDocument();
    const rawSceneTimes = raw.scene_updated_at && typeof raw.scene_updated_at === 'object' ? raw.scene_updated_at : {};
    sceneIds.forEach(id => {
      doc.scenes[id] = sanitizeItems(raw.scenes[id]);
      const explicit = validTimestamp(rawSceneTimes[id]) ? rawSceneTimes[id] : null;
      doc.scene_updated_at[id] = explicit || (doc.scenes[id].length && validTimestamp(raw.updated_at) ? raw.updated_at : null);
    });
    const recent = [];
    (Array.isArray(raw.recent_sticker_ids) ? raw.recent_sticker_ids : []).forEach(id => {
      if (ownedIds.has(id) && catalog.getSticker(id) && !recent.includes(id) && recent.length < 6) recent.push(id);
    });
    doc.recent_sticker_ids = recent;
    doc.updated_at = validTimestamp(raw.updated_at) ? raw.updated_at : doc.updated_at;
    return doc;
  }
  function readLocal() {
    if (!storage) return blankDocument();
    try {
      const raw = storage.getItem(keyFor(ownerId));
      status.persistent = true; status.error = null;
      return raw == null ? blankDocument() : sanitizeDocument(JSON.parse(raw));
    } catch (error) {
      status.error = 'corrupt'; return blankDocument();
    }
  }
  function persistLocal() {
    currentDoc.updated_at = new Date().toISOString(); currentDoc.owner_id = ownerId;
    if (!storage) { status.persistent = false; status.error = 'unavailable'; return false; }
    try { storage.setItem(keyFor(ownerId), JSON.stringify(currentDoc)); status.persistent = true; status.error = null; return true; }
    catch (error) { status.persistent = false; status.error = 'write_failed'; return false; }
  }
  function loadQueue(targetOwner) {
    const target = targetOwner || ownerId;
    if (!storage || target === 'guest') return [];
    try { return JSON.parse(storage.getItem(queueKey(target)) || '[]'); } catch (error) { return []; }
  }
  function saveQueue(queue, targetOwner) {
    const target = targetOwner || ownerId;
    if (target === ownerId) status.pending = queue.length;
    if (!storage || target === 'guest') return;
    try { storage.setItem(queueKey(target), JSON.stringify(queue)); } catch (error) { if (target === ownerId) status.error = 'queue_write_failed'; }
  }
  function queueScene(sceneId, layout, updatedAt, targetOwner) {
    const target = targetOwner || ownerId;
    if (target === 'guest') return;
    const queue = loadQueue(target).filter(entry => entry.scene_id !== sceneId);
    queue.push({ scene_id: sceneId, layout_json: clone(layout), updated_at: updatedAt });
    saveQueue(queue, target);
  }
  function enqueueScene(sceneId) {
    if (ownerId === 'guest') return;
    const updatedAt = currentDoc.scene_updated_at[sceneId] || new Date().toISOString();
    queueScene(sceneId, currentDoc.scenes[sceneId], updatedAt, ownerId);
    flushQueue();
  }
  function pendingScenes(queue) {
    const latest = new Map();
    (Array.isArray(queue) ? queue : []).forEach(entry => {
      if (!entry || !sceneIds.includes(entry.scene_id) || !validTimestamp(entry.updated_at)) return;
      const prior = latest.get(entry.scene_id);
      if (!prior || timestampValue(entry.updated_at) >= timestampValue(prior.updated_at)) latest.set(entry.scene_id, entry);
    });
    return latest;
  }
  let flushPromise = null;
  let flushRequested = false;
  function flushQueue() {
    flushRequested = true;
    if (flushPromise) return flushPromise;
    flushPromise = (async function drainQueues() {
      let ok = true;
      do {
        flushRequested = false;
        const target = ownerId;
        ok = await flushQueueNow(target);
        if (!ok && target === ownerId) return false;
      } while (flushRequested || loadQueue(ownerId).length);
      return ok;
    })().finally(() => { flushPromise = null; });
    return flushPromise;
  }
  async function flushQueueNow(targetOwner) {
    const target = targetOwner || ownerId;
    if (target === 'guest') return true;
    const client = getClient();
    if (!client) { if (target === ownerId) { status.remote = false; status.error = 'remote_unavailable'; } return false; }
    let queue = loadQueue(target);
    while (queue.length) {
      const entry = queue[0];
      try {
        const result = await client.from('user_scene_layouts').upsert({
          user_id: target, scene_id: entry.scene_id, layout_json: entry.layout_json, updated_at: entry.updated_at,
        }, { onConflict: 'user_id,scene_id' });
        if (result.error) throw result.error;
        const latest = loadQueue(target);
        const index = latest.findIndex(item => item.scene_id === entry.scene_id && item.updated_at === entry.updated_at);
        if (index >= 0) latest.splice(index, 1);
        saveQueue(latest, target);
        queue = loadQueue(target);
      } catch (error) {
        if (target === ownerId) { status.remote = false; status.error = 'remote_write_failed'; }
        return false;
      }
    }
    if (target === ownerId) { status.remote = true; status.error = null; }
    return true;
  }
  function mergeRemoteScenes(rows, pendingQueue, targetOwner) {
    const cloud = new Map();
    (Array.isArray(rows) ? rows : []).forEach(row => {
      if (!row || !sceneIds.includes(row.scene_id)) return;
      cloud.set(row.scene_id, {
        items: sanitizeItems(row.layout_json),
        updatedAt: validTimestamp(row.updated_at) ? row.updated_at : null,
        time: timestampValue(row.updated_at),
      });
    });
    const pending = pendingScenes(pendingQueue);
    sceneIds.forEach(sceneId => {
      const cloudScene = cloud.get(sceneId);
      const localTime = timestampValue(currentDoc.scene_updated_at[sceneId]);
      const candidates = [
        { source: 'local', priority: 2, items: currentDoc.scenes[sceneId], updatedAt: currentDoc.scene_updated_at[sceneId], time: localTime },
      ];
      if (cloudScene) candidates.push({ source: 'cloud', priority: 1, items: cloudScene.items, updatedAt: cloudScene.updatedAt, time: cloudScene.time });
      const pendingScene = pending.get(sceneId);
      if (pendingScene) candidates.push({ source: 'pending', priority: 3, items: sanitizeItems(pendingScene.layout_json), updatedAt: pendingScene.updated_at, time: timestampValue(pendingScene.updated_at) });
      candidates.sort((left, right) => right.time - left.time || right.priority - left.priority);
      const winner = candidates[0];
      currentDoc.scenes[sceneId] = clone(winner.items);
      currentDoc.scene_updated_at[sceneId] = winner.updatedAt || null;
      if (winner.source === 'cloud') {
        pending.delete(sceneId);
      } else if (validTimestamp(winner.updatedAt) && (!cloudScene || winner.time > cloudScene.time || !sameItems(winner.items, cloudScene.items))) {
        pending.set(sceneId, { scene_id: sceneId, layout_json: clone(winner.items), updated_at: winner.updatedAt });
      }
    });
    saveQueue(Array.from(pending.values()), targetOwner);
  }
  async function initOwner(nextOwner, nextOwnedIds) {
    ownerId = typeof nextOwner === 'string' && nextOwner.trim() ? nextOwner.trim() : 'guest';
    const initializingOwner = ownerId;
    currentDoc = null;
    setOwnedIds(nextOwnedIds);
    currentDoc = readLocal();
    const pendingQueue = loadQueue();
    status.remote = false; status.pending = pendingQueue.length;
    if (ownerId === 'guest') return loadAllLayouts();
    const client = getClient();
    if (!client) { status.error = 'remote_unavailable'; return loadAllLayouts(); }
    try {
      const result = await client.from('user_scene_layouts').select('scene_id,layout_json,updated_at').eq('user_id', initializingOwner);
      if (result.error) throw result.error;
      if (ownerId !== initializingOwner) return loadAllLayouts();
      mergeRemoteScenes(result.data || [], pendingQueue, initializingOwner);
      status.remote = true; status.error = null; persistLocal();
      await flushQueue();
    } catch (error) {
      if (ownerId === initializingOwner) { status.remote = false; status.error = 'remote_read_failed'; }
    }
    return loadAllLayouts();
  }
  function setOwner(nextOwner) { ownerId = nextOwner || 'guest'; currentDoc = null; currentDoc = readLocal(); return ownerId; }
  function setOwnedIds(ids) {
    const list = Array.isArray(ids) && ids.length ? ids : (catalog.defaultStickerIds ? catalog.defaultStickerIds() : ['sticker_begin_think']);
    ownedIds = new Set(list.filter(id => catalog.getSticker(id)));
    if (currentDoc) {
      sceneIds.forEach(id => { currentDoc.scenes[id] = sanitizeItems(currentDoc.scenes[id]); });
      currentDoc.recent_sticker_ids = currentDoc.recent_sticker_ids.filter(id => ownedIds.has(id));
      persistLocal();
    }
  }
  function ensureDocument() { if (!currentDoc) currentDoc = readLocal(); return currentDoc; }
  function loadAllLayouts() { return clone(ensureDocument()); }
  function loadSceneLayout(sceneId) { return sceneIds.includes(sceneId) ? clone(ensureDocument().scenes[sceneId]) : []; }
  function saveSceneLayout(sceneId, items, recentStickerId) {
    if (!sceneIds.includes(sceneId)) return false;
    const updatedAt = new Date().toISOString();
    const doc = ensureDocument(); doc.scenes[sceneId] = sanitizeItems(items);
    doc.scene_updated_at[sceneId] = updatedAt;
    if (ownedIds.has(recentStickerId)) doc.recent_sticker_ids = [recentStickerId].concat(doc.recent_sticker_ids.filter(id => id !== recentStickerId)).slice(0, 6);
    const ok = persistLocal(); enqueueScene(sceneId); return ok;
  }
  function clearScene(sceneId) { return saveSceneLayout(sceneId, []); }
  function clearAllLayouts() {
    const doc = ensureDocument(), updatedAt = new Date().toISOString();
    sceneIds.forEach(id => { doc.scenes[id] = []; doc.scene_updated_at[id] = updatedAt; });
    doc.recent_sticker_ids = [];
    const ok = persistLocal(); sceneIds.forEach(enqueueScene); return ok;
  }
  function getRecentStickerIds() { return clone(ensureDocument().recent_sticker_ids); }
  function getStatus() { return Object.assign({}, status); }

  currentDoc = readLocal();
  return { initOwner, setOwner, setOwnedIds, loadAllLayouts, loadSceneLayout, saveSceneLayout, clearScene, clearAllLayouts, getRecentStickerIds, getStatus, flushQueue };
});
