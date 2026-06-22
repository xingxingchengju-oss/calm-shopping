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
  function addPoolItem(item) { state.pool.push(item); write(KEY_POOL, state.pool); }
  function removePoolItem(id) { state.pool = state.pool.filter(x => x.id !== id); write(KEY_POOL, state.pool); }

  // ---- 河币 ----
  function getCoins(def) { return state.coins == null ? def : state.coins; }
  function setCoins(n) { state.coins = n; write(KEY_COINS, n); }

  window.LJG_STORE = {
    now, getPool, getPoolItem, addPoolItem, removePoolItem, getCoins, setCoins,
  };
})();
