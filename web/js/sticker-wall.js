/* 冷静购 · 河湾贴纸墙 */
(function () {
  'use strict';
  const C=window.LJG_STICKER_CATALOG,A=window.LJG_STICKER_ACHIEVEMENTS,Auth=window.LJG_AUTH;
  const grid=document.getElementById('wallGrid'),count=document.getElementById('wallCount'),progress=document.getElementById('wallProgress');
  const coins=document.getElementById('wallCoins'),owner=document.getElementById('wallOwner'),filters=document.getElementById('wallFilters'),toast=document.getElementById('wallToast');
  const detail=document.getElementById('wallDetail'),sheet=document.getElementById('purchaseSheet');
  const purchaseSheet=sheet;
  const sheetPanel=sheet.querySelector('.purchase-panel'),confirmButton=sheet.querySelector('[data-purchase-confirm]');
  const closeButton=sheet.querySelector('[data-purchase-close]'),cancelButton=sheet.querySelector('[data-purchase-cancel]');
  const allowedFilters=new Set(['all','achievement','shop','locked','new']);
  const requestedFilter=new URLSearchParams(location.search).get('filter');
  let filter=allowedFilters.has(requestedFilter)?requestedFilter:'all';
  let purchaseState='idle',selectedSticker=null,previousFocus=null,toastTimer=null;
  let purchaseSyncState='loading',bootGeneration=0;
  function signalRewardContext(){
    try{ window.dispatchEvent(new CustomEvent('ljg:reward-context-changed')); }catch(error){}
  }
  if(window.LJG_STICKER_REWARD&&window.LJG_STICKER_REWARD.setPresentationGate){
    window.LJG_STICKER_REWARD.setPresentationGate(()=>{
      if(purchaseSheet.classList.contains('show')) return false;
      if(detail.classList.contains('show')) return false;
      return true;
    });
  }

  function sourceLabel(type){return ({default:'默认贴纸',achievement:'成就贴纸',shop:'商店贴纸',hybrid:'成就 / 商店'})[type]||'贴纸';}
  function say(message){
    toast.textContent=message;toast.classList.add('show');clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>toast.classList.remove('show'),2400);
  }
  function currentCoins(){
    const state=A.getState();
    return typeof state.coins==='number'?state.coins:(window.LJG_STORE?LJG_STORE.getCoins(0):0);
  }
  function statValue(rule,state){
    if(!rule||!rule.stat)return 0;
    if(rule.stat==='owned_count')return state.owned_ids.length;
    return Number(state.stats[rule.stat]||0);
  }
  function visible(sticker,state){
    const owned=state.owned_ids.includes(sticker.id),isNew=state.new_stickers.includes(sticker.id);
    if(filter==='achievement')return sticker.source_type==='achievement'||sticker.source_type==='hybrid';
    if(filter==='shop')return sticker.source_type==='shop'||sticker.source_type==='hybrid';
    if(filter==='locked')return !owned;
    if(filter==='new')return isNew;
    return true;
  }
  function openDetail(sticker){
    detail.querySelector('[data-detail-image]').src=sticker.image;
    detail.querySelector('[data-detail-image]').alt=sticker.name;
    detail.querySelector('[data-detail-name]').textContent=sticker.name;
    detail.querySelector('[data-detail-source]').textContent=sourceLabel(sticker.source_type);
    detail.querySelector('[data-detail-description]').textContent=sticker.description;
    detail.querySelector('[data-detail-rule]').textContent=(sticker.unlock_rule&&sticker.unlock_rule.text)||'已经收进贴纸墙';
    detail.classList.add('show');detail.setAttribute('aria-hidden','false');
  }
  function closeDetail(){
    detail.classList.remove('show');detail.setAttribute('aria-hidden','true');
    signalRewardContext();
  }

  function setPurchaseState(mode,message){
    purchaseState=mode;
    const submitting=mode==='submitting',insufficient=mode==='insufficient';
    sheet.dataset.state=mode;
    closeButton.disabled=submitting;
    cancelButton.disabled=submitting;
    confirmButton.disabled=submitting||insufficient;
    confirmButton.textContent=submitting?'兑换中…':insufficient?'河币不足':'确认兑换';
    const messageEl=sheet.querySelector('[data-purchase-message]');
    messageEl.textContent=message||'';
    messageEl.className='purchase-message'+(mode==='error'||insufficient?' error':'');
  }
  function openPurchaseSheet(sticker){
    if(purchaseSyncState!=='ready'){say(purchaseSyncState==='offline'?'当前离线，联网后才能兑换':'河币正在同步，请稍等');return;}
    if(A.getState().mode!=='account'){say('登录后才能使用河币兑换贴纸');return;}
    selectedSticker=sticker;previousFocus=document.activeElement;
    const balance=currentCoins(),after=balance-sticker.price;
    sheet.querySelector('[data-purchase-image]').src=sticker.image;
    sheet.querySelector('[data-purchase-image]').alt=sticker.name;
    sheet.querySelector('[data-purchase-name]').textContent=sticker.name;
    sheet.querySelector('[data-purchase-description]').textContent=sticker.description;
    sheet.querySelector('[data-purchase-current]').textContent=balance;
    sheet.querySelector('[data-purchase-price]').textContent=sticker.price;
    sheet.querySelector('[data-purchase-after]').textContent=Math.max(0,after);
    if(after<0)setPurchaseState('insufficient','还差 '+Math.abs(after)+' 河币，继续冷静几次再来吧。');
    else setPurchaseState('idle','兑换后会立即收入贴纸墙。');
    sheet.classList.add('show');sheet.setAttribute('aria-hidden','false');
    signalRewardContext();
    setTimeout(()=>sheetPanel.focus(),180);
  }
  function closePurchaseSheet(){
    if(purchaseState==='submitting')return;
    sheet.classList.remove('show');sheet.setAttribute('aria-hidden','true');
    selectedSticker=null;setPurchaseState('idle','');
    if(previousFocus&&previousFocus.focus)previousFocus.focus();
    signalRewardContext();
  }
  async function confirmPurchase(){
    if(!selectedSticker||purchaseState==='submitting')return;
    const balance=currentCoins();
    if(balance<selectedSticker.price){
      setPurchaseState('insufficient','还差 '+(selectedSticker.price-balance)+' 河币，继续冷静几次再来吧。');
      return;
    }
    setPurchaseState('submitting','正在确认河币与贴纸所有权…');
    const sticker=selectedSticker;
    try{
      await A.purchase(sticker.id);
      purchaseState='idle';
      closePurchaseSheet();
      render();
      say('兑换成功，已收进贴纸墙');
    }catch(error){
      const message=(error&&error.message)||'兑换失败，请稍后重试';
      setPurchaseState(/余额|河币不足/i.test(message)?'insufficient':'error',message);
    }
  }

  function card(sticker,state,index){
    const owned=state.owned_ids.includes(sticker.id),isNew=state.new_stickers.includes(sticker.id),rule=sticker.unlock_rule||{};
    const el=document.createElement('article');
    el.className='wall-card rarity-'+sticker.rarity+(owned?' owned':' locked')+(isNew?' is-new':'');
    const image=document.createElement('div');image.className='wall-sticker-img';
    if(sticker.hidden&&!owned)image.innerHTML='<span class="mystery">?</span>';
    else{
      const img=document.createElement('img');img.alt=owned?sticker.name:'';img.src=sticker.image;img.decoding='async';if(index>3)img.loading='lazy';image.appendChild(img);
      if(!owned){const mark=document.createElement('span');mark.className='lock-mark';mark.textContent='?';image.appendChild(mark);}
    }
    const body=document.createElement('div');body.className='wall-card-body';
    const tag=document.createElement('div');tag.className='card-tag';tag.textContent=sourceLabel(sticker.source_type);
    const title=document.createElement('h2');title.textContent=sticker.hidden&&!owned?'神秘贴纸':sticker.name;
    const desc=document.createElement('p');desc.textContent=owned?sticker.description:(rule.text||'继续探索河湾');
    body.append(tag,title,desc);
    if(!owned&&rule.gte){
      const current=Math.min(rule.gte,statValue(rule,state));
      const mini=document.createElement('div');mini.className='mini-progress';mini.innerHTML='<i style="width:'+(current/rule.gte*100)+'%"></i>';
      const small=document.createElement('small');small.textContent=current+' / '+rule.gte;body.append(mini,small);
    }
    if(!owned&&sticker.price!=null){
      const buy=document.createElement('button');buy.className='wall-buy';buy.type='button';
      const canPurchase=purchaseSyncState==='ready';
      buy.disabled=!canPurchase;
      buy.textContent=canPurchase?sticker.price+' 河币兑换':purchaseSyncState==='offline'?'离线不可兑换':'同步中…';
      buy.onclick=()=>openPurchaseSheet(sticker);body.appendChild(buy);
    }
    if(isNew){const dot=document.createElement('span');dot.className='new-dot';dot.textContent='NEW';body.appendChild(dot);}
    if(owned){
      el.tabIndex=0;el.setAttribute('role','button');
      el.addEventListener('click',event=>{if(!event.target.closest('button'))openDetail(sticker);});
      el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openDetail(sticker);}});
    }
    el.append(image,body);return el;
  }
  function render(){
    const state=A.getState(),owned=state.owned_ids.length;
    count.textContent=owned+' / '+C.stickers.length;
    progress.style.width=(owned/C.stickers.length*100)+'%';
    coins.textContent=currentCoins();
    const syncLabel=purchaseSyncState==='ready'?'账号已同步':purchaseSyncState==='offline'?'已保存本机 · 当前离线':'已显示本机缓存 · 正在同步';
    owner.textContent=state.mode==='account'?syncLabel+' · '+owned+' 张已拥有':'游客体验 · 仅默认贴纸';
    grid.innerHTML='';
    C.stickers.filter(sticker=>visible(sticker,state)).forEach((sticker,index)=>grid.appendChild(card(sticker,state,index)));
    if(!grid.children.length)grid.innerHTML='<div class="wall-empty">这里还空着，继续在河湾里冷静几次吧～</div>';
  }
  function activateFilter(next){
    filter=allowedFilters.has(next)?next:'all';
    filters.querySelectorAll('button').forEach(button=>button.classList.toggle('active',button.dataset.filter===filter));
    render();
  }

  detail.querySelector('[data-detail-close]').addEventListener('click',closeDetail);
  detail.addEventListener('click',event=>{if(event.target===detail)closeDetail();});
  filters.addEventListener('click',event=>{const button=event.target.closest('button[data-filter]');if(button)activateFilter(button.dataset.filter);});
  closeButton.addEventListener('click',closePurchaseSheet);
  cancelButton.addEventListener('click',closePurchaseSheet);
  confirmButton.addEventListener('click',confirmPurchase);
  sheet.addEventListener('click',event=>{if(event.target===sheet)closePurchaseSheet();});
  sheet.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();closePurchaseSheet();return;}
    if(event.key!=='Tab')return;
    const focusable=[closeButton,cancelButton,confirmButton].filter(button=>!button.disabled);
    if(!focusable.length)return;
    const first=focusable[0],last=focusable[focusable.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });
  window.addEventListener('ljg:stickers-updated',render);
  window.addEventListener('ljg:coins-updated',render);

  async function boot(){
    const generation=++bootGeneration;
    purchaseSyncState='loading';
    activateFilter(filter);
    try{
      if(Auth&&Auth.restoreUserFromSession)await Auth.restoreUserFromSession();
      if(generation!==bootGeneration)return;
      const uid=Auth&&Auth.currentUserId?Auth.currentUserId():null;
      A.hydrate(uid);
      purchaseSyncState=uid?'loading':'ready';
      activateFilter(filter);
      if(!uid){
        if(window.LJG_STORE)LJG_STORE.clear();
        return;
      }
      const coinSync=window.LJG_STORE?LJG_STORE.init(uid):Promise.resolve(false);
      const stickerSync=A.refresh(uid);
      const authSync=Auth&&Auth.refreshUser?Auth.refreshUser():Promise.resolve(null);
      const results=await Promise.allSettled([coinSync,stickerSync,authSync]);
      if(generation!==bootGeneration)return;
      const verifiedUid=Auth&&Auth.currentUserId?Auth.currentUserId():null;
      if(verifiedUid!==uid){boot();return;}
      const coinReady=results[0].status==='fulfilled'&&results[0].value!==false;
      const stickersReady=results[1].status==='fulfilled';
      purchaseSyncState=coinReady&&stickersReady?'ready':'offline';
      render();
      if(stickersReady)A.recordEvent('daily_visit',new Date().toISOString().slice(0,10)).catch(()=>{});
      if(purchaseSyncState==='offline')say('已显示本机缓存，联网后会自动同步');
    }catch(error){
      if(generation!==bootGeneration)return;
      purchaseSyncState='offline';
      render();
      say('已显示本机缓存，联网后会自动同步');
    }
  }
  if(Auth&&Auth.onChange)Auth.onChange(()=>boot());
  boot();
})();
