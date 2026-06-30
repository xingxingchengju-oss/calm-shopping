/* ============================================================
   冷静购 · 登录态（Supabase Auth · 邮箱验证码注册 + 双方式登录）
   - 不再自动匿名登录：未登录就是未登录。匿名残留一律登出当未登录。
   - 邮箱验证码入口兼容首次注册与已有账号登录；已有用户也可用密码登录。
   - 同步态缓存 _user（匿名视为 null），供 main 在点击动作时即时判断 isLoggedIn()。
   依赖：window.supabase（CDN UMD）、window.LJG_CONFIG（config.js）。
   ============================================================ */
(function () {
  const CFG = window.LJG_CONFIG || {};
  let _client = null;
  let _user = null;          // 当前「正式」用户缓存（匿名 → null）
  const _subs = [];
  const _profileSubs = [];
  const _authEventSubs = [];
  let _lastRecoverySession = null;
  let _profileMutationSeq = 0;
  let _optimisticProfile = null;
  const AVATAR_IDS = new Set(['capybara', 'otter', 'rabbit', 'bear', 'fox', 'duck']);

  function notify() { _subs.forEach(cb => { try { cb(_user); } catch (e) { /* ignore */ } }); }
  function notifyProfile() { _profileSubs.forEach(cb => { try { cb(_user); } catch (e) { /* ignore */ } }); }
  function notifyAuthEvent(event, session) {
    if (event === 'PASSWORD_RECOVERY') _lastRecoverySession = session || null;
    _authEventSubs.forEach(cb => { try { cb(event, session || null); } catch (e) { /* ignore */ } });
  }
  function profileSignature(u) {
    const m = (u && u.user_metadata) || {};
    return [m.display_name || '', m.avatar_id || '', m.password_enabled ? '1' : '0'].join('|');
  }
  function setUser(u) {
    let norm = (u && !u.is_anonymous) ? u : null;   // 匿名一律当未登录
    const previousId = (_user && _user.id) || null;
    const nextId = (norm && norm.id) || null;
    const changed = previousId !== nextId;
    if (changed) {
      _optimisticProfile = null;
      _profileMutationSeq++;                       // 登录/登出/切号使在途资料请求失效
    } else if (norm && _optimisticProfile) {
      norm = Object.assign({}, norm, {
        user_metadata: Object.assign({}, norm.user_metadata || {}, _optimisticProfile),
      });                                           // token 刷新不能覆盖正在同步的乐观资料
    }
    const profileChanged = !changed && profileSignature(_user) !== profileSignature(norm);
    _user = norm;
    if (changed) notify();
    else if (profileChanged) notifyProfile();
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
    _client.auth.onAuthStateChange((evt, session) => {
      setUser(session ? session.user : null);
      notifyAuthEvent(evt, session);                 // PASSWORD_RECOVERY 等轻量事件交给账号 UI 处理
    });
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

  // 邮箱验证码：允许首次使用时自动创建账号，已注册邮箱则直接登录。
  async function sendEmailOtp(email, shouldCreateUser) {
    const c = client(); if (!c) throw new Error('无 Supabase 客户端');
    return c.auth.signInWithOtp({
      email: email,
      options: { shouldCreateUser: shouldCreateUser !== false },
    });
  }
  async function signInWithEmail(email) { return sendEmailOtp(email, true); } // 兼容旧调用
  async function verifyEmailOtp(email, token) { const c = client(); if (!c) throw new Error('无 Supabase 客户端'); return c.auth.verifyOtp({ email, token, type: 'email' }); }
  async function signInWithPassword(email, password) {
    const c = client(); if (!c) throw new Error('无 Supabase 客户端');
    const result = await c.auth.signInWithPassword({ email: email, password: password });
    if (!result.error && result.data && result.data.user) {
      const user = result.data.user;
      const flagged = Object.assign({}, user, { user_metadata: Object.assign({}, user.user_metadata || {}, { password_enabled: true }) });
      setUser(flagged);                              // 立即让设置页识别为“已设置密码”
      c.auth.updateUser({ data: { password_enabled: true } }).catch(() => {}); // 标记仅服务 UX，不阻塞登录
    }
    return result;
  }
  function hasPassword() { return !!(_user && _user.user_metadata && _user.user_metadata.password_enabled); }
  async function setPassword(newPassword, currentPassword) {
    const c = client(); if (!c || !_user) throw new Error('请先登录');
    const attrs = { password: newPassword, data: { password_enabled: true } };
    if (currentPassword) attrs.currentPassword = currentPassword;
    const { data, error } = await c.auth.updateUser(attrs);
    if (error) throw error;
    if (data && data.user) setUser(data.user);
    return data && data.user;
  }
  function recoveryRedirectUrl() {
    if (CFG.AUTH_REDIRECT_URL) return CFG.AUTH_REDIRECT_URL;
    if (!window.location) return undefined;
    return window.location.origin + window.location.pathname + '?auth=recovery';
  }
  async function sendPasswordReset(email) {
    const c = client(); if (!c) throw new Error('无 Supabase 客户端');
    return c.auth.resetPasswordForEmail(email, { redirectTo: recoveryRedirectUrl() });
  }
  async function finishPasswordRecovery(newPassword) { return setPassword(newPassword, ''); }
  async function updateProfile(profile) {
    const c = client();
    if (!c || !_user) throw new Error('请先登录');
    const name = String((profile && profile.display_name) || '').trim();
    const avatarId = String((profile && profile.avatar_id) || '');
    if (!name || name.length > 16) throw new Error('用户名需要是 1–16 个字符');
    if (!AVATAR_IDS.has(avatarId)) throw new Error('请选择有效的动物头像');

    const mutationSeq = ++_profileMutationSeq;
    const previousUser = _user;
    const userId = previousUser.id;
    _optimisticProfile = { display_name: name, avatar_id: avatarId };
    _user = Object.assign({}, previousUser, {
      user_metadata: Object.assign({}, previousUser.user_metadata || {}, _optimisticProfile),
    });
    notifyProfile();         // 乐观更新：调用后同步刷新页面，不等待网络往返

    try {
      const { data, error } = await c.auth.updateUser({ data: { display_name: name, avatar_id: avatarId } });
      if (error) throw error;
      if (!data || !data.user) throw new Error('资料保存失败，请稍后再试');
      if (mutationSeq === _profileMutationSeq && _user && _user.id === userId) {
        _optimisticProfile = null;
        const changed = profileSignature(_user) !== profileSignature(data.user);
        _user = data.user;   // 用服务端最终用户对象补齐缓存，但不触发全局 onChange
        if (changed) notifyProfile();
      }
      return data.user;
    } catch (error) {
      // 只有最新一次修改失败时才回滚；旧请求失败不能覆盖用户随后做的新修改。
      if (mutationSeq === _profileMutationSeq && _user && _user.id === userId) {
        _optimisticProfile = null;
        _user = previousUser;
        notifyProfile();
      }
      throw error;
    }
  }
  async function signOut() { const c = client(); if (c) { try { await c.auth.signOut(); } catch (e) { /* ignore */ } } setUser(null); }
  async function getAccessToken() { const c = client(); if (!c) return null; try { const { data } = await c.auth.getSession(); return (data && data.session) ? data.session.access_token : null; } catch (e) { return null; } }

  function onChange(cb) { if (typeof cb === 'function') _subs.push(cb); }
  function onProfileChange(cb) { if (typeof cb === 'function') _profileSubs.push(cb); }
  function onAuthEvent(cb) {
    if (typeof cb !== 'function') return;
    _authEventSubs.push(cb);
    if (_lastRecoverySession) {
      setTimeout(() => { try { cb('PASSWORD_RECOVERY', _lastRecoverySession); } catch (e) { /* ignore */ } }, 0);
    }
  }

  window.LJG_AUTH = {
    sb: client, refreshUser, isLoggedIn, currentUser, currentUserId, hasPassword,
    sendEmailOtp, signInWithEmail, verifyEmailOtp, signInWithPassword,
    setPassword, sendPasswordReset, finishPasswordRecovery,
    updateProfile, signOut, getAccessToken, onChange, onProfileChange, onAuthEvent,
  };
})();
