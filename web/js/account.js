/* ============================================================
   冷静购 · 账号（统一邮箱 OTP 登录 + 保存拦截 + 账号区）
   - 登录窗两步：邮箱 → 验证码（verifyEmailOtp）。新邮箱自动注册、老邮箱直接登录。
   - gateSave({pending,onSkip})：未登录点保存动作时弹窗 3 选项：
       ①验证码登录并保存（发码时才落 pending；登录成功后由 main 的 onChange→resumePending 续跑，本文件不重复触发）
       ②仅完成本次·不保存 → clearPending + onSkip()（draft 保留）
       ③关闭 → clearPending（draft 保留）
   - 「我」页账号区：未登录→登录；已登录→显示邮箱 + 退出登录。
   依赖：window.LJG_AUTH（auth.js）、window.LJG_DRAFT（draft.js）。
   ============================================================ */
(function () {
  const A = window.LJG_AUTH, D = window.LJG_DRAFT;
  const $ = id => document.getElementById(id);
  const card = $('acctCard'), acctTitle = $('acctTitle'), acctSub = $('acctSub'), acctBtn = $('acctBtn');
  const modal = $('loginModal'), titleEl = $('loginTitle'), stepEmail = $('loginStepEmail'), stepCode = $('loginStepCode'),
    emailInp = $('loginEmail'), codeInp = $('loginCode'), msg = $('loginMsg'),
    skipBtn = $('loginSkip'), primaryBtn = $('loginPrimary'), closeBtn = $('loginClose');
  if (!modal) return;

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let mode = 'plain';   // 'plain'（纯登录）| 'gate'（保存拦截）
  let gateCtx = null;   // {pending, onSkip}
  let step = 'email';
  let email = '';

  function setMsg(t, kind) { if (msg) { msg.textContent = t || ''; msg.className = 'bind-msg' + (kind ? ' ' + kind : ''); } }
  function show(el, on) { if (el) el.classList.toggle('lg-hide', !on); }
  function gotoEmail() { step = 'email'; show(stepEmail, true); show(stepCode, false); if (primaryBtn) primaryBtn.textContent = '发送验证码'; setTimeout(() => emailInp && emailInp.focus(), 60); }
  function gotoCode() { step = 'code'; show(stepEmail, false); show(stepCode, true); if (primaryBtn) primaryBtn.textContent = '登录'; if (codeInp) codeInp.value = ''; setTimeout(() => codeInp && codeInp.focus(), 60); }

  function open(m, ctx) {
    mode = m; gateCtx = ctx || null; email = '';
    if (emailInp) emailInp.value = '';
    setMsg('');
    if (titleEl) titleEl.textContent = (m === 'gate') ? '登录后保存这次进度' : '邮箱验证码登录';
    show(skipBtn, m === 'gate');     // 仅保存拦截才显示「仅完成本次·不保存」
    gotoEmail();
    modal.classList.add('show');
  }
  function close() { modal.classList.remove('show'); }

  if (primaryBtn) primaryBtn.addEventListener('click', async () => {
    if (!A) { setMsg('云端暂时连不上，稍后再试～', 'err'); return; }
    if (step === 'email') {
      const e = ((emailInp && emailInp.value) || '').trim();
      if (!EMAIL_RE.test(e)) { setMsg('邮箱格式看起来不太对～', 'err'); return; }
      email = e; primaryBtn.disabled = true; setMsg('豚豚正在发送验证码…');
      let err = null; try { const r = await A.signInWithEmail(email); if (r && r.error) err = r.error; } catch (ex) { err = ex; }
      primaryBtn.disabled = false;
      if (err) { setMsg((err && err.message) || '发送失败，可能太频繁，过会儿再试～', 'err'); return; }
      if (mode === 'gate' && gateCtx && D) D.savePending(gateCtx.pending);   // 用户明确选「登录并保存」时才落 pending
      setMsg('验证码已发到 ' + email + '，填进来即可登录。', 'ok'); gotoCode();
    } else {
      const code = ((codeInp && codeInp.value) || '').trim();
      if (!/^\d{4,8}$/.test(code)) { setMsg('验证码是邮件里的数字哦～', 'err'); return; }
      primaryBtn.disabled = true; setMsg('登录中…');
      let err = null; try { const r = await A.verifyEmailOtp(email, code); if (r && r.error) err = r.error; } catch (ex) { err = ex; }
      primaryBtn.disabled = false;
      if (err) { setMsg((err && err.message) || '验证码不对或已过期，重发一次试试～', 'err'); return; }
      setMsg('登录成功～', 'ok'); close();   // 续跑由 main 的 onChange→resumePending 处理（单飞，不在此重复触发）
    }
  });

  if (skipBtn) skipBtn.addEventListener('click', () => { if (D) D.clearPending(); close(); if (mode === 'gate' && gateCtx && gateCtx.onSkip) gateCtx.onSkip(); });
  if (closeBtn) closeBtn.addEventListener('click', () => { if (D) D.clearPending(); close(); });
  modal.addEventListener('click', e => { if (e.target === modal) { if (D) D.clearPending(); close(); } });

  if (acctBtn) acctBtn.addEventListener('click', () => { (A && A.isLoggedIn && A.isLoggedIn()) ? A.signOut() : open('plain'); });

  function refreshCard() {
    const u = (A && A.currentUser) ? A.currentUser() : null;
    if (u && u.email) {
      if (acctTitle) acctTitle.textContent = '已登录';
      if (acctSub) acctSub.textContent = u.email;
      if (acctBtn) acctBtn.textContent = '退出登录';
    } else {
      if (acctTitle) acctTitle.textContent = '登录后才会保存';
      if (acctSub) acctSub.textContent = '识别 / 报告免登录；保存进度需邮箱登录';
      if (acctBtn) acctBtn.textContent = '登录';
    }
  }
  if (A && A.onChange) A.onChange(() => { refreshCard(); if (A.isLoggedIn && A.isLoggedIn()) close(); });
  refreshCard();

  window.LJG_ACCOUNT = { gateSave: ctx => open('gate', ctx), openLogin: () => open('plain') };
})();
