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
const TOKEN = process.env.GITHUB_TOKEN;
const ADMIN_KEY = process.env.ADMIN_KEY;
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 100);
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: MAX_MB * 1024 * 1024 } });

app.use(express.json());
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c]));
const safe = (v) => path.basename(String(v || '').replace(/[\\/]/g, ''));
const extension = (name) => { const m = safe(name).match(/(\\.[^.]+)$/); return m ? m[1] : ''; };

async function gh(endpoint, options = {}) {
  if (!TOKEN) throw new Error('GITHUB_TOKEN is not configured.');
  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'release-hosting', ...(options.headers || {}) }
  });
  const text = await response.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) { const e = new Error(data.message || `GitHub request failed (${response.status})`); e.status = response.status; throw e; }
  return data;
}
function releases() { return gh(`/repos/${REPO}/releases?per_page=100`); }
function release(tag) { return gh(`/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`); }
function auth(req, res, next) {
  const key = req.get('x-admin-key') || req.body?.adminKey || req.query?.adminKey;
  if (!ADMIN_KEY || key !== ADMIN_KEY) return res.status(401).json({ ok: false, error: 'Unauthorized.' });
  next();
}
function uploadAsset(id, name, type, file) {
  return new Promise((resolve, reject) => {
    const stat = fs.statSync(file);
    const req = https.request({ hostname: 'uploads.github.com', method: 'POST', path: `/repos/${REPO}/releases/${encodeURIComponent(id)}/assets?name=${encodeURIComponent(name)}`, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'release-hosting', 'Content-Type': type || 'application/octet-stream', 'Content-Length': stat.size } }, (res) => {
      let body = ''; res.setEncoding('utf8'); res.on('data', (c) => body += c); res.on('end', () => { let data; try { data = JSON.parse(body); } catch { data = { message: body }; } if (res.statusCode >= 200 && res.statusCode < 300) resolve(data); else reject(new Error(data.message || `Upload failed (${res.statusCode})`)); });
    });
    req.on('error', reject); fs.createReadStream(file).on('error', reject).pipe(req);
  });
}
function page(title, body, script = '') { return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} - ${esc(SITE_NAME)}</title><style>
:root{font-family:system-ui,sans-serif;color:#f8fafc;background:#08090d}body{max-width:1100px;margin:0 auto;padding:24px;background:#08090d}a{color:#a99aff}.muted{color:#9aa5b5}.card,.asset,.panel{background:#11141c;border:1px solid #293141;border-radius:12px;padding:16px;margin:12px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.asset{display:flex;align-items:center;gap:12px}.asset-main{flex:1;min-width:0}.asset-name{overflow-wrap:anywhere}.btn,button,input,select{font:inherit;border-radius:7px;padding:8px 10px;border:1px solid #394457;background:#191d28;color:inherit}.btn,button{cursor:pointer}.primary{background:#7c5cff;border-color:#7c5cff}.danger{color:#ff9b9b;border-color:#a94444}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.progress{height:8px;background:#293141;border-radius:5px;overflow:hidden;margin-top:8px}.progress i{display:block;height:100%;width:0;background:#7c5cff}.preview img{max-width:180px;max-height:120px}
</style></head><body><header class="row"><a href="/"><strong>${esc(SITE_NAME)}</strong></a><span style="flex:1"></span><a href="/admin">Admin</a></header>${body}<script>${script}</script></body></html>`; }
function preview(a) { const n = a.name || ''; if (!/\\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(n)) return ''; return `<div class="preview"><img loading="lazy" src="${esc(a.browser_download_url)}" alt="${esc(n)}"></div>`; }
function assetCard(a) { return `<div class="asset" data-created="${esc(a.created_at || '')}" data-size="${a.size || 0}"><div class="asset-main">${preview(a)}<div class="asset-name"><a href="${esc(a.browser_download_url)}">${esc(a.name)}</a></div><small class="muted">${(a.size / 1024 / 1024).toFixed(2)} MB · ${new Date(a.created_at).toLocaleString()}</small></div></div>`; }

app.get('/', async (_req, res) => { try { const rs = await releases(); res.send(page('Releases', `<h1>Releases</h1><div class="grid">${rs.filter(r => !r.draft).map(r => `<div class="card"><h2><a href="/release/${encodeURIComponent(r.tag_name)}">${esc(r.name || r.tag_name)}</a></h2><p class="muted">${esc(r.tag_name)}</p><p>📦 ${r.assets.length} files</p></div>`).join('')}</div>`)); } catch (e) { res.status(500).send(page('Error', `<p>${esc(e.message)}</p>`)); } });
app.get('/release/:tag', async (req, res) => { try { const r = await release(req.params.tag); const assets = r.assets || []; res.send(page(r.name || r.tag_name, `<a href="/">← Releases</a><h1>${esc(r.name || r.tag_name)}</h1><p class="muted">${esc(r.tag_name)}</p><div class="row"><label>Sort <select id="sort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="smallest">Smallest size first</option><option value="largest">Biggest size first</option></select></label></div><div id="assets">${assets.map(assetCard).join('')}</div>`, `const box=document.querySelector('#assets');document.querySelector('#sort').onchange=e=>{const a=[...box.children];const v=e.target.value;a.sort((x,y)=>v==='newest'?new Date(y.dataset.created)-new Date(x.dataset.created):v==='oldest'?new Date(x.dataset.created)-new Date(y.dataset.created):v==='smallest'?Number(x.dataset.size)-Number(y.dataset.size):Number(y.dataset.size)-Number(x.dataset.size));a.forEach(x=>box.appendChild(x));};`)); } catch (e) { res.status(404).send(page('Not found', `<p>${esc(e.message)}</p>`)); } });
app.get('/api/releases', async (_req, res) => { try { const rs = await releases(); res.json({ ok: true, count: rs.length, releases: rs }); } catch (e) { res.status(e.status || 500).json({ ok:false, error:e.message }); } });
app.get('/admin', async (_req, res) => { try { const rs = await releases(); const opts = rs.filter(r => !r.draft).map(r => `<option value="${esc(r.id)}">${esc(r.name || r.tag_name)} (${esc(r.tag_name)})</option>`).join(''); const body = `<h1>Upload to release</h1><form id="form" class="panel"><input id="key" type="password" placeholder="Admin key" required><select id="release" required>${opts}</select><input id="files" type="file" multiple required><button class="primary" type="submit">Upload</button></form><div id="queue"></div>`; const script = `const form=document.querySelector('#form'),files=document.querySelector('#files'),queue=document.querySelector('#queue'),key=document.querySelector('#key');form.onsubmit=e=>{e.preventDefault();[...files.files].forEach(file=>start(file));};function start(file){const row=document.createElement('div');row.className='asset';row.innerHTML='<div class="asset-main"><b class="asset-name"></b><span class="status muted">Preparing…</span><div class="progress"><i></i></div></div><button class="btn danger" type="button" title="Cancel upload">✕</button>';row.querySelector('.asset-name').textContent=file.name;queue.prepend(row);const xhr=new XMLHttpRequest(),fd=new FormData();fd.append('file',file);fd.append('releaseId',document.querySelector('#release').value);const ext=file.name.match(/\\.[^.]+$/)?.[0]||'';fd.append('extension',ext);xhr.open('POST','/api/upload');xhr.setRequestHeader('x-admin-key',key.value);xhr.upload.onprogress=e=>{if(e.lengthComputable){const pct=Math.round(e.loaded/e.total*100);row.querySelector('i').style.width=pct+'%';row.querySelector('.status').textContent=pct+'% · '+speed(e.loaded,e.timeStamp,e.total);}};xhr.onload=()=>{try{const d=JSON.parse(xhr.responseText);row.querySelector('.status').textContent=d.ok?'Uploaded ✓':(d.error||'Upload failed');}catch{row.querySelector('.status').textContent='Upload failed';}};xhr.onerror=()=>row.querySelector('.status').textContent='Network error';row.querySelector('button').onclick=()=>{xhr.abort();row.querySelector('.status').textContent='Cancelled';row.querySelector('i').style.width='0';};xhr.send(fd);}function speed(bytes,time,total){const now=performance.now();if(!start.last){start.last={bytes,time:now};return 'starting';}const d=bytes-start.last.bytes,s=(d/1024)/Math.max((now-start.last.time)/1000,.001);start.last={bytes,time:now};return (s>=1024?(s/1024).toFixed(1)+' MB/s':s.toFixed(0)+' KB/s')+' · '+Math.round(bytes/total*100)+'%';}`; res.send(page('Admin', body, script)); } catch (e) { res.status(500).send(page('Error', `<p>${esc(e.message)}</p>`)); } });
app.post('/api/upload', auth, upload.single('file'), async (req, res) => { const temp = req.file?.path; try { if (!req.file || !req.body.releaseId) return res.status(400).json({ok:false,error:'File and release are required.'}); const original = req.file.originalname; const name = safe(original); const asset = await uploadAsset(req.body.releaseId, name, req.file.mimetype, temp); res.json({ok:true,asset}); } catch (e) { res.status(e.status || 500).json({ok:false,error:e.message}); } finally { if (temp) fs.promises.unlink(temp).catch(() => {}); } });
app.patch('/api/assets/:id', auth, async (req, res) => { try { const asset = await gh(`/repos/${REPO}/releases/assets/${req.params.id}`); const oldExt = extension(asset.name); const requested = safe(req.body?.name); if (!requested) return res.status(400).json({ok:false,error:'A valid filename is required.'}); const newExt = extension(requested); if (oldExt && newExt.toLowerCase() !== oldExt.toLowerCase()) return res.status(400).json({ok:false,error:`The file extension must remain ${oldExt}.`}); const name = oldExt && !newExt ? `${requested}${oldExt}` : requested; const updated = await gh(`/repos/${REPO}/releases/assets/${req.params.id}`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})}); res.json({ok:true,asset:updated}); } catch(e) { res.status(e.status || 500).json({ok:false,error:e.message}); } });
app.get('/health', (_req,res) => res.json({ok:true}));
app.listen(PORT, () => console.log(`${SITE_NAME} listening on ${PORT}`));
