const express = require("express");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 10000;
const REPO = process.env.REPO_FULL_NAME || "txrszone/release-hosting";
const SITE_NAME = process.env.SITE_NAME || "Release Hosting";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const MAX_UPLOAD_MB = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 100));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 }
});

app.use(express.json({ limit: "2mb" }));

function esc(v = "") {
  return String(v).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function auth(req, res, next) {
  if (!ADMIN_KEY) return res.status(503).json({error:"ADMIN_KEY is not configured on Render."});
  const key = req.get("x-admin-key") || req.query.key || "";
  if (key !== ADMIN_KEY) return res.status(401).json({error:"Invalid admin key."});
  next();
}

async function gh(path, options = {}) {
  const headers = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(options.headers || {})
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  const r = await fetch(`https://api.github.com${path}`, {...options, headers});
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) {
    const msg = data?.message || `GitHub API error ${r.status}`;
    const e = new Error(msg);
    e.status = r.status;
    throw e;
  }
  return data;
}

function layout(title, body, extraScript = "") {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} • ${esc(SITE_NAME)}</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
*{box-sizing:border-box}body{margin:0;background:#0f1220;color:#f5f7ff}
a{color:inherit}.wrap{max-width:1050px;margin:auto;padding:20px}
nav{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:24px}
.brand{font-size:22px;font-weight:800;text-decoration:none}
.btn,button{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:10px;padding:10px 14px;background:#5865f2;color:#fff;text-decoration:none;cursor:pointer;font-weight:700}
.btn.alt{background:#252b40}.hero,.card{background:#171b2d;border:1px solid #292f49;border-radius:16px;padding:20px}
.hero{margin-bottom:18px}.muted{color:#aab2cc}.tag{display:inline-block;background:#272e48;padding:4px 8px;border-radius:999px;font-size:12px;margin:3px}
.search{width:100%;padding:13px 15px;border-radius:12px;border:1px solid #343b58;background:#0c1020;color:#fff;margin:14px 0 18px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:15px}
.card h2{margin:0 0 8px}.assets{margin-top:14px}.asset{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 0;border-top:1px solid #292f49}
.asset-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.note{white-space:pre-wrap;line-height:1.6;max-height:360px;overflow:auto}
form{display:grid;gap:12px}.field{display:grid;gap:6px}input,select,textarea{width:100%;padding:12px;border-radius:10px;border:1px solid #343b58;background:#0c1020;color:#fff}
.filebox{padding:18px;border:1px dashed #5865f2;border-radius:12px}.danger{background:#b83b4b}
.preview{max-width:100%;max-height:420px;border-radius:12px;margin-top:10px}
video{width:100%;max-height:520px;border-radius:12px;margin-top:10px}
.notice{padding:12px;border-radius:10px;background:#222941;margin:10px 0}
@media(max-width:600px){.wrap{padding:14px}.asset{align-items:flex-start;flex-direction:column}.asset .btn{width:100%}}
</style></head><body><main class="wrap">
<nav><a class="brand" href="/">${esc(SITE_NAME)}</a><a class="btn alt" href="/admin">Admin Upload</a></nav>
${body}</main>${extraScript}</body></html>`;
}

function assetHtml(a, release) {
  const safeUrl = esc(a.browser_download_url);
  const name = esc(a.name);
  const size = a.size ? `${(a.size/1024/1024).toFixed(2)} MB` : "";
  const ext = (a.name.split(".").pop() || "").toLowerCase();
  let preview = "";
  if (["jpg","jpeg","png","gif","webp","svg"].includes(ext)) preview = `<img class="preview" src="${safeUrl}" alt="${name}" loading="lazy">`;
  if (["mp4","webm","ogg"].includes(ext)) preview = `<video controls preload="metadata" src="${safeUrl}"></video>`;
  return `<div class="asset"><div style="min-width:0"><div class="asset-name">${name}</div><small class="muted">${size} • ${esc(a.download_count)} downloads</small>${preview}</div><a class="btn" href="${safeUrl}" target="_blank" rel="noopener">Download</a></div>`;
}

async function releases() {
  return gh(`/repos/${encodeURIComponent(REPO)}/releases?per_page=100`);
}

app.get("/", async (req,res) => {
  try {
    const list = await releases();
    const cards = list.map(r => `<article class="card release-card" data-search="${esc((r.name||r.tag_name||"")+" "+(r.body||""))}">
      <h2>${esc(r.name || r.tag_name)}</h2>
      <span class="tag">${esc(r.tag_name)}</span>
      ${r.prerelease ? '<span class="tag">Pre-release</span>' : ''}
      <p class="muted">${r.published_at ? new Date(r.published_at).toLocaleString() : "Unpublished"}</p>
      <p>${esc((r.body || "").slice(0,240))}${(r.body||"").length>240?"…":""}</p>
      <a class="btn" href="/release/${encodeURIComponent(r.tag_name)}">View Release</a>
    </article>`).join("");
    res.send(layout(SITE_NAME, `<section class="hero"><h1>${esc(SITE_NAME)}</h1><p class="muted">Releases from ${esc(REPO)}</p><input id="search" class="search" placeholder="Search releases..."></section><section class="grid" id="list">${cards || '<div class="card">No releases found.</div>'}</section>`,
`<script>const s=document.querySelector('#search');s.oninput=()=>{const q=s.value.toLowerCase();document.querySelectorAll('.release-card').forEach(x=>x.style.display=x.dataset.search.toLowerCase().includes(q)?'block':'none')}</script>`));
  } catch(e) { res.status(500).send(layout("Error", `<div class="card"><h2>Could not load releases</h2><p>${esc(e.message)}</p></div>`)); }
});

app.get("/release/:tag", async (req,res) => {
  try {
    const tag = req.params.tag;
    const r = await gh(`/repos/${encodeURIComponent(REPO)}/releases/tags/${encodeURIComponent(tag)}`);
    const assets = (r.assets || []).map(a => assetHtml(a,r)).join("");
    res.send(layout(r.name || r.tag_name, `<section class="hero"><a class="muted" href="/">← All releases</a><h1>${esc(r.name || r.tag_name)}</h1><span class="tag">${esc(r.tag_name)}</span><p class="muted">${r.published_at ? new Date(r.published_at).toLocaleString() : "Unpublished"}</p><div class="note">${esc(r.body || "No release notes.")}</div></section><section class="card"><h2>Files (${r.assets?.length || 0})</h2><div class="assets">${assets || '<p class="muted">No files attached to this release.</p>'}</div></section>`));
  } catch(e) { res.status(404).send(layout("Release not found", `<div class="card"><h2>Release not found</h2><p>${esc(e.message)}</p><a class="btn" href="/">Back</a></div>`)); }
});

app.get("/admin", async (req,res) => {
  let list = [];
  try { list = await releases(); } catch {}
  const opts = list.map(r => `<option value="${esc(r.id)}">${esc(r.name || r.tag_name)} (${esc(r.tag_name)})</option>`).join("");
  res.send(layout("Admin Upload", `<section class="hero"><h1>Admin Upload</h1><p class="muted">Upload an asset directly to a GitHub Release.</p><div class="notice">The admin key is only sent to this server and is never placed in the page source.</div></section>
<section class="card"><form id="form">
<div class="field"><label>Admin key</label><input id="key" type="password" required autocomplete="off"></div>
<div class="field"><label>Release</label><select id="release_id" required>${opts || '<option>No releases available</option>'}</select></div>
<div class="field"><label>File</label><div class="filebox"><input id="file" type="file" required></div></div>
<button type="submit">Upload to GitHub Release</button>
<div id="status"></div></form></section>`,
`<script>
const f=document.querySelector('#form'),st=document.querySelector('#status');
f.onsubmit=async e=>{e.preventDefault();st.textContent='Uploading...';
const fd=new FormData();fd.append('release_id',document.querySelector('#release_id').value);fd.append('file',document.querySelector('#file').files[0]);
try{const r=await fetch('/api/upload',{method:'POST',headers:{'x-admin-key':document.querySelector('#key').value},body:fd});const d=await r.json();if(!r.ok)throw new Error(d.error||'Upload failed');st.innerHTML='<div class="notice">Uploaded successfully. <a href="'+d.download_url+'" target="_blank" rel="noopener">Open file</a></div>';f.reset()}catch(x){st.innerHTML='<div class="notice">'+x.message+'</div>'}};
</script>`));
});

app.post("/api/upload", auth, upload.single("file"), async (req,res) => {
  try {
    if (!GITHUB_TOKEN) return res.status(503).json({error:"GITHUB_TOKEN is not configured."});
    if (!req.file) return res.status(400).json({error:"No file selected."});
    const releaseId = Number(req.body.release_id);
    if (!releaseId) return res.status(400).json({error:"Invalid release."});

    const release = await gh(`/repos/${encodeURIComponent(REPO)}/releases/${releaseId}`);
    const filename = req.file.originalname.replace(/[\/\\]/g,"_");
    const uploadUrl = `https://uploads.github.com/repos/${encodeURIComponent(REPO)}/releases/${releaseId}/assets?name=${encodeURIComponent(filename)}`;

    const r = await fetch(uploadUrl, {
      method:"POST",
      headers:{
        "Authorization":`Bearer ${GITHUB_TOKEN}`,
        "Accept":"application/vnd.github+json",
        "Content-Type":req.file.mimetype || "application/octet-stream",
        "Content-Length":String(req.file.size),
        "X-GitHub-Api-Version":"2022-11-28"
      },
      body:req.file.buffer
    });
    const text=await r.text();
    let data; try{data=JSON.parse(text)}catch{data={message:text}};
    if(!r.ok) return res.status(r.status).json({error:data.message||"GitHub upload failed."});
    res.json({ok:true,name:data.name,download_url:data.browser_download_url,release:release.tag_name});
  } catch(e) {
    res.status(e.status || 500).json({error:e.message || "Upload failed."});
  }
});

app.get("/health",(req,res)=>res.json({ok:true,repo:REPO}));
app.listen(PORT,()=>console.log(`${SITE_NAME} running on port ${PORT}`));