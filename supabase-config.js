/* ============================================================
 * Supabase 配置
 * ------------------------------------------------------------
 * url     : Supabase 项目的 Project URL（不要带 /rest/v1/）
 * anonKey : 公开密钥（anon / public / publishable），可以放心放在网页里，
 *           安全性由数据库的行级权限（RLS）保证——每人只能读写自己的数据。
 *           绝对不要把 service_role / secret key 填在这里。
 * ============================================================ */
window.SUPABASE_CONFIG = {
    url: 'https://iheqczqbyiunpawxryhg.supabase.co',
    anonKey: 'sb_publishable_bba9l2PYqmaNIZXwamA9LQ_KWurrv7_'
};
