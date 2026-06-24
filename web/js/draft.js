/* ============================================================
   冷静购 · 草稿 & 待办动作（sessionStorage，2h TTL，剥图，绝不写 Supabase）
   - 报告草稿 ljg.draft：未登录期间留住「商品/问卷/答案/报告」，刷新可恢复、登录后用于写库。
   - 待办动作 ljg.pending：被登录拦截的那次保存动作；仅在用户选「验证码登录并保存」时写，
     登录后幂等执行、云端确认成功后才清（失败保留待重试）。
   注意：sessionStorage 是「单标签页」的——邮件链接若开新标签不保证恢复，自动续跑只靠 in-page 验证码。
   ============================================================ */
(function () {
  const KEY_DRAFT = 'ljg.draft';
  const KEY_PENDING = 'ljg.pending';
  const KEY_REWARD = 'ljg.reward';   // 已确认的 let_go「待领奖励」标记（防重复发币，刷新最多展示一次）
  const TTL_MS = 2 * 3600 * 1000;   // 2 小时

  function now() { return (window.LJG_STORE && LJG_STORE.now) ? LJG_STORE.now() : Date.now(); }

  // 深拷贝并剥掉截图 base64（input.image / item.input.image），隐私 + 省空间
  function stripImage(data) {
    let d;
    try { d = JSON.parse(JSON.stringify(data == null ? null : data)); } catch (e) { d = null; }
    if (d && typeof d === 'object') {
      if (d.input && d.input.image) d.input = d.input.text ? { text: d.input.text } : null;
      if (d.item && d.item.input && d.item.input.image) d.item.input = d.item.input.text ? { text: d.item.input.text } : null;
    }
    return d;
  }
  function put(key, data) {
    try { sessionStorage.setItem(key, JSON.stringify({ savedAt: now(), data: stripImage(data) })); } catch (e) { /* 隐私模式/超额，忽略 */ }
  }
  function del(key) { try { sessionStorage.removeItem(key); } catch (e) { /* ignore */ } }
  function get(key) {
    let raw = null;
    try { raw = sessionStorage.getItem(key); } catch (e) { return null; }
    if (!raw) return null;
    let obj = null;
    try { obj = JSON.parse(raw); } catch (e) { obj = null; }
    if (!obj || typeof obj.savedAt !== 'number' || (now() - obj.savedAt) > TTL_MS) { del(key); return null; }
    return obj.data;
  }

  window.LJG_DRAFT = {
    saveDraft: d => put(KEY_DRAFT, d),
    loadDraft: () => get(KEY_DRAFT),
    clearDraft: () => del(KEY_DRAFT),
    savePending: d => put(KEY_PENDING, d),
    loadPending: () => get(KEY_PENDING),
    clearPending: () => del(KEY_PENDING),
    saveReward: d => put(KEY_REWARD, d),
    loadReward: () => get(KEY_REWARD),
    clearReward: () => del(KEY_REWARD),
  };
})();
