/* ============================================================
 * Supabase 配置 —— 把下面两项换成你自己项目的值
 * ------------------------------------------------------------
 * 1. 打开 https://supabase.com ，用邮箱注册并新建一个项目（免费）
 * 2. 进入项目 → 左下角 Settings（齿轮）→ API
 * 3. 复制 "Project URL"          填到 url
 * 4. 复制 "anon / public" API key 填到 anonKey
 * 5. 在项目里执行一次建表 SQL（见 README.md「第一步」）
 *
 * 说明：anon key 是「公开」密钥，本来就放在网页里，安全性由数据库的
 *      行级权限（RLS）保证——每人只能读写自己的数据。
 * ============================================================ */
window.SUPABASE_CONFIG = {
    url: '',        // 例如：https://abcdefghijklmn.supabase.co
    anonKey: ''     // 例如：eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....
};
