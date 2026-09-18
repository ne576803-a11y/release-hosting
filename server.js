const express = require("express");
const multer = require("multer");
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 10000;
const REPO = process.env.REPO_FULL_NAME || "nusratbytxrs/release-hosting";
const SITE_NAME = process.env.SITE_NAME || "Release Hosting";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const MAX_UPLOAD_MB = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 100));
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-hosting-"));
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}-${path.basename(file.originalname)}`)
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "2mb" }));

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;");
}
function getAdminKey(req) { return req.headers["x-admin-key"] || req.query.key || req.body?.key || ""; }
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(500).json({ ok: false, error: "ADMIN_KEY is not configured." });
  if (getAdminKey(req) !== ADMIN_KEY) return res.status(401).json({ ok: false, error: "Invalid admin key." });
  next();
}

async function githubApi(apiPath, options = {}) {
  if (!GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is not configured.");
  const response = await fetch(`https://api.github.com${apiPath}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const error = new Error(data.message || `GitHub API returned ${response.status}`);
    error.status = response.status;
    error.github = data;
    throw error;
  }
  return data;
}
function getReleases() { return githubApi(`/repos/${REPO}/releases?per_page=100`); }
function getReleaseByTag(tag) { return githubApi(`/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`); }

function uploadToGithub(releaseId, filename, contentType, filePath, size) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: "uploads.github.com", method: "POST",
      path: `/repos/${REPO}/releases/${encodeURIComponent(releaseId)}/assets?name=${encodeURIComponent(filename)}`,
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${GITHUB_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28", "Content-Type": contentType || "application/octet-stream", "Content-Length": String(size), Connection: "close" },
      timeout: 20 * 60 * 1000
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
        resolve({ status: response.statusCode || 500, ok: (response.statusCode || 500) >= 200 && (response.statusCode || 500) < 300, data });
      });
    });
    request.on("timeout", () => request.destroy(new Error("GitHub upload timed out.")));
    request.on("error", reject);
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.pipe(request);
  });
}

const CSS = `:root{--bg:#08090d;--surface:#11141c;--surface2:#191d28;--text:#f8fafc;--muted:#9aa5b5;--line:#293141;--accent:#7c5cff;--accent2:#23d5ab}body.light{--bg:#f4f7fb;--surface:#fff;--surface2:#edf1f7;--text:#111827;--muted:#5d6878;--line:#d8e0eb}*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,Arial,sans-serif;background:var(--bg);color:var(--text);transition:.3s}a{color:inherit;text-decoration:none}.container{width:min(1120px,calc(100% - 32px));margin:auto}header{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--bg) 90%,transparent);backdrop-filter:blur(16px);border-bottom:1px solid var(--line)}.nav{min-height:70px;display:flex;align-items:center;justify-content:space-between;gap:16px}.logo{font-weight:800;font-size:20px}.logo span{color:var(--accent)}.nav-links{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:10px 15px;border-radius:12px;border:1px solid var(--line);background:var(--surface);color:var(--text);cursor:pointer;transition:transform .2s,border .2s}.btn:hover{transform:translateY(-2px);border-color:var(--accent)}.btn-primary{border:0;background:linear-gradient(135deg,var(--accent),#4f9cff);color:#fff}.btn:disabled{opacity:.6;cursor:wait;transform:none}main{padding:28px 0 60px}.hero{padding:35px 0 20px}.hero h1{font-size:clamp(32px,6vw,58px);line-height:1.05;letter-spacing:-2px;margin:0 0 14px;background:linear-gradient(110deg,var(--text),var(--accent2));-webkit-background-clip:text;color:transparent}.hero p,.muted,.upload-meta{color:var(--muted)}.search{margin:20px 0 25px}.search input,.form-group input,.form-group select{width:100%;padding:14px 15px;border-radius:12px;border:1px solid var(--line);background:var(--surface);color:var(--text);outline:none}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}.card,.asset{background:linear-gradient(145deg,var(--surface),var(--surface2));border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:0 18px 55px #0003}.card h2{margin-top:0}.asset{margin-top:14px}.asset-name{font-weight:700;word-break:break-word}.preview{margin-top:14px}.preview img{max-width:100%;max-height:450px;border-radius:14px}.preview video{width:100%;max-height:500px;border-radius:14px;background:#000}.notice{padding:16px;border-radius:14px;margin:16px 0;background:var(--surface2);border:1px solid var(--line)}.form-group{margin-bottom:20px}.form-group label{display:block;margin-bottom:8px;font-weight:700}.file-input{padding:20px!important}.selected-list{display:grid;gap:10px;margin:12px 0}.selected-file{display:grid;grid-template-columns:1fr minmax(150px,260px) auto;gap:8px;align-items:center;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--surface2)}.selected-file small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.selected-file input{padding:9px!important}.progress{height:14px;background:var(--line);border-radius:20px;overflow:hidden;margin-top:15px}.progress-bar{height:100%;width:0;background:linear-gradient(90deg,var(--accent),var(--accent2));transition:width .15s}.upload-meta{font-size:14px;margin-top:10px;line-height:1.5}.rename-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.rename-row input{flex:1;min-width:190px;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--text)}footer{padding:34px 0;border-top:1px solid var(--line);color:var(--muted);text-align:center}@media(max-width:650px){.container{width:calc(100% - 22px)}.selected-file{grid-template-columns:1fr}.selected-file input{width:100%}}
`;
function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} - ${escapeHtml(SITE_NAME)}</title><style>${CSS}</style></head><body><header><div class="container nav"><a class="logo" href="/"><span>◆</span> ${escapeHtml(SITE_NAME)}</a><div class="nav-links"><a class="btn" href="/">Releases</a><a class="btn" href="/admin">Upload</a><button class="btn" id="themeBtn" type="button">☀</button></div></div></header><main><div class="container">${body}</div></main><footer><div class="container">${escapeHtml(SITE_NAME)} · Fast, simple release hosting</div></footer><script>const t=localStorage.getItem('release_theme');if(t==='light')document.body.classList.add('light');const b=document.getElementById('themeBtn');if(b){b.textContent=document.body.classList.contains('light')?'🌙':'☀';b.onclick=()=>{document.body.classList.toggle('light');localStorage.setItem('release_theme',document.body.classList.contains('light')?'light':'dark');b.textContent=document.body.classList.contains('light')?'🌙':'☀'}};</script></body></html>`;
}
function assetPreview(asset) { const n=asset.name||"",u=asset.browser_download_url||""; if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(n)) return `<div class="preview"><img src="${escapeHtml(u)}" alt="${escapeHtml(n)}" loading="lazy"></div>`; if (/\.(mp4|webm|ogg|mov|m4v)$/i.test(n)) return `<div class="preview"><video controls preload="metadata"><source src="${escapeHtml(u)}">Your browser does not support this video.</video></div>`; return ""; }

app.get("/", async (_req,res) => { try { const releases=await getReleases(); const cards=releases.filter(r=>!r.draft).map(r=>`<div class="card"><h2><a href="/release/${encodeURIComponent(r.tag_name)}">${escapeHtml(r.name||r.tag_name)}</a></h2><p class="muted">Version: ${escapeHtml(r.tag_name)}</p><p>📦 ${r.assets?.length||0} files</p><a class="btn btn-primary" href="/release/${encodeURIComponent(r.tag_name)}">Explore release →</a></div>`).join(""); res.send(page("Releases",`<section class="hero"><h1>Share your releases<br>with style.</h1><p>Browse releases, preview media, and download files in one place.</p></section><div class="search"><input id="search" type="search" placeholder="⌕  Search releases..." oninput="searchReleases()"></div>${cards?`<div class="grid" id="releaseGrid">${cards}</div>`:`<div class="notice">No releases available yet.</div>`}<script>function searchReleases(){const v=document.getElementById('search').value.toLowerCase();document.querySelectorAll('#releaseGrid .card').forEach(c=>c.style.display=c.innerText.toLowerCase().includes(v)?'':'none')}</script>`)); } catch(e) { res.status(500).send(page("Error",`<div class="notice">${escapeHtml(e.message)}</div>`)); } });
app.get("/release/:tag", async (req,res) => { try { const release=await getReleaseByTag(req.params.tag); const assets=(release.assets||[]).map(a=>`<div class="asset"><div class="asset-name">${escapeHtml(a.name)}</div><p class="muted">${(a.size/1024/1024).toFixed(2)} MB</p>${assetPreview(a)}<br><a class="btn btn-primary" href="${escapeHtml(a.browser_download_url)}">Download ↓</a></div>`).join("")||`<div class="notice">This release has no files.</div>`; res.send(page(release.name||release.tag_name,`<section class="hero"><h1>${escapeHtml(release.name||release.tag_name)}</h1><p class="muted">Version: ${escapeHtml(release.tag_name)}</p></section><h2>Files</h2>${assets}`)); } catch(e) { res.status(e.status||500).send(page("Error",`<div class="notice">${escapeHtml(e.message)}</div>`)); } });
app.get("/api/releases", async (_req,res) => { try { const releases=await getReleases(); res.json({ok:true,count:releases.length,releases}); } catch(e) { res.status(e.status||500).json({ok:false,error:e.message}); } });
app.get("/api/admin/verify", requireAdmin, (_req,res) => res.json({ok:true}));

app.get("/admin", async (_req,res) => { try { const releases=await getReleases(); const options=releases.filter(r=>!r.draft).map(r=>`<option value="${escapeHtml(r.id)}">${escapeHtml(r.name||r.tag_name)} (${escapeHtml(r.tag_name)})</option>`).join(""); const body=`<section class="hero"><h1>Upload files</h1><p>Select multiple files, rename them before upload, and rename any newly uploaded asset without uploading it again.</p></section><div class="card"><div id="keyBox" class="form-group"><label>Admin key</label><input id="adminKey" type="password" placeholder="Enter your admin key" autocomplete="current-password"></div><div class="form-group"><label>Destination release</label><select id="releaseId">${options}</select></div><div class="form-group"><label>Select files <span class="muted">(each up to ${MAX_UPLOAD_MB} MB)</span></label><input id="file" class="file-input" type="file" multiple><div id="selected" class="selected-list"></div></div><button class="btn btn-primary" id="uploadBtn" type="button" onclick="uploadAll()">Upload selected files ↑</button><div id="status"></div></div><script>
const keyBox=document.getElementById('keyBox'),keyInput=document.getElementById('adminKey'),fileInput=document.getElementById('file'),selected=document.getElementById('selected'),saved=localStorage.getItem('release_admin_key'),state=[];function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#039;')}function hideKey(){keyBox.style.display='none'}async function verify(){if(!saved)return;try{const r=await fetch('/api/admin/verify',{headers:{'x-admin-key':saved}});if(r.ok){keyInput.value=saved;hideKey()}else localStorage.removeItem('release_admin_key')}catch{}}verify();function size(n){const u=['B','KB','MB','GB'];let i=0;while(n>=1024&&i<3){n/=1024;i++}return n.toFixed(i?2:0)+' '+u[i]}function redraw(){selected.innerHTML=state.map((x,i)=>'<div class="selected-file"><small>'+esc(x.file.name)+'</small><input id="name-'+i+'" value="'+esc(x.name)+'" aria-label="New filename for '+esc(x.file.name)+'"><button class="btn" type="button" onclick="removeFile('+i+')">Remove</button></div>').join('')}function removeFile(i){state.splice(i,1);redraw()}fileInput.onchange=()=>{state.length=0;Array.from(fileInput.files).forEach(file=>state.push({file,name:file.name}));redraw()};function renameAsset(id,oldName){const input=document.getElementById('rename-'+id),name=(input.value||oldName).trim(),out=document.getElementById('rename-status-'+id);if(!name){out.textContent='Enter a filename.';return}fetch('/api/assets/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json','x-admin-key':keyInput.value},body:JSON.stringify({name})}).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw Error(d.error||'Rename failed.');out.textContent='✓ Renamed successfully.';input.value=d.asset.name}).catch(e=>{out.textContent=e.message})}function uploadOne(item,key,index,total){return new Promise(resolve=>{const fd=new FormData(),xhr=new XMLHttpRequest(),out=document.getElementById('status'),safeName=(document.getElementById('name-'+index)?.value||item.name).trim()||item.name;fd.append('release_id',document.getElementById('releaseId').value);fd.append('filename',safeName);fd.append('file',item.file,safeName);const start=performance.now();let last=start,lastBytes=0;xhr.timeout=25*60*1000;xhr.upload.onprogress=e=>{if(!e.lengthComputable)return;const now=performance.now(),avg=e.loaded/Math.max((now-start)/1000,.001),cur=(e.loaded-lastBytes)/Math.max((now-last)/1000,.001);last=now;lastBytes=e.loaded;out.innerHTML='<div class="notice"><strong>Uploading '+(index+1)+' of '+total+': '+esc(safeName)+'</strong><div class="progress"><div id="bar" class="progress-bar"></div></div><div class="upload-meta">'+(e.loaded/e.total*100).toFixed(1)+'% · '+size(avg)+'/s average · '+size(cur)+'/s current · '+size(e.loaded)+' / '+size(e.total)+'</div></div>';document.getElementById('bar').style.width=(e.loaded/e.total*100).toFixed(2)+'%'};xhr.onload=()=>{let d;try{d=JSON.parse(xhr.responseText)}catch{d={ok:false,error:xhr.responseText||'Invalid response'}};resolve({ok:xhr.status>=200&&xhr.status<300&&d.ok,data:d,filename:safeName})};xhr.onerror=()=>resolve({ok:false,data:{error:'Connection interrupted while uploading.'},filename:safeName});xhr.ontimeout=()=>resolve({ok:false,data:{error:'Upload timed out.'},filename:safeName});xhr.open('POST','/api/upload');xhr.setRequestHeader('x-admin-key',key);xhr.send(fd)})}async function uploadAll(){const key=keyInput.value.trim(),btn=document.getElementById('uploadBtn'),out=document.getElementById('status');if(!key){out.innerHTML='<div class="notice">Please enter the admin key.</div>';return}if(!state.length){out.innerHTML='<div class="notice">Please select at least one file.</div>';return}localStorage.setItem('release_admin_key',key);hideKey();btn.disabled=true;btn.textContent='Uploading…';const results=[];for(let i=0;i<state.length;i++)results.push(await uploadOne(state[i],key,i,state.length));const failed=results.filter(r=>!r.ok);if(!failed.length){out.innerHTML='<div class="notice"><strong>✓ All '+results.length+' files uploaded successfully!</strong><br>'+results.map(r=>'<div>'+esc(r.filename)+'<div class="rename-row"><input id="rename-'+r.data.asset.id+'" value="'+esc(r.data.asset.name||r.filename)+'"><button class="btn" type="button" onclick="renameAsset('+r.data.asset.id+',\''+esc(r.data.asset.name||r.filename).replace(/'/g,'\\&#039;')+'\')">Rename</button><span id="rename-status-'+r.data.asset.id+'" class="muted"></span></div></div>').join('')+'</div>';fileInput.value='';state.length=0;redraw()}else out.innerHTML='<div class="notice"><strong>Upload finished with '+failed.length+' error(s).</strong><br>'+results.map(r=>(r.ok?'✓ ':'✕ ')+esc(r.filename)+(r.ok?'':' — '+esc(r.data.error||'Unknown error'))).join('<br>')+'</div>';btn.disabled=false;btn.textContent='Upload selected files ↑'}
</script>`;res.send(page("Admin",body)); } catch(e) { res.status(500).send(page("Admin Error",`<div class="notice">${escapeHtml(e.message)}</div>`)); } });

app.post("/api/upload", requireAdmin, upload.single("file"), async (req,res) => { const temp=req.file?.path; try { if(!req.file)return res.status(400).json({ok:false,error:"No file was uploaded."}); if(!req.body.release_id)return res.status(400).json({ok:false,error:"release_id is required."}); const filename=path.basename(String(req.body.filename||req.file.originalname)).replace(/[\\/]/g,"-").trim(); if(!filename||filename==='.'||filename==='..')return res.status(400).json({ok:false,error:"A valid filename is required."}); const result=await uploadToGithub(req.body.release_id,filename,req.file.mimetype,temp,req.file.size); if(!result.ok)return res.status(result.status).json({ok:false,error:result.data?.message||`GitHub upload failed with HTTP ${result.status}`,github:result.data}); res.json({ok:true,message:"File uploaded successfully.",asset:result.data}); } catch(e) { console.error('UPLOAD ERROR',e);res.status(502).json({ok:false,error:e.message||'Binary upload failed.'}); } finally { if(temp)fs.promises.unlink(temp).catch(()=>{}); } });

app.patch("/api/assets/:assetId", requireAdmin, async (req,res) => { try { const assetId=encodeURIComponent(req.params.assetId),name=path.basename(String(req.body?.name||"")).replace(/[\\/]/g,"-").trim(); if(!name||name==='.'||name==='..')return res.status(400).json({ok:false,error:"A valid filename is required."}); const asset=await githubApi(`/repos/${REPO}/releases/assets/${assetId}`,{method:"PATCH",body:JSON.stringify({name})}); res.json({ok:true,asset}); } catch(e) { res.status(e.status||500).json({ok:false,error:e.message,github:e.github||null}); } });

app.use((error,_req,res,_next) => { if(error instanceof multer.MulterError)return res.status(error.code==='LIMIT_FILE_SIZE'?413:400).json({ok:false,error:error.code==='LIMIT_FILE_SIZE'?`File is too large. Maximum allowed size is ${MAX_UPLOAD_MB} MB.`:error.message}); console.error(error);res.status(500).json({ok:false,error:error.message||'Internal server error.'}); });
app.get('/health',(_req,res)=>res.type('text').send('ok'));
app.listen(PORT,'0.0.0.0',()=>console.log(`${SITE_NAME} running on port ${PORT}`));
