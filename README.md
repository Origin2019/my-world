# 我的世界 · 网页版

待办 · DDL 倒计时 · 课程表 · 便签 的个人管理面板。纯网页，手机和电脑都能打开，
登录同一个账号后数据自动同步，并可「添加到主屏幕」像 App 一样一键打开。

---

## 三步上线

### 第一步：建一个 Supabase 云端数据库（免费）

1. 打开 <https://supabase.com> ，用邮箱注册，点 **New project** 新建项目
   （Region 选离你近的，比如 Singapore；数据库密码随便设一个，记住即可）。
2. 等 1~2 分钟项目建好，在左侧点 **SQL Editor** → **New query**，
   把下面整段粘进去，点 **Run**：

```sql
-- 用户数据表：一行 = 一个人的全部数据
create table if not exists public.userdata (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 开启行级安全（RLS）：每个人只能读写属于自己的那一行
alter table public.userdata enable row level security;

create policy "read own data"   on public.userdata for select using (auth.uid() = user_id);
create policy "insert own data" on public.userdata for insert with check (auth.uid() = user_id);
create policy "update own data" on public.userdata for update using (auth.uid() = user_id);
```

3. （可选，更省事）左侧 **Authentication → Sign In / Providers → Email**，
   把 **Confirm email** 关掉。这样注册后不用点邮件链接就能直接登录。
4. 左侧齿轮 **Settings → API**，记下两个值：
   - **Project URL**（形如 `https://abcdefg.supabase.co`）
   - **anon / public** 那把 key（`eyJ...` 开头的一长串）

### 第二步：把这两个值填进配置

打开同目录下的 `supabase-config.js`，填进去：

```js
window.SUPABASE_CONFIG = {
    url: 'https://abcdefg.supabase.co',
    anonKey: 'eyJhbGciOi...'
};
```

> `anon key` 是「公开」密钥，本来就是给网页用的，别人看到也没关系；
> 真正的安全靠上面那段 RLS 规则（每人只能读写自己的数据）。

### 第三步：部署到 GitHub Pages（免费）

1. 到 <https://github.com> 注册/登录，右上角 **+ → New repository**，
   仓库名随意（例如 `myworld`），选 **Public**，点 **Create repository**。
2. 在新建的空仓库页面点 **uploading an existing file**，
   把**本目录（web）里的所有文件**拖进去（`index.html`、`style.css`、`app.js`、
   `sync.js`、`supabase-config.js`、`sw.js`、`manifest.webmanifest`、四个 `.png` 图标）。
   下面的 **Commit changes** 点一下。
3. 仓库页 **Settings → Pages**：
   - **Source** 选 `Deploy from a branch`
   - **Branch** 选 `main`，目录选 `/ (root)`，点 **Save**
4. 等 1 分钟左右，页面顶部会出现网址，形如：

   `https://你的用户名.github.io/myworld/`

   在电脑浏览器打开它，点右上角 **☁ 未登录** → 注册账号 → 登录，数据就会开始上云。

---

## 手机怎么用

1. 手机浏览器打开上面那个网址。
2. **iPhone（Safari）**：点底部「分享」按钮 → **添加到主屏幕**。
   **安卓（Chrome）**：点右上角「⋮」→ **添加到主屏幕 / 安装应用**。
3. 桌面上就多了一个「我的世界」图标，以后点它直接打开，跟原生 App 一样。
4. 在里面用**同一个账号**登录，数据立刻和电脑同步。

> 提示：想在电脑上也装成 App，用 Chrome 打开网址，地址栏右侧会有「安装」图标，点一下即可。

---

## 把电脑上桌面版的老数据搬过来

你桌面上原来的 Electron 版（整个「我的世界」文件夹）数据都存在 `userdata.json` 里。

1. 用电脑浏览器打开你的网页版网址。
2. 点 **☁** → **从文件导入数据**，选中原来那个 `userdata.json`。
3. 页面会刷新，然后登录账号 → 数据自动上传到云端 → 手机登录同一账号即可看到。

（反过来也可用 **导出备份** 把网页版数据存成 json 文件留底。）

---

## 常见问题

- **手机和电脑不同步？** 确认两端登录的是同一个邮箱账号；打开面板点「立即同步」。
  拖动/修改后有 1.5 秒防抖，稍等一下。
- **右上角显示「未配置」？** `supabase-config.js` 里的 `url` / `anonKey` 没填或填错。
- **显示「同步失败」？** 多半是网络问题，会自动重试；也可能是建表 SQL 没执行成功。
- **在两台设备同时改同一条**，以最后修改的那台为准（个人工具够用，不做逐条合并）。
- **不登录能不能用？** 能。不登录时数据只存在当前浏览器本地，只是不能跨设备同步。
- **注意隐私**：GitHub Pages 上的网页是公开的，任何人都能打开你的网址，但打开后是空的
  （他们没登录、也没有你的本地数据）。你的数据只存在 Supabase 里，由 RLS 保护。

---

## 本目录文件说明

| 文件 | 作用 |
| --- | --- |
| `index.html` | 页面结构 |
| `style.css` | 样式（含手机端适配） |
| `app.js` | 界面逻辑 |
| `sync.js` | 数据层 + 云同步 + 同步面板 |
| `supabase-config.js` | 你要填的 Supabase 配置 |
| `sw.js` | Service Worker（离线可用、可安装） |
| `manifest.webmanifest` | PWA 清单（App 图标、名称等） |
| `icon-192.png` / `icon-512.png` / `icon-maskable-512.png` / `apple-touch-icon.png` | 应用图标 |
| `make-icons.js` | 重新生成图标的脚本（`node make-icons.js`） |
| `serve.js` / `本地预览.bat` | 仅用于本地预览，不必上传到 GitHub |

> 首次部署不必传 `make-icons.js`、`serve.js`、`本地预览.bat`、`README.md`，但传上去也无妨。
