/* ============================================================
   冷静购 · 登录态（Supabase Auth · 统一邮箱 OTP，无匿名账号）
   - 不再自动匿名登录：未登录就是未登录。匿名残留一律登出当未登录。
   - 统一 OTP：signInWithEmail 发码 → verifyEmailOtp 校验；新邮箱自动注册、老邮箱直接登录。
   - 同步态缓存 _user（匿名视为 null），供 main 在点击动作时即时判断 isLoggedIn()。
   依赖：window.supabase（CDN UMD）、window.LJG_CONFIG（config.js）。
   ============================================================ */
(function () {
  const CFG = window.LJG_CONFIG || {};
  let _client = null;
  let _user = null;          // 当前「正式」用户缓存（匿名 → null）
  const _subs = [];

  function notify() { _subs.forEach(cb => { try { cb(_user); } catch (e) { /* ignore */ } }); }
  function setUser(u) {
    const norm = (u && !u.is_anonymous) ? u : null;   // 匿名一律当未登录
    const changed = ((_user && _user.id) || null) !== ((norm && norm.id) || null);
    _user = norm;
    if (changed) notify();
  }
  // 仅「明确的 token 失效」才登出；网络失败 / 5xx / 未知一律不登出（避免断网误登出正式用户）
  function isAuthRejection(err) {
    if (!err) return false;
    const s = err.status;
    if (s === 401 || s === 403) return true;
    const m = String((err && (err.message || err.code)) || '').toLowerCase();
    return /invalid (jwt|token|claim)|jwt expired|bad_jwt|user not found|user_not_found|session_not_found|forbidden/.test(m);
  }

  function client() {
    if (_client) return _client;
    if (!window.supabase || !window.supabase.createClient) { console.warn('[LJG] supabase-js 未加载，离线模式'); return null; }
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) { console.warn('[LJG] 未配置 SUPABASE_URL/ANON_KEY，离线模式'); return null; }
    _client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    _client.auth.onAuthStateChange((_evt, session) => { setUser(session ? session.user : null); });   // 含链接登录回跳
    return _client;
  }

  // 残留会话清理 + 断网保活：先读本地 session（不联网）。正式用户网络失败保留登录态；仅匿名 / 明确失效才登出。
  async function refreshUser() {
    const c = client(); if (!c) { setUser(null); return null; }
    let session = null;
    try { const { data } = await c.auth.getSession(); session = data && data.session; } catch (e) { session = null; }
    if (!session || !session.user) { setUser(null); return null; }                         // 本就未登录
    if (session.user.is_anonymous) { try { await c.auth.signOut({ scope: 'local' }); } catch (e) { /* ignore */ } setUser(null); return null; }
    setUser(session.user);                                                                  // 正式用户：先保住登录态（断网也保留）
    try {
      const { data, error } = await c.auth.getUser();                                       // 后台校验
      if (error) { if (isAuthRejection(error)) { try { await c.auth.signOut({ scope: 'local' }); } catch (e2) { /* ignore */ } setUser(null); } }   // 仅明确失效才登出
      else if (data && data.user) { if (data.user.is_anonymous) { try { await c.auth.signOut({ scope: 'local' }); } catch (e2) { /* ignore */ } setUser(null); } else setUser(data.user); }
    } catch (e) { /* 网络异常 → 保留本地登录态 */ }
    return _user;
  }

  // 同步态
  function isLoggedIn() { return !!_user; }
  function currentUser() { return _user; }
  function currentUserId() { return _user ? _user.id : null; }

  // 统一邮箱 OTP（shouldCreateUser 默认 true：新邮箱自动注册）
  async function signInWithEmail(email) { const c = client(); if (!c) throw new Error('无 Supabase 客户端'); return c.auth.signInWithOtp({ email }); }
  async function verifyEmailOtp(email, token) { const c = client(); if (!c) throw new Error('无 Supabase 客户端'); return c.auth.verifyOtp({ email, token, type: 'email' }); }
  async function signOut() { const c = client(); if (c) { try { await c.auth.signOut(); } catch (e) { /* ignore */ } } setUser(null); }
  async function getAccessToken() { const c = client(); if (!c) return null; try { const { data } = await c.auth.getSession(); return (data && data.session) ? data.session.access_token : null; } catch (e) { return null; } }

  function onChange(cb) { if (typeof cb === 'function') _subs.push(cb); }

  window.LJG_AUTH = {
    sb: client, refreshUser, isLoggedIn, currentUser, currentUserId,
    signInWithEmail, verifyEmailOtp, signOut, getAccessToken, onChange,
  };
})();
