/* ============================================================
   冷静购 · “我的”页面
   资料走 Auth user_metadata；足迹只读当前 user_id 的 decisions。
   ============================================================ */
(function () {
  const A = window.LJG_AUTH, S = window.LJG_STORE;
  const $ = id => document.getElementById(id);
  const AVATARS = ['capybara', 'otter', 'rabbit', 'bear', 'fox', 'duck'];
  const AVATAR_SET = new Set(AVATARS);
  const profileCard = $('profileCard'), profileAvatar = $('profileAvatar'), profileName = $('profileName'), profileSubtitle = $('profileSubtitle');
  const statDays = $('statDays'), statTotal = $('statTotal'), statLetGo = $('statLetGo'), footprintNote = $('footprintNote');
  const todayRiverText = $('todayRiverText'), floatingShortcutMeta = $('floatingShortcutMeta');
  const profileModal = $('profileModal'), profileNameInput = $('profileNameInput'), avatarGrid = $('avatarGrid'), profileMsg = $('profileMsg'), profileSave = $('profileSave'), profileCancel = $('profileCancel');
  const historyModal = $('historyModal'), historyList = $('historyList'), historyClose = $('historyClose');
  if (!profileCard) return;

  let selectedAvatar = 'capybara';
  let recentDecisions = null;
  let overviewRequest = 0;

  function safeAvatarId(value) { return AVATAR_SET.has(value) ? value : 'capybara'; }
  function avatarPath(id) { return 'assets/avatars/' + safeAvatarId(id) + '.webp'; }
  function setAvatarImage(img, id) {
    if (!img) return;
    img.onerror = function () { this.onerror = null; this.src = avatarPath('capybara'); };
    img.src = avatarPath(id);
  }
  function openSheet(el) { if (el) { el.classList.add('show'); el.setAttribute('aria-hidden', 'false'); } }
  function closeSheet(el) { if (el) { el.classList.remove('show'); el.setAttribute('aria-hidden', 'true'); } }
  function currentUser() { return (A && A.currentUser) ? A.currentUser() : null; }
  function daysTogether(user) {
    const started = user && user.created_at ? Date.parse(user.created_at) : NaN;
    if (!Number.isFinite(started)) return null;
    return Math.max(1, Math.floor((Date.now() - started) / 86400000) + 1);
  }
  function validDisplayName(user) {
    const value = String((user && user.user_metadata && user.user_metadata.display_name) || '').trim();
    return value && value.length <= 16 ? value : '河湾旅人';
  }

  function refreshToday() {
    const loggedIn = !!currentUser();
    const count = (S && S.getPool) ? S.getPool().length : 0;
    if (todayRiverText) {
      todayRiverText.textContent = !loggedIn
        ? '先把想买的放进河里，陪自己慢一点。'
        : count > 0 ? '还有 ' + count + ' 件正在河里慢慢沉淀。' : '河面很轻，今天也可以慢慢来。';
    }
    if (floatingShortcutMeta) floatingShortcutMeta.textContent = count > 0 ? count + ' 件正在沉淀' : '河面暂时很轻';
  }

  function refreshProfileCard() {
    const user = currentUser();
    if (!user) {
      setAvatarImage(profileAvatar, 'capybara');
      if (profileName) profileName.textContent = '河湾旅人';
      if (profileSubtitle) profileSubtitle.textContent = '登录后留下名字与陪伴足迹';
      if (statDays) statDays.textContent = '—';
      if (statTotal) statTotal.textContent = '—';
      if (statLetGo) statLetGo.textContent = '—';
      if (footprintNote) footprintNote.textContent = '登录后，豚豚会把每次认真考虑都收进足迹。';
      recentDecisions = null;
      refreshToday();
      return;
    }
    const metadata = user.user_metadata || {};
    const days = daysTogether(user);
    setAvatarImage(profileAvatar, safeAvatarId(metadata.avatar_id));
    if (profileName) profileName.textContent = validDisplayName(user);
    if (profileSubtitle) profileSubtitle.textContent = days == null ? '和豚豚一起住在河湾' : '与豚豚相伴第 ' + days + ' 天';
    if (statDays) statDays.textContent = days == null ? '—' : String(days);
    if (footprintNote) footprintNote.textContent = '正在从河湾里捞起你的真实足迹…';
    refreshToday();
  }

  async function refreshOverview() {
    const user = currentUser();
    const requestId = ++overviewRequest;
    if (!user || !S || !S.fetchCompanionOverview) { refreshProfileCard(); return; }
    const uid = user.id;
    if (statTotal) statTotal.textContent = '…';
    if (statLetGo) statLetGo.textContent = '…';
    let data;
    try { data = await S.fetchCompanionOverview(); }
    catch (e) { data = { totalDecisions: null, letGoCount: null, recentDecisions: null }; }
    const latest = currentUser();
    if (requestId !== overviewRequest || !latest || latest.id !== uid) return;
    const total = data && typeof data.totalDecisions === 'number' ? data.totalDecisions : null;
    const letGo = data && typeof data.letGoCount === 'number' ? data.letGoCount : null;
    if (statTotal) statTotal.textContent = total == null ? '—' : String(total);
    if (statLetGo) statLetGo.textContent = letGo == null ? '—' : String(letGo);
    recentDecisions = data ? data.recentDecisions : null;
    if (footprintNote) {
      footprintNote.textContent = (total == null || letGo == null)
        ? '有些足迹暂时没连上云端，稍后再回来看看。'
        : total === 0 ? '河湾还是空白的，第一次认真停下来也会被记住。'
        : '豚豚已经陪你认真想过 ' + total + ' 件，其中 ' + letGo + ' 件顺水放下了。';
    }
  }

  function selectAvatar(id) {
    selectedAvatar = safeAvatarId(id);
    if (!avatarGrid) return;
    avatarGrid.querySelectorAll('[data-avatar]').forEach(btn => btn.classList.toggle('on', btn.dataset.avatar === selectedAvatar));
  }
  function openProfileEditor() {
    const user = currentUser();
    if (!user) { if (window.LJG_ACCOUNT) LJG_ACCOUNT.openLogin(); return; }
    const metadata = user.user_metadata || {};
    if (profileNameInput) profileNameInput.value = validDisplayName(user);
    if (profileMsg) { profileMsg.textContent = ''; profileMsg.className = 'sheet-msg'; }
    selectAvatar(metadata.avatar_id);
    openSheet(profileModal);
    setTimeout(() => profileNameInput && profileNameInput.focus(), 160);
  }
  function saveProfile() {
    if (!A || !A.updateProfile || !profileSave || profileSave.disabled) return;
    const name = String((profileNameInput && profileNameInput.value) || '').trim();
    if (!name || name.length > 16) { if (profileMsg) profileMsg.textContent = '用户名需要是 1–16 个字符。'; return; }

    profileSave.disabled = true;
    if (profileMsg) { profileMsg.textContent = ''; profileMsg.className = 'sheet-msg'; }
    const saving = A.updateProfile({ display_name: name, avatar_id: safeAvatarId(selectedAvatar) });
    closeSheet(profileModal); // updateProfile 已同步完成乐观刷新，立即收起，不等网络也不固定延迟
    if (window.tip) window.tip('名字和头像已经换好啦 · 正在同步');

    saving.then(() => {
      if (window.tip) window.tip('个人资料已同步');
    }).catch(e => {
      if (window.tip) window.tip(((e && e.message) || '同步失败') + ' · 已恢复原资料');
    }).finally(() => {
      profileSave.disabled = false;
      profileSave.textContent = '保存我的资料';
    });
  }

  function renderHistoryLoading() {
    if (!historyList) return;
    historyList.textContent = '';
    const box = document.createElement('div'); box.className = 'history-empty';
    const inner = document.createElement('div');
    const title = document.createElement('h4'); title.textContent = '正在捞起陪伴记录…';
    const p = document.createElement('p'); p.textContent = '河水有一点慢，豚豚正在找。';
    inner.append(title, p); box.appendChild(inner); historyList.appendChild(box);
  }
  function renderHistoryEmpty(message, action) {
    if (!historyList) return;
    historyList.textContent = '';
    const box = document.createElement('div'); box.className = 'history-empty';
    const inner = document.createElement('div');
    const icon = document.createElement('div'); icon.textContent = '🌿'; icon.style.fontSize = '42px';
    const title = document.createElement('h4'); title.textContent = action ? '第一条记录还在等你' : '暂时没捞到记录';
    const p = document.createElement('p'); p.textContent = message;
    inner.append(icon, title, p);
    if (action) {
      const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = '去河边放一件';
      btn.addEventListener('click', () => { closeSheet(historyModal); if (window.LJG_APP) LJG_APP.focusDrop(); });
      inner.appendChild(btn);
    }
    box.appendChild(inner); historyList.appendChild(box);
  }
  function renderHistory(rows) {
    if (!historyList) return;
    if (rows == null) { renderHistoryEmpty('云端暂时有点远，稍后再回来看看。', false); return; }
    if (!rows.length) { renderHistoryEmpty('认真停下来的每一件事，之后都会出现在这里。', true); return; }
    historyList.textContent = '';
    const labels = { floating: '沉淀中', riverbed: '沉淀中', let_go: '已放手', bought: '已买下' };
    const icons = { floating: '💧', riverbed: '🪨', let_go: '🍃', bought: '🧺' };
    const dateFmt = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' });
    rows.forEach(row => {
      const item = document.createElement('div'); item.className = 'history-item';
      const dot = document.createElement('div'); dot.className = 'history-dot'; dot.textContent = icons[row.status] || '🌊';
      const main = document.createElement('div'); main.className = 'history-main';
      const title = document.createElement('b'); title.textContent = row.title || '一件没写名字的东西';
      const meta = document.createElement('small');
      const when = row.resolved_at || row.created_at; const parsed = when ? new Date(when) : null;
      meta.textContent = parsed && !Number.isNaN(parsed.getTime()) ? dateFmt.format(parsed) + ' · 豚豚陪你想了想' : '豚豚陪你想了想';
      main.append(title, meta);
      const status = document.createElement('span'); status.className = 'history-status ' + (row.status || ''); status.textContent = labels[row.status] || '已记录';
      item.append(dot, main, status); historyList.appendChild(item);
    });
  }
  async function openHistory() {
    if (!currentUser()) { if (window.LJG_ACCOUNT) LJG_ACCOUNT.openLogin(); return; }
    openSheet(historyModal);
    if (recentDecisions == null) { renderHistoryLoading(); await refreshOverview(); }
    renderHistory(recentDecisions);
  }

  profileCard.addEventListener('click', openProfileEditor);
  if (profileCancel) profileCancel.addEventListener('click', () => closeSheet(profileModal));
  if (profileModal) profileModal.addEventListener('click', e => { if (e.target === profileModal) closeSheet(profileModal); });
  if (avatarGrid) avatarGrid.addEventListener('click', e => { const btn = e.target.closest('[data-avatar]'); if (btn) selectAvatar(btn.dataset.avatar); });
  if (profileSave) profileSave.addEventListener('click', saveProfile);
  if (historyClose) historyClose.addEventListener('click', () => closeSheet(historyModal));
  if (historyModal) historyModal.addEventListener('click', e => { if (e.target === historyModal) closeSheet(historyModal); });
  if ($('historyBtn')) $('historyBtn').addEventListener('click', openHistory);
  if ($('goDropBtn')) $('goDropBtn').addEventListener('click', () => { if (window.LJG_APP) LJG_APP.focusDrop(); });
  if ($('goFloatingBtn')) $('goFloatingBtn').addEventListener('click', () => { if (window.LJG_APP) LJG_APP.go('soaking'); });
  if ($('goYardBtn')) $('goYardBtn').addEventListener('click', () => { if (window.LJG_APP) LJG_APP.go('yard'); });

  if (A && A.onChange) A.onChange(() => { refreshProfileCard(); if (currentUser()) refreshOverview(); });
  if (A && A.onProfileChange) A.onProfileChange(refreshProfileCard);
  window.addEventListener('ljg:view', e => { if (e && e.detail && e.detail.target === 'me') { refreshProfileCard(); refreshOverview(); } });
  window.addEventListener('ljg:sync', refreshToday);
  document.querySelectorAll('#avatarGrid img').forEach(img => { img.onerror = function () { this.onerror = null; this.src = avatarPath('capybara'); }; });

  refreshProfileCard();
  if (currentUser()) refreshOverview();
})();
