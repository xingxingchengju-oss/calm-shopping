/* 冷静购 · 二期贴纸所有权与成就客户端 */
(function (root, factory) {
  const catalog = root && root.LJG_STICKER_CATALOG;
  const singleton = factory({
    catalog,
    storage: root && root.localStorage,
    rpc: async function (name, args) {
      const sb = root && root.LJG_AUTH && root.LJG_AUTH.sb && root.LJG_AUTH.sb();
      if (!sb) throw new Error('贴纸云端服务暂不可用');
      const result = await sb.rpc(name, args || {});
      if (result.error) throw result.error;
      return result.data;
    },
    flushCoins: async function () {
      if (!root || !root.LJG_STORE) return true;
      if (root.LJG_STORE.flushCoins) return root.LJG_STORE.flushCoins();
      if (root.LJG_STORE.resync) return root.LJG_STORE.resync();
      return true;
    },
  });
  singleton.createAchievementClient = options => factory(options || {});
  if (typeof module === 'object' && module.exports) module.exports = singleton;
  if (root) root.LJG_STICKER_ACHIEVEMENTS = singleton;
  if (root && root.addEventListener) root.addEventListener('online', () => singleton.flushPendingEvents());
})(typeof globalThis !== 'undefined' ? globalThis : this, function (options) {
  'use strict';
  const catalog = options.catalog;
  const rpc = options.rpc || (async function () { throw new Error('贴纸云端服务暂不可用'); });
  const flushCoins = options.flushCoins || (async function () { return true; });
  const storage = options.storage || null;
  const memoryQueues = new Map();
  let eventFlushPromise = null;
  let lastEventResult = null;
  let state = blankState();
  function blankState() { return { mode: 'guest', owner_id: null, owned_ids: catalog ? catalog.defaultStickerIds() : [], new_stickers: [], stats: {}, coins: null, ready: false }; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function cacheKey(owner) { return 'calm_sticker_state.v2.user.' + owner; }
  function validStickerIds(ids) {
    return Array.from(new Set((Array.isArray(ids) ? ids : []).filter(id => catalog && catalog.getSticker(id))));
  }
  function persistState() {
    if (!storage || state.mode !== 'account' || !state.owner_id) return;
    const payload = Object.assign({ version: 2, updated_at: new Date().toISOString() }, getState());
    try { storage.setItem(cacheKey(state.owner_id), JSON.stringify(payload)); } catch (error) {}
  }
  function hydrate(ownerId) {
    state = blankState();
    state.owner_id = ownerId || null;
    state.mode = ownerId ? 'account' : 'guest';
    lastEventResult = null;
    if (ownerId && storage) {
      try {
        const cached = JSON.parse(storage.getItem(cacheKey(ownerId)) || 'null');
        if (cached && cached.version === 2 && cached.owner_id === ownerId) {
          state.owned_ids = validStickerIds((catalog ? catalog.defaultStickerIds() : []).concat(cached.owned_ids || []));
          state.new_stickers = validStickerIds(cached.new_stickers);
          state.stats = cached.stats && typeof cached.stats === 'object' ? clone(cached.stats) : {};
          state.coins = typeof cached.coins === 'number' && Number.isFinite(cached.coins) ? cached.coins : null;
        }
      } catch (error) {}
    }
    state.ready = true;
    emit('ljg:stickers-updated', state);
    return getState();
  }
  function unwrap(payload) { return Array.isArray(payload) && payload.length === 1 ? payload[0] : (payload || {}); }
  function applyPayload(payload) {
    const data = unwrap(payload);
    if (Array.isArray(data.owned_ids)) state.owned_ids = validStickerIds((catalog ? catalog.defaultStickerIds() : []).concat(data.owned_ids));
    if (Array.isArray(data.new_stickers)) state.new_stickers = validStickerIds(state.new_stickers.concat(data.new_stickers));
    if (data.stats && typeof data.stats === 'object') state.stats = data.stats;
    if (typeof data.coins === 'number') state.coins = data.coins;
    state.ready = true;
    persistState();
    return clone(Object.assign({}, data, { owned_ids: state.owned_ids, new_stickers: state.new_stickers, stats: state.stats, coins: state.coins }));
  }
  function emit(name, detail) {
    if (typeof window === 'undefined' || !window.dispatchEvent || typeof CustomEvent === 'undefined') return;
    try { window.dispatchEvent(new CustomEvent(name, { detail: clone(detail) })); } catch (error) {}
  }
  function pendingKey() { return 'calm_sticker_events.v2.' + state.owner_id; }
  function loadPending() {
    if (!state.owner_id) return [];
    if (storage) { try { return JSON.parse(storage.getItem(pendingKey()) || '[]'); } catch (error) { return []; } }
    return clone(memoryQueues.get(pendingKey()) || []);
  }
  function savePending(queue) {
    if (!state.owner_id) return;
    memoryQueues.set(pendingKey(), clone(queue));
    if (storage) { try { storage.setItem(pendingKey(), JSON.stringify(queue)); } catch (error) {} }
  }
  function enqueueEvent(type, eventId, metadata) {
    const queue = loadPending();
    if (!queue.some(item => item.type === type && item.event_id === eventId)) queue.push({ type, event_id: eventId, metadata: metadata || {} });
    savePending(queue);
  }
  function flushPendingEvents() {
    if (state.mode !== 'account' || !state.owner_id) return Promise.resolve(true);
    if (eventFlushPromise) return eventFlushPromise;
    eventFlushPromise = flushPendingEventsNow().finally(() => { eventFlushPromise = null; });
    return eventFlushPromise;
  }
  async function flushPendingEventsNow() {
    let queue = loadPending();
    while (queue.length) {
      const event = queue[0];
      try {
        lastEventResult = applyPayload(await rpc('record_sticker_event', { p_event_type: event.type, p_event_id: event.event_id, p_metadata: event.metadata || {} }));
        emit('ljg:stickers-updated', getState());
        if (lastEventResult.new_stickers && lastEventResult.new_stickers.length) emit('ljg:sticker-unlocked', { sticker_ids: lastEventResult.new_stickers });
      } catch (error) { return false; }
      const latest = loadPending();
      const index = latest.findIndex(item => item.type === event.type && item.event_id === event.event_id);
      if (index >= 0) latest.splice(index, 1);
      savePending(latest); queue = loadPending();
    }
    return true;
  }
  async function refresh(ownerId) {
    const requestedOwner = arguments.length ? (ownerId || null) : state.owner_id;
    if (state.owner_id !== requestedOwner) hydrate(requestedOwner);
    if (!requestedOwner) return getState();
    const refreshOwner = state.owner_id;
    const payload = await rpc('bootstrap_stickers', {});
    if (state.owner_id !== refreshOwner) return getState();
    const data = applyPayload(payload);
    emit('ljg:stickers-updated', getState());
    if (data.new_stickers && data.new_stickers.length) emit('ljg:sticker-unlocked', { sticker_ids: data.new_stickers });
    await flushPendingEvents();
    return getState();
  }
  async function init(ownerId) {
    hydrate(ownerId);
    return refresh(ownerId);
  }
  async function recordEvent(type, eventId, metadata) {
    if (state.mode !== 'account' || !state.owner_id) return null;
    if (!type || !eventId) throw new Error('成就事件缺少类型或业务 ID');
    enqueueEvent(String(type), String(eventId), metadata || {});
    const ok = await flushPendingEvents();
    if (!ok) throw new Error('achievement event pending retry');
    return lastEventResult;
  }
  async function purchase(stickerId) {
    if (state.mode !== 'account' || !state.owner_id) throw new Error('登录后才能兑换贴纸');
    const sticker = catalog && catalog.getSticker(stickerId);
    if (!sticker || !['shop', 'hybrid'].includes(sticker.source_type)) throw new Error('这张贴纸不能购买');
    if (await flushCoins() === false) throw new Error('河币仍在同步，请稍后再试');
    const data = applyPayload(await rpc('purchase_sticker', { p_sticker_id: stickerId }));
    emit('ljg:stickers-updated', getState()); emit('ljg:coins-updated', { coins: state.coins });
    if (data.new_stickers && data.new_stickers.length) emit('ljg:sticker-unlocked', { sticker_ids: data.new_stickers });
    return data;
  }
  async function markSeen(ids) {
    const stickerIds = Array.from(new Set((ids || []).filter(Boolean)));
    if (!stickerIds.length || state.mode !== 'account') return true;
    await rpc('mark_stickers_seen', { p_sticker_ids: stickerIds });
    state.new_stickers = state.new_stickers.filter(id => !stickerIds.includes(id));
    persistState();
    emit('ljg:stickers-updated', getState()); return true;
  }
  function isOwned(id) { return state.owned_ids.includes(id); }
  function getState() { return clone(state); }
  return { hydrate, refresh, init, recordEvent, flushPendingEvents, purchase, markSeen, isOwned, getState };
});
