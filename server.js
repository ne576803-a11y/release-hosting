const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;
const REPO = process.env.REPO_FULL_NAME || 'nusratbytxrs/release-hosting';
const SITE_NAME = process.env.SITE_NAME || 'Release Hosting';
const TOKEN = process.env.GITHUB_TOKEN || '';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const IS_PROD = process.env.NODE_ENV === 'production';
const MAX_MB = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 100));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-hosting-'));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tempDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}-${path.basename(file.originalname)}`)
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024 }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '2mb' }));

/* ============ helpers ============ */
const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const safeName = value => { const name = path.basename(String(value || '')).replace(/[\\/]/g, '-').trim(); return name && name !== '.' && name !== '..' ? name : ''; };
const extension = name => path.extname(String(name || '')).toLowerCase();
const preserveExtension = (newName, oldName) => {
  const oldExt = extension(oldName);
  let clean = safeName(newName);
  if (!clean) return '';
  if (oldExt) {
    clean = clean.replace(/\.[^/.]+$/, '').trim();
    if (!clean) return '';
    return clean + oldExt;
  }
  return clean;
};

/* ============ timing-safe compare ============ */
function safeEqual(a, b) {
  const A = Buffer.from(String(a ?? ''));
  const B = Buffer.from(String(b ?? ''));
  if (A.length !== B.length) return false;
  try { return crypto.timingSafeEqual(A, B); } catch { return false; }
}

const requestKey = req => req.headers['x-admin-key'] || '';
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(500).json({ ok: false, error: 'ADMIN_KEY is not configured.' });
  if (!safeEqual(requestKey(req), ADMIN_KEY)) return res.status(401).json({ ok: false, error: 'Invalid admin key.' });
  next();
}

/* ============ error sanitizer ============ */
function sendError(res, err, fallbackStatus = 500, fallbackMsg = 'Something went wrong.') {
  const status = Number.isInteger(err?.status) ? err.status : fallbackStatus;
  const message = err?.message || 'Unknown error';
  console.error(`[ERROR] ${res.req?.path || '-'} ${status}: ${message}`, err?.stack || '');
  if (IS_PROD) return res.status(status).json({ ok: false, error: status >= 500 ? fallbackMsg : message });
  return res.status(status).json({ ok: false, error: message });
}

/* ============ GitHub API ============ */
async function githubApi(apiPath, options = {}) {
  if (!TOKEN) throw new Error('GITHUB_TOKEN is not configured.');
  const response = await fetch(`https://api.github.com${apiPath}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) {
    const error = new Error(data.message || `GitHub API returned ${response.status}`);
    error.status = response.status;
    error.github = data;
    throw error;
  }
  return data;
}
const getReleases = () => githubApi(`/repos/${REPO}/releases?per_page=100`);
const getReleaseByTag = tag => githubApi(`/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`);
const getReleaseById = id => githubApi(`/repos/${REPO}/releases/${encodeURIComponent(id)}`);

function uploadAsset(releaseId, filename, type, filePath, size) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'uploads.github.com',
      method: 'POST',
      path: `/repos/${REPO}/releases/${encodeURIComponent(releaseId)}/assets?name=${encodeURIComponent(filename)}`,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': type || 'application/octet-stream',
        'Content-Length': String(size),
        Connection: 'close'
      },
      timeout: 30 * 60 * 1000
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        let data = {};
        try { data = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch {}
        resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode || 500, data });
      });
    });
    req.on('timeout', () => req.destroy(new Error('GitHub upload timed out.')));
    req.on('error', reject);
    const stream = fs.createReadStream(filePath);
    stream.on('error', error => { req.destroy(); reject(error); });
    stream.pipe(req);
  });
}

/* ============ CSS ============ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
:root{--bg:#07080d;--bg-2:#0d0f17;--surface:rgba(20,23,33,.72);--surface-2:rgba(28,32,46,.6);--surface-solid:#141721;--text:#eef2f9;--muted:#8b95a7;--line:rgba(255,255,255,.08);--line-strong:rgba(255,255,255,.14);--accent:#7c5cff;--accent-2:#4f9cff;--good:#22d39d;--info:#69b7ff;--warn:#ffb84d;--danger:#ff5f7e;--shadow-lg:0 25px 60px -20px rgba(0,0,0,.7);--shadow-md:0 12px 32px -12px rgba(0,0,0,.55);--radius:16px;--radius-sm:11px}
body.light{--bg:#eef2f9;--bg-2:#e6ebf4;--surface:rgba(255,255,255,.85);--surface-2:rgba(255,255,255,.6);--surface-solid:#ffffff;--text:#0e1420;--muted:#5c6678;--line:rgba(10,20,40,.08);--line-strong:rgba(10,20,40,.16);--shadow-lg:0 25px 60px -25px rgba(30,50,90,.25);--shadow-md:0 12px 32px -14px rgba(30,50,90,.2)}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;font-family:'Inter',system-ui,-apple-system,'Segoe UI',Arial,sans-serif;font-feature-settings:'cv02','cv03','cv04','cv11';color:var(--text);background:radial-gradient(1200px 600px at 10% -10%,rgba(124,92,255,.18),transparent 60%),radial-gradient(900px 500px at 100% 0%,rgba(79,156,255,.14),transparent 55%),linear-gradient(180deg,var(--bg) 0%,var(--bg-2) 100%);background-attachment:fixed;min-height:100vh;-webkit-font-smoothing:antialiased;letter-spacing:-.01em}
a{color:inherit;text-decoration:none}
button{font-family:inherit}
.container{width:min(1180px,calc(100% - 32px));margin:auto}
header{position:sticky;top:0;z-index:50;background:color-mix(in srgb,var(--bg) 78%,transparent);backdrop-filter:blur(18px) saturate(180%);-webkit-backdrop-filter:blur(18px) saturate(180%);border-bottom:1px solid var(--line)}
.nav{min-height:72px;display:flex;align-items:center;justify-content:space-between;gap:14px}
.logo{display:inline-flex;align-items:center;gap:10px;font-weight:800;font-size:19px;letter-spacing:-.02em}
.logo .mark{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;background:linear-gradient(135deg,var(--accent),var(--accent-2));box-shadow:0 8px 22px -8px var(--accent);font-size:17px;color:#fff}
.nav-links{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 16px;font-size:14px;font-weight:600;border:1px solid var(--line-strong);border-radius:var(--radius-sm);background:var(--surface-2);color:var(--text);cursor:pointer;transition:all .2s cubic-bezier(.4,0,.2,1);white-space:nowrap;font-family:inherit}
.btn:hover{transform:translateY(-1px);border-color:color-mix(in srgb,var(--accent) 60%,var(--line-strong));background:var(--surface)}
.btn:active{transform:translateY(0)}
.btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
.btn.primary{border:0;background:linear-gradient(135deg,var(--accent) 0%,var(--accent-2) 100%);color:#fff;box-shadow:0 12px 26px -12px var(--accent)}
.btn.primary:hover{box-shadow:0 16px 32px -12px var(--accent);filter:brightness(1.06)}
.btn.danger{color:var(--danger)}
.btn.danger:hover{border-color:color-mix(in srgb,var(--danger) 60%,transparent);background:color-mix(in srgb,var(--danger) 12%,transparent)}
.btn.ghost{background:transparent}
.btn.sm{padding:7px 12px;font-size:13px}
.btn.icon{padding:8px;width:38px;height:38px}
main{padding:36px 0 80px}
.hero{padding:34px 0 22px;display:flex;flex-wrap:wrap;gap:18px;align-items:flex-end;justify-content:space-between}
.hero-left{flex:1;min-width:260px}
.hero h1{font-size:clamp(30px,5vw,56px);font-weight:900;letter-spacing:-.035em;line-height:1.05;margin:0 0 12px;background:linear-gradient(135deg,var(--text) 0%,color-mix(in srgb,var(--text) 55%,var(--accent)) 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{max-width:640px;font-size:16px;line-height:1.6;margin:0}
.muted{color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px}
.card,.asset{position:relative;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:24px;backdrop-filter:blur(14px) saturate(160%);-webkit-backdrop-filter:blur(14px) saturate(160%);box-shadow:var(--shadow-md);transition:transform .25s cubic-bezier(.4,0,.2,1),border-color .25s,box-shadow .25s}
.card:hover{transform:translateY(-3px);border-color:var(--line-strong);box-shadow:var(--shadow-lg)}
.card h2{margin:0 0 10px;font-size:20px;font-weight:800;letter-spacing:-.02em;line-height:1.3}
.card h2 a:hover{color:var(--accent)}
.card .meta{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 18px}
.card-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.chip{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;font-size:12.5px;font-weight:600;background:var(--surface-2);border:1px solid var(--line);color:var(--muted)}
.chip.accent{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 40%,transparent);background:color-mix(in srgb,var(--accent) 10%,transparent)}
.stats-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:22px 0 26px}
.stat{padding:18px 20px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);backdrop-filter:blur(12px);display:flex;align-items:center;gap:14px;box-shadow:var(--shadow-md)}
.stat .icon{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;font-size:20px;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 22%,transparent),color-mix(in srgb,var(--accent-2) 22%,transparent));border:1px solid var(--line-strong)}
.stat .label{font-size:12.5px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.stat .value{font-size:20px;font-weight:800;letter-spacing:-.02em;margin-top:2px}
#files{display:grid;gap:16px}
.asset{padding:20px 22px;display:grid;gap:12px}
.asset.selected{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,var(--surface))}
.asset-head{display:flex;align-items:flex-start;gap:14px;padding-right:46px}
.asset-check{width:20px;height:20px;accent-color:var(--accent);cursor:pointer;margin-top:6px}
.file-icon{width:46px;height:46px;border-radius:13px;flex-shrink:0;display:grid;place-items:center;font-size:22px;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 22%,transparent),color-mix(in srgb,var(--accent-2) 22%,transparent));border:1px solid var(--line-strong)}
.asset-info{min-width:0;flex:1}
.asset-name{font-weight:700;font-size:16px;word-break:break-word;line-height:1.35;letter-spacing:-.015em}
.asset-sub{margin-top:5px;font-size:13.5px;color:var(--muted);display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.asset-sub .dot{width:3px;height:3px;border-radius:50%;background:currentColor;opacity:.5;display:inline-block}
.asset-menu{position:absolute;right:16px;top:16px}
.dots{width:38px;height:38px;padding:0;font-size:20px;line-height:1;border-radius:11px;background:var(--surface-2);border:1px solid var(--line)}
.menu-panel{display:none;position:absolute;right:0;top:46px;z-index:20;min-width:230px;padding:7px;border:1px solid var(--line-strong);border-radius:13px;background:var(--surface-solid);box-shadow:var(--shadow-lg);animation:pop .15s ease}
@keyframes pop{from{opacity:0;transform:translateY(-6px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
.menu-panel.open{display:grid;gap:3px}
.menu-panel button{padding:10px 12px;text-align:left;font-size:14px;font-weight:500;border:0;border-radius:9px;background:transparent;color:var(--text);cursor:pointer;transition:background .15s;display:flex;align-items:center;gap:9px}
.menu-panel button:hover{background:var(--surface-2)}
.menu-panel button.danger{color:var(--danger)}
.preview{margin-top:4px}
.preview img,.preview video{max-width:100%;max-height:420px;border-radius:13px;border:1px solid var(--line);display:block}
.notice{padding:18px 20px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);backdrop-filter:blur(10px);margin:16px 0;line-height:1.6}
.status{border-left:4px solid var(--info);background:linear-gradient(135deg,color-mix(in srgb,var(--info) 14%,var(--surface)),var(--surface-2));color:var(--info);font-weight:500;padding:16px 20px;border-radius:var(--radius);animation:fadeIn .25s ease}
.status.success{border-left-color:var(--good);color:var(--good);background:linear-gradient(135deg,color-mix(in srgb,var(--good) 14%,var(--surface)),var(--surface-2))}
.status.error{border-left-color:var(--danger);color:var(--danger);background:linear-gradient(135deg,color-mix(in srgb,var(--danger) 14%,var(--surface)),var(--surface-2))}
@keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
.form-group{margin-bottom:20px}
.form-group label{display:block;margin-bottom:9px;font-weight:600;font-size:14px}
.form-group input,.form-group select,.form-group textarea,.file-input{width:100%;padding:13px 15px;border:1px solid var(--line-strong);border-radius:var(--radius-sm);background:var(--surface-2);color:var(--text);font-size:14.5px;font-family:inherit;transition:border-color .2s,box-shadow .2s,background .2s;outline:none;resize:vertical}
.form-group textarea{min-height:90px}
.form-group input:focus,.form-group select:focus,.form-group textarea:focus{border-color:var(--accent);background:var(--surface-solid);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 18%,transparent)}
.form-group input::placeholder,.form-group textarea::placeholder{color:var(--muted)}
select{appearance:none;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238b95a7' stroke-width='3'><polyline points='6 9 12 15 18 9'/></svg>");background-repeat:no-repeat;background-position:right 15px center;padding-right:40px}
.search-wrap{position:relative}
.search-wrap svg{position:absolute;left:15px;top:50%;transform:translateY(-50%);width:17px;height:17px;color:var(--muted);pointer-events:none}
.search-wrap input{padding-left:44px}
.selected-list{display:grid;gap:9px;margin:14px 0 20px}
.selected-file{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:9px;align-items:center;padding:11px 14px;border:1px solid var(--line);border-radius:11px;background:var(--surface-2);animation:fadeIn .2s ease}
.selected-file small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px;font-weight:500}
.selected-file .btn{padding:7px 11px;font-size:12.5px}
.upload-progress-note{margin:16px 0 0;padding:16px 18px;border:1px solid var(--line-strong);border-radius:var(--radius-sm);background:transparent;font-size:14px;line-height:1.75}
.progress{height:8px;background:color-mix(in srgb,var(--line-strong) 70%,transparent);border-radius:20px;overflow:hidden;margin-top:14px;position:relative}
.progress-bar{height:100%;border-radius:20px;background:linear-gradient(90deg,var(--accent),var(--accent-2),var(--good));background-size:200% 100%;animation:shimmer 2s linear infinite;transition:width .2s ease}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.speed{color:var(--warn);font-weight:700;font-variant-numeric:tabular-nums}
.uploaded{color:var(--info);font-weight:600;font-variant-numeric:tabular-nums}
.upload-name{color:var(--text);font-weight:700}
footer{padding:38px 0;border-top:1px solid var(--line);text-align:center;color:var(--muted);font-size:14px}
.toolbar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:14px 16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);margin-bottom:18px;backdrop-filter:blur(12px)}
.toolbar .search-wrap{flex:1;min-width:200px}
.toolbar .sort-wrap{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--muted)}
.toolbar .sort-wrap select{width:auto;padding:9px 36px 9px 13px;font-size:13.5px}
.bulk-bar{display:none;flex-wrap:wrap;gap:10px;align-items:center;padding:12px 16px;border:1px solid var(--accent);border-radius:var(--radius);background:color-mix(in srgb,var(--accent) 10%,var(--surface));margin-bottom:16px;animation:fadeIn .2s ease}
.bulk-bar.show{display:flex}
.bulk-bar .count{font-weight:700;color:var(--accent)}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);z-index:1000;display:none;align-items:center;justify-content:center;padding:20px;animation:fadeIn .2s ease}
.modal-overlay.show{display:flex}
.modal{width:min(560px,100%);max-height:90vh;overflow-y:auto;background:var(--surface-solid);border:1px solid var(--line-strong);border-radius:var(--radius);padding:26px;box-shadow:var(--shadow-lg);animation:modalIn .25s cubic-bezier(.4,0,.2,1)}
@keyframes modalIn{from{opacity:0;transform:scale(.95) translateY(10px)}to{opacity:1;transform:scale(1) translateY(0)}}
.modal h3{margin:0 0 8px;font-size:22px;font-weight:800;letter-spacing:-.02em}
.modal .sub{margin:0 0 22px;color:var(--muted);font-size:14px}
.modal-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:22px;flex-wrap:wrap}
.modal-icon{width:52px;height:52px;border-radius:14px;display:grid;place-items:center;font-size:26px;margin-bottom:14px;background:color-mix(in srgb,var(--danger) 14%,transparent);border:1px solid color-mix(in srgb,var(--danger) 40%,transparent)}
.modal-icon.warn{background:color-mix(in srgb,var(--warn) 14%,transparent);border-color:color-mix(in srgb,var(--warn) 40%,transparent)}
/* progress with cancel button */
.progress-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.progress-head .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}
.cancel-btn{background:color-mix(in srgb,var(--danger) 18%,transparent);border:1px solid color-mix(in srgb,var(--danger) 50%,transparent);color:var(--danger);padding:6px 12px;border-radius:9px;font-size:13px;font-weight:700;cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:5px}
.cancel-btn:hover{background:color-mix(in srgb,var(--danger) 30%,transparent);transform:scale(1.03)}
.cancel-btn:disabled{opacity:.5;cursor:not-allowed}
.upload-cancelled{color:var(--danger);font-weight:700}
@media(max-width:650px){
  .selected-file{grid-template-columns:1fr auto}
  .selected-file small{grid-column:1/-1}
  .hero h1{font-size:30px}
  .card,.asset{padding:18px}
  .nav-links .btn{padding:9px 12px;font-size:13px}
  .logo{font-size:17px}
  .modal{padding:20px}
  .asset{padding:16px}
  .asset-head{padding-right:44px}
}
`;

const THEME_BOOT = `<script>(function(){try{var t=localStorage.getItem('release_theme');if(t==='light')document.documentElement.classList.add('light-pre');}catch(e){}})();</script>`;
const THEME_CSS = `html.light-pre body{background:#eef2f9 !important;color:#0e1420 !important}html.light-pre header{background:rgba(238,242,249,.78) !important}`;
const TOAST_CSS = `.toast{position:fixed;bottom:32px;left:50%;transform:translateX(-50%) translateY(140%);padding:14px 24px;border-radius:14px;background:linear-gradient(135deg,var(--good),#12a37f);color:#fff;font-weight:700;font-size:14.5px;box-shadow:0 20px 50px -12px rgba(34,211,157,.5),0 8px 24px rgba(0,0,0,.4);z-index:9999;transition:transform .35s cubic-bezier(.4,0,.2,1),opacity .3s;opacity:0;pointer-events:none;max-width:90vw;text-align:center}.toast.show{transform:translateX(-50%) translateY(0);opacity:1}.toast.error{background:linear-gradient(135deg,var(--danger),#c4374a);box-shadow:0 20px 50px -12px rgba(255,95,126,.5),0 8px 24px rgba(0,0,0,.4)}`;

function page(title, body, script = '') {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#07080d"><title>${esc(title)} - ${esc(SITE_NAME)}</title>${THEME_BOOT}<style>${CSS}${THEME_CSS}${TOAST_CSS}</style></head><body>
<header><div class="container nav">
  <a class="logo" href="/"><span class="mark">✦</span> ${esc(SITE_NAME)}</a>
  <div class="nav-links">
    <a class="btn" href="/">Releases</a>
    <a class="btn" href="/admin">Upload</a>
    <button class="btn icon" id="themeBtn" type="button" title="Toggle theme"></button>
  </div>
</div></header>
<main><div class="container">${body}</div></main>
<footer>${esc(SITE_NAME)} · Fast, simple release hosting</footer>
<div id="toast" class="toast"></div>
<script>
function applyTheme(){var light=localStorage.getItem('release_theme')==='light';document.body.classList.toggle('light',light);document.documentElement.classList.remove('light-pre');var b=document.getElementById('themeBtn');if(b)b.textContent=light?'🌙':'☀️'}
applyTheme();
document.getElementById('themeBtn').onclick=function(){localStorage.setItem('release_theme',document.body.classList.contains('light')?'dark':'light');applyTheme()};
function showToast(msg,isError){var t=document.getElementById('toast');t.textContent=msg;t.classList.toggle('error',!!isError);t.classList.add('show');clearTimeout(t._timer);t._timer=setTimeout(function(){t.classList.remove('show')},2800)}
function humanSize(b){b=Number(b||0);if(b<1024)return b+' B';if(b<1048576)return (b/1024).toFixed(1)+' KB';if(b<1073741824)return (b/1048576).toFixed(2)+' MB';return (b/1073741824).toFixed(2)+' GB'}
${script}
</script></body></html>`;
}

function fileIcon(name){
  const ext = (name.split('.').pop() || '').toLowerCase();
  if(['jpg','jpeg','png','gif','webp','bmp','svg','avif'].includes(ext)) return '🖼️';
  if(['mp4','webm','ogg','mov','m4v','mkv','avi'].includes(ext)) return '🎬';
  if(['mp3','wav','flac','aac','m4a','opus'].includes(ext)) return '🎵';
  if(['zip','rar','7z','tar','gz','bz2','xz'].includes(ext)) return '📦';
  if(['pdf'].includes(ext)) return '📕';
  if(['apk','ipa','exe','msi','dmg','deb','rpm','appimage'].includes(ext)) return '⚙️';
  if(['txt','md','log'].includes(ext)) return '📄';
  if(['json','xml','yml','yaml','js','ts','py','java','c','cpp','html','css'].includes(ext)) return '🧩';
  return '📁';
}
function preview(asset) {
  const n = asset.name || '', u = asset.browser_download_url || '';
  if (/\.(jpg|jpeg|png|gif|webp|bmp|svg|avif)$/i.test(n)) return `<div class="preview"><img src="${esc(u)}" alt="${esc(n)}" loading="lazy"></div>`;
  if (/\.(mp4|webm|ogg|mov|m4v)$/i.test(n)) return `<div class="preview"><video controls preload="metadata"><source src="${esc(u)}"></video></div>`;
  return '';
}
function humanSize(bytes){ const b = Number(bytes||0); if(b<1024) return b+' B'; if(b<1048576) return (b/1024).toFixed(1)+' KB'; if(b<1073741824) return (b/1048576).toFixed(2)+' MB'; return (b/1073741824).toFixed(2)+' GB'; }

/* ============ HOME ============ */
app.get('/', async (_req, res) => {
  try {
    const releases = await getReleases();
    const publicReleases = releases.filter(r => !r.draft);
    const totalFiles = publicReleases.reduce((a, r) => a + (r.assets?.length || 0), 0);
    const totalSize = publicReleases.reduce((a, r) => a + (r.assets || []).reduce((s, x) => s + (x.size || 0), 0), 0);

    const cards = publicReleases.map(r => {
      const assetCount = r.assets?.length || 0;
      const relSize = (r.assets || []).reduce((a, x) => a + (x.size || 0), 0);
      return `<div class="card" data-release-id="${r.id}">
        <h2><a href="/release/${encodeURIComponent(r.tag_name)}">${esc(r.name || r.tag_name)}</a></h2>
        <div class="meta">
          <span class="chip accent">🏷️ ${esc(r.tag_name)}</span>
          <span class="chip">📦 ${assetCount} file${assetCount !== 1 ? 's' : ''}</span>
          ${relSize ? `<span class="chip">💾 ${humanSize(relSize)}</span>` : ''}
        </div>
        <div class="card-actions">
          <a class="btn primary sm" href="/release/${encodeURIComponent(r.tag_name)}">Open →</a>
          <button class="btn sm" type="button" data-edit-release="${r.id}">✏️ Edit</button>
          <button class="btn sm danger" type="button" data-delete-release="${r.id}">🗑️ Delete</button>
        </div>
      </div>`;
    }).join('');

    const body = `
      <section class="hero">
        <div class="hero-left">
          <h1>Share your releases<br>with style.</h1>
          <p class="muted">Browse releases, preview media, and download files in one place.</p>
        </div>
        <div>
          <button class="btn primary" id="addReleaseBtn" type="button">＋ Add release</button>
        </div>
      </section>

      <div class="stats-row">
        <div class="stat"><div class="icon">🚀</div><div><div class="label">Releases</div><div class="value">${publicReleases.length}</div></div></div>
        <div class="stat"><div class="icon">📦</div><div><div class="label">Total files</div><div class="value">${totalFiles}</div></div></div>
        <div class="stat"><div class="icon">💾</div><div><div class="label">Total size</div><div class="value">${humanSize(totalSize)}</div></div></div>
      </div>

      <div class="toolbar">
        <div class="search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input id="search" placeholder="Search releases...">
        </div>
      </div>

      ${cards ? `<div class="grid" id="releaseGrid">${cards}</div>` : '<div class="notice">No releases available yet. Click "+ Add release" to create one.</div>'}

      <div class="modal-overlay" id="releaseModal">
        <div class="modal">
          <h3 id="releaseModalTitle">Create release</h3>
          <p class="sub" id="releaseModalSub">Fill in the details below. Tag must be unique.</p>
          <input type="hidden" id="editReleaseId">
          <div class="form-group"><label>Title</label><input id="relTitle" placeholder="e.g. My Awesome Release v1.0"></div>
          <div class="form-group"><label>Tag / Version <span class="muted">(must be unique, e.g. v1.0.0)</span></label><input id="relTag" placeholder="v1.0.0"></div>
          <div class="form-group"><label>Description <span class="muted">(optional)</span></label><textarea id="relDesc" placeholder="What's new in this release..."></textarea></div>
          <div class="form-group"><label>Target branch <span class="muted">(optional, e.g. main)</span></label><input id="relBranch" placeholder="main"></div>
          <div class="modal-actions">
            <button class="btn" type="button" data-close-modal>Cancel</button>
            <button class="btn primary" id="saveReleaseBtn" type="button">Save release</button>
          </div>
        </div>
      </div>

      <div class="modal-overlay" id="confirmModal">
        <div class="modal">
          <div class="modal-icon">🗑️</div>
          <h3 id="confirmTitle">Delete release?</h3>
          <p class="sub" id="confirmSub">This action cannot be undone.</p>
          <div class="modal-actions">
            <button class="btn" type="button" data-close-modal>Cancel</button>
            <button class="btn danger primary" id="confirmYesBtn" type="button">Yes, delete</button>
          </div>
        </div>
      </div>
    `;

    const script = `
      var search=document.getElementById('search');
      search.oninput=function(){var v=search.value.toLowerCase();document.querySelectorAll('#releaseGrid .card').forEach(function(x){x.style.display=x.innerText.toLowerCase().includes(v)?'':'none'})};

      function adminKey(){var k=localStorage.getItem('release_admin_key')||prompt('Enter admin key');if(k)localStorage.setItem('release_admin_key',k);return k||''}

      var releaseModal=document.getElementById('releaseModal');
      var confirmModal=document.getElementById('confirmModal');
      var editReleaseId=document.getElementById('editReleaseId');
      var relTitle=document.getElementById('relTitle');
      var relTag=document.getElementById('relTag');
      var relDesc=document.getElementById('relDesc');
      var relBranch=document.getElementById('relBranch');
      var modalTitle=document.getElementById('releaseModalTitle');
      var modalSub=document.getElementById('releaseModalSub');

      function openReleaseModal(mode,data){
        if(mode==='edit'){
          modalTitle.textContent='Edit release';
          modalSub.textContent='Update release details. Be careful changing the tag.';
          editReleaseId.value=data.id;
          relTitle.value=data.name||'';
          relTag.value=data.tag_name||'';
          relDesc.value=data.body||'';
          relBranch.value='';
        }else{
          modalTitle.textContent='Create release';
          modalSub.textContent='Fill in the details below. Tag must be unique.';
          editReleaseId.value='';
          relTitle.value='';relTag.value='';relDesc.value='';relBranch.value='';
        }
        releaseModal.classList.add('show');
      }
      function closeModals(){releaseModal.classList.remove('show');confirmModal.classList.remove('show')}
      document.addEventListener('click',function(e){if(e.target.closest('[data-close-modal]')||e.target===releaseModal||e.target===confirmModal)closeModals()});

      document.getElementById('addReleaseBtn').onclick=function(){openReleaseModal('add')};

      document.querySelectorAll('[data-edit-release]').forEach(function(b){
        b.onclick=function(){
          var id=b.dataset.editRelease;
          var card=b.closest('[data-release-id]');
          var r={id:id,name:card.querySelector('h2 a').textContent,tag_name:card.querySelector('.chip.accent').textContent.replace('🏷️ ','').trim(),body:''};
          fetch('/api/releases/'+id).then(function(x){return x.json()}).then(function(d){if(d.ok)r=d.release;openReleaseModal('edit',r)}).catch(function(){openReleaseModal('edit',r)});
        };
      });

      var confirmYes=document.getElementById('confirmYesBtn');
      document.querySelectorAll('[data-delete-release]').forEach(function(b){
        b.onclick=function(){
          var id=b.dataset.deleteRelease;
          var card=b.closest('[data-release-id]');
          var name=card.querySelector('h2 a').textContent;
          document.getElementById('confirmTitle').textContent='Delete "'+name+'"?';
          document.getElementById('confirmSub').textContent='The release and ALL its files will be permanently deleted. This cannot be undone.';
          confirmModal.classList.add('show');
          confirmYes.onclick=async function(){
            var key=adminKey();if(!key)return;
            confirmYes.disabled=true;
            try{
              var r=await fetch('/api/releases/'+id,{method:'DELETE',headers:{'x-admin-key':key}});
              var d=await r.json();
              if(!r.ok||!d.ok)throw Error(d.error||'Delete failed');
              card.style.transition='opacity .25s,transform .25s';
              card.style.opacity='0';card.style.transform='scale(.96)';
              setTimeout(function(){card.remove()},250);
              closeModals();showToast('✓ Release deleted successfully.');
            }catch(x){showToast(x.message,true)}
            confirmYes.disabled=false;
          };
        };
      });

      document.getElementById('saveReleaseBtn').onclick=async function(){
        var key=adminKey();if(!key)return;
        var btn=this;btn.disabled=true;
        var payload={name:relTitle.value.trim(),tag_name:relTag.value.trim(),body:relDesc.value.trim(),target_commitish:relBranch.value.trim()||undefined};
        if(!payload.name||!payload.tag_name){showToast('Title and tag are required.',true);btn.disabled=false;return}
        var id=editReleaseId.value;
        try{
          var r=await fetch('/api/releases'+(id?'/'+id:''),{method:id?'PATCH':'POST',headers:{'Content-Type':'application/json','x-admin-key':key},body:JSON.stringify(payload)});
          var d=await r.json();
          if(!r.ok||!d.ok)throw Error(d.error||'Failed');
          closeModals();showToast('✓ Release '+(id?'updated':'created')+' successfully.');
          setTimeout(function(){location.reload()},600);
        }catch(x){showToast(x.message,true)}
        btn.disabled=false;
      };
    `;
    res.send(page('Releases', body, script));
  } catch (e) { sendError(res, e, 500, 'Could not load releases.'); }
});

/* ============ RELEASE PAGE ============ */
app.get('/release/:tag', async (req, res) => {
  try {
    const release = await getReleaseByTag(req.params.tag);
    const assets = (release.assets || []).map(asset => `
      <div class="asset" data-asset data-id="${asset.id}" data-created="${esc(asset.created_at || '')}" data-url="${esc(asset.browser_download_url || '')}">
        <div class="asset-menu">
          <button class="btn dots" data-menu type="button" aria-label="File actions">⋮</button>
          <div class="menu-panel">
            <button data-action="rename" type="button">✏️ Rename file</button>
            <button data-action="delete" class="danger" type="button">🗑️ Delete file</button>
            <button data-action="view" type="button">🔗 Copy direct view link</button>
            <button data-action="download" type="button">⬇️ Copy direct download link</button>
          </div>
        </div>
        <div class="asset-head">
          <input type="checkbox" class="asset-check" data-check>
          <div class="file-icon">${fileIcon(asset.name)}</div>
          <div class="asset-info">
            <div class="asset-name">${esc(asset.name)}</div>
            <div class="asset-sub">
              <span>${humanSize(asset.size)}</span>
              <span class="dot"></span>
              <span>${new Date(asset.created_at).toLocaleDateString()} · ${new Date(asset.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
            </div>
          </div>
        </div>
        ${preview(asset)}
        <div><a class="btn primary" href="${esc(asset.browser_download_url)}">Download ↘</a></div>
      </div>
    `).join('');
    const body = `
      <section class="hero">
        <div class="hero-left">
          <h1>${esc(release.name || release.tag_name)}</h1>
          <p class="muted">Version: ${esc(release.tag_name)} · ${release.assets?.length || 0} file(s)</p>
        </div>
        <div><a class="btn" href="/">← Back</a></div>
      </section>
      <div class="toolbar">
        <div class="search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input id="fileSearch" placeholder="Search files in this release...">
        </div>
        <div class="sort-wrap">
          <span>Sort</span>
          <select id="sort">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
        <button class="btn" id="selectAllBtn" type="button">☑️ Select all</button>
      </div>
      <div class="bulk-bar" id="bulkBar">
        <span class="count" id="bulkCount">0 selected</span>
        <button class="btn sm primary" id="bulkDownloadBtn" type="button">⬇️ Download selected</button>
        <button class="btn sm danger" id="bulkDeleteBtn" type="button">🗑️ Delete selected</button>
        <button class="btn sm ghost" id="bulkClearBtn" type="button">✕ Clear</button>
      </div>
      <div id="status"></div>
      <div id="files">${assets || '<div class="notice">This release has no files.</div>'}</div>

      <div class="modal-overlay" id="confirmModal">
        <div class="modal">
          <div class="modal-icon">🗑️</div>
          <h3 id="confirmTitle">Delete selected files?</h3>
          <p class="sub" id="confirmSub"></p>
          <div class="modal-actions">
            <button class="btn" type="button" data-close-modal>Cancel</button>
            <button class="btn danger primary" id="confirmYesBtn" type="button">Yes, delete</button>
          </div>
        </div>
      </div>
    `;
    const script = `
      var files=document.getElementById('files'),status=document.getElementById('status'),sort=document.getElementById('sort'),fileSearch=document.getElementById('fileSearch');
      var bulkBar=document.getElementById('bulkBar'),bulkCount=document.getElementById('bulkCount');
      var confirmModal=document.getElementById('confirmModal');
      var selectAllBtn=document.getElementById('selectAllBtn');
      var savedSort=localStorage.getItem('release_sort_pref');
      if(savedSort==='newest'||savedSort==='oldest'){sort.value=savedSort}
      function adminKey(){var k=localStorage.getItem('release_admin_key')||prompt('Enter admin key');if(k)localStorage.setItem('release_admin_key',k);return k||''}
      function msg(text,good){
        status.innerHTML='';
        var div=document.createElement('div');
        div.className='notice status '+(good===false?'error':'success');
        div.textContent=text;
        status.appendChild(div);
      }
      function reorder(){Array.from(files.querySelectorAll('[data-asset]')).sort(function(a,b){var d=new Date(a.dataset.created)-new Date(b.dataset.created);return sort.value==='oldest'?d:-d}).forEach(function(x){files.appendChild(x)})}
      function filterFiles(){var v=fileSearch.value.toLowerCase();files.querySelectorAll('[data-asset]').forEach(function(x){x.style.display=x.innerText.toLowerCase().includes(v)?'':'none'})}
      sort.onchange=function(){localStorage.setItem('release_sort_pref',sort.value);reorder()};
      fileSearch.oninput=filterFiles;
      reorder();filterFiles();

      function refreshSelectAllLabel(){
        var cbs=Array.from(files.querySelectorAll('[data-check]'));
        if(!cbs.length){selectAllBtn.style.display='none';return}
        selectAllBtn.style.display='';
        var checked=cbs.filter(function(c){return c.checked}).length;
        if(checked===0){selectAllBtn.textContent='☑️ Select all'}
        else if(checked===cbs.length){selectAllBtn.textContent='🔲 Select none'}
        else{selectAllBtn.textContent='🔲 Deselect all'}
      }
      function updateBulk(){
        var checks=files.querySelectorAll('[data-check]:checked');
        bulkCount.textContent=checks.length+' selected';
        bulkBar.classList.toggle('show',checks.length>0);
        files.querySelectorAll('[data-asset]').forEach(function(a){a.classList.toggle('selected',a.querySelector('[data-check]').checked)});
        refreshSelectAllLabel();
      }
      files.addEventListener('change',function(e){if(e.target.matches('[data-check]'))updateBulk()});
      selectAllBtn.onclick=function(){
        var cbs=Array.from(files.querySelectorAll('[data-check]'));
        if(!cbs.length)return;
        var allChecked=cbs.every(function(c){return c.checked});
        cbs.forEach(function(c){c.checked=!allChecked});
        updateBulk();
      };
      document.getElementById('bulkClearBtn').onclick=function(){files.querySelectorAll('[data-check]').forEach(function(c){c.checked=false});updateBulk()};

      document.getElementById('bulkDownloadBtn').onclick=async function(){
        var selected=Array.from(files.querySelectorAll('[data-check]:checked')).map(function(c){return c.closest('[data-asset]')});
        if(!selected.length)return;
        showToast('Starting download of '+selected.length+' file(s)...');
        for(var i=0;i<selected.length;i++){
          var a=document.createElement('a');a.href=selected[i].dataset.url;a.download='';a.target='_blank';
          document.body.appendChild(a);a.click();a.remove();
          await new Promise(function(r){setTimeout(r,700)});
        }
      };

      var confirmYes=document.getElementById('confirmYesBtn');
      document.getElementById('bulkDeleteBtn').onclick=function(){
        var selected=Array.from(files.querySelectorAll('[data-check]:checked')).map(function(c){return c.closest('[data-asset]')});
        if(!selected.length)return;
        document.getElementById('confirmTitle').textContent='Delete '+selected.length+' file(s)?';
        document.getElementById('confirmSub').textContent='Selected files will be permanently deleted. This cannot be undone.';
        confirmModal.classList.add('show');
        confirmYes.onclick=async function(){
          var key=adminKey();if(!key)return;
          confirmYes.disabled=true;
          var failed=0;
          for(var i=0;i<selected.length;i++){
            try{
              var r=await fetch('/api/assets/'+selected[i].dataset.id,{method:'DELETE',headers:{'x-admin-key':key}});
              var d=await r.json();
              if(!r.ok||!d.ok)throw Error(d.error||'Failed');
              selected[i].remove();
            }catch(x){failed++}
          }
          confirmYes.disabled=false;
          confirmModal.classList.remove('show');
          updateBulk();
          if(failed===0){showToast('✓ '+selected.length+' file(s) deleted.');msg('✓ '+selected.length+' file(s) deleted.',true)}
          else{showToast('⚠ '+failed+' of '+selected.length+' failed.',true);msg('⚠ '+failed+' file(s) could not be deleted.',false)}
        };
      };
      document.addEventListener('click',function(e){if(e.target.closest('[data-close-modal]')||e.target===confirmModal)confirmModal.classList.remove('show')});

      updateBulk();

      function stripExt(name){var i=name.lastIndexOf('.');return i>0?name.slice(0,i):name}
      function getExt(name){var i=name.lastIndexOf('.');return i>0?name.slice(i):''}

      document.addEventListener('click',async function(e){
        var menu=e.target.closest('[data-menu]');
        if(menu){document.querySelectorAll('.menu-panel.open').forEach(function(x){x.classList.remove('open')});menu.nextElementSibling.classList.toggle('open');return}
        if(!e.target.closest('.asset-menu'))document.querySelectorAll('.menu-panel.open').forEach(function(x){x.classList.remove('open')});
        var button=e.target.closest('[data-action]');if(!button)return;
        var card=button.closest('[data-asset]'),id=card.dataset.id,name=card.querySelector('.asset-name').textContent;
        if(button.dataset.action==='rename'||button.dataset.action==='delete'){
          var key=adminKey();if(!key)return;
          if(button.dataset.action==='rename'){
            var ext=getExt(name),base=stripExt(name);
            var next=prompt('Rename file (extension '+ext+' stays unchanged):',base);
            if(next===null)return;
            next=next.trim();if(!next||next===base)return;
            if(next.toLowerCase().endsWith(ext.toLowerCase()))next=next.slice(0,next.length-ext.length).trim();
            if(!next)return;
            try{
              var r=await fetch('/api/assets/'+id,{method:'PATCH',headers:{'Content-Type':'application/json','x-admin-key':key},body:JSON.stringify({name:next})});
              var d=await r.json();
              if(!r.ok||!d.ok)throw Error(d.error||'Rename failed');
              card.querySelector('.asset-name').textContent=d.asset.name;
              msg('✓ File renamed successfully.',true);showToast('✓ File renamed successfully.');
            }catch(x){msg(x.message,false);showToast(x.message,true)}
          }else{
            if(!confirm('Delete '+name+' permanently?'))return;
            var r=await fetch('/api/assets/'+id,{method:'DELETE',headers:{'x-admin-key':key}}),d=await r.json();
            if(!r.ok||!d.ok){msg(d.error||'Delete failed',false);showToast(d.error||'Delete failed',true);return}
            card.remove();msg('✓ File deleted successfully.',true);showToast('✓ File deleted successfully.');
            updateBulk();
          }
          return;
        }
        var url=card.dataset.url,label=button.dataset.action==='view'?'Direct view link':'Direct download link';
        try{await navigator.clipboard.writeText(url);msg('✓ '+label+' copied.',true);showToast('✓ '+label+' copied to clipboard.')}
        catch{prompt('Copy this link:',url);showToast('⚠ Clipboard blocked — copy manually.',true)}
      });
    `;
    res.send(page(release.name || release.tag_name, body, script));
  } catch (e) { sendError(res, e, 500, 'Could not load this release.'); }
});

/* ============ ADMIN UPLOAD PAGE (with cancel button) ============ */
app.get('/admin', async (_req, res) => {
  try {
    const releases = await getReleases();
    const options = releases.filter(r => !r.draft).map(r => `<option value="${r.id}">${esc(r.name || r.tag_name)} (${esc(r.tag_name)})</option>`).join('');
    const body = `
      <section class="hero">
        <div class="hero-left">
          <h1>Upload files</h1>
          <p class="muted">Rename selected files before uploading. File extensions are protected and never editable. All file types are supported.</p>
        </div>
      </section>
      <div class="card">
        <div class="form-group" id="keyBox"><label>Admin key</label><input id="adminKey" type="password" placeholder="Enter your admin key"></div>
        <div class="form-group"><label>Destination release</label><select id="releaseId">${options || '<option value="">No releases found</option>'}</select></div>
        <div class="form-group"><label>Select files <span class="muted">(each up to ${MAX_MB} MB · any file type)</span></label><input id="file" class="file-input" type="file" multiple><div id="selected" class="selected-list"></div></div>
        <button class="btn primary" id="uploadBtn" type="button">Upload selected files ↥</button>
        <div id="status"></div>
      </div>
    `;
    const script = `
      var keyInput=document.getElementById('adminKey'),fileInput=document.getElementById('file'),selectedBox=document.getElementById('selected'),statusBox=document.getElementById('status'),uploadBtn=document.getElementById('uploadBtn'),keyBox=document.getElementById('keyBox'),files=[];
      var savedKey=localStorage.getItem('release_admin_key');
      if(savedKey){keyInput.value=savedKey;keyBox.style.display='none'}
      function safeHtml(v){return String(v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[c]})}
      function stripExt(name){var i=name.lastIndexOf('.');return i>0?name.slice(0,i):name}
      function getExt(name){var i=name.lastIndexOf('.');return i>0?name.slice(i):''}
      function render(){selectedBox.innerHTML=files.map(function(x,i){return '<div class="selected-file"><small title="'+safeHtml(x.name)+'">'+safeHtml(x.name)+'</small><button class="btn" type="button" data-rename="'+i+'">Rename</button><button class="btn danger" type="button" data-remove="'+i+'">Remove</button></div>'}).join('')}
      fileInput.onchange=function(){files=Array.from(fileInput.files).map(function(file){return{file:file,name:file.name,original:file.name}});render()};
      selectedBox.onclick=function(e){
        var r=e.target.closest('[data-rename]'),x=e.target.closest('[data-remove]');
        if(r){
          var i=Number(r.dataset.rename),ext=getExt(files[i].original),base=stripExt(files[i].name);
          var next=prompt('Rename file (extension '+ext+' stays unchanged):',base);
          if(next===null)return;
          next=next.trim();if(!next)return;
          if(next.toLowerCase().endsWith(ext.toLowerCase()))next=next.slice(0,next.length-ext.length).trim();
          if(!next)return;
          files[i].name=next+ext;render();
        }
        if(x){files.splice(Number(x.dataset.remove),1);render()}
      };

      // Track active uploads: index -> { xhr, cancelled }
      var activeUploads={};
      var cancelFlag={};

      function one(item,index,total,retry){
        return new Promise(function(done){
          retry=retry||0;
          var form=new FormData();
          form.append('release_id',document.getElementById('releaseId').value);
          form.append('file',item.file,item.name);
          var q=new XMLHttpRequest(),started=performance.now();
          var slot=activeUploads[index]={xhr:q,cancelled:false};

          q.open('POST','/api/upload');
          q.setRequestHeader('x-admin-key',keyInput.value.trim());
          q.timeout=30*60*1000;

          q.upload.onprogress=function(e){
            if(!e.lengthComputable)return;
            if(slot.cancelled)return;
            var mb=e.loaded/1048576,totalMb=e.total/1048576,seconds=Math.max((performance.now()-started)/1000,.001),speed=mb/seconds;
            statusBox.innerHTML='<div class="upload-progress-note">'+
              '<div class="progress-head">'+
                '<span class="name">'+index+'/'+total+' · '+safeHtml(item.name)+'</span>'+
                '<button class="cancel-btn" type="button" data-cancel="'+index+'">✕ Cancel</button>'+
              '</div>'+
              '<div><span class="uploaded">Uploaded: '+mb.toFixed(1)+' MB / '+totalMb.toFixed(1)+' MB</span> · <span class="speed">'+speed.toFixed(2)+' MB/s</span></div>'+
              '<div class="progress"><div class="progress-bar" style="width:'+(e.loaded/e.total*100)+'%"></div></div>'+
            '</div>';
          };

          q.onload=function(){
            delete activeUploads[index];
            if(slot.cancelled)return done({ok:false,name:item.name,error:'Cancelled',cancelled:true});
            var d={};try{d=JSON.parse(q.responseText)}catch{}
            var z={ok:q.status>=200&&q.status<300&&d.ok,name:item.name,error:d.error||('Upload failed ('+q.status+')')};
            if(!z.ok&&retry<2&&/connection|timeout/i.test(z.error))return setTimeout(function(){one(item,index,total,retry+1).then(done)},1500*(retry+1));
            done(z);
          };
          q.onerror=function(){
            delete activeUploads[index];
            if(slot.cancelled)return done({ok:false,name:item.name,error:'Cancelled',cancelled:true});
            if(retry<2)return setTimeout(function(){one(item,index,total,retry+1).then(done)},1500*(retry+1));
            done({ok:false,name:item.name,error:'Connection interrupted after retries.'});
          };
          q.ontimeout=function(){
            delete activeUploads[index];
            if(slot.cancelled)return done({ok:false,name:item.name,error:'Cancelled',cancelled:true});
            done({ok:false,name:item.name,error:'Upload timed out.'});
          };
          q.onabort=function(){
            delete activeUploads[index];
            done({ok:false,name:item.name,error:'Cancelled',cancelled:true});
          };

          activeUploads[index].xhr=q;
          q.send(form);
        });
      }

      // Cancel button handler (delegated)
      statusBox.addEventListener('click',function(e){
        var btn=e.target.closest('[data-cancel]');
        if(!btn)return;
        var idx=Number(btn.dataset.cancel);
        var slot=activeUploads[idx];
        if(!slot)return;
        slot.cancelled=true;
        try{slot.xhr.abort()}catch(_){}
        btn.disabled=true;
        btn.textContent='Cancelling...';
        showToast('✕ Upload cancelled.',true);
      });

      uploadBtn.onclick=async function(){
        var key=keyInput.value.trim();
        if(!key)return statusBox.textContent='Admin key required.';
        if(!files.length)return statusBox.textContent='Select at least one file.';
        if(!document.getElementById('releaseId').value)return statusBox.textContent='No release selected. Create one from home page first.';
        localStorage.setItem('release_admin_key',key);keyBox.style.display='none';uploadBtn.disabled=true;
        activeUploads={};
        var results=[];
        for(var i=0;i<files.length;i++)results.push(await one(files[i],i+1,files.length));
        var ok=results.filter(function(x){return x.ok});
        var cancelled=results.filter(function(x){return x.cancelled});
        var bad=results.filter(function(x){return !x.ok&&!x.cancelled});
        var summary='<div class="notice status '+(bad.length?'error':'success')+'"><b>'+
          (cancelled.length?('Uploaded '+ok.length+'/'+results.length+' (cancelled '+cancelled.length+')'):(bad.length?'Some files failed.':'✓ All files uploaded successfully.'))+
          '</b><br>'+results.map(function(x){
            if(x.ok)return '✓ '+safeHtml(x.name);
            if(x.cancelled)return '✕ '+safeHtml(x.name)+' — <span class="upload-cancelled">Cancelled</span>';
            return '✗ '+safeHtml(x.name)+(x.error?' — '+safeHtml(x.error):'');
          }).join('<br>')+'</div>';
        statusBox.innerHTML=summary;
        if(!bad.length&&!cancelled.length)showToast('✓ All '+results.length+' file(s) uploaded successfully.');
        else if(cancelled.length)showToast('Upload finished. '+cancelled.length+' cancelled.',true);
        else showToast('⚠ '+bad.length+' file(s) failed.',true);
        uploadBtn.disabled=false;
        if(!bad.length&&!cancelled.length){fileInput.value='';files=[];render()}
        else{
          // Keep only failed/cancelled files so user can retry
          var keep=[];
          for(var j=0;j<results.length;j++){if(!results[j].ok)keep.push(files[j])}
          files=keep;
          render();
        }
      };
    `;
    res.send(page('Admin', body, script));
  } catch (e) { sendError(res, e, 500, 'Could not load admin page.'); }
});

/* ============ RELEASE APIs ============ */
app.get('/api/releases/:id', async (req, res) => {
  try { const release = await getReleaseById(req.params.id); res.json({ ok: true, release }); }
  catch (e) { sendError(res, e, 500, 'Could not load release.'); }
});

app.post('/api/releases', requireAdmin, async (req, res) => {
  try {
    const { name, tag_name, body: desc, target_commitish } = req.body || {};
    if (!name || !tag_name) return res.status(400).json({ ok: false, error: 'Title and tag are required.' });
    const payload = { name: String(name).trim(), tag_name: String(tag_name).trim(), body: String(desc || ''), draft: false, prerelease: false };
    if (target_commitish) payload.target_commitish = String(target_commitish).trim();
    const release = await githubApi(`/repos/${REPO}/releases`, { method: 'POST', body: JSON.stringify(payload) });
    res.json({ ok: true, release });
  } catch (e) { sendError(res, e, 500, 'Could not create release.'); }
});

app.patch('/api/releases/:id', requireAdmin, async (req, res) => {
  try {
    const { name, tag_name, body: desc } = req.body || {};
    const payload = {};
    if (name) payload.name = String(name).trim();
    if (tag_name) payload.tag_name = String(tag_name).trim();
    if (desc !== undefined) payload.body = String(desc);
    if (!Object.keys(payload).length) return res.status(400).json({ ok: false, error: 'Nothing to update.' });
    const release = await githubApi(`/repos/${REPO}/releases/${encodeURIComponent(req.params.id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
    res.json({ ok: true, release });
  } catch (e) { sendError(res, e, 500, 'Could not update release.'); }
});

app.delete('/api/releases/:id', requireAdmin, async (req, res) => {
  try { await githubApi(`/repos/${REPO}/releases/${encodeURIComponent(req.params.id)}`, { method: 'DELETE' }); res.json({ ok: true }); }
  catch (e) { sendError(res, e, 500, 'Could not delete release.'); }
});

/* ============ ASSET APIs ============ */
app.post('/api/upload', requireAdmin, upload.single('file'), async (req, res) => {
  const filePath = req.file?.path;
  const cleanup = () => { if (filePath) fs.promises.unlink(filePath).catch(() => {}); };
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file was uploaded.' });
    if (!req.body.release_id) return res.status(400).json({ ok: false, error: 'release_id is required.' });
    let name = safeName(req.file.originalname);
    const existing = await githubApi(`/repos/${REPO}/releases/${encodeURIComponent(req.body.release_id)}/assets`);
    const ext = path.extname(name); const base = path.basename(name, ext);
    let counter = 1;
    while (existing.some(asset => asset.name === name)) name = `${base}-${counter++}${ext}`;
    const result = await uploadAsset(req.body.release_id, name, req.file.mimetype, filePath, req.file.size);
    if (!result.ok) {
      const ghMsg = result.data?.message || `GitHub upload failed (${result.status}).`;
      const err = new Error(ghMsg); err.status = result.status;
      return sendError(res, err, result.status, 'Upload failed.');
    }
    res.json({ ok: true, asset: result.data });
  } catch (e) { sendError(res, e, 502, 'Upload failed.'); }
  finally { cleanup(); }
});

app.patch('/api/assets/:id', requireAdmin, async (req, res) => {
  try {
    const current = await githubApi(`/repos/${REPO}/releases/assets/${encodeURIComponent(req.params.id)}`);
    const name = preserveExtension(req.body?.name, current.name);
    if (!name) return res.status(400).json({ ok: false, error: 'A valid filename is required.' });
    if (name === current.name) return res.status(400).json({ ok: false, error: 'New name is the same as the old one.' });
    const asset = await githubApi(`/repos/${REPO}/releases/assets/${encodeURIComponent(req.params.id)}`, { method: 'PATCH', body: JSON.stringify({ name }) });
    res.json({ ok: true, asset });
  } catch (e) { sendError(res, e, 500, 'Could not rename file.'); }
});

app.delete('/api/assets/:id', requireAdmin, async (req, res) => {
  try { await githubApi(`/repos/${REPO}/releases/assets/${encodeURIComponent(req.params.id)}`, { method: 'DELETE' }); res.json({ ok: true }); }
  catch (e) { sendError(res, e, 500, 'Could not delete file.'); }
});

app.get('/health', (_req, res) => res.json({ ok: true, status: 'ok', uptime: process.uptime() }));

app.use((error, req, res, _next) => {
  if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {});
  if (error?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ ok: false, error: `File is too large. Maximum allowed size is ${MAX_MB} MB.` });
  console.error('[UNHANDLED]', error);
  res.status(500).json({ ok: false, error: IS_PROD ? 'Something went wrong.' : (error?.message || 'Unknown error') });
});

function cleanupTempDir() { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {} }
process.on('SIGINT', () => { cleanupTempDir(); process.exit(0); });
process.on('SIGTERM', () => { cleanupTempDir(); process.exit(0); });
process.on('exit', cleanupTempDir);

app.listen(PORT, '0.0.0.0', () => console.log(`${SITE_NAME} running on port ${PORT}`));
