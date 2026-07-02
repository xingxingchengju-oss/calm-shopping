/* 冷静购 · 贴纸编辑纯状态模型 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LJG_STICKER_MODEL = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LOGICAL_WIDTH = 1440;
  const LOGICAL_HEIGHT = 900;
  const MIN_SCALE = 0.4;
  const MAX_SCALE = 2.5;

  function cloneItems(items) {
    return (Array.isArray(items) ? items : []).map(item => Object.assign({}, item));
  }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function round1(value) { return Math.round(value * 10) / 10; }
  function normalizeRotation(value) { return ((Math.round(value) % 360) + 360) % 360; }
  function makeId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return 'item_' + crypto.randomUUID();
    return 'item_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function createInstance(stickerId, existingItems, options) {
    const items = Array.isArray(existingItems) ? existingItems : [];
    const opts = options || {};
    const maxZ = items.reduce((max, item) => Math.max(max, Number(item.z_index) || 0), 0);
    const cascade = Math.min(items.length % 5, 4) * 24;
    return {
      instance_id: opts.instanceId || makeId(),
      sticker_id: stickerId,
      x: opts.x == null ? LOGICAL_WIDTH / 2 + cascade : clamp(Number(opts.x), 0, LOGICAL_WIDTH),
      y: opts.y == null ? LOGICAL_HEIGHT / 2 + cascade : clamp(Number(opts.y), 0, LOGICAL_HEIGHT),
      scale: 1,
      rotation: 0,
      z_index: maxZ + 1,
    };
  }

  function applyAction(items, action) {
    const source = cloneItems(items);
    if (!action || action.type === 'clear') return action && action.type === 'clear' ? [] : source;
    if (action.type === 'delete') return source.filter(item => item.instance_id !== action.instanceId);
    const index = source.findIndex(item => item.instance_id === action.instanceId);
    if (index < 0) return source;
    const current = source[index];
    if (action.type === 'move') {
      current.x = clamp(Number(action.x) || 0, 0, LOGICAL_WIDTH);
      current.y = clamp(Number(action.y) || 0, 0, LOGICAL_HEIGHT);
    } else if (action.type === 'scale') {
      current.scale = round1(clamp((Number(current.scale) || 1) + Number(action.delta || 0), MIN_SCALE, MAX_SCALE));
    } else if (action.type === 'rotate') {
      current.rotation = normalizeRotation((Number(current.rotation) || 0) + Number(action.delta || 0));
    } else if (action.type === 'bring-front') {
      current.z_index = source.reduce((max, item) => Math.max(max, Number(item.z_index) || 0), 0) + 1;
    }
    return source;
  }

  function createHistory(initialItems, requestedLimit) {
    const limit = Math.max(1, Number(requestedLimit) || 50);
    let present = cloneItems(initialItems);
    let past = [];
    let future = [];
    return {
      current: () => cloneItems(present),
      canUndo: () => past.length > 0,
      canRedo: () => future.length > 0,
      commit(nextItems) {
        past.push(cloneItems(present));
        if (past.length > limit) past = past.slice(past.length - limit);
        present = cloneItems(nextItems);
        future = [];
        return cloneItems(present);
      },
      replace(nextItems) { present = cloneItems(nextItems); return cloneItems(present); },
      undo() {
        if (!past.length) return cloneItems(present);
        future.push(cloneItems(present));
        present = past.pop();
        return cloneItems(present);
      },
      redo() {
        if (!future.length) return cloneItems(present);
        past.push(cloneItems(present));
        present = future.pop();
        return cloneItems(present);
      },
    };
  }

  return {
    LOGICAL_WIDTH, LOGICAL_HEIGHT, MIN_SCALE, MAX_SCALE,
    createInstance, applyAction, createHistory,
  };
});
