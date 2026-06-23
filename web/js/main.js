/* ============================================================
   冷静购 · 河湾村前端主逻辑（接真实后端）
   流程：扑通 → 许愿瓶/羊皮纸动画(等后端出问卷) → 豚豚聊天式逐题问
        → 生成报告 → 买下它 / 继续漂着(入沉淀池) / 放手啦
   依赖：window.LJG_API（api.js）、window.LJG_STORE（store.js）
   红线：所有后端文本进 DOM 一律走 textContent 或 esc()，不裸拼 innerHTML。
   ============================================================ */

/* ---------- 安全工具 ---------- */
function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c=>(
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---------- 页签切换 ---------- */
const track=document.getElementById('track');
const yard=document.getElementById('yard'), me=document.getElementById('me');
const navBtns=document.querySelectorAll('.nav button');
const DIVE=-760;
function go(t){
  const navT=(t==='soil')?'soaking':t;   // 河床是「漂着」的更深一层，导航高亮仍归漂着
  navBtns.forEach(b=>b.classList.toggle('active',b.dataset.target===navT));
  yard.classList.toggle('on',t==='yard');
  me.classList.toggle('on',t==='me');
  if(t==='home') track.style.transform='translateY(0)';
  else if(t==='soaking') track.style.transform='translateY('+DIVE+'px)';
  else if(t==='soil') track.style.transform='translateY('+(DIVE*2)+'px)';   // 继续下潜到河床地层
}
navBtns.forEach(b=>b.addEventListener('click',()=>go(b.dataset.target)));
document.getElementById('diveBtn').addEventListener('click',()=>go('soaking'));
document.getElementById('upBtn').addEventListener('click',()=>go('home'));
document.getElementById('upBtn2').addEventListener('click',()=>go('home'));
document.getElementById('soilHint').addEventListener('click',()=>go('soil'));
document.getElementById('soilUp').addEventListener('click',()=>go('soaking'));
// 河床一直可点：有沉底就下潜，没有就温和提示一句（避免「点了没反应」）
document.querySelector('.riverbed').addEventListener('click',()=>{
  const sunk=LJG_STORE.getPool().filter(it=>depthFrac(it)>=1).length;
  if(sunk>0) go('soil'); else tip('河床还很干净～漂满 24 小时的东西才会落到这儿');
});

/* ---------- 轻提示 ---------- */
const toast=document.getElementById('toast');let tt;
function tip(t){toast.textContent=t;toast.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>toast.classList.remove('show'),2000);}
function backdropClose(el){el.addEventListener('click',e=>{if(e.target===el)el.classList.remove('show');});}

/* ---------- 河币：本地账本（持久化） ---------- */
const coinEl=document.getElementById('coin');
let coins=LJG_STORE.getCoins(parseInt(coinEl.textContent,10)||0);
coinEl.textContent=coins;
function setCoins(n){coins=n;coinEl.textContent=n;LJG_STORE.setCoins(n);}

/* ---------- 豚豚：眨眼 + 点一下说话 ---------- */
const capy=document.getElementById('capy');
const say=document.getElementById('say');
setInterval(()=>{capy.classList.add('blink');setTimeout(()=>capy.classList.remove('blink'),150);},4000);
const speakLines=['摸摸头～','要不要一起去河边坐坐？','别急，慢慢来嘛','省下的钱都在小院里啦','柚子真香','深夜想买的，多半是困了'];
let li=0;
capy.addEventListener('click',(e)=>{
  e.stopPropagation();li=(li+1)%speakLines.length;say.textContent=speakLines[li];
  capy.style.transform='translateX(-50%) scale(1.06)';setTimeout(()=>capy.style.transform='',180);
});
function capySay(t){ if(say) say.textContent=t; }

/* ============================================================
   核心：投递 → 过渡动画 → 识别
   ============================================================ */
const bottleStage=document.getElementById('bottleStage');
const dropBtn=document.getElementById('dropBtn');
const dropInput=document.getElementById('drop');
const shotBtn=document.getElementById('shotBtn');
const shotInput=document.getElementById('shotInput');

let busy=false;
function setBusy(b){ busy=b; if(dropBtn){dropBtn.disabled=b;dropBtn.style.opacity=b?'.6':'';} if(shotBtn) shotBtn.disabled=b; }

dropBtn.onclick=()=>{
  if(busy) return;
  const v=(dropInput.value||'').trim();
  if(!v){ capySay('先把链接或商品名丢进来呀～'); return; }
  startCast({text:v});
};
shotBtn.onclick=()=>{ if(!busy) shotInput.click(); };
shotInput.onchange=e=>{
  const f=e.target.files&&e.target.files[0]; if(!f) return;
  downscaleImage(f, 1280, url=>startCast({image:url}));   // 压缩后再识别/存档：省配额、上传更快
  e.target.value='';
};
/* 截图降采样：长边压到 maxEdge 的 JPEG；失败则退回原图 */
function downscaleImage(file, maxEdge, cb){
  const rd=new FileReader();
  rd.onload=()=>{
    const img=new Image();
    img.onload=()=>{
      try{
        const scale=Math.min(1, maxEdge/Math.max(img.width,img.height));
        const cw=Math.round(img.width*scale), ch=Math.round(img.height*scale);
        const cv=document.createElement('canvas'); cv.width=cw; cv.height=ch;
        cv.getContext('2d').drawImage(img,0,0,cw,ch);
        cb(cv.toDataURL('image/jpeg',0.82));
      }catch(err){ cb(rd.result); }
    };
    img.onerror=()=>cb(rd.result);
    img.src=rd.result;
  };
  rd.readAsDataURL(file);
}

/* 许愿瓶飞向豚豚 → 开盖 → 羊皮纸展开 → 豚豚读（循环说话拖时间）。
   返回一个 Promise，在入场动画演够 ~2.6s 后 resolve；读信循环到 stopReading 才停。 */
let readTimer=null;
function runBottleAnim(){
  bottleStage.classList.add('run');
  capy.classList.add('reading');
  capySay('咦，河里漂来一个瓶子，豚豚捞起来看看～');
  const readLines=['豚豚正在翻别人的真实评价…','这条评价有点意思…','再看看价格最近怎么走…','嗯…让豚豚认真读读羊皮纸～','马上好啦，再等豚豚一下下'];
  let ri=0;
  readTimer=setInterval(()=>{ ri=(ri+1)%readLines.length; capySay(readLines[ri]); }, 2200);
  return new Promise(res=>setTimeout(res,2600));
}
function stopReading(){
  if(readTimer){ clearInterval(readTimer); readTimer=null; }
  capy.classList.remove('reading');
  bottleStage.classList.remove('run');
}

let current=null, qi=0, lastInput=null;

async function startCast(payload){
  setBusy(true); go('home');
  lastInput=payload;                 // 记住原始输入（{text} 或 {image}），供「重新扑通」复用
  const intro=runBottleAnim();
  let data=null, err=null;
  try{ data=await LJG_API.recognize(payload); }
  catch(e){ err=e; }
  await intro;            // 保证入场动画演够（即使后端很快）
  stopReading();
  setBusy(false);
  if(err){ endCastFail(err); return; }
  endCastOk(data);
}
function endCastOk(data){
  current={
    session_id:data.session_id, product:data.product||{}, review:data.review||{},
    pricing:data.pricing||null, q:data.questionnaire||{questions:[]}, answers:[],
    input:lastInput
  };
  const name=(current.product&&current.product.name)||(current.q&&current.q.product_name)||'这件东西';
  capySay('在决定买「'+name+'」之前，豚豚想问你几个小问题～');
  setTimeout(openChat,1300);
}
function endCastFail(err){
  capySay((err&&err.message)||'这件豚豚没认出来，换个链接或截图再丢一次？');
}

/* ============================================================
   聊天式问卷
   ============================================================ */
const qpanel=document.getElementById('qpanel');
const qchat=document.getElementById('qchat');
const qinput=document.getElementById('qinput');
const qprog=document.getElementById('qprog');
backdropClose(qpanel);

function scrollChat(){ qchat.scrollTop=qchat.scrollHeight; }
function pushCapy(text, sub){
  const m=document.createElement('div'); m.className='chat-msg chat-capy'; m.textContent=text;
  if(sub){ const s=document.createElement('span'); s.className='chat-sub'; s.textContent='↳ '+sub; m.appendChild(s); }
  qchat.appendChild(m); scrollChat(); return m;
}
function pushUser(text){
  const m=document.createElement('div'); m.className='chat-msg chat-user'; m.textContent=text;
  qchat.appendChild(m); scrollChat(); return m;
}
function pushTyping(text){
  const m=document.createElement('div'); m.className='chat-msg chat-capy';
  if(text) m.textContent=text+' ';
  const dots=document.createElement('span'); dots.className='chat-typing';
  dots.innerHTML='<i></i><i></i><i></i>';
  m.appendChild(dots); qchat.appendChild(m); scrollChat(); return m;
}
function removeTyping(el){ if(el&&el.parentNode) el.parentNode.removeChild(el); }

function renderProg(){
  const qs=(current&&current.q&&current.q.questions)||[];
  qprog.innerHTML='';
  for(let i=0;i<qs.length;i++){ const d=document.createElement('i'); if(i<qi) d.className='on'; qprog.appendChild(d); }
}

function openChat(){
  qi=0; qchat.innerHTML=''; qinput.innerHTML='';
  renderProg();
  qpanel.classList.add('show');
  if(current.q.intro) pushCapy(current.q.intro);
  setTimeout(askQuestion,480);
}
function askQuestion(){
  const qs=current.q.questions||[];
  if(qi>=qs.length) return finishChat();
  const q=qs[qi];
  renderProg();
  pushCapy(q.question, q.question_reason);
  setTimeout(()=>renderControl(q),280);
}

function mkSend(label){ const b=document.createElement('button'); b.className='qsend'; b.textContent=label; return b; }

/* 各 interaction_type → 内联控件；作答值格式严格对齐后端 score_answer。 */
function renderControl(q){
  qinput.innerHTML='';
  const t=q.interaction_type;
  if(t==='bubble_single' || t==='two_choice'){
    const wrap=document.createElement('div'); wrap.className='chips';
    (q.options||[]).forEach(o=>{
      const c=document.createElement('button'); c.className='qchip'; c.textContent=o.label;
      c.onclick=()=>submitAnswer(q,o.value,o.label);
      wrap.appendChild(c);
    });
    qinput.appendChild(wrap);
  } else if(t==='bubble_multi'){
    const wrap=document.createElement('div'); wrap.className='chips';
    const chosen=new Set();
    (q.options||[]).forEach(o=>{
      const c=document.createElement('button'); c.className='qchip'; c.textContent=o.label;
      c.onclick=()=>{ if(chosen.has(o.value)){chosen.delete(o.value);c.classList.remove('on');}else{chosen.add(o.value);c.classList.add('on');} };
      wrap.appendChild(c);
    });
    qinput.appendChild(wrap);
    const send=mkSend('就这些～');
    send.onclick=()=>{
      const vals=[...chosen];
      const labels=(q.options||[]).filter(o=>chosen.has(o.value)).map(o=>o.label);
      submitAnswer(q, vals, labels.join('、')||'（先跳过）');
    };
    qinput.appendChild(send);
  } else if(t==='slider'){
    const s=q.slider||{min:0,max:10,step:1};
    const box=document.createElement('div'); box.className='qslider';
    const sv=document.createElement('div'); sv.className='sv'; sv.textContent=s.min;
    const range=document.createElement('input'); range.type='range';
    range.min=s.min; range.max=s.max; range.step=s.step||1; range.value=s.min;
    range.oninput=()=>sv.textContent=range.value;
    const sl=document.createElement('div'); sl.className='sl';
    const a=document.createElement('span'); a.textContent=s.min_label||s.min;
    const b=document.createElement('span'); b.textContent=s.max_label||s.max;
    sl.appendChild(a); sl.appendChild(b);
    box.appendChild(sv); box.appendChild(range); box.appendChild(sl);
    qinput.appendChild(box);
    const send=mkSend('嗯，差不多');
    send.onclick=()=>submitAnswer(q, parseInt(range.value,10), String(range.value));
    qinput.appendChild(send);
  } else { /* sentence_complete */
    const inp=document.createElement('input'); inp.type='text'; inp.className='qtext';
    inp.placeholder=(q.input&&q.input.placeholder)||'说说看～';
    const submit=()=>{ const v=inp.value.trim(); submitAnswer(q, v, v||'（先跳过）'); };
    inp.onkeydown=e=>{ if(e.key==='Enter') submit(); };
    qinput.appendChild(inp);
    const send=mkSend('告诉豚豚'); send.onclick=submit; qinput.appendChild(send);
    setTimeout(()=>inp.focus(),60);
  }
}
function submitAnswer(q,value,echo){
  current.answers.push({id:q.id, value:value});
  pushUser(echo);
  qi++; renderProg(); qinput.innerHTML='';
  setTimeout(askQuestion,430);
}

/* ============================================================
   报告 + 决定
   ============================================================ */
function leanLabel(l){ return {buy:'偏向 · 想买',keep_floating:'偏向 · 再漂漂',let_go:'偏向 · 放手'}[l]||'看你的'; }
function actLabel(k, ctx){
  if(k==='keep_floating') return ctx==='soil'?'继续沉淀':(ctx==='float'?'继续漂着':'先丢进沉淀池');
  return {buy:'立即买下它',let_go:'放手啦',re_eval:'重新扑通一下'}[k]||k;
}
function confLabel(c){ return {high:'高',medium:'中',low:'低'}[c]||c||'—'; }

async function finishChat(){
  renderProg();
  const typing=pushTyping('豚豚在写冷静报告');
  let rep=null, err=null;
  try{ rep=await LJG_API.report({session_id:current.session_id, answers:current.answers}); }
  catch(e){ err=e; }
  removeTyping(typing);
  if(err){
    pushCapy((err&&err.message)||'报告生成失败了，再等等？');
    qinput.innerHTML='';
    const retry=mkSend('再试一次'); retry.onclick=finishChat; qinput.appendChild(retry);
    return;
  }
  current.report=rep;
  renderReport(rep);
}

function renderReport(rep, ctx){
  rep=rep||{}; ctx=ctx||'fresh';            // 'fresh'=刚答完 / 'float'=水里漂着 / 'soil'=河床地层
  const lean=rep.lean||'keep_floating';
  const card=document.createElement('div'); card.className='chat-msg chat-capy report-msg';
  card.innerHTML=
    '<div class="report-card">'+
      '<div class="rc-head"><span class="lean-badge '+esc(lean)+'">'+esc(leanLabel(lean))+'</span>'+
        '<span class="rc-conf">置信 '+esc(confLabel(rep.confidence))+'</span></div>'+
      '<div class="rc-row"><b>风评里看到</b>'+esc(rep.review_digest||'—')+'</div>'+
      '<div class="rc-row"><b>你的信号</b>'+esc(rep.your_signals||'—')+'</div>'+
      '<div class="rc-row sug"><b>豚豚建议</b>'+esc(rep.suggestion_text||'—')+'</div>'+
    '</div>';
  qchat.appendChild(card); scrollChat();
  qinput.innerHTML='';
  const acts=((rep.actions&&rep.actions.length)?rep.actions:[{key:'buy'},{key:'keep_floating'},{key:'let_go'}]).slice();
  if(ctx!=='fresh') acts.push({key:'re_eval'});   // 池中/河床项可「重新扑通」
  const row=document.createElement('div'); row.className='report-acts';
  acts.forEach(a=>{
    const b=document.createElement('button');
    b.className='ract '+a.key+(a.key===lean?' hl':'');
    b.textContent=actLabel(a.key, ctx);
    b.onclick=()=>onAction(a.key);
    row.appendChild(b);
  });
  qinput.appendChild(row);
}

function priceOf(o){ const v=o&&o.price; return (typeof v==='number'&&isFinite(v))?v:null; }

function onAction(key){
  const fromPool=current&&current.fromPool;
  if(key==='re_eval'){ reEvaluate(current.poolId); return; }
  if(key==='buy'){
    if(fromPool){ LJG_STORE.removePoolItem(current.poolId); renderPool(); }
    closeChat(); tip('好，这个买得安心～'); return;
  }
  if(key==='keep_floating'){
    if(fromPool){
      const it=LJG_STORE.getPoolItem(current.poolId);
      closeChat(); tip(it&&depthFrac(it)>=1?'好，让它继续在河床躺着～':'好，让它再漂一会儿～'); return;
    }
    floatToPool(); closeChat(); tip('扑通 · 让它在沉淀池里漂着'); setTimeout(()=>go('soaking'),320); return;
  }
  if(key==='let_go'){
    let price, deliberated=false;
    if(fromPool){
      const it=LJG_STORE.getPoolItem(current.poolId);
      price=it?it.price:null; deliberated=!!(it&&depthFrac(it)>=1);
      LJG_STORE.removePoolItem(current.poolId); renderPool();
    } else { price=priceOf(current.product); }
    closeChat(); askReward(price, deliberated); return;
  }
}

/* 重新扑通：用存好的原始输入复跑一遍（无需再传链接/截图），相当于重置重评 */
function reEvaluate(id){
  const it=LJG_STORE.getPoolItem(id); if(!it) return;
  if(!it.input){                          // 图片被配额丢了 / 老数据无 input → 降级为重新丢图
    closeChat(); go('home');
    if(dropInput) dropInput.value=it.title||'';
    capySay('这件当时是截图认的，把图再丢一次，豚豚帮你重新看看～');
    return;
  }
  LJG_STORE.removePoolItem(id); renderPool();
  closeChat();
  if(dropInput && it.input.text) dropInput.value=it.input.text;
  startCast(it.input);                    // 内部 go('home') + 走完整流程
}

function closeChat(){ qpanel.classList.remove('show'); current=null; }

/* 继续漂着 → 入沉淀池，存「完整决策档案」便于以后回看 */
function floatToPool(){
  const p=current.product||{}, rep=current.report||{}, t=LJG_STORE.now();
  LJG_STORE.addPoolItem({
    id:'it_'+t.toString(36)+Math.random().toString(36).slice(2,6),
    title: p.name || (current.q&&current.q.product_name) || '一件小心动',
    price: priceOf(p),
    product:p, report:rep, answers:current.answers||[],
    review_digest: rep.review_digest||'', score_summary: rep.score_summary||{},
    session_id: current.session_id||null, input: current.input||null,
    floatedAt:t, createdAt:t
  });
  renderPool();
}

/* ---------- 放手 → 奖励弹层（price 可能为 null，用安全默认值） ---------- */
const reward=document.getElementById('reward'); backdropClose(reward);
const rewardOk=document.getElementById('rewardOk');
let pendingCoins=0, pendingDeliberated=false;
function coinAmount(price){ return (typeof price==='number'&&isFinite(price)&&price>0)?Math.round(price):30; }
function askReward(price, deliberated){
  pendingDeliberated=!!deliberated;
  pendingCoins=coinAmount(price)+(deliberated?20:0);          // 在河床躺过 24h 才放手，多给一点正向反馈
  const em=reward.querySelector('.rg em'); if(em) em.textContent='+'+pendingCoins;
  const h=reward.querySelector('h3'); if(h) h.textContent=deliberated?'想了这么久，还能放手':'漂走了，放手啦';
  reward.classList.add('show');
}
rewardOk.addEventListener('click',()=>{
  reward.classList.remove('show');
  setCoins(coins+pendingCoins);
  tip((pendingDeliberated?'真棒，想通了 · +':'+')+pendingCoins+' 河币 · 收进小院啦');
  pendingCoins=0; pendingDeliberated=false;
  setTimeout(()=>go('yard'),420);
});

/* ============================================================
   沉淀池：按真实时间下沉，24h 沉底；点开看回报告 + 可再决定
   ============================================================ */
const pool=document.getElementById('pool');
const poolCount=document.getElementById('poolCount');
const diveCount=document.getElementById('diveCount');
const soilStrata=document.getElementById('soilStrata');
const soilCount=document.getElementById('soilCount');
const soilEmpty=document.getElementById('soilEmpty');
const soilHint=document.getElementById('soilHint');
const riverbedCount=document.getElementById('riverbedCount');
let lastFloatingIds=new Set();
const SINK_MS=24*3600*1000;     // 真实 24 小时沉底（可注入 window.__LJG_NOW 验收）

function depthFrac(it){ return Math.max(0, Math.min(1,(LJG_STORE.now()-(it.floatedAt||0))/SINK_MS)); }
function updateHints(n){ if(poolCount) poolCount.textContent='漂着的 · '+n+' 件'; if(diveCount) diveCount.textContent=n; }

function renderPool(){
  const all=LJG_STORE.getPool();
  const floating=all.filter(it=>depthFrac(it)<1);
  const sunk=all.filter(it=>depthFrac(it)>=1).sort((a,b)=>(b.floatedAt||0)-(a.floatedAt||0)); // 新沉底在上，越老越靠下
  const newlySunk=new Set(sunk.filter(it=>lastFloatingIds.has(it.id)).map(it=>it.id));
  // —— 水里（<24h，漂着的泡泡）——
  pool.innerHTML='';
  if(!floating.length){
    const e=document.createElement('div'); e.className='pool-empty';
    e.textContent='还没有漂着的东西～把想买的丢进河里试试';
    pool.appendChild(e);
  } else {
    floating.forEach(it=>pool.appendChild(buildBubble(it)));
    positionPool();
  }
  updateHints(floating.length);
  // —— 河床（>=24h，泥土层）——
  renderStrata(sunk, newlySunk);
  lastFloatingIds=new Set(floating.map(it=>it.id));
}
function buildBubble(it){
  const b=document.createElement('div'); b.className='bub float'; b.dataset.id=it.id;
  const clip=document.createElement('div'); clip.className='bub-clip';
  const inner=document.createElement('div'); inner.className='b-in';
  const t=document.createElement('div'); t.className='b-title'; t.textContent=it.title||'心动';
  const s=document.createElement('div'); s.className='b-sub'; s.textContent=(typeof it.price==='number')?('¥'+it.price):'看过报告';
  const tag=document.createElement('div'); tag.className='b-tag'; tag.textContent='看报告';
  inner.appendChild(t); inner.appendChild(s); inner.appendChild(tag);
  clip.appendChild(inner); b.appendChild(clip);
  b.onclick=()=>openPoolItem(it.id);
  return b;
}
function positionPool(){
  const floating=LJG_STORE.getPool().filter(it=>depthFrac(it)<1);
  const cols=Math.min(Math.max(floating.length,1),3);
  const colW=100/(cols+1);
  pool.querySelectorAll('.bub.float').forEach((b,i)=>{
    const it=floating[i]; if(!it) return;
    const f=depthFrac(it);
    const left=colW*((i%cols)+1);
    const top=8 + f*76 + ((Math.floor(i/cols)%2)?8:0);   // 越接近 24h 越贴近河床
    b.style.left='calc('+left+'% - 58px)';
    b.style.top=top+'%';
  });
}

/* 河床地层：每条 = 一件沉底商品；越靠下（越老）颜色越深 */
function soilShade(t){                      // t:0(最上,新)→1(最下,老)
  const a=[138,107,68], b=[58,42,23];       // #8a6b44 → #3a2a17
  const c=a.map((v,k)=>Math.round(v+(b[k]-v)*Math.max(0,Math.min(1,t))));
  return 'rgb('+c[0]+','+c[1]+','+c[2]+')';
}
function buildStratum(it,i,total,isNew){
  const el=document.createElement('div'); el.className='stratum'+(isNew?' settling':''); el.dataset.id=it.id;
  el.style.background=soilShade(total<=1?0:i/(total-1));
  const name=document.createElement('div'); name.className='st-name'; name.textContent=it.title||'一件小心动';
  const meta=document.createElement('div'); meta.className='st-meta';
  if(typeof it.price==='number'){ const p=document.createElement('span'); p.className='st-price'; p.textContent='¥'+it.price; meta.appendChild(p); }
  const days=Math.floor((LJG_STORE.now()-(it.floatedAt||0))/86400000);
  const age=document.createElement('span'); age.textContent='沉底 '+Math.max(1,days)+' 天';
  meta.appendChild(age);
  el.appendChild(name); el.appendChild(meta);
  el.onclick=()=>openPoolItem(it.id);
  return el;
}
function renderStrata(sunk, newlySunk){
  newlySunk=newlySunk||new Set();
  if(soilCount) soilCount.textContent=sunk.length;
  if(riverbedCount) riverbedCount.textContent=sunk.length;
  if(soilHint) soilHint.classList.toggle('hidden', sunk.length===0);
  if(soilEmpty) soilEmpty.classList.toggle('hidden', sunk.length>0);
  if(!soilStrata) return;
  soilStrata.innerHTML='';
  sunk.forEach((it,i)=>soilStrata.appendChild(buildStratum(it,i,sunk.length,newlySunk.has(it.id))));
}
setInterval(()=>{
  let crossed=false;
  LJG_STORE.getPool().forEach(it=>{ if(lastFloatingIds.has(it.id) && depthFrac(it)>=1) crossed=true; });
  if(crossed) renderPool();                              // 有新沉底 → 重渲染（含落床动画）
  else if(pool.querySelector('.bub.float')) positionPool();
}, 10000);

function openPoolItem(id){
  const it=LJG_STORE.getPoolItem(id); if(!it) return;
  const sunk=depthFrac(it)>=1;
  current={
    session_id:it.session_id, product:it.product||{name:it.title,price:it.price},
    report:it.report||{}, answers:it.answers||[], input:it.input||null,
    fromPool:true, poolId:id, q:{product_name:it.title,questions:[]}
  };
  qprog.innerHTML=''; qchat.innerHTML=''; qinput.innerHTML='';
  qpanel.classList.add('show');
  pushCapy(sunk ? ('这是「'+(it.title||'它')+'」沉在河床时的冷静报告，挖出来再看看～')
               : ('这是「'+(it.title||'它')+'」当时的冷静报告，给你看回～'));
  renderReport(it.report||{}, sunk?'soil':'float');
}

/* ============================================================
   小院图鉴 / 商店 / 我（与后端无关，沿用原型）
   ============================================================ */
const peek=document.getElementById('peek'); backdropClose(peek);
document.getElementById('peekOk').addEventListener('click',()=>peek.classList.remove('show'));
function openPeek(svg,name,desc){
  document.getElementById('peekPic').innerHTML=svg;
  document.getElementById('peekTag').textContent='图鉴 · 已收集';
  document.getElementById('peekTitle').textContent=name;
  document.getElementById('peekDesc').textContent=desc;
  peek.classList.add('show');
}
function bindDex(){
  document.querySelectorAll('.dex .cell').forEach(c=>{
    c.onclick=()=>{
      if(c.classList.contains('locked')){tip('还没解锁～放手攒河币，邀请新伙伴来住');return;}
      openPeek(c.querySelector('svg').outerHTML,c.dataset.name||'',c.dataset.desc||'');
    };
  });
}
bindDex();

const dexCount=document.getElementById('dexCount');let unlocked=3;
const duckSVG='<svg viewBox="0 0 48 48"><ellipse cx="21" cy="32" rx="15" ry="11" fill="#ffd95b"/><path d="M7 32a14 10 0 0 0 28 0z" fill="#f3c12f" opacity=".55"/><path d="M8 28q-5 0-6 3.4 3.4 1.2 6.6-1z" fill="#ffe27a"/><path d="M15 30q6.5-5.2 13.5-1.4-4.6 5-13.5 1.4z" fill="#f7c948"/><circle cx="33" cy="18" r="9.2" fill="#ffe27a"/><path d="M32 9.2q.8-3 3.2-2.2-1.2 1.6-.6 3.2z" fill="#f7c948"/><circle cx="34.6" cy="16.4" r="2.1" fill="#43341f"/><circle cx="35.4" cy="15.6" r=".75" fill="#fff"/><path d="M41 17.6q6 -.6 6 2.3 0 2.7-6 1.6z" fill="#f0892b"/><path d="M41.4 20q2.8 .3 5.2 .1" stroke="#d2731f" stroke-width=".9" fill="none"/></svg>';
document.querySelectorAll('.btn-buy').forEach(btn=>{
  btn.addEventListener('click',()=>{
    if(btn.disabled) return;
    const price=parseInt(btn.dataset.price,10);
    if(coins<price){tip('河币还差 '+(price-coins)+' 枚 · 多放手几件再来');return;}
    setCoins(coins-price);
    btn.textContent='已布置 ✓';btn.disabled=true;btn.style.opacity='.5';btn.style.boxShadow='none';
    if(btn.dataset.unlock==='duck'){
      const lock=document.querySelector('.dex .cell.locked');
      if(lock){
        lock.classList.remove('locked');
        lock.dataset.name='小黄鸭';
        lock.dataset.desc='被你从河里捞起来的小黄鸭，决定住进小院，给河湾添点热闹。';
        lock.innerHTML=duckSVG+'<span>小黄鸭</span>';
        unlocked++;dexCount.textContent=unlocked+' / 9 已解锁';bindDex();
      }
      tip('小黄鸭住进来啦 · 图鉴 +1');
    }else{
      tip('「'+btn.dataset.item+'」已布置到小院 🌿');
    }
  });
});

const meTips={'提醒时间':'demo · 每晚 23:30 轻轻提醒，别熬夜下单','河湾主题':'demo · 当前「晴日河」，更多主题攒河币解锁','豚豚的零食':'demo · 正在投喂柚子，豚豚很满足','安稳夜记录':'demo · 已连续 4 夜没有冲动消费','数据与隐私':'demo · 数据本地优先，不上传云端'};
document.querySelectorAll('.melist .mr').forEach(r=>{
  r.addEventListener('click',()=>{const k=(r.childNodes[0].textContent||'').trim();tip(meTips[k]||'demo · 暂未开放');});
});
document.querySelector('.streak').addEventListener('click',()=>tip('连续 4 晚没有冲动下单，豚豚很安心'));
document.querySelector('.quest').addEventListener('click',()=>tip('今天已经有 2 件漂进河里啦 · +8 河币'));

/* ---------- 启动 ---------- */
renderPool();
