const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 10000;
const REPO = process.env.REPO_FULL_NAME || 'nusratbytxrs/release-hosting';
const SITE_NAME = process.env.SITE_NAME || 'Release Hosting';
const TOKEN = process.env.GITHUB_TOKEN || '';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const MAX_MB = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 100));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-hosting-'));
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tmp),
    filename: (_req, file, cb) => cb(null, Date.now() + '-' + path.basename(file.originalname))
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024 }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '2mb' }));

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c]));
const safe = value => path.basename(String(value || '')).replace(/[\\/]/g, '-').trim();
const keyFrom = req => req.headers['x-admin-key'] || req.query.key || req.body?.key || '';

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(500).json({ ok: false, error: 'ADMIN_KEY is not configured.' });
  if (keyFrom(req) !== ADMIN_KEY) return res.status(401).json({ ok: false, error: 'Invalid admin key.' });
  next();
}

async function gh(endpoint, options = {}) {
  if (!TOKEN) throw new Error('GITHUB_TOKEN is not configured.');
  const response = await fetch('https://api.github.com' + endpoint, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + TOKEN,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) { const error = new Error(data.message || 'GitHub API error'); error.status = response.status; throw error; }
  return data;
}

const releases = () => gh('/repos/' + REPO + '/releases?per_page=100');
const byTag = tag => gh('/repos/' + REPO + '/releases/tags/' + encodeURIComponent(tag));

function uploadAsset(releaseId, name, type, file, size) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: 'uploads.github.com', method: 'POST',
      path: '/repos/' + REPO + '/releases/' + encodeURIComponent(releaseId) + '/assets?name=' + encodeURIComponent(name),
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + TOKEN, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': type || 'application/octet-stream', 'Content-Length': size }, timeout: 30 * 60 * 1000
    }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => { let data = {}; try { data = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch {} resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, data }); });
    });
    request.on('error', reject); request.on('timeout', () => request.destroy(new Error('GitHub upload timed out.')));
    fs.createReadStream(file).on('error', reject).pipe(request);
  });
}

const CSS = `:root{--bg:#08090d;--surface:#11141c;--surface2:#191d28;--text:#f8fafc;--muted:#9aa5b5;--line:#293141;--accent:#7c5cff;--good:#23d5ab}body.light{--bg:#f4f7fb;--surface:#fff;--surface2:#edf1f7;--text:#111827;--muted:#5d6878;--line:#d8e0eb}*{box-sizing:border-box}body{margin:0;font:16px system-ui,Arial;background:var(--bg);color:var(--text)}a{color:inherit;text-decoration:none}.wrap{width:min(1120px,calc(100% - 24px));margin:auto}header{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line)}nav{min-height:68px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.logo{font-size:20px;font-weight:800}.logo b{color:var(--accent)}nav{display:flex}.btn{display:inline-flex;align-items:center;padding:10px 14px;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--text);cursor:pointer}.btn:hover{border-color:var(--accent)}.primary{background:linear-gradient(135deg,var(--accent),#4f9cff);border:0;color:white}.danger{color:#ef4444}.hero{padding:42px 0 20px}.hero h1{font-size:clamp(32px,6vw,58px);margin:0 0 12px}.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:18px}.card,.asset{background:linear-gradient(145deg,var(--surface),var(--surface2));border:1px solid var(--line);border-radius:18px;padding:20px}.card h2{margin:10px 0}.search,input,select,textarea{width:100%;padding:13px;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--text);outline:0}.form-group{margin:0 0 16px}.form-group label{display:block;font-weight:700;margin-bottom:7px}.notice,.status{padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--surface2);margin:14px 0}.assets{display:grid;gap:12px}.asset{display:flex;justify-content:space-between;gap:12px;align-items:center}.actions{display:flex;gap:8px;flex-wrap:wrap}@media(max-width:650px){.asset{display:block}.asset .actions{margin-top:12px}}`;

function page(title, body, script = '') {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + ' - ' + esc(SITE_NAME) + '</title><style>' + CSS + '</style></head><body><header><div class="wrap"><nav><a class="logo" href="/"><b>↗</b> ' + esc(SITE_NAME) + '</a><span class="actions"><a class="btn" href="/">Releases</a><a class="btn" href="/admin">Upload</a><button class="btn" id="themeBtn" type="button">☀️ Light mode</button></span></nav></div></header><main class="wrap">' + body + '</main><footer class="wrap muted" style="text-align:center;padding:35px 0">' + esc(SITE_NAME) + ' — Fast, simple release hosting</footer><script>(function(){const b=document.getElementById("themeBtn");function apply(){const light=localStorage.getItem("release_theme")==="light";document.body.classList.toggle("light",light);if(b)b.textContent=light?"🌙 Dark mode":"☀️ Light mode"}apply();if(b)b.onclick=()=>{localStorage.setItem("release_theme",document.body.classList.contains("light")?"dark":"light");apply()}})();' + script + '</script></body></html>';
}

app.get('/', async (_req, res) => {
  try {
    const list = (await releases()).filter(r => !r.draft);
    const cards = list.map(r => '<article class="card" data-release><h2><a href="/release/' + encodeURIComponent(r.tag_name) + '">' + esc(r.name || r.tag_name) + '</a></h2><p class="muted">Version: ' + esc(r.tag_name) + '</p><p>' + esc(r.body || 'No description') + '</p><p class="muted">' + (r.assets || []).length + ' files</p><a class="btn primary" href="/release/' + encodeURIComponent(r.tag_name) + '">Explore release →</a></article>').join('');
    const body = '<section class="hero"><h1>Share your releases<br>with style.</h1><p class="muted">Browse releases, preview media, and download files in one place.</p></section><input class="search" id="search" placeholder="⌕ Search releases..."><div class="grid" id="grid" style="margin-top:18px">' + (cards || '<div class="notice">No releases available yet.</div>') + '</div>';
    const script = 'const s=document.getElementById("search"),g=document.getElementById("grid");s.oninput=()=>{const q=s.value.toLowerCase();g.querySelectorAll("[data-release]").forEach(x=>x.style.display=x.innerText.toLowerCase().includes(q)?"":"none")};';
    res.send(page('Releases', body, script));
  } catch (e) { res.status(500).send(page('Error', '<div class="notice">' + esc(e.message) + '</div>')); }
});

app.get('/release/:tag', async (req, res) => {
  try {
    const release = await byTag(req.params.tag);
    const assets = (release.assets || []).map(a => '<div class="asset"><div><strong>' + esc(a.name) + '</strong><div class="muted">' + (a.size / 1048576).toFixed(2) + ' MB</div></div><a class="btn primary" href="' + esc(a.browser_download_url) + '">Download ↓</a></div>').join('');
    res.send(page(release.name || release.tag_name, '<section class="hero"><h1>' + esc(release.name || release.tag_name) + '</h1><p class="muted">Version: ' + esc(release.tag_name) + '</p></section><div class="card"><p>' + esc(release.body || 'No description') + '</p></div><h2>Files</h2><div class="assets">' + (assets || '<div class="notice">No files.</div>') + '</div>'));
  } catch (e) { res.status(404).send(page('Error', '<div class="notice">' + esc(e.message) + '</div>')); }
});

app.get('/admin', async (_req, res) => {
  try {
    const list = (await releases()).filter(r => !r.draft);
    const options = list.map(r => '<option value="' + r.id + '">' + esc(r.name || r.tag_name) + '</option>').join('');
    const body = '<section class="hero"><h1>Upload files</h1><p class="muted">Your admin key is saved securely in this browser after the first upload.</p></section><div class="card"><div class="form-group" id="keyBox"><label for="adminKey">Admin key</label><input id="adminKey" type="password" placeholder="Enter admin key" autocomplete="current-password"></div><div class="form-group"><label for="releaseId">Release</label><select id="releaseId">' + options + '</select></div><div class="form-group"><label for="files">Files</label><input id="files" type="file" multiple></div><button class="btn primary" id="uploadBtn" type="button">Upload selected files</button><div id="status"></div></div>';
    const script = `const keyInput=document.getElementById('adminKey'),keyBox=document.getElementById('keyBox'),stored=localStorage.getItem('release_admin_key');if(stored){keyInput.value=stored;keyBox.style.display='none'}document.getElementById('uploadBtn').onclick=async()=>{const key=keyInput.value.trim(),files=[...document.getElementById('files').files],status=document.getElementById('status');if(!key||!files.length){status.innerHTML='<div class="notice">Admin key and at least one file are required.</div>';return}localStorage.setItem('release_admin_key',key);keyBox.style.display='none';for(const file of files){const form=new FormData();form.append('release_id',document.getElementById('releaseId').value);form.append('file',file,file.name);const r=await fetch('/api/upload',{method:'POST',headers:{'x-admin-key':key},body:form});const d=await r.json();status.innerHTML='<div class="notice">'+(d.ok?'✅ Uploaded: ':'❌ Failed: ')+file.name+(d.error?' — '+d.error:'')+'</div>'}};`;
    res.send(page('Admin', body, script));
  } catch (e) { res.status(500).send(page('Error', '<div class="notice">' + esc(e.message) + '</div>')); }
});

app.post('/api/upload', requireAdmin, upload.single('file'), async (req, res) => {
  const file = req.file;
  try {
    if (!file || !req.body.release_id) return res.status(400).json({ ok: false, error: 'File and release are required.' });
    let name = safe(file.originalname) || 'upload';
    const existing = await gh('/repos/' + REPO + '/releases/' + encodeURIComponent(req.body.release_id) + '/assets');
    let n = 1; const base = path.basename(name, path.extname(name)), ext = path.extname(name);
    while (existing.some(a => a.name === name)) name = base + '-' + n++ + ext;
    const result = await uploadAsset(req.body.release_id, name, file.mimetype, file.path, file.size);
    if (!result.ok) return res.status(result.status || 500).json({ ok: false, error: result.data.message || 'Upload failed.' });
    res.json({ ok: true, asset: result.data });
  } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
  finally { if (file) fs.promises.unlink(file.path).catch(() => {}); }
});

app.post('/api/releases', requireAdmin, async (req, res) => { try { const name = String(req.body.name || '').trim(), tag_name = String(req.body.tag_name || '').trim(); if (!name || !tag_name) return res.status(400).json({ ok:false, error:'Title and tag name are required.' }); res.json({ ok:true, release:await gh('/repos/'+REPO+'/releases',{method:'POST',body:JSON.stringify({name,tag_name,body:String(req.body.body||''),draft:false,prerelease:false})}) }); } catch(e) { res.status(e.status||500).json({ok:false,error:e.message}); } });
app.get('/health', (_req, res) => res.type('text').send('ok'));
app.use((err, _req, res, _next) => res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ ok:false, error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large. Maximum allowed size is '+MAX_MB+' MB.' : err.message }));
app.listen(PORT, '0.0.0.0', () => console.log(SITE_NAME + ' running on ' + PORT));
