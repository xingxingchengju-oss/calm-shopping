/* ============================================================
   冷静购 · 账号
   - 新用户：邮箱 + 验证码注册。
   - 邮箱验证码兼容首次注册和已有账号登录；已有用户也可使用密码。
   - 已登录用户：设置 / 验证原密码后更改密码；忘记密码走邮件恢复。
   - gateSave({pending,onSkip}) 保留未登录保存拦截。
   ============================================================ */
(function () {
  const A = window.LJG_AUTH, D = window.LJG_DRAFT;
  const $ = id => document.getElementById(id);
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const STRONG_PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;

  const acctTitle = $('acctTitle'), acctSub = $('acctSub'), acctSync = $('acctSync'), acctBtn = $('acctBtn');
  const settingsModal = $('settingsModal'), settingsOpen = $('meSettings'), settingsClose = $('settingsClose'),
    settingsEmail = $('settingsEmail'), settingsSync = $('settingsSync'), settingsAccountBtn = $('settingsAccountBtn'),
    passwordSettingsBtn = $('passwordSettingsBtn'), passwordSettingsStatus = $('passwordSettingsStatus');
  const logoutModal = $('logoutModal'), logoutCancel = $('logoutCancel'), logoutConfirm = $('logoutConfirm');

  const modal = $('loginModal'), titleEl = $('loginTitle'), descEl = $('loginDesc'), authTabs = $('authTabs'),
    loginTab = $('authLoginTab'), registerTab = $('authRegisterTab'), authMethods = $('authMethods'),
    passwordMethod = $('authPasswordMethod'), otpMethod = $('authOtpMethod'), stepEmail = $('loginStepEmail'),
    stepPassword = $('loginStepPassword'), stepCode = $('loginStepCode'), emailInp = $('loginEmail'),
    passwordInp = $('loginPassword'), codeInp = $('loginCode'), authBack = $('authBack'), authResend = $('authResend'),
    authForgot = $('authForgot'), msg = $('loginMsg'), skipBtn = $('loginSkip'),
    primaryBtn = $('loginPrimary'), closeBtn = $('loginClose');
  if (!modal) return;

  const passwordModal = $('passwordModal'), passwordModalTitle = $('passwordModalTitle'),
    passwordModalDesc = $('passwordModalDesc'), currentPasswordWrap = $('currentPasswordWrap'),
    currentPasswordInput = $('currentPasswordInput'), newPasswordInput = $('newPasswordInput'),
    confirmPasswordInput = $('confirmPasswordInput'), passwordForgotCurrent = $('passwordForgotCurrent'),
    passwordMsg = $('passwordMsg'), passwordCancel = $('passwordCancel'), passwordSave = $('passwordSave');
  const recoveryModal = $('recoveryModal'), recoveryPassword = $('recoveryPassword'),
    recoveryConfirm = $('recoveryConfirm'), recoveryMsg = $('recoveryMsg'),
    recoverySave = $('recoverySave'), recoveryClose = $('recoveryClose');

  let gateMode = false;
  let gateCtx = null;
  let authMode = 'login';       // login | register | forgot
  let loginMethod = 'password'; // password | otp
  let authStep = 'credentials'; // credentials | code
  let verifiedEmail = '';
  let resendTimer = null;
  let resendSeconds = 0;

  function show(el, on) { if (el) el.classList.toggle('lg-hide', !on); }
  function setMsg(t, kind) {
    if (!msg) return;
    msg.textContent = t || '';
    msg.className = 'bind-msg' + (kind ? ' ' + kind : '');
  }
  function setPasswordMsg(t, kind) {
    if (!passwordMsg) return;
    passwordMsg.textContent = t || '';
    passwordMsg.className = 'bind-msg' + (kind ? ' ' + kind : '');
  }
  function setRecoveryMsg(t, kind) {
    if (!recoveryMsg) return;
    recoveryMsg.textContent = t || '';
    recoveryMsg.className = 'bind-msg' + (kind ? ' ' + kind : '');
  }
  function setBusy(button, busy, busyText) {
    if (!button) return;
    if (busy) {
      button.dataset.normalText = button.textContent;
      button.disabled = true;
      if (busyText) button.textContent = busyText;
    } else {
      button.disabled = false;
      if (button.dataset.normalText) button.textContent = button.dataset.normalText;
      delete button.dataset.normalText;
    }
  }
  function friendlyError(error, fallback) {
    const raw = String((error && (error.message || error.code)) || '').toLowerCase();
    if (/invalid login credentials|invalid_credentials|email or password/.test(raw)) return '邮箱或密码不正确。也可以改用验证码登录。';
    if (/otp.*expired|token.*expired|invalid.*otp|otp.*invalid/.test(raw)) return '验证码不正确或已过期，请重新发送。';
    if (/user not found|user_not_found|signups not allowed|no user/.test(raw)) return '这个邮箱还没有账号，请先注册。';
    if (/current.password|old.password|reauthentication|nonce/.test(raw)) return '当前密码不正确，请重新输入。';
    if (/same password|different from the old/.test(raw)) return '新密码需要和当前密码不同。';
    if (/rate|too many|over_email_send_rate_limit/.test(raw)) return '操作有些频繁，请稍等一会儿再试。';
    if (/network|fetch|failed to fetch|offline/.test(raw)) return '网络似乎断开了，请检查后重试。';
    return fallback || '操作没有成功，请稍后再试。';
  }
  function validateEmail() {
    const value = String((emailInp && emailInp.value) || '').trim();
    if (!EMAIL_RE.test(value)) {
      setMsg('请输入正确的邮箱地址。', 'err');
      return '';
    }
    return value;
  }
  function validateNewPassword(value, confirmValue, setMessage) {
    if (!STRONG_PASSWORD_RE.test(value)) {
      setMessage('密码需为 8–72 位，并同时包含字母和数字。', 'err');
      return false;
    }
    if (value !== confirmValue) {
      setMessage('两次输入的新密码不一致。', 'err');
      return false;
    }
    return true;
  }
  function preparePending() {
    if (gateMode && gateCtx && D && D.savePending) D.savePending(gateCtx.pending);
  }

  function stopResendTimer() {
    if (resendTimer) clearInterval(resendTimer);
    resendTimer = null;
    resendSeconds = 0;
    if (authResend) { authResend.disabled = false; authResend.textContent = '重新发送'; }
  }
  function startResendTimer() {
    stopResendTimer();
    resendSeconds = 45;
    if (authResend) { authResend.disabled = true; authResend.textContent = '重新发送（45s）'; }
    resendTimer = setInterval(() => {
      resendSeconds -= 1;
      if (resendSeconds <= 0) { stopResendTimer(); return; }
      if (authResend) authResend.textContent = '重新发送（' + resendSeconds + 's）';
    }, 1000);
  }

  function renderAuth() {
    const inCode = authStep === 'code';
    const forgot = authMode === 'forgot';
    const register = authMode === 'register';
    if (titleEl) {
      titleEl.textContent = forgot ? '找回登录密码' : register ? '创建河湾账号' : (gateMode ? '登录后保存这次进度' : '欢迎回到河湾');
    }
    if (descEl) {
      descEl.textContent = forgot
        ? '我们会发送一封安全邮件，验证后即可设置新密码。'
        : register
          ? '新用户使用邮箱验证码注册，不需要先设置密码。'
          : '使用密码或邮箱验证码登录；邮箱首次使用会自动创建账号。';
    }
    show(authTabs, !forgot && !inCode);
    show(authMethods, authMode === 'login' && !inCode);
    show(stepEmail, !inCode);
    show(stepPassword, !inCode && authMode === 'login' && loginMethod === 'password');
    show(stepCode, inCode);
    show(authForgot, !inCode && authMode === 'login' && loginMethod === 'password');
    show(authBack, forgot || inCode);
    show(authResend, inCode);
    show(skipBtn, gateMode);

    if (loginTab) loginTab.classList.toggle('on', authMode === 'login');
    if (registerTab) registerTab.classList.toggle('on', authMode === 'register');
    if (passwordMethod) passwordMethod.classList.toggle('on', loginMethod === 'password');
    if (otpMethod) otpMethod.classList.toggle('on', loginMethod === 'otp');
    if (primaryBtn) {
      primaryBtn.textContent = forgot ? '发送重设邮件'
        : inCode ? (register ? '完成注册' : '登录')
          : register ? '发送注册验证码'
            : loginMethod === 'otp' ? '发送登录验证码' : '登录';
    }
  }
  function resetAuthInputs(clearEmail) {
    if (clearEmail && emailInp) emailInp.value = '';
    if (passwordInp) passwordInp.value = '';
    if (codeInp) codeInp.value = '';
    verifiedEmail = '';
  }
  function switchAuthMode(nextMode) {
    authMode = nextMode;
    authStep = 'credentials';
    stopResendTimer();
    resetAuthInputs(false);
    setMsg('');
    renderAuth();
    setTimeout(() => emailInp && emailInp.focus(), 40);
  }
  function switchLoginMethod(method) {
    loginMethod = method;
    authStep = 'credentials';
    if (passwordInp) passwordInp.value = '';
    setMsg('');
    renderAuth();
    setTimeout(() => (method === 'password' ? passwordInp : emailInp) && (method === 'password' ? passwordInp : emailInp).focus(), 40);
  }
  function open(mode, ctx) {
    gateMode = mode === 'gate';
    gateCtx = ctx || null;
    authMode = 'login';
    loginMethod = 'password';
    authStep = 'credentials';
    stopResendTimer();
    resetAuthInputs(true);
    setMsg('');
    renderAuth();
    modal.classList.add('show');
    setTimeout(() => emailInp && emailInp.focus(), 60);
  }
  function openForgot(prefill) {
    gateMode = false;
    gateCtx = null;
    authMode = 'forgot';
    authStep = 'credentials';
    stopResendTimer();
    resetAuthInputs(true);
    if (emailInp && prefill) emailInp.value = prefill;
    setMsg('');
    renderAuth();
    modal.classList.add('show');
    setTimeout(() => emailInp && emailInp.focus(), 60);
  }
  function close(clearPending) {
    stopResendTimer();
    modal.classList.remove('show');
    if (clearPending && D && D.clearPending) D.clearPending();
  }

  async function requestOtp(isResend) {
    const email = isResend ? verifiedEmail : validateEmail();
    if (!email) return;
    // “验证码登录”也允许首次邮箱自动注册，避免新用户误点登录后收不到邮件。
    const allowCreate = authMode === 'register' || loginMethod === 'otp';
    setBusy(isResend ? authResend : primaryBtn, true, isResend ? '发送中…' : '发送中…');
    setMsg('正在把验证码送到你的邮箱…');
    let error = null;
    try {
      const result = await A.sendEmailOtp(email, allowCreate);
      error = result && result.error;
    } catch (ex) { error = ex; }
    setBusy(isResend ? authResend : primaryBtn, false);
    if (error) {
      setMsg(friendlyError(error, '验证码发送失败，请稍后重试。'), 'err');
      return;
    }
    verifiedEmail = email;
    preparePending();
    authStep = 'code';
    if (!isResend && codeInp) codeInp.value = '';
    renderAuth();
    startResendTimer();
    setMsg('验证码已发送到 ' + email + '。', 'ok');
    setTimeout(() => codeInp && codeInp.focus(), 60);
  }

  async function submitAuth() {
    if (!A) { setMsg('云端暂时连不上，请稍后再试。', 'err'); return; }
    if (authMode === 'forgot') {
      const email = validateEmail();
      if (!email) return;
      setBusy(primaryBtn, true, '发送中…');
      setMsg('正在发送密码重设邮件…');
      let error = null;
      try {
        const result = await A.sendPasswordReset(email);
        error = result && result.error;
      } catch (ex) { error = ex; }
      setBusy(primaryBtn, false);
      if (error) { setMsg(friendlyError(error, '重设邮件发送失败，请稍后重试。'), 'err'); return; }
      setMsg('如果该邮箱已注册，重设邮件很快就会到达。请同时检查垃圾邮件。', 'ok');
      return;
    }
    if (authStep === 'code') {
      const code = String((codeInp && codeInp.value) || '').trim();
      if (!/^\d{4,8}$/.test(code)) { setMsg('请输入邮件中的数字验证码。', 'err'); return; }
      setBusy(primaryBtn, true, authMode === 'register' ? '注册中…' : '登录中…');
      let error = null;
      try {
        const result = await A.verifyEmailOtp(verifiedEmail, code);
        error = result && result.error;
      } catch (ex) { error = ex; }
      setBusy(primaryBtn, false);
      if (error) { setMsg(friendlyError(error, '验证码不正确或已过期，请重新发送。'), 'err'); return; }
      setMsg(authMode === 'register' ? '注册成功，欢迎来到河湾。' : '登录成功。', 'ok');
      close(false);
      return;
    }
    if (authMode === 'register' || loginMethod === 'otp') {
      await requestOtp(false);
      return;
    }

    const email = validateEmail();
    const password = String((passwordInp && passwordInp.value) || '');
    if (!email) return;
    if (!password) { setMsg('请输入登录密码。', 'err'); return; }
    preparePending();
    setBusy(primaryBtn, true, '登录中…');
    let error = null;
    try {
      const result = await A.signInWithPassword(email, password);
      error = result && result.error;
    } catch (ex) { error = ex; }
    setBusy(primaryBtn, false);
    if (error) { setMsg(friendlyError(error, '登录失败，请检查邮箱和密码。'), 'err'); return; }
    setMsg('登录成功。', 'ok');
    close(false);
  }

  if (primaryBtn) primaryBtn.addEventListener('click', submitAuth);
  if (loginTab) loginTab.addEventListener('click', () => switchAuthMode('login'));
  if (registerTab) registerTab.addEventListener('click', () => switchAuthMode('register'));
  if (passwordMethod) passwordMethod.addEventListener('click', () => switchLoginMethod('password'));
  if (otpMethod) otpMethod.addEventListener('click', () => switchLoginMethod('otp'));
  if (authForgot) authForgot.addEventListener('click', () => switchAuthMode('forgot'));
  if (authBack) authBack.addEventListener('click', () => {
    if (authStep === 'code') {
      authStep = 'credentials';
      stopResendTimer();
      setMsg('');
      renderAuth();
      return;
    }
    switchAuthMode('login');
  });
  if (authResend) authResend.addEventListener('click', () => { if (!authResend.disabled) requestOtp(true); });
  [emailInp, passwordInp, codeInp].forEach(input => {
    if (input) input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); submitAuth(); } });
  });
  if (skipBtn) skipBtn.addEventListener('click', () => {
    const callback = gateMode && gateCtx && gateCtx.onSkip;
    close(true);
    if (callback) callback();
  });
  if (closeBtn) closeBtn.addEventListener('click', () => close(true));
  modal.addEventListener('click', event => { if (event.target === modal) close(true); });

  function openSettings() {
    if (!settingsModal) return;
    refreshCard();
    settingsModal.classList.add('show');
    settingsModal.setAttribute('aria-hidden', 'false');
  }
  function closeSettings() {
    if (!settingsModal) return;
    settingsModal.classList.remove('show');
    settingsModal.setAttribute('aria-hidden', 'true');
  }
  function openLogoutConfirm() { if (logoutModal) logoutModal.classList.add('show'); }
  function closeLogoutConfirm() { if (logoutModal) logoutModal.classList.remove('show'); }

  function openPasswordSettings() {
    if (!A || !A.isLoggedIn || !A.isLoggedIn()) {
      closeSettings();
      open('plain');
      return;
    }
    const changing = !!(A.hasPassword && A.hasPassword());
    if (passwordModalTitle) passwordModalTitle.textContent = changing ? '更改登录密码' : '设置登录密码';
    if (passwordModalDesc) passwordModalDesc.textContent = changing
      ? '先输入当前密码，再设置新的登录密码。'
      : '设置后，下次可以直接使用邮箱和密码登录。';
    show(currentPasswordWrap, changing);
    if (currentPasswordInput) currentPasswordInput.value = '';
    if (newPasswordInput) newPasswordInput.value = '';
    if (confirmPasswordInput) confirmPasswordInput.value = '';
    setPasswordMsg('');
    if (passwordModal) passwordModal.classList.add('show');
    setTimeout(() => (changing ? currentPasswordInput : newPasswordInput) && (changing ? currentPasswordInput : newPasswordInput).focus(), 60);
  }
  function closePasswordSettings() { if (passwordModal) passwordModal.classList.remove('show'); }

  async function savePassword() {
    if (!A || !A.isLoggedIn || !A.isLoggedIn()) { setPasswordMsg('登录状态已失效，请重新登录。', 'err'); return; }
    const changing = !!(A.hasPassword && A.hasPassword());
    const current = String((currentPasswordInput && currentPasswordInput.value) || '');
    const next = String((newPasswordInput && newPasswordInput.value) || '');
    const confirm = String((confirmPasswordInput && confirmPasswordInput.value) || '');
    if (changing && !current) { setPasswordMsg('请输入当前密码。', 'err'); return; }
    if (!validateNewPassword(next, confirm, setPasswordMsg)) return;
    if (changing && current === next) { setPasswordMsg('新密码需要和当前密码不同。', 'err'); return; }
    setBusy(passwordSave, true, '保存中…');
    setPasswordMsg('正在安全地更新密码…');
    let error = null;
    try { await A.setPassword(next, changing ? current : ''); } catch (ex) { error = ex; }
    setBusy(passwordSave, false);
    if (error) { setPasswordMsg(friendlyError(error, '密码更新失败，请稍后重试。'), 'err'); return; }
    refreshCard();
    setPasswordMsg('密码已经更新。', 'ok');
    setTimeout(closePasswordSettings, 450);
  }

  if (passwordSettingsBtn) passwordSettingsBtn.addEventListener('click', openPasswordSettings);
  if (passwordCancel) passwordCancel.addEventListener('click', closePasswordSettings);
  if (passwordSave) passwordSave.addEventListener('click', savePassword);
  if (passwordModal) passwordModal.addEventListener('click', event => { if (event.target === passwordModal) closePasswordSettings(); });
  [currentPasswordInput, newPasswordInput, confirmPasswordInput].forEach(input => {
    if (input) input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); savePassword(); } });
  });
  if (passwordForgotCurrent) passwordForgotCurrent.addEventListener('click', () => {
    const user = A && A.currentUser ? A.currentUser() : null;
    closePasswordSettings();
    closeSettings();
    openForgot(user && user.email ? user.email : '');
  });

  function openRecovery() {
    if (recoveryModal && recoveryModal.classList.contains('show')) return;
    close(false);
    closeSettings();
    closePasswordSettings();
    if (recoveryPassword) recoveryPassword.value = '';
    if (recoveryConfirm) recoveryConfirm.value = '';
    setRecoveryMsg('');
    if (recoveryModal) recoveryModal.classList.add('show');
    setTimeout(() => recoveryPassword && recoveryPassword.focus(), 60);
  }
  function closeRecovery() { if (recoveryModal) recoveryModal.classList.remove('show'); }
  function cleanRecoveryUrl() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('auth');
      window.history.replaceState({}, '', url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : ''));
    } catch (e) { /* ignore */ }
  }
  async function finishRecovery() {
    const next = String((recoveryPassword && recoveryPassword.value) || '');
    const confirm = String((recoveryConfirm && recoveryConfirm.value) || '');
    if (!validateNewPassword(next, confirm, setRecoveryMsg)) return;
    setBusy(recoverySave, true, '保存中…');
    setRecoveryMsg('正在设置新的登录密码…');
    let error = null;
    try { await A.finishPasswordRecovery(next); } catch (ex) { error = ex; }
    setBusy(recoverySave, false);
    if (error) { setRecoveryMsg(friendlyError(error, '密码重设失败，请重新打开邮件中的链接。'), 'err'); return; }
    cleanRecoveryUrl();
    refreshCard();
    setRecoveryMsg('密码已重设，下次可以直接使用密码登录。', 'ok');
    setTimeout(closeRecovery, 650);
  }
  if (recoverySave) recoverySave.addEventListener('click', finishRecovery);
  if (recoveryClose) recoveryClose.addEventListener('click', closeRecovery);
  if (recoveryModal) recoveryModal.addEventListener('click', event => { if (event.target === recoveryModal) closeRecovery(); });
  [recoveryPassword, recoveryConfirm].forEach(input => {
    if (input) input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); finishRecovery(); } });
  });
  if (A && A.onAuthEvent) A.onAuthEvent(event => { if (event === 'PASSWORD_RECOVERY') openRecovery(); });
  setTimeout(() => {
    try {
      const recoveryRequested = new URL(window.location.href).searchParams.get('auth') === 'recovery';
      if (recoveryRequested && A && A.isLoggedIn && A.isLoggedIn()) openRecovery();
    } catch (e) { /* ignore */ }
  }, 500);

  function accountAction() {
    if (A && A.isLoggedIn && A.isLoggedIn()) openSettings();
    else open('plain');
  }
  if (acctBtn) acctBtn.addEventListener('click', accountAction);
  if (settingsOpen) settingsOpen.addEventListener('click', openSettings);
  if (settingsClose) settingsClose.addEventListener('click', closeSettings);
  if (settingsModal) settingsModal.addEventListener('click', event => { if (event.target === settingsModal) closeSettings(); });
  if (settingsAccountBtn) settingsAccountBtn.addEventListener('click', () => {
    if (A && A.isLoggedIn && A.isLoggedIn()) openLogoutConfirm();
    else { closeSettings(); open('plain'); }
  });
  if (logoutCancel) logoutCancel.addEventListener('click', closeLogoutConfirm);
  if (logoutModal) logoutModal.addEventListener('click', event => { if (event.target === logoutModal) closeLogoutConfirm(); });
  if (logoutConfirm) logoutConfirm.addEventListener('click', async () => {
    if (!A || !A.signOut) return;
    setBusy(logoutConfirm, true, '正在退出…');
    try { await A.signOut(); closeLogoutConfirm(); closeSettings(); }
    finally { setBusy(logoutConfirm, false); }
  });

  function syncLabel() {
    const s = (window.LJG_STORE && LJG_STORE.syncStatus) ? LJG_STORE.syncStatus() : 'logged_out';
    return { synced: '云端已同步', local: '本地缓存', pending: '等待同步', logged_out: '未登录 · 不保存' }[s] || '同步状态未知';
  }
  function refreshCard() {
    const user = (A && A.currentUser) ? A.currentUser() : null;
    const synced = syncLabel();
    if (user && user.email) {
      if (acctTitle) acctTitle.textContent = '账号与同步';
      if (acctSub) acctSub.textContent = user.email;
      if (acctSync) acctSync.textContent = synced;
      if (acctBtn) { acctBtn.textContent = '管理'; acctBtn.classList.remove('signout'); }
      if (settingsEmail) settingsEmail.textContent = user.email;
      if (settingsSync) settingsSync.textContent = synced;
      if (passwordSettingsStatus) passwordSettingsStatus.textContent = (A.hasPassword && A.hasPassword()) ? '更改密码 ›' : '设置密码 ›';
      if (passwordSettingsBtn) passwordSettingsBtn.disabled = false;
      if (settingsAccountBtn) { settingsAccountBtn.textContent = '退出登录'; settingsAccountBtn.classList.add('signout'); }
    } else {
      if (acctTitle) acctTitle.textContent = '登录后同步陪伴记录';
      if (acctSub) acctSub.textContent = '识别与报告免登录，足迹需要邮箱登录';
      if (acctSync) acctSync.textContent = '未登录 · 不保存';
      if (acctBtn) { acctBtn.textContent = '登录'; acctBtn.classList.remove('signout'); }
      if (settingsEmail) settingsEmail.textContent = '尚未登录';
      if (settingsSync) settingsSync.textContent = '未登录 · 不保存';
      if (passwordSettingsStatus) passwordSettingsStatus.textContent = '登录后可设置 ›';
      if (passwordSettingsBtn) passwordSettingsBtn.disabled = true;
      if (settingsAccountBtn) { settingsAccountBtn.textContent = '登录并同步'; settingsAccountBtn.classList.remove('signout'); }
    }
  }
  if (A && A.onChange) A.onChange(() => {
    refreshCard();
    if (A.isLoggedIn && A.isLoggedIn() && authMode !== 'forgot') close(false);
  });
  if (A && A.onProfileChange) A.onProfileChange(refreshCard);
  window.addEventListener('ljg:sync', refreshCard);
  refreshCard();

  window.LJG_ACCOUNT = {
    gateSave: ctx => open('gate', ctx),
    openLogin: () => open('plain'),
    openSettings,
  };
})();
