/* 冷静购 · 贴纸解锁奖励队列 */
(function (root, factory) {
  const singleton = factory({
    catalog: root && root.LJG_STICKER_CATALOG,
    markSeen: ids => root && root.LJG_STICKER_ACHIEVEMENTS ? root.LJG_STICKER_ACHIEVEMENTS.markSeen(ids) : Promise.resolve(),
  });
  singleton.createRewardQueue = options => factory(options || {});
  if (typeof module === 'object' && module.exports) module.exports = singleton;
  if (root) root.LJG_STICKER_REWARD = singleton;
  if (root && root.document) {
    const boot = () => {
      const layer = document.getElementById('stickerReward');
      if (!layer) return;
      const image = layer.querySelector('[data-reward-image]');
      const name = layer.querySelector('[data-reward-name]');
      const rarity = layer.querySelector('[data-reward-rarity]');
      const close = layer.querySelector('[data-reward-close]');
      let retryTimer = null;
      let previousFocus = null;

      function coinRewardOpen() {
        const coin = document.getElementById('reward');
        return !!(coin && coin.classList.contains('show'));
      }
      function retrySoon() {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(pump, 350);
      }
      function pump() {
        if (layer.classList.contains('show') || layer.classList.contains('closing')) return;
        const waiting = singleton.getPending();
        if (!waiting.active && !waiting.queued.length) return;
        if (!singleton.canPresent() || coinRewardOpen()) { retrySoon(); return; }
        const sticker = singleton.next();
        if (!sticker) return;
        previousFocus = document.activeElement;
        if (image) { image.src = sticker.image; image.alt = sticker.name; }
        if (name) name.textContent = sticker.name;
        if (rarity) rarity.textContent = ({ common: '普通', rare: '稀有', epic: '史诗' })[sticker.rarity] || sticker.rarity;
        layer.className = 'sticker-reward show rarity-' + sticker.rarity;
        layer.setAttribute('aria-hidden', 'false');
        if (close) setTimeout(() => close.focus(), 520);
      }
      async function dismissCurrent() {
        if (!layer.classList.contains('show')) return;
        layer.classList.remove('show');
        layer.classList.add('closing');
        layer.setAttribute('aria-hidden', 'true');
        await singleton.dismiss();
        setTimeout(() => {
          layer.classList.remove('closing');
          if (previousFocus && previousFocus.focus) previousFocus.focus();
          pump();
        }, 180);
      }
      if (close) close.addEventListener('click', dismissCurrent);
      layer.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); dismissCurrent(); }
      });
      root.addEventListener('ljg:sticker-unlocked', event => {
        singleton.enqueue(event.detail && event.detail.sticker_ids);
        pump();
      });
      root.addEventListener('ljg:view', pump);
      root.addEventListener('ljg:reward-context-changed', pump);
      singleton.pump = pump;
    };
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (options) {
  'use strict';
  const catalog = options.catalog;
  const markSeen = options.markSeen || (async () => true);
  const pending = [];
  let active = null;
  let presentationGate = typeof options.canPresent === 'function' ? options.canPresent : (() => true);

  function enqueue(ids) {
    (Array.isArray(ids) ? ids : []).forEach(id => {
      if (!catalog || !catalog.getSticker(id) || id === active || pending.includes(id)) return;
      pending.push(id);
    });
    return pending.slice();
  }
  function canPresent() {
    try { return presentationGate() !== false; } catch (error) { return false; }
  }
  function setPresentationGate(fn) {
    presentationGate = typeof fn === 'function' ? fn : (() => true);
    return canPresent();
  }
  function next() {
    if (!canPresent()) return null;
    if (!active && pending.length) active = pending.shift();
    return active && catalog ? catalog.getSticker(active) : null;
  }
  async function dismiss() {
    if (!active) return false;
    const id = active;
    active = null;
    await markSeen([id]);
    return true;
  }
  function getPending() { return { active, queued: pending.slice() }; }
  return { enqueue, next, dismiss, getPending, canPresent, setPresentationGate };
});
