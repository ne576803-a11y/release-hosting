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

const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const safeName = value => { const name = path.basename(String(value || '')).replace(/[\\/]/g, '-').trim(); return name && name !== '.' && name !== '..' ? name : ''; };
const extension = name => path.extname(String(name || '')).toLowerCase();
const preserveExtension = (newName, oldName) => { const clean = safeName(newName); const oldExt = extension(oldName); if (!clean) return ''; return oldExt && extension(clean) !== oldExt ? `${path.basename(clean, path.extname(clean))}${oldExt}` : clean; };
const requestKey = req => req.headers['x-admin-key'] || req.query.key || req.body?.key || '';
function requireAdmin(req, res, next) { if (!ADMIN_KEY) return res.status(500).json({ ok: false, error: 'ADMIN_KEY is not configured.' }); if (requestKey(req) !== ADMIN_KEY) return res.status(401).json({ ok: false, error: 'Invalid admin key.' }); next(); }

async function githubApi(apiPath, options = {}) {
  if (!TOKEN) throw new Error('GITHUB_TOKEN is not configured.');
  const response = await fetch(`https://api.github.com${apiPath}`, { ...options, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const text = await response.text(); let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) { const error = new Error(data.message || `GitHub API returned ${response.status}`); error.status = response.status; error.github = data; throw error; }
  return data;
}
const getReleases = () => githubApi(`/repos/${REPO}/releases?per_page=100`);
const getReleaseByTag = tag => githubApi(`/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`);

function uploadAsset(releaseId, filename, type, filePath, size) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'uploads.github.com', method: 'POST', path: `/repos/${REPO}/releases/${encodeURIComponent(releaseId)}/assets?name=${encodeURIComponent(filename)}`, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': type || 'application/octet-stream', 'Content-Length': String(size), Connection: 'close' }, timeout: 30 * 60 * 1000 }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => { let data = {}; try { data = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch {} resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode || 500, data }); });
    });
    req.on('timeout', () => req.destroy(new Error('GitHub upload timed out.'))); req.on('error', reject);
    const stream = fs.createReadStream(filePath); stream.on('error', error => { req.destroy(); reject(error); }); stream.pipe(req);
  });
}

const CSS = `:root{--bg:#08090d;--surface:#11141c;--surface2:#191d28;--text:#f8fafc;--muted:#9aa5b5;--line:#293141;--accent:#7c5cff;--good:#23d5ab;--info:#69b7ff;--warn:#ffbd66}body.light{--bg:#f4f7fb;--surface:#fff;--surface2:#edf1f7;--text:#111827;--muted:#5d6878;--line:#d8e0eb}*{box-sizing:border-box}body{margin:0;font:16px Inter,system-ui,Arial,sans-serif;background:var(--bg);color:var(--text)}a{color:inherit;text-decoration:none}.container{width:min(1120px,calc(100% - 24px));margin:auto}header{position:sticky;top:0;z-index:10;background:var(--bg);border-bottom:1px solid var(--line)}.nav{min-height:68px;display:flex;align-items:center;justify-content:space-between;gap:12px}.logo{font-weight:800;font-size:20px}.logo span{color:var(--accent)}.nav-links{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.btn{display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--text);cursor:pointer}.btn:hover{border-color:var(--accent)}.primary{border:0;background:linear-gradient(135deg,var(--accent),#4f9cff);color:#fff}.danger{color:#ef4444}main{padding:28px 0 60px}.hero{padding:30px 0 20px}.hero h1{font-size:clamp(32px,6vw,58px);margin:0 0 14px}.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}.card,.asset{background:linear-gradient(145deg,var(--surface),var(--surface2));border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:0 18px 55px #0003}.asset{margin-top:14px;position:relative}.asset-name{font-weight:700;word-break:break-word;padding-right:48px}.asset-menu{position:absolute;right:14px;top:14px}.dots{font-size:22px;width:38px;height:38px;padding:0}.menu-panel{display:none;position:absolute;right:0;top:44px;z-index:5;min-width:215px;padding:7px;border:1px solid var(--line);border-radius:12px;background:var(--surface);box-shadow:0 12px 35px #0008}.menu-panel.open{display:grid;gap:5px}.menu-panel button{padding:9px;text-align:left;border:0;border-radius:8px;background:transparent;color:var(--text);cursor:pointer}.menu-panel button:hover{background:var(--surface2)}.preview{margin-top:14px}.preview img,.preview video{max-width:100%;max-height:450px;border-radius:14px}.notice{padding:16px;border:1px solid var(--line);border-radius:14px;background:var(--surface2);margin:16px 0}.status{border-left:4px solid var(--info);background:linear-gradient(135deg,#17263a,var(--surface2));color:var(--info);font-weight:600;line-height:1.7}.status.success{border-left-color:var(--good);color:var(--good);background:linear-gradient(135deg,#102d2b,var(--surface2))}.status.error{border-left-color:#ff6b7a;color:#ff9aa5;background:linear-gradient(135deg,#321c27,var(--surface2))}.status b{color:inherit}.speed{color:var(--warn);font-weight:800}.uploaded{color:var(--info);font-weight:700}.upload-name{color:var(--text);font-weight:800}.form-group{margin-bottom:20px}.form-group label{display:block;margin-bottom:8px;font-weight:700}.form-group input,.form-group select,.file-input{width:100%;padding:13px;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--text)}.selected-list{display:grid;gap:10px;margin:12px 0 20px}.selected-file{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:9px;align-items:center;padding:10px;border:1px solid var(--line);border-radius:10px}.selected-file small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.selected-file .btn{padding:7px 10px;font-size:13px}.progress{height:14px;background:var(--line);border-radius:20px;overflow:hidden;margin-top:14px}.progress-bar{height:100%;background:linear-gradient(90deg,var(--accent),var(--good));transition:width .15s}footer{padding:34px 0;border-top:1px solid var(--line);text-align:center;color:var(--muted)}@media(max-width:650px){.selected-file{grid-template-columns:1fr auto}.selected-file small{grid-column:1/-1}}`;

/* ===== Toast styles added for copy confirmation ===== */
const TOAST_CSS = `.toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%) translateY(120%);padding:13px 22px;border-radius:12px;background:linear-gradient(135deg,var(--good),#12a37f);color:#fff;font-weight:700;box-shadow:0 12px 40px #0006;z-index:9999;transition:transform .3s ease;opacity:0}.toast.show{transform:translateX(-50%) translateY(0);opacity:1}.toast.error{background:linear-gradient(135deg,#ff6b7a,#c4374a)}.upload-progress-note{margin:14px 0 0;padding:14px;border:1px solid var(--line);border-radius:12px;background:transparent}`;

function page(title, body, script = '') { return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} - ${esc(SITE_NAME)}</title><style>${CSS}${TOAST_CSS}</style></head><body><header><div class="container nav"><a class="logo" href="/"><span>✦</span> ${esc(SITE_NAME)}</a><div class="nav-links"><a class="btn" href="/">Releases</a><a class="btn" href="/admin">Upload</a><button class="btn" id="themeBtn" type="button"></button></div></div></header><main><div class="container">${body}</div></main><footer>${esc(SITE_NAME)} · Fast, simple release hosting</footer><div id="toast" class="toast"></div><script>function applyTheme(){var light=localStorage.getItem('release_theme')==='light';document.body.classList.toggle('light',light);var b=document.getElementById('themeBtn');if(b)b.textContent=light?'🌙 Dark mode':'☀️ Light mode'}applyTheme();document.getElementById('themeBtn').onclick=function(){localStorage.setItem('release_theme',document.body.classList.contains('light')?'dark':'light');applyTheme()};function showToast(msg,isError){var t=document.getElementById('toast');t.textContent=msg;t.classList.toggle('error',!!isError);t.classList.add('show');clearTimeout(t._timer);t._timer=setTimeout(function(){t.classList.remove('show')},2600)}${script}</script></body></html>`; }
function preview(asset) { const n = asset.name || '', u = asset.browser_download_url || ''; if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(n)) return `<div class="preview"><img src="${esc(u)}" alt="${esc(n)}" loading="lazy"></div>`; if (/\.(mp4|webm|ogg|mov|m4v)$/i.test(n)) return `<div class="preview"><video controls preload="metadata"><source src="${esc(u)}"></video></div>`; return ''; }

app.get('/', async (_req, res) => { try { const releases = await getReleases(); const cards = releases.filter(r => !r.draft).map(r => `<div class="card"><h2><a href="/release/${encodeURIComponent(r.tag_name)}">${esc(r.name || r.tag_name)}</a></h2><p class="muted">Version: ${esc(r.tag_name)}</p><p>📦 ${r.assets?.length || 0} files</p><a class="btn primary" href="/release/${encodeURIComponent(r.tag_name)}">Explore release →</a></div>`).join(''); res.send(page('Releases', `<section class="hero"><h1>Share your releases<br>with style.</h1><p class="muted">Browse releases, preview media, and download files in one place.</p></section><input id="search" class="form-group" placeholder="⌕ Search releases...">${cards ? `<div class="grid" id="releaseGrid">${cards}</div>` : '<div class="notice">No releases available yet.</div>'}`, `var search=document.getElementById('search');search.oninput=function(){var v=search.value.toLowerCase();document.querySelectorAll('#releaseGrid .card').forEach(function(x){x.style.display=x.innerText.toLowerCase().includes(v)?'':'none'})}`)); } catch (e) { res.status(500).send(page('Error', `<div class="notice error">${esc(e.message)}</div>`)); } });

app.get('/release/:tag', async (req, res) => { try { const release = await getReleaseByTag(req.params.tag); const assets = (release.assets || []).map(asset => `<div class="asset" data-asset data-id="${asset.id}" data-created="${esc(asset.created_at || '')}" data-url="${esc(asset.browser_download_url || '')}"><div class="asset-menu"><button class="btn dots" data-menu type="button" aria-label="File actions">⋮</button><div class="menu-panel"><button data-action="rename" type="button">Rename file</button><button data-action="delete" class="danger" type="button">Delete file</button><button data-action="view" type="button">Copy direct view link</button><button data-action="download" type="button">Copy direct download link</button></div></div><div class="asset-name">${esc(asset.name)}</div><p class="muted">${(asset.size / 1048576).toFixed(2)} MB</p>${preview(asset)}<br><a class="btn primary" href="${esc(asset.browser_download_url)}">Download ↘</a></div>`).join(''); const body = `<section class="hero"><h1>${esc(release.name || release.tag_name)}</h1><p class="muted">Version: ${esc(release.tag_name)}</p></section><div class="card"><div class="form-group" style="margin-bottom:12px"><input id="fileSearch" placeholder="⌕ Search files in this release..."></div><label>Sort files: <select id="sort"><option value="oldest">Oldest first</option><option value="newest">Newest first</option></select></label></div><div id="status"></div><div id="files">${assets || '<div class="notice">This release has no files.</div>'}</div>`; 
const script = `
var files=document.getElementById('files'),status=document.getElementById('status'),sort=document.getElementById('sort'),fileSearch=document.getElementById('fileSearch');
// Restore saved sort preference
var savedSort=localStorage.getItem('release_sort_pref');
if(savedSort==='newest'||savedSort==='oldest'){sort.value=savedSort}
function adminKey(){var k=localStorage.getItem('release_admin_key')||prompt('Enter admin key');if(k)localStorage.setItem('release_admin_key',k);return k||''}
function msg(text,good){status.innerHTML='<div class="notice status '+(good===false?'error':'success')+'">'+text+'</div>'}
function reorder(){Array.from(files.querySelectorAll('[data-asset]')).sort(function(a,b){var d=new Date(a.dataset.created)-new Date(b.dataset.created);return sort.value==='oldest'?d:-d}).forEach(function(x){files.appendChild(x)})}
function filterFiles(){var v=fileSearch.value.toLowerCase();files.querySelectorAll('[data-asset]').forEach(function(x){x.style.display=x.innerText.toLowerCase().includes(v)?'':'none'})}
sort.onchange=function(){localStorage.setItem('release_sort_pref',sort.value);reorder()};
fileSearch.oninput=filterFiles;
reorder();filterFiles();
document.addEventListener('click',async function(e){
  var menu=e.target.closest('[data-menu]');
  if(menu){document.querySelectorAll('.menu-panel.open').forEach(function(x){x.classList.remove('open')});menu.nextElementSibling.classList.toggle('open');return}
  if(!e.target.closest('.asset-menu'))document.querySelectorAll('.menu-panel.open').forEach(function(x){x.classList.remove('open')});
  var button=e.target.closest('[data-action]');if(!button)return;
  var card=button.closest('[data-asset]'),id=card.dataset.id,name=card.querySelector('.asset-name').textContent;
  if(button.dataset.action==='rename'||button.dataset.action==='delete'){
    var key=adminKey();if(!key)return;
    if(button.dataset.action==='rename'){
      var next=prompt('New filename (extension stays unchanged):',name);if(!next||next===name)return;
      var oldExt=name.includes('.')?name.slice(name.lastIndexOf('.')):'';var typedExt=next.includes('.')?next.slice(next.lastIndexOf('.')):'';
      if(oldExt&&typedExt.toLowerCase()!==oldExt.toLowerCase())next=next.replace(/\.[^/.]*$/,'')+oldExt;
      try{var r=await fetch('/api/assets/'+id,{method:'PATCH',headers:{'Content-Type':'application/json','x-admin-key':key},body:JSON.stringify({name:next})}),d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'Rename failed');card.querySelector('.asset-name').textContent=d.asset.name;msg('✓ File renamed successfully.');showToast('✓ File renamed successfully.')}catch(x){msg(x.message,false);showToast(x.message,true)}
    }else{
      if(!confirm('Delete '+name+' permanently?'))return;
      var r=await fetch('/api/assets/'+id,{method:'DELETE',headers:{'x-admin-key':key}}),d=await r.json();
      if(!r.ok||!d.ok){msg(d.error||'Delete failed',false);showToast(d.error||'Delete failed',true);return}
      card.remove();msg('✓ File deleted successfully.');showToast('✓ File deleted successfully.');
    }
    return;
  }
  // Copy links
  var url=card.dataset.url;
  var label=button.dataset.action==='view'?'Direct view link':'Direct download link';
  try{await navigator.clipboard.writeText(url);msg('✓ '+label+' copied.');showToast('✓ '+label+' copied to clipboard.')}
  catch{prompt('Copy this link:',url);showToast('⚠ Clipboard blocked — copy manually.',true)}
});`;
res.send(page(release.name || release.tag_name, body, script)); } catch (e) { res.status(e.status || 500).send(page('Error', `<div class="notice error">${esc(e.message)}</div>`)); } });

app.get('/admin', async (_req, res) => { try { const releases = await getReleases(); const options = releases.filter(r => !r.draft).map(r => `<option value="${r.id}">${esc(r.name || r.tag_name)} (${esc(r.tag_name)})</option>`).join(''); const body = `<section class="hero"><h1>Upload files</h1><p class="muted">Rename selected files before uploading. File extensions are protected.</p></section><div class="card"><div class="form-group" id="keyBox"><label>Admin key</label><input id="adminKey" type="password" placeholder="Enter your admin key"></div><div class="form-group"><label>Destination release</label><select id="releaseId">${options}</select></div><div class="form-group"><label>Select files <span class="muted">(each up to ${MAX_MB} MB)</span></label><input id="file" class="file-input" type="file" multiple><div id="selected" class="selected-list"></div></div><button class="btn primary" id="uploadBtn" type="button">Upload selected files ↥</button><div id="status"></div></div>`; 
const script = `
var keyInput=document.getElementById('adminKey'),fileInput=document.getElementById('file'),selectedBox=document.getElementById('selected'),statusBox=document.getElementById('status'),uploadBtn=document.getElementById('uploadBtn'),keyBox=document.getElementById('keyBox'),files=[];
var savedKey=localStorage.getItem('release_admin_key');
if(savedKey){keyInput.value=savedKey;keyBox.style.display='none'}
function safeHtml(v){return String(v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[c]})}
function keepExt(next,original){var ext=original.includes('.')?original.slice(original.lastIndexOf('.')):'';var clean=next.replace(/[\\\\/]/g,'-').trim();if(ext)clean=clean.replace(/\\.[^/.]*$/,'')+ext;return clean}
function render(){selectedBox.innerHTML=files.map(function(x,i){return '<div class="selected-file"><small title="'+safeHtml(x.name)+'">'+safeHtml(x.name)+'</small><button class="btn" type="button" data-rename="'+i+'">Rename</button><button class="btn danger" type="button" data-remove="'+i+'">Remove</button></div>'}).join('')}
fileInput.onchange=function(){files=Array.from(fileInput.files).map(function(file){return{file:file,name:file.name,original:file.name}});render()};
selectedBox.onclick=function(e){var r=e.target.closest('[data-rename]'),x=e.target.closest('[data-remove]');if(r){var i=Number(r.dataset.rename),n=prompt('New filename (extension stays unchanged):',files[i].name),v=n&&keepExt(n,files[i].original);if(v)files[i].name=v;render()}if(x){files.splice(Number(x.dataset.remove),1);render()}};
function one(item,index,total,retry){return new Promise(function(done){retry=retry||0;var form=new FormData();form.append('release_id',document.getElementById('releaseId').value);form.append('file',item.file,item.name);var q=new XMLHttpRequest(),started=performance.now();q.open('POST','/api/upload');q.setRequestHeader('x-admin-key',keyInput.value.trim());q.timeout=30*60*1000;q.upload.onprogress=function(e){if(!e.lengthComputable)return;var mb=e.loaded/1048576,totalMb=e.total/1048576,seconds=Math.max((performance.now()-started)/1000,.001),speed=mb/seconds;statusBox.innerHTML='<div class="upload-progress-note"><b>'+index+'/'+total+' file uploading:</b> <span class="upload-name">'+safeHtml(item.name)+'</span><br><span class="uploaded">Uploaded: '+mb.toFixed(1)+' MB / '+totalMb.toFixed(1)+' MB</span><br><span class="speed">Speed: '+speed.toFixed(2)+' MB/s</span><div class="progress"><div class="progress-bar" style="width:'+(e.loaded/e.total*100)+'%"></div></div></div>'};
q.onload=function(){var d={};try{d=JSON.parse(q.responseText)}catch{}var z={ok:q.status>=200&&q.status<300&&d.ok,name:item.name,error:d.error||('Upload failed ('+q.status+')')};if(!z.ok&&retry<2&&/connection|timeout/i.test(z.error))return setTimeout(function(){one(item,index,total,retry+1).then(done)},1500*(retry+1));done(z)};
q.onerror=function(){if(retry<2)return setTimeout(function(){one(item,index,total,retry+1).then(done)},1500*(retry+1));done({ok:false,name:item.name,error:'Connection interrupted after retries.'})};
q.ontimeout=function(){done({ok:false,name:item.name,error:'Upload timed out.'})};
q.send(form)})}
uploadBtn.onclick=async function(){
  var key=keyInput.value.trim();
  if(!key)return statusBox.innerHTML='<div class="notice status error">Admin key required.</div>';
  if(!files.length)return statusBox.innerHTML='<div class="notice status error">Select at least one file.</div>';
  localStorage.setItem('release_admin_key',key);keyBox.style.display='none';uploadBtn.disabled=true;
  var results=[];for(var i=0;i<files.length;i++)results.push(await one(files[i],i+1,files.length));
  var bad=results.filter(function(x){return!x.ok});
  statusBox.innerHTML='<div class="notice status '+(bad.length?'error':'success')+'"><b>'+(bad.length?'Some files failed.':'✓ All files uploaded successfully.')+'</b><br>'+results.map(function(x){return(x.ok?'✓ ':'✗ ')+safeHtml(x.name)+(x.error?' — '+safeHtml(x.error):'')}).join('<br>')+'</div>';
  if(!bad.length)showToast('✓ All '+results.length+' file(s) uploaded successfully.');
  else showToast('⚠ '+bad.length+' file(s) failed.',true);
  uploadBtn.disabled=false;
  if(!bad.length){fileInput.value='';files=[];render()}
}`; res.send(page('Admin', body, script)); } catch (e) { res.status(500).send(page('Admin Error', `<div class="notice error">${esc(e.message)}</div>`)); } });

app.post('/api/upload', requireAdmin, upload.single('file'), async (req, res) => { const file = req.file?.path; try { if (!req.file) return res.status(400).json({ ok: false, error: 'No file was uploaded.' }); if (!req.body.release_id) return res.status(400).json({ ok: false, error: 'release_id is required.' }); let name = safeName(req.file.originalname); const existing = await githubApi(`/repos/${REPO}/releases/${encodeURIComponent(req.body.release_id)}/assets`); const ext = path.extname(name); const base = path.basename(name, ext); let counter = 1; while (existing.some(asset => asset.name === name)) name = `${base}-${counter++}${ext}`; const result = await uploadAsset(req.body.release_id, name, req.file.mimetype, file, req.file.size); if (!result.ok) return res.status(result.status).json({ ok: false, error: result.data?.message || `GitHub upload failed (${result.status}).` }); res.json({ ok: true, asset: result.data }); } catch (e) { res.status(e.status || 502).json({ ok: false, error: e.message }); } finally { if (file) fs.promises.unlink(file).catch(() => {}); } });
app.patch('/api/assets/:id', requireAdmin, async (req, res) => { try { const current = await githubApi(`/repos/${REPO}/releases/assets/${encodeURIComponent(req.params.id)}`); const name = preserveExtension(req.body?.name, current.name); if (!name) return res.status(400).json({ ok: false, error: 'A valid filename is required.' }); const asset = await githubApi(`/repos/${REPO}/releases/assets/${encodeURIComponent(req.params.id)}`, { method: 'PATCH', body: JSON.stringify({ name }) }); res.json({ ok: true, asset }); } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); } });
app.delete('/api/assets/:id', requireAdmin, async (req, res) => { try { await githubApi(`/repos/${REPO}/releases/assets/${encodeURIComponent(req.params.id)}`, { method: 'DELETE' }); res.json({ ok: true }); } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); } });
app.get('/health', (_req, res) => res.type('text').send('ok'));
app.use((error, _req, res, _next) => res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ ok: false, error: error.code === 'LIMIT_FILE_SIZE' ? `File is too large. Maximum allowed size is ${MAX_MB} MB.` : error.message }));
app.listen(PORT, '0.0.0.0', () => console.log(`${SITE_NAME} running on port ${PORT}`));
