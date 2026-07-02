/* 冷静购 · 河湾贴纸墙编辑器 */
(function () {
  'use strict';
  const C = window.LJG_STICKER_CATALOG;
  const M = window.LJG_STICKER_MODEL;
  const S = window.LJG_STICKER_STORE;
  const A = window.LJG_AUTH;
  const G = window.LJG_STICKER_ACHIEVEMENTS;
  if (!C || !M || !S || !document.getElementById('sceneCanvas')) return;

  const canvas = document.getElementById('sceneCanvas');
  const sceneTabs = document.getElementById('sceneTabs');
  const tray = document.getElementById('stickerTrayList');
  const empty = document.getElementById('canvasEmpty');
  const ownerLabel = document.getElementById('ownerLabel');
  const itemCount = document.getElementById('sceneItemCount');
  const clearBtn = document.getElementById('clearSceneBtn');
  const confirmLayer = document.getElementById('clearConfirm');
  const clearConfirm = confirmLayer;
  const confirmClearBtn = document.getElementById('confirmClearBtn');
  const cancelClearBtn = document.getElementById('cancelClearBtn');
  const toast = document.getElementById('storageToast');
  const histories = new Map();
  let currentSceneId = C.scenes[0].id;
  let items = [];
  let selectedId = null;
  let drag = null;
  let toastTimer = null;
  let warnedStorage = false;
  let booted = false;
  let activeOwnerMode = 'guest';
  const sceneEventsSent = new Set();
  function signalRewardContext() {
    try { window.dispatchEvent(new CustomEvent('ljg:reward-context-changed')); } catch (error) {}
  }
  if (window.LJG_STICKER_REWARD && window.LJG_STICKER_REWARD.setPresentationGate) {
    window.LJG_STICKER_REWARD.setPresentationGate(() => !clearConfirm.classList.contains('show'));
  }

  const toolIds = ['zoomInBtn','zoomOutBtn','rotateLeftBtn','rotateRightBtn','bringFrontBtn','deleteStickerBtn'];
  const tools = Object.fromEntries(toolIds.map(id => [id, document.getElementById(id)]));
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
  }
  function ownerFromAuth() {
    return A && A.currentUserId ? A.currentUserId() : null;
  }
  function refreshOwnerLabel() {
    if (activeOwnerMode !== 'account') { ownerLabel.textContent = '游客体验'; return; }
    const sync = S.getStatus();
    if (sync.pending > 0) ownerLabel.textContent = '已保存到本机 · 云端同步中';
    else if (sync.remote) ownerLabel.textContent = '账号已同步';
    else ownerLabel.textContent = '离线保存';
  }
  async function updateOwner() {
    const uid = ownerFromAuth();
    let owned = C.defaultStickerIds();
    try {
      if (G) { await G.init(uid); owned = G.getState().owned_ids; }
      await S.initOwner(uid, owned);
      activeOwnerMode = uid && G && G.getState().mode === 'account' ? 'account' : 'guest';
    } catch (error) {
      await S.initOwner(null, C.defaultStickerIds());
      activeOwnerMode = 'guest';
      showToast('云端暂不可用，已进入游客模式');
    }
    refreshOwnerLabel();
  }
  function historyFor(sceneId) {
    if (!histories.has(sceneId)) histories.set(sceneId, M.createHistory(S.loadSceneLayout(sceneId), 50));
    return histories.get(sceneId);
  }
  function currentHistory() { return historyFor(currentSceneId); }
  function selectedItem() { return items.find(item => item.instance_id === selectedId) || null; }
  function escapeAttr(value) { return String(value).replace(/["\\]/g, '\\$&'); }

  function saveCurrent(recentStickerId) {
    const ok = S.saveSceneLayout(currentSceneId, items, recentStickerId);
    if (!ok && !warnedStorage) {
      warnedStorage = true;
      showToast('本次仍可继续，刷新后可能无法保留');
    }
    try { window.dispatchEvent(new CustomEvent('ljg:layout-updated')); } catch (error) { /* old browser */ }
    refreshOwnerLabel();
    if (activeOwnerMode === 'account') {
      const eventScene = currentSceneId;
      const shouldReport = items.length && G && G.getState().mode === 'account' && !sceneEventsSent.has(eventScene);
      S.flushQueue().then(synced => {
        refreshOwnerLabel();
        if (!synced || !shouldReport || sceneEventsSent.has(eventScene)) return;
        sceneEventsSent.add(eventScene);
        return G.recordEvent('scene_saved', 'scene:' + eventScene, { scene_id: eventScene });
      }).catch(() => { refreshOwnerLabel(); });
    }
    return ok;
  }
  function commit(nextItems, recentStickerId) {
    items = currentHistory().commit(nextItems);
    if (selectedId && !items.some(item => item.instance_id === selectedId)) selectedId = null;
    saveCurrent(recentStickerId);
    renderCanvas();
  }

  function renderTabs() {
    sceneTabs.innerHTML = '';
    C.scenes.forEach(scene => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'scene-tab' + (scene.id === currentSceneId ? ' active' : '');
      button.textContent = scene.name;
      button.setAttribute('aria-pressed', scene.id === currentSceneId ? 'true' : 'false');
      button.addEventListener('click', () => switchScene(scene.id));
      sceneTabs.appendChild(button);
    });
  }
  function renderTray() {
    tray.innerHTML = '';
    const owned = G ? G.getState().owned_ids : C.defaultStickerIds();
    C.listOwned(owned).forEach(sticker => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tray-sticker';
      button.title = sticker.description;
      button.innerHTML = '<img alt="" draggable="false"><span></span>';
      const trayImage = button.querySelector('img');
      trayImage.src = sticker.image;
      trayImage.loading = 'lazy';
      trayImage.decoding = 'async';
      button.querySelector('span').textContent = sticker.name;
      button.addEventListener('click', () => addSticker(sticker.id));
      tray.appendChild(button);
    });
  }
  function positionElement(element, item) {
    element.style.left = (item.x / M.LOGICAL_WIDTH * 100) + '%';
    element.style.top = (item.y / M.LOGICAL_HEIGHT * 100) + '%';
    element.style.zIndex = String(item.z_index);
    element.style.transform = 'translate(-50%, -50%) scale(' + item.scale + ') rotate(' + item.rotation + 'deg)';
  }
  function renderCanvas() {
    const scene = C.getScene(currentSceneId);
    canvas.style.backgroundImage = scene ? 'url("' + scene.background + '")' : '';
    canvas.querySelectorAll('.placed-sticker').forEach(node => node.remove());
    items.slice().sort((a, b) => a.z_index - b.z_index).forEach(item => {
      const sticker = C.getSticker(item.sticker_id);
      if (!sticker) return;
      const image = document.createElement('img');
      image.className = 'placed-sticker' + (item.instance_id === selectedId ? ' selected' : '');
      image.src = sticker.image;
      image.decoding = 'async';
      image.alt = sticker.name;
      image.draggable = false;
      image.dataset.instanceId = item.instance_id;
      positionElement(image, item);
      image.addEventListener('pointerdown', startDrag);
      canvas.appendChild(image);
    });
    empty.classList.toggle('hidden', items.length > 0);
    itemCount.textContent = items.length + ' 枚';
    refreshControls();
  }
  function refreshControls() {
    const selected = selectedItem();
    toolIds.forEach(id => { tools[id].disabled = !selected; });
    if (selected) {
      tools.zoomInBtn.disabled = selected.scale >= M.MAX_SCALE;
      tools.zoomOutBtn.disabled = selected.scale <= M.MIN_SCALE;
    }
    undoBtn.disabled = !currentHistory().canUndo();
    redoBtn.disabled = !currentHistory().canRedo();
    clearBtn.disabled = items.length === 0;
  }
  function switchScene(sceneId) {
    if (sceneId === currentSceneId || !C.getScene(sceneId)) return;
    saveCurrent();
    currentSceneId = sceneId;
    items = currentHistory().current();
    selectedId = null;
    renderTabs();
    renderCanvas();
  }
  function addSticker(stickerId) {
    const next = M.createInstance(stickerId, items);
    selectedId = next.instance_id;
    commit(items.concat(next), stickerId);
    showToast('贴进来了 · 可以拖动它');
  }
  function editSelected(action) {
    if (!selectedItem()) return;
    commit(M.applyAction(items, Object.assign({ instanceId: selectedId }, action)));
  }
  function clientToLogical(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width * M.LOGICAL_WIDTH,
      y: (event.clientY - rect.top) / rect.height * M.LOGICAL_HEIGHT,
    };
  }
  function startDrag(event) {
    event.preventDefault();
    event.stopPropagation();
    const id = event.currentTarget.dataset.instanceId;
    const target = items.find(item => item.instance_id === id);
    if (!target) return;
    selectedId = id;
    const point = clientToLogical(event);
    drag = { pointerId: event.pointerId, start: point, originalX: target.x, originalY: target.y, baseItems: items.map(item => Object.assign({}, item)) };
    try { canvas.setPointerCapture(event.pointerId); } catch (error) { /* optional */ }
    renderCanvas();
  }
  function moveDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = clientToLogical(event);
    items = M.applyAction(drag.baseItems, {
      type: 'move', instanceId: selectedId,
      x: drag.originalX + point.x - drag.start.x,
      y: drag.originalY + point.y - drag.start.y,
    });
    const current = selectedItem();
    const element = canvas.querySelector('[data-instance-id="' + escapeAttr(selectedId) + '"]');
    if (current && element) positionElement(element, current);
  }
  function endDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const before = drag.baseItems.find(item => item.instance_id === selectedId);
    const after = selectedItem();
    drag = null;
    try { canvas.releasePointerCapture(event.pointerId); } catch (error) { /* optional */ }
    if (before && after && (before.x !== after.x || before.y !== after.y)) {
      items = currentHistory().commit(items);
      saveCurrent();
    }
    renderCanvas();
  }
  function undo() {
    if (!currentHistory().canUndo()) return;
    items = currentHistory().undo();
    if (!items.some(item => item.instance_id === selectedId)) selectedId = null;
    saveCurrent(); renderCanvas();
  }
  function redo() {
    if (!currentHistory().canRedo()) return;
    items = currentHistory().redo();
    if (!items.some(item => item.instance_id === selectedId)) selectedId = null;
    saveCurrent(); renderCanvas();
  }
  function openClearConfirm() {
    if (!items.length) return;
    confirmLayer.classList.add('show');
    confirmLayer.setAttribute('aria-hidden', 'false');
    signalRewardContext();
    cancelClearBtn.focus();
  }
  function closeClearConfirm() {
    confirmLayer.classList.remove('show');
    confirmLayer.setAttribute('aria-hidden', 'true');
    signalRewardContext();
    clearBtn.focus();
  }
  function clearScene() {
    selectedId = null;
    commit([]);
    closeClearConfirm();
    showToast('场景已清空 · 还可以撤销');
  }

  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  tools.zoomInBtn.addEventListener('click', () => editSelected({ type: 'scale', delta: .1 }));
  tools.zoomOutBtn.addEventListener('click', () => editSelected({ type: 'scale', delta: -.1 }));
  tools.rotateLeftBtn.addEventListener('click', () => editSelected({ type: 'rotate', delta: -15 }));
  tools.rotateRightBtn.addEventListener('click', () => editSelected({ type: 'rotate', delta: 15 }));
  tools.bringFrontBtn.addEventListener('click', () => editSelected({ type: 'bring-front' }));
  tools.deleteStickerBtn.addEventListener('click', () => editSelected({ type: 'delete' }));
  clearBtn.addEventListener('click', openClearConfirm);
  cancelClearBtn.addEventListener('click', closeClearConfirm);
  confirmClearBtn.addEventListener('click', clearScene);
  confirmLayer.addEventListener('click', event => { if (event.target === confirmLayer) closeClearConfirm(); });
  canvas.addEventListener('pointermove', moveDrag);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerdown', event => {
    if (event.target === canvas || event.target === empty) { selectedId = null; renderCanvas(); }
  });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); event.shiftKey ? redo() : undo();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault(); redo();
    } else if (event.key === 'Escape' && confirmLayer.classList.contains('show')) closeClearConfirm();
  });
  window.addEventListener('pagehide', () => saveCurrent());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveCurrent(); });
  window.addEventListener('online', () => { S.flushQueue().then(() => refreshOwnerLabel()).catch(() => refreshOwnerLabel()); });
  window.addEventListener('storage', event => {
    if (!event.key || !event.key.startsWith('calm_sticker_scene_layouts.v2.')) return;
    histories.clear(); items = historyFor(currentSceneId).current(); selectedId = null; renderCanvas();
  });

  async function handleOwnerChange() {
    saveCurrent();
    await updateOwner();
    histories.clear();
    items = historyFor(currentSceneId).current();
    selectedId = null;
    renderTray();
    renderCanvas();
  }
  async function boot() {
    if (A && A.onChange) A.onChange(() => { if (booted) handleOwnerChange(); });
    try { if (A && A.refreshUser) await A.refreshUser(); } catch (error) { /* offline guest */ }
    await updateOwner();
    renderTabs();
    renderTray();
    items = historyFor(currentSceneId).current();
    renderCanvas();
    window.addEventListener('ljg:stickers-updated', () => {
      if (!booted || !G) return;
      S.setOwnedIds(G.getState().owned_ids);
      histories.clear();
      items = historyFor(currentSceneId).current();
      renderTray(); renderCanvas();
    });
    const state = S.getStatus();
    if (state.error === 'corrupt') showToast('已忽略损坏的本地贴纸数据');
    booted = true;
  }
  boot();
})();
