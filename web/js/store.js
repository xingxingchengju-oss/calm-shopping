/* ============================================================
   冷静购 · 持久化（Supabase + 按 user_id 命名空间 + 待同步队列）
   原则：**只有正式邮箱用户登录后**才读写云端；未登录 = disabled（getPool→[]、getCoins→def、写操作 no-op）。
     - 缓存/队列键全部带 uid：ljg.pool.<uid> / ljg.coins.<uid> / ljg.syncq.<uid> → 切号不串数据。
     - 写操作先改本地（即时），再入队 + 异步 flush；成功出队、失败留队重试（带 op_id 防竞态）。
     - init(uid) 只在「读云端成功」后才覆盖本地镜像；clear() 登出/切号时重置内存（不删 uid 缓存，便于再登录）。
     - recordAndConfirm(item,status)：写入并等待云端确认（带超时；超时/断网→保留队列+pending，返回 false 不误报成功）。
   旧全局键 ljg.pool/coins/syncq/migrated 一次性清掉，绝不迁移进邮箱账号。
   ============================================================ */
(function () {
  // 一次性清掉旧全局键（含匿名/游客残留），绝不迁移
  ['ljg.pool', 'ljg.coins', 'ljg.syncq', 'ljg.migrated'].forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });

  function now() { return (typeof window.__LJG_NOW === 'number') ? window.__LJG_NOW : Date.now(); }
  function read(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

  const state = { pool: [], coins: null, userId: null, remote: false, syncStatus: 'logged_out' };

  function sb() { return (window.LJG_AUTH && window.LJG_AUTH.sb) ? window.LJG_AUTH.sb() : null; }
  function poolKey() { return 'ljg.pool.' + state.userId; }
  function coinsKey() { return 'ljg.coins.' + state.userId; }
  function queueKey() { return 'ljg.syncq.' + state.userId; }

  function setStatus(s) {
    const pending = state.userId ? loadQueue().length : 0;
    const changed = (s !== state.syncStatus);
    state.syncStatus = s;
    if (changed) {
      const label = { synced: '云端已同步', local: '本地模式', pending: '待同步(' + pending + ')', logged_out: '未登录·不保存' }[s] || s;
      console.info('[LJG] 同步状态 →', s, '·', label);
      try { window.dispatchEvent(new CustomEvent('ljg:sync', { detail: { status: s, pending: pending } })); } catch (e) { /* ignore */ }
    }
  }

  function mirrorPool() {
    if (!state.userId) return false;
    try { localStorage.setItem(poolKey(), JSON.stringify(state.pool)); return true; }
    catch (e) { /* 配额超了 */ }
    try {
      const lean = state.pool.map(it => { if (it.input && it.input.image) { const c = Object.assign({}, it); c.input = it.input.text ? { text: it.input.text } : null; return c; } return it; });
      localStorage.setItem(poolKey(), JSON.stringify(lean));
      state.pool.forEach(it => { if (it.input && it.input.image) it.input = it.input.text ? { text: it.input.text } : null; });
      return true;
    } catch (e2) { return false; }
  }

  /* 同步读：UI 直接用内存缓存（未登录为空） */
  function getPool() { return state.pool; }
  function getPoolItem(id) { return state.pool.find(x => x.id === id); }
  function getCoins(def) { return state.coins == null ? def : state.coins; }
  async function fetchCompanionOverview() {
    const uid = state.userId || ((window.LJG_AUTH && window.LJG_AUTH.currentUserId) ? window.LJG_AUTH.currentUserId() : null);
    const c = sb();
    const empty = { totalDecisions: null, letGoCount: null, recentDecisions: null };
    if (!uid || !c) return empty;

    const results = await Promise.allSettled([
      c.from('decisions').select('client_id', { count: 'exact', head: true }).eq('user_id', uid),
      c.from('decisions').select('client_id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'let_go'),
      c.from('decisions')
        .select('client_id,title,status,created_at,resolved_at,price')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    function countResult(result, label) {
      if (result.status === 'rejected' || !result.value || result.value.error) {
        const err = result.status === 'rejected' ? result.reason : result.value.error;
        console.warn('[LJG] ' + label + '查询失败', (err && err.message) || err);
        return null;
      }
      return typeof result.value.count === 'number' ? result.value.count : 0;
    }
    function rowsResult(result) {
      if (result.status === 'rejected' || !result.value || result.value.error) {
        const err = result.status === 'rejected' ? result.reason : result.value.error;
        console.warn('[LJG] 最近陪伴记录查询失败', (err && err.message) || err);
        return null;
      }
      return Array.isArray(result.value.data) ? result.value.data : [];
    }

    return {
      totalDecisions: countResult(results[0], '陪伴总数'),
      letGoCount: countResult(results[1], '已放手数量'),
      recentDecisions: rowsResult(results[2]),
    };
  }

  function rowToItem(r) {
    const rep = r.report || {};
    return {
      id: r.client_id, title: r.title, price: (r.price == null) ? null : Number(r.price),
      product: r.product || {}, report: rep, answers: r.answers || [], review: r.review || {}, pricing: r.pricing || null,
      review_digest: rep.review_digest || '', score_summary: r.score_summary || rep.score_summary || {},
      session_id: r.backend_session_id || null, input: r.input || null,
      floatedAt: r.floated_at ? Date.parse(r.floated_at) : (r.created_at ? Date.parse(r.created_at) : now()),
      createdAt: r.created_at ? Date.parse(r.created_at) : now(), status: r.status,
    };
  }
  function itemToRow(it, status) {
    const rep = it.report || {}, p = it.product || {};
    const row = {
      user_id: state.userId, client_id: it.id, backend_session_id: it.session_id || null,
      title: it.title || null, platform: p.platform || null,
      price: (typeof it.price === 'number' && isFinite(it.price)) ? it.price : null,
      lean: rep.lean || null, confidence: rep.confidence || null, status: status,
      product: p || null, review: it.review || null, pricing: it.pricing || null, answers: it.answers || null,
      report: rep || null, score_summary: it.score_summary || rep.score_summary || null,
      input: (it.input && it.input.text) ? { text: it.input.text } : null,  // 截图 base64 不入库
      floated_at: it.floatedAt ? new Date(it.floatedAt).toISOString() : null,
      resolved_at: (status === 'let_go' || status === 'bought') ? new Date(now()).toISOString() : null,
    };
    if (it.createdAt) row.created_at = new Date(it.createdAt).toISOString();
    return row;
  }

  /* ---------- 待同步队列（按 uid 命名空间，带 op_id） ---------- */
  function loadQueue() { return state.userId ? read(queueKey(), []) : []; }
  function saveQueue(q) { if (state.userId) write(queueKey(), q); }
  let _opSeq = 0;
  function opId() { return 'op_' + now().toString(36) + '_' + (++_opSeq) + '_' + Math.random().toString(36).slice(2, 6); }
  function enqueue(entry) {
    if (!state.remote) return;
    entry.op_id = opId();
    let q = loadQueue();
    if (entry.kind === 'coins') q = q.filter(e => e.kind !== 'coins');
    else q = q.filter(e => e.client_id !== entry.client_id);
    q.push(entry); saveQueue(q);
  }
  async function applyOp(c, e) {
    if (e.kind === 'decision') { const row = Object.assign({}, e.row, { user_id: state.userId }); const { error } = await c.from('decisions').upsert(row, { onConflict: 'user_id,client_id' }); return error; }
    if (e.kind === 'delete') { const { error } = await c.from('decisions').delete().eq('user_id', state.userId).eq('client_id', e.client_id); return error; }
    if (e.kind === 'coins') {
      const { data, error } = await c.from('user_stats').update({ coins: e.n }).eq('user_id', state.userId).select('user_id');
      if (error) return error;
      if (!data || data.length === 0) return { message: 'user_stats 行不存在(0 行)，留待重试' };   // 修 I4：0 行不再算成功
      return null;
    }
    return null;
  }
  let flushing = false;
  async function flushQueue() {
    const c = sb();
    if (!state.remote || !c) { setStatus(loadQueue().length ? 'pending' : (state.userId ? 'local' : 'logged_out')); return; }
    if (flushing) return; flushing = true;
    try {
      while (true) {
        const q = loadQueue();
        if (!q.length) { setStatus('synced'); break; }
        const e = q[0];
        let err = null;
        try { err = await applyOp(c, e); } catch (ex) { err = ex; }
        if (err) { console.warn('[LJG] 同步失败，留待重试 ·', e.kind, (err && err.message) || err); setStatus('pending'); break; }
        const q2 = loadQueue(); const i = q2.findIndex(x => x.op_id === e.op_id);   // 只删本次上传的那一版（防竞态）
        if (i >= 0) { q2.splice(i, 1); saveQueue(q2); }
      }
    } finally { flushing = false; }
  }

  /* ---------- 写操作（未登录 no-op） ---------- */
  function pushDecision(it, status) { if (!state.remote || !it || !it.id) return; enqueue({ kind: 'decision', client_id: it.id, row: itemToRow(it, status) }); flushQueue(); }
  function pushDelete(id) { if (!state.remote) return; enqueue({ kind: 'delete', client_id: id }); flushQueue(); }
  function pushCoins(n) { if (!state.remote) return; enqueue({ kind: 'coins', n: n }); flushQueue(); }

  function addPoolItem(item) { if (!state.remote) return; state.pool.push(item); mirrorPool(); pushDecision(item, 'floating'); }
  function removePoolItem(id) { if (!state.remote) return; state.pool = state.pool.filter(x => x.id !== id); mirrorPool(); pushDelete(id); }
  function resolvePoolItem(id, status) { if (!state.remote) return; const it = getPoolItem(id); state.pool = state.pool.filter(x => x.id !== id); mirrorPool(); if (it) pushDecision(it, status); }
  function recordDecision(item, status) { if (!state.remote) return; pushDecision(item, status); }
  function setCoins(n) { if (!state.remote) return; state.coins = n; write(coinsKey(), n); pushCoins(n); }

  // 写入并确认云端成功（超时/断网→保留队列+pending，返回 false 不误报成功）
  async function recordAndConfirm(item, status, timeoutMs) {
    if (!state.remote || !item || !item.id) return false;
    if (status === 'floating' && !getPoolItem(item.id)) { state.pool.push(item); mirrorPool(); }
    enqueue({ kind: 'decision', client_id: item.id, row: itemToRow(item, status) });
    flushQueue();
    return confirmClientId(item.id, timeoutMs || 10000);
  }
  function confirmClientId(clientId, timeoutMs) {
    const start = Date.now();
    return new Promise(resolve => {
      const tick = () => {
        const stillPending = loadQueue().some(e => e.client_id === clientId && (e.kind === 'decision' || e.kind === 'delete'));
        if (!stillPending) { resolve(true); return; }                 // 出队 = 云端确认
        if (Date.now() - start > timeoutMs) { resolve(false); return; } // 超时：保留，待同步
        flushQueue(); setTimeout(tick, 300);
      };
      setTimeout(tick, 200);
    });
  }

  /* ---------- init / clear / resync ---------- */
  let initing = false;
  async function init(uid) {
    if (!uid) { clear(); return false; }
    if (initing) return state.remote; initing = true;
    try {
      const c = sb(); if (!c) { clear(); return false; }
      state.userId = uid; state.remote = true;
      state.pool = read(poolKey(), []);                       // 本命名空间本地缓存先就位（同步 getter 立即可用）
      const lc = read(coinsKey(), null); state.coins = (lc == null ? 0 : lc);

      let decOk = false, statsOk = false, cloudPool = [], cloudCoins = null;
      try {
        const { data, error } = await c.from('decisions').select('*').eq('user_id', uid).in('status', ['floating', 'riverbed']).order('created_at', { ascending: true });
        if (error) throw error; cloudPool = (data || []).map(rowToItem); decOk = true;
      } catch (e) { console.warn('[LJG] 拉取 decisions 失败，保留本地', (e && e.message) || e); }
      try {
        const { data, error } = await c.from('user_stats').select('coins').eq('user_id', uid).maybeSingle();
        if (error) throw error; if (data && typeof data.coins === 'number') cloudCoins = data.coins; statsOk = true;
      } catch (e) { console.warn('[LJG] 拉取 user_stats 失败，保留本地', (e && e.message) || e); }

      if (decOk) {   // 仅读成功才覆盖本地；合并仍待同步的本地新项 − 待删 − 待了结
        const cloudIds = new Set(cloudPool.map(i => i.id));
        const pFloat = new Set(), pResolved = new Set(), pDel = new Set();
        loadQueue().forEach(e => {
          if (e.kind === 'delete') pDel.add(e.client_id);
          else if (e.kind === 'decision' && e.row) { (e.row.status === 'let_go' || e.row.status === 'bought') ? pResolved.add(e.client_id) : pFloat.add(e.client_id); }
        });
        const extras = state.pool.filter(it => !cloudIds.has(it.id) && pFloat.has(it.id));
        state.pool = cloudPool.concat(extras).filter(it => !pDel.has(it.id) && !pResolved.has(it.id));
        mirrorPool();
      }
      if (statsOk && cloudCoins != null && !loadQueue().some(e => e.kind === 'coins')) { state.coins = cloudCoins; write(coinsKey(), cloudCoins); }

      await flushQueue();
      return true;
    } finally { initing = false; }
  }
  function clear() { state.pool = []; state.coins = null; state.userId = null; state.remote = false; setStatus('logged_out'); }
  async function resync() {
    if (state.remote && state.userId) { await flushQueue(); return true; }
    const uid = (window.LJG_AUTH && window.LJG_AUTH.currentUserId) ? window.LJG_AUTH.currentUserId() : null;
    if (uid) return init(uid);
    return false;   // 未登录：绝不匿名注册
  }
  try { window.addEventListener('online', function () { resync(); }); } catch (e) { /* ignore */ }

  window.LJG_STORE = {
    now, init, clear, resync,
    getPool, getPoolItem, getCoins, fetchCompanionOverview,
    addPoolItem, removePoolItem, resolvePoolItem, recordDecision, recordAndConfirm, setCoins,
    confirm: function (clientId, timeoutMs) { return confirmClientId(clientId, timeoutMs || 10000); },
    syncStatus: function () { return state.syncStatus; }, savePool: mirrorPool,
  };
})();
