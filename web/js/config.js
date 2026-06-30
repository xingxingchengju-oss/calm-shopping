/* ============================================================
   冷静购 · 前端配置
   - API_BASE：后端同源时留空；前后端分开起时填 http://127.0.0.1:8000
   - SUPABASE_*：匿名 anon/publishable key 是「可公开」的，安全性靠数据库 RLS 兜底
     （绝不要把 service_role / secret key 放进前端）
   ============================================================ */
window.LJG_CONFIG = {
  API_BASE: '',
  // 线上可填完整回跳地址；留空时使用当前页面的 ?auth=recovery。该地址需加入 Supabase Redirect URLs。
  AUTH_REDIRECT_URL: '',
  SUPABASE_URL: 'https://vcxpgxnoyaosnwznpypq.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_6QhxjDxPZSxIRG4UIgJAOg_A5FZRsSp',
};
