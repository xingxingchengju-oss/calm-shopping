/* ============================================================
   冷静购 · 后端 API 客户端
   只暴露两个真实接口；统一超时(60s)与错误分类。
   错误对象：{kind:'fail'|'network'|'timeout', message, product?}
   ============================================================ */
(function () {
  const CFG = window.LJG_CONFIG || {};
  const API_BASE = CFG.API_BASE || '';      // 同源时留空；前后端分开时填 http://127.0.0.1:8000
  const TIMEOUT_MS = 60000;                  // 截图+搜索+LLM 并发，放宽到 60s

  async function post(path, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const headers = { 'Content-Type': 'application/json' };
    try {                                   // 前向兼容：带登录态 token（后端 MVP 暂不校验，未来限流/归属用）
      if (window.LJG_AUTH && window.LJG_AUTH.getAccessToken) {
        const tk = await window.LJG_AUTH.getAccessToken();
        if (tk) headers['Authorization'] = 'Bearer ' + tk;
      }
    } catch (e) { /* 离线/未登录，忽略 */ }
    let res;
    try {
      res = await fetch(API_BASE + path, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === 'AbortError') {
        throw { kind: 'timeout', message: '豚豚等太久啦，喘口气再丢一次试试？' };
      }
      throw { kind: 'network', message: '豚豚一时联系不上河对岸，检查下网络再丢一次～' };
    }
    clearTimeout(timer);

    let data = {};
    try { data = await res.json(); } catch (e) { data = {}; }

    if (!res.ok) {
      // 4xx 的 detail 多是给用户看的友好提示（如「请粘贴商品链接…」）；5xx 用温和兜底文案，不暴露后端报错。
      const detail = data && data.detail;
      const msg = (res.status >= 500 || !detail)
        ? '豚豚刚有点忙不过来，喘口气再丢一次试试～'
        : detail;
      throw { kind: 'fail', message: msg };
    }
    return data;
  }

  /** 识别商品（+口碑+行情+生成五问）。payload: {text} 或 {image:dataURL} */
  async function recognize(payload) {
    const data = await post('/api/recognize', payload);
    if (data && data.ok === false) {
      // 后端识别不出（拼多多无标题、截图不清等）——温和提示，不算崩
      throw { kind: 'fail', message: data.message || '这件豚豚没认出来～', product: data.product };
    }
    return data;
  }

  /** 生成冷静报告。payload: {session_id, answers:[{id,value}]} */
  async function report(payload) {
    return await post('/api/report', payload);
  }

  window.LJG_API = { recognize, report, TIMEOUT_MS };
})();
