/* 冷静购 · 二期贴纸与场景目录 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LJG_STICKER_CATALOG = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const stickers = [
    { id: 'sticker_begin_think', name: '开始思考', image: 'assets/stickers/begin-think.png', category: 'beginner', rarity: 'common', description: '先想一想，再做决定', source_type: 'default', price: null, unlock_rule: { kind: 'default', text: '欢迎来到河湾' }, hidden: false },
    { id: 'sticker_first_calm', name: '第一次冷静', image: 'assets/stickers/first-calm.png', category: 'beginner', rarity: 'common', description: '完成第一次冷静判断', source_type: 'achievement', price: null, unlock_rule: { stat: 'report_count', gte: 1, text: '生成第一份冷静报告' }, hidden: false },
    { id: 'sticker_put_pool', name: '放入沉淀池', image: 'assets/stickers/put-pool.png', category: 'cooldown', rarity: 'common', description: '让商品先漂一会儿', source_type: 'achievement', price: null, unlock_rule: { stat: 'pool_item_count', gte: 1, text: '第一次把商品放入沉淀池' }, hidden: false },
    { id: 'sticker_hold_buy', name: '忍住没买', image: 'assets/stickers/hold-buy.png', category: 'decision', rarity: 'common', description: '把冲动留在购物车外', source_type: 'achievement', price: null, unlock_rule: { stat: 'purchase_cancel_count', gte: 1, text: '第一次成功放弃购买' }, hidden: false },
    { id: 'sticker_price_detective', name: '价格侦探', image: 'assets/stickers/price-detective.png', category: 'insight', rarity: 'common', description: '看清价格里的小机关', source_type: 'achievement', price: null, unlock_rule: { stat: 'price_judgement_count', gte: 1, text: '完成一次带价格判断的报告' }, hidden: false },
    { id: 'sticker_need_check', name: '需求确认', image: 'assets/stickers/need-check.png', category: 'insight', rarity: 'rare', description: '确认它是否真的需要', source_type: 'achievement', price: null, unlock_rule: { stat: 'report_count', gte: 3, text: '累计生成 3 份冷静报告' }, hidden: false },
    { id: 'sticker_wallet_guard', name: '钱包保卫战', image: 'assets/stickers/wallet-guard.png', category: 'fun', rarity: 'rare', description: '守住钱包的一次胜利', source_type: 'achievement', price: null, unlock_rule: { stat: 'purchase_cancel_count', gte: 3, text: '累计放弃购买 3 次' }, hidden: false },
    { id: 'sticker_cooling', name: '冷却中', image: 'assets/stickers/cooling.png', category: 'cooldown', rarity: 'common', description: '冲动正在慢慢降温', source_type: 'achievement', price: null, unlock_rule: { stat: 'scene_save_count', gte: 1, text: '保存第一个非空贴纸场景' }, hidden: false },
    { id: 'sticker_rational_start', name: '理性启动', image: 'assets/stickers/rational-start.png', category: 'beginner', rarity: 'rare', description: '理性模式已经开启', source_type: 'achievement', price: null, unlock_rule: { stat: 'owned_count', gte: 5, text: '拥有 5 张贴纸' }, hidden: false },
    { id: 'sticker_wait_more', name: '等等再说', image: 'assets/stickers/wait-more.png', category: 'cooldown', rarity: 'common', description: '给决定多一点时间', source_type: 'shop', price: 50, unlock_rule: { kind: 'purchase', text: '使用 50 河币兑换' }, hidden: false },
    { id: 'sticker_today_safe', name: '今日没破防', image: 'assets/stickers/today-safe.png', category: 'fun', rarity: 'rare', description: '今天也稳稳接住自己', source_type: 'shop', price: 100, unlock_rule: { kind: 'purchase', text: '使用 100 河币兑换' }, hidden: false },
    { id: 'sticker_let_go', name: '成功放下', image: 'assets/stickers/let-go.png', category: 'decision', rarity: 'epic', description: '轻轻放下这次冲动', source_type: 'hybrid', price: 180, unlock_rule: { stat: 'purchase_cancel_count', gte: 5, text: '放弃购买 5 次，或使用 180 河币兑换' }, hidden: false },
  ];
  const scenes = [
    { id: 'scene_riverside', name: '河边小路', background: 'assets/scenes/riverside.png', description: '默认主场景，适合展示普通贴纸' },
    { id: 'scene_room', name: '房间书桌', background: 'assets/scenes/room.png', description: '适合成长、复盘和思考类贴纸' },
    { id: 'scene_pool', name: '沉淀池', background: 'assets/scenes/pool.png', description: '适合冷却、暂不购买和放下类贴纸' },
  ];
  function getSticker(id) { return stickers.find(item => item.id === id) || null; }
  function getScene(id) { return scenes.find(item => item.id === id) || null; }
  function listOwned(ids) { const owned = new Set(Array.isArray(ids) ? ids : []); return stickers.filter(item => owned.has(item.id)); }
  function defaultStickerIds() { return stickers.filter(item => item.source_type === 'default').map(item => item.id); }
  return { stickers, scenes, getSticker, getScene, listOwned, defaultStickerIds };
});
