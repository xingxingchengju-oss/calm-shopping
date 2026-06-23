/* ============================================================
   冷静购 · 本地持久化（localStorage）
   - 沉淀池里的「决策档案」、河币余额。
   - now()：可注入的时间源（仅供测试/验收，正式仍是真实时间）。
     在控制台设 window.__LJG_NOW = <毫秒> 即可模拟时间流逝，核对 24h 沉降。
   ============================================================ */
(function () {
  const KEY_POOL = 'ljg.pool';
  const KEY_COINS = 'ljg.coins';

  function now() {
    return (typeof window.__LJG_NOW === 'number') ? window.__LJG_NOW : Date.now();
  }
  function read(k, def) {
    try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); }
    catch (e) { return def; }
  }
  function write(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 隐私模式/超额，忽略 */ }
  }

  const state = {
    pool: read(KEY_POOL, []),
    coins: read(KEY_COINS, null),
  };

  // ---- 沉淀池 ----
  function getPool() { return state.pool; }
  function getPoolItem(id) { return state.pool.find(x => x.id === id); }

  // 写盘：图片 input(dataURL) 可能很大；配额超了就先丢掉图片 input 再存，
  // 保证商品本身持久化（这些项的「重新扑通」降级为重新丢图）。文本 input 很小，保留。
  function savePool() {
    try { localStorage.setItem(KEY_POOL, JSON.stringify(state.pool)); return true; }
    catch (e) { /* 多半是配额超了 */ }
    try {
      const lean = state.pool.map(it => {
        if (it.input && it.input.image) { const c = Object.assign({}, it); c.input = null; return c; }
        return it;
      });
      localStorage.setItem(KEY_POOL, JSON.stringify(lean));
      state.pool.forEach(it => { if (it.input && it.input.image) it.input = null; });
      return true;
    } catch (e2) { return false; }
  }
  function addPoolItem(item) { state.pool.push(item); savePool(); }
  function removePoolItem(id) { state.pool = state.pool.filter(x => x.id !== id); savePool(); }

  // ---- 河币 ----
  function getCoins(def) { return state.coins == null ? def : state.coins; }
  function setCoins(n) { state.coins = n; write(KEY_COINS, n); }

  window.LJG_STORE = {
    now, getPool, getPoolItem, addPoolItem, removePoolItem, savePool, getCoins, setCoins,
  };
})();
