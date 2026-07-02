/* 冷静购 · 小院贴纸摘要 */
(function () {
  'use strict';
  const preview=document.getElementById('stickerHallPreview');
  const count=document.getElementById('stickerHallCount');
  const percent=document.getElementById('stickerHallPercent');
  const progress=document.getElementById('stickerHallProgress');
  const placed=document.getElementById('stickerPlacedCount');
  const C=window.LJG_STICKER_CATALOG,S=window.LJG_STICKER_STORE,G=window.LJG_STICKER_ACHIEVEMENTS;
  if(!preview||!count||!percent||!progress||!placed||!C||!S)return;

  function orderedPreviewIds(owned){
    const ownedSet=new Set(owned);
    const recent=S.getRecentStickerIds().filter(id=>ownedSet.has(id));
    const ownedOrder=recent.concat(owned.filter(id=>!recent.includes(id)));
    const locked=C.stickers.filter(item=>!ownedSet.has(item.id)).map(item=>item.id);
    return ownedOrder.slice(0,3).concat(locked).slice(0,4);
  }
  function refresh(){
    const state=G?G.getState():{owned_ids:C.defaultStickerIds(),mode:'guest'};
    const owned=state.owned_ids||C.defaultStickerIds();
    const ownedSet=new Set(owned);
    const doc=S.loadAllLayouts();
    const total=Object.values(doc.scenes||{}).reduce((sum,list)=>sum+(list||[]).length,0);
    const ratio=Math.round(owned.length/C.stickers.length*100);
    count.textContent=owned.length+' / '+C.stickers.length+' 已收集';
    percent.textContent=ratio+'%';
    progress.style.width=ratio+'%';
    placed.textContent=total?'已摆放 '+total+' 枚':(state.mode==='account'?'继续解锁新贴纸':'登录后解锁成就');
    preview.innerHTML='';
    orderedPreviewIds(owned).forEach(id=>{
      const sticker=C.getSticker(id);if(!sticker)return;
      const item=document.createElement('span');
      item.className='hall-preview-item '+(ownedSet.has(id)?'owned':'locked');
      item.title=ownedSet.has(id)?sticker.name:sticker.unlock_rule.text;
      if(ownedSet.has(id)){
        const image=document.createElement('img');image.src=sticker.image;image.alt=sticker.name;item.appendChild(image);
      }else{
        const mark=document.createElement('b');mark.textContent='?';mark.setAttribute('aria-label','未获得贴纸');item.appendChild(mark);
      }
      preview.appendChild(item);
    });
    document.querySelectorAll('[data-hall-sticker]').forEach(card=>{
      const id=card.dataset.hallSticker;
      const sticker=C.getSticker(id);
      const price=card.querySelector('[data-hall-price]');
      const isOwned=ownedSet.has(id);
      card.classList.toggle('owned',isOwned);
      if(price&&sticker)price.textContent=isOwned?'已拥有':sticker.price+' 河币';
    });
  }
  window.addEventListener('focus',refresh);
  window.addEventListener('ljg:stickers-updated',refresh);
  window.addEventListener('ljg:layout-updated',refresh);
  window.addEventListener('storage',event=>{if(event.key&&event.key.startsWith('calm_sticker_scene_layouts.v2.'))refresh();});
  refresh();
})();
