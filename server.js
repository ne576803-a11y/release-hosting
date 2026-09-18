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
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-upload-"));

// Never keep binary files in memory. Render can terminate a process that buffers a video.
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}-${path.basename(file.originalname)}`)
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "2mb" }));

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function getAdminKey(req) { return req.headers["x-admin-key"] || req.query.key || req.body?.key || ""; }
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(500).json({ ok: false, error: "ADMIN_KEY is not configured." });
  if (getAdminKey(req) !== ADMIN_KEY) return res.status(401).json({ ok: false, error: "Invalid admin key." });
  next();
}

async function githubApi(apiPath) {
  if (!GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is not configured.");
  const response = await fetch(`https://api.github.com${apiPath}`, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${GITHUB_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28" } });
  const text = await response.text(); let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) { const e = new Error(data?.message || `GitHub API returned ${response.status}`); e.status = response.status; e.github = data; throw e; }
  return data;
}
function getReleases() { return githubApi(`/repos/${REPO}/releases?per_page=100`); }
function getReleaseByTag(tag) { return githubApi(`/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`); }

// Use native https for the binary upload. It is more reliable on Node/Render than
// fetch() with a streamed request body and always returns a response to the browser.
function uploadAssetToGitHub({ releaseId, filename, contentType, filePath, size }) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: "uploads.github.com",
      method: "POST",
      path: `/repos/${REPO}/releases/${encodeURIComponent(releaseId)}/assets?name=${encodeURIComponent(filename)}`,
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${GITHUB_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28", "Content-Type": contentType || "application/octet-stream", "Content-Length": String(size), Connection: "close" },
      timeout: 15 * 60 * 1000
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8"); let data;
        try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
        resolve({ status: response.statusCode || 500, ok: (response.statusCode || 500) >= 200 && (response.statusCode || 500) < 300, data, permissions: response.headers["x-accepted-github-permissions"] || null });
      });
    });
    request.on("timeout", () => request.destroy(new Error("GitHub upload timed out.")));
    request.on("error", reject);
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("error", () => request.destroy());
    stream.pipe(request);
  });
}

const CSS = `*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#0f1117;color:#f2f4f8}a{color:inherit;text-decoration:none}.container{width:min(1100px,calc(100% - 32px));margin:auto}header{border-bottom:1px solid #292d38;background:#151821;position:sticky;top:0;z-index:10}.nav{min-height:64px;display:flex;align-items:center;justify-content:space-between;gap:16px}.logo{font-size:20px;font-weight:700}.nav-links{display:flex;gap:10px;flex-wrap:wrap}.btn{display:inline-block;padding:10px 15px;border-radius:9px;border:1px solid #343947;background:#202532;color:#fff;cursor:pointer}.btn-primary{background:#3b82f6;border-color:#3b82f6}main{padding:38px 0 60px}.hero{margin-bottom:28px}.hero h1{margin:0 0 10px;font-size:36px}.hero p,.muted{color:#aeb5c2}.search{margin:25px 0}.search input,.form-group input,.form-group select{width:100%;padding:13px;border-radius:9px;border:1px solid #343947;background:#12151c;color:#fff}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:18px}.card{background:#171a22;border:1px solid #292d38;border-radius:14px;padding:20px}.asset{border:1px solid #303542;border-radius:10px;padding:14px;margin-top:12px;background:#13161d}.asset-name{font-weight:600;word-break:break-word}.preview{margin-top:12px}.preview img{max-width:100%;max-height:450px;border-radius:10px}.preview video{width:100%;max-height:500px;border-radius:10px;background:#000}.notice{padding:14px;border-radius:10px;margin:15px 0;background:#1d2330;border:1px solid #343b4a}.form-group{margin-bottom:18px}.form-group label{display:block;margin-bottom:8px;font-weight:600}.file-input{padding:20px!important}footer{padding:30px 0;border-top:1px solid #292d38;color:#8e96a5;text-align:center}@media(max-width:600px){.hero h1{font-size:28px}.nav{padding:10px 0}}`;
function page(title, body) { return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} - ${escapeHtml(SITE_NAME)}</title><style>${CSS}</style></head><body><header><div class="container nav"><a class="logo" href="/">${escapeHtml(SITE_NAME)}</a><div class="nav-links"><a class="btn" href="/">Releases</a><a class="btn" href="/admin">Admin</a></div></div></header><main><div class="container">${body}</div></main><footer><div class="container">${escapeHtml(SITE_NAME)}</div></footer></body></html>`; }
function assetPreview(a) { const n = a.name || "", u = a.browser_download_url || ""; if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(n)) return `<div class="preview"><img src="${escapeHtml(u)}" alt="${escapeHtml(n)}" loading="lazy"></div>`; if (/\.(mp4|webm|ogg|mov|m4v)$/i.test(n)) return `<div class="preview"><video controls preload="metadata"><source src="${escapeHtml(u)}">Your browser does not support this video.</video></div>`; return ""; }

app.get("/", async (_req, res) => { try { const releases = await getReleases(); const cards = releases.filter(r => !r.draft).map(r => `<div class="card"><h2><a href="/release/${encodeURIComponent(r.tag_name)}">${escapeHtml(r.name || r.tag_name)}</a></h2><p class="muted">Version: ${escapeHtml(r.tag_name)}</p><p>Assets: ${r.assets?.length || 0}</p><a class="btn btn-primary" href="/release/${encodeURIComponent(r.tag_name)}">View Release</a></div>`).join(""); res.send(page("Releases", `<section class="hero"><h1>${escapeHtml(SITE_NAME)}</h1><p>Browse releases and download files.</p></section><div class="search"><input id="search" type="search" placeholder="Search releases..." oninput="searchReleases()"></div>${cards ? `<div class="grid" id="releaseGrid">${cards}</div>` : `<div class="notice">No releases available.</div>`}<script>function searchReleases(){const v=document.getElementById('search').value.toLowerCase();document.querySelectorAll('#releaseGrid .card').forEach(c=>c.style.display=c.innerText.toLowerCase().includes(v)?'':'none')}</script>`)); } catch (e) { res.status(500).send(page("Error", `<div class="notice">${escapeHtml(e.message)}</div>`)); } });
app.get("/release/:tag", async (req, res) => { try { const r = await getReleaseByTag(req.params.tag); const html = (r.assets || []).map(a => `<div class="asset"><div class="asset-name">${escapeHtml(a.name)}</div><p class="muted">${(a.size / 1024 / 1024).toFixed(2)} MB</p>${assetPreview(a)}<br><a class="btn btn-primary" href="${escapeHtml(a.browser_download_url)}">Download</a></div>`).join("") || `<div class="notice">This release has no files.</div>`; res.send(page(r.name || r.tag_name, `<section class="hero"><h1>${escapeHtml(r.name || r.tag_name)}</h1><p class="muted">Version: ${escapeHtml(r.tag_name)}</p></section><h2>Files</h2>${html}`)); } catch (e) { res.status(e.status || 500).send(page("Error", `<div class="notice">${escapeHtml(e.message)}</div>`)); } });
app.get("/api/releases", async (_req, res) => { try { const releases = await getReleases(); res.json({ ok: true, count: releases.length, releases }); } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); } });

app.get("/admin", async (_req, res) => { try { const releases = await getReleases(); const options = releases.filter(r => !r.draft).map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name || r.tag_name)} (${escapeHtml(r.tag_name)})</option>`).join(""); res.send(page("Admin", `<section class="hero"><h1>Admin Upload</h1><p>Upload files directly to a GitHub Release.</p></section><div class="card"><div class="form-group"><label>Admin Key</label><input id="adminKey" type="password" placeholder="Enter ADMIN_KEY"></div><div class="form-group"><label>Release</label><select id="releaseId">${options}</select></div><div class="form-group"><label>File (maximum ${MAX_UPLOAD_MB} MB)</label><input id="file" class="file-input" type="file"></div><button class="btn btn-primary" id="uploadBtn" onclick="uploadFile()">Upload</button><div id="status"></div></div><script>
function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}
async function uploadFile(){const key=adminKey.value,input=file,button=uploadBtn,statusEl=status;if(!key){statusEl.innerHTML='<div class="notice">Admin key required.</div>';return}if(!input.files.length){statusEl.innerHTML='<div class="notice">Please select a file.</div>';return}const f=input.files[0],fd=new FormData();fd.append('release_id',releaseId.value);fd.append('file',f,f.name);button.disabled=true;button.textContent='Uploading...';statusEl.innerHTML='<div class="notice">Uploading '+esc(f.name)+'...</div>';try{const r=await fetch('/api/upload',{method:'POST',headers:{'x-admin-key':key},body:fd});const t=await r.text();let d;try{d=JSON.parse(t)}catch{d={ok:false,error:t||'Invalid server response'}}if(!r.ok||!d.ok){statusEl.innerHTML='<div class="notice"><strong>Upload failed:</strong><br>'+esc(d.error)+(d.github?'<pre>'+esc(JSON.stringify(d.github,null,2))+'</pre>':'')+'</div>';return}statusEl.innerHTML='<div class="notice"><strong>Upload successful!</strong><br><br><a class="btn btn-primary" href="'+esc(d.asset.browser_download_url)+'" target="_blank">Open uploaded file</a></div>';input.value=''}catch(e){statusEl.innerHTML='<div class="notice"><strong>Upload connection failed</strong><br>'+esc(e.message)+'</div>'}finally{button.disabled=false;button.textContent='Upload'}}
</script>`)); } catch (e) { res.status(500).send(page("Admin Error", `<div class="notice">${escapeHtml(e.message)}</div>`)); } });

app.post("/api/upload", requireAdmin, upload.single("file"), async (req, res) => { const temp = req.file?.path; try { if (!req.file) return res.status(400).json({ ok: false, error: "No file was uploaded." }); if (!req.body.release_id) return res.status(400).json({ ok: false, error: "release_id is required." }); const filename = path.basename(req.file.originalname); const result = await uploadAssetToGitHub({ releaseId: req.body.release_id, filename, contentType: req.file.mimetype, filePath: temp, size: req.file.size }); if (!result.ok) return res.status(result.status).json({ ok: false, error: result.data?.message || `GitHub upload failed with HTTP ${result.status}`, github: result.data, accepted_permissions: result.permissions }); res.json({ ok: true, message: "File uploaded successfully.", asset: result.data }); } catch (e) { console.error("UPLOAD ERROR", e); res.status(502).json({ ok: false, error: e.message || "Binary upload failed." }); } finally { if (temp) fs.promises.unlink(temp).catch(() => {}); } });
app.use((err, _req, res, _next) => { if (err instanceof multer.MulterError) return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ ok: false, error: err.code === "LIMIT_FILE_SIZE" ? `File is too large. Maximum allowed size is ${MAX_UPLOAD_MB} MB.` : err.message }); console.error(err); res.status(500).json({ ok: false, error: err.message || "Internal server error." }); });
app.get("/health", (_req, res) => res.type("text").send("ok"));
app.listen(PORT, "0.0.0.0", () => console.log(`${SITE_NAME} running on port ${PORT}`));
