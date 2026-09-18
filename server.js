const express = require("express");
const multer = require("multer");
const fs = require("fs");
const os = require("os");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;
const REPO = process.env.REPO_FULL_NAME || "nusratbytxrs/release-hosting";
const SITE_NAME = process.env.SITE_NAME || "Release Hosting";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const MAX_UPLOAD_MB = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 100));
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-upload-"));

// Store uploads on disk instead of keeping large videos/images in RAM.
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
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function getAdminKey(req) {
  return req.headers["x-admin-key"] || req.query.key || req.body?.key || "";
}

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(500).json({ ok: false, error: "ADMIN_KEY is not configured on Render." });
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
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `GitHub API returned ${response.status}`);
    error.status = response.status;
    error.github = data;
    error.acceptedPermissions = response.headers.get("x-accepted-github-permissions") || null;
    throw error;
  }
  return data;
}

function getReleases() { return githubApi(`/repos/${REPO}/releases?per_page=100`); }
function getReleaseByTag(tag) { return githubApi(`/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`); }

const CSS = `*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#0f1117;color:#f2f4f8}a{color:inherit;text-decoration:none}.container{width:min(1100px,calc(100% - 32px));margin:auto}header{border-bottom:1px solid #292d38;background:#151821;position:sticky;top:0;z-index:10}.nav{min-height:64px;display:flex;align-items:center;justify-content:space-between;gap:16px}.logo{font-size:20px;font-weight:700}.nav-links{display:flex;gap:10px;flex-wrap:wrap}.btn{display:inline-block;padding:10px 15px;border-radius:9px;border:1px solid #343947;background:#202532;color:#fff;cursor:pointer}.btn:hover{background:#2a3040}.btn-primary{background:#3b82f6;border-color:#3b82f6}.btn-primary:hover{background:#2563eb}main{padding:38px 0 60px}.hero{margin-bottom:28px}.hero h1{margin:0 0 10px;font-size:36px}.hero p{color:#aeb5c2;margin:0}.search{margin:25px 0}.search input{width:100%;padding:14px 16px;border-radius:10px;border:1px solid #343947;background:#171a22;color:#fff;outline:none}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:18px}.card{background:#171a22;border:1px solid #292d38;border-radius:14px;padding:20px}.card h2{margin-top:0}.muted{color:#9da5b3}.asset{border:1px solid #303542;border-radius:10px;padding:14px;margin-top:12px;background:#13161d}.asset-name{font-weight:600;word-break:break-word}.preview{margin-top:12px}.preview img{max-width:100%;max-height:450px;border-radius:10px;display:block}.preview video{width:100%;max-height:500px;border-radius:10px;background:#000}.notice{padding:14px;border-radius:10px;margin:15px 0;background:#1d2330;border:1px solid #343b4a}.form-group{margin-bottom:18px}.form-group label{display:block;margin-bottom:8px;font-weight:600}.form-group input,.form-group select{width:100%;padding:13px;border-radius:9px;border:1px solid #343947;background:#12151c;color:#fff}.file-input{padding:20px!important}footer{padding:30px 0;border-top:1px solid #292d38;color:#8e96a5;text-align:center}@media(max-width:600px){.hero h1{font-size:28px}.nav{padding:10px 0}}`;

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} - ${escapeHtml(SITE_NAME)}</title><style>${CSS}</style></head><body><header><div class="container nav"><a class="logo" href="/">${escapeHtml(SITE_NAME)}</a><div class="nav-links"><a class="btn" href="/">Releases</a><a class="btn" href="/admin">Admin</a></div></div></header><main><div class="container">${body}</div></main><footer><div class="container">${escapeHtml(SITE_NAME)}</div></footer></body></html>`;
}

function assetPreview(asset) {
  const name = asset.name || "";
  const url = asset.browser_download_url || "";
  if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(name)) return `<div class="preview"><img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy"></div>`;
  if (/\.(mp4|webm|ogg|mov|m4v)$/i.test(name)) return `<div class="preview"><video controls preload="metadata"><source src="${escapeHtml(url)}">Your browser does not support this video.</video></div>`;
  return "";
}

app.get("/", async (_req, res) => {
  try {
    const releases = await getReleases();
    const cards = releases.filter(r => !r.draft).map(r => `<div class="card"><h2><a href="/release/${encodeURIComponent(r.tag_name)}">${escapeHtml(r.name || r.tag_name)}</a></h2><p class="muted">Version: ${escapeHtml(r.tag_name)}</p><p class="muted">Published: ${escapeHtml(r.published_at ? new Date(r.published_at).toLocaleString() : "")}</p><p>Assets: ${r.assets?.length || 0}</p><a class="btn btn-primary" href="/release/${encodeURIComponent(r.tag_name)}">View Release</a></div>`).join("");
    res.send(page("Releases", `<section class="hero"><h1>${escapeHtml(SITE_NAME)}</h1><p>Browse releases and download files.</p></section><div class="search"><input id="search" type="search" placeholder="Search releases..." oninput="searchReleases()"></div>${cards ? `<div class="grid" id="releaseGrid">${cards}</div>` : `<div class="notice">No releases available.</div>`}<script>function searchReleases(){const v=document.getElementById('search').value.toLowerCase();document.querySelectorAll('#releaseGrid .card').forEach(c=>c.style.display=c.innerText.toLowerCase().includes(v)?'':'none')}</script>`));
  } catch (error) { console.error("HOME ERROR:", error); res.status(500).send(page("Error", `<div class="notice">Failed to load releases.<br><br>${escapeHtml(error.message)}</div>`)); }
});

app.get("/release/:tag", async (req, res) => {
  try {
    const release = await getReleaseByTag(req.params.tag);
    const assets = release.assets || [];
    const assetHtml = assets.length ? assets.map(a => `<div class="asset"><div class="asset-name">${escapeHtml(a.name)}</div><p class="muted">${(a.size / 1024 / 1024).toFixed(2)} MB</p>${assetPreview(a)}<br><a class="btn btn-primary" href="${escapeHtml(a.browser_download_url)}">Download</a></div>`).join("") : `<div class="notice">This release has no files.</div>`;
    const body = `<section class="hero"><h1>${escapeHtml(release.name || release.tag_name)}</h1><p class="muted">Version: ${escapeHtml(release.tag_name)}</p>${release.body ? `<div class="notice">${escapeHtml(release.body).replace(/\n/g,"<br>")}</div>` : ""}</section><h2>Files</h2>${assetHtml}`;
    res.send(page(release.name || release.tag_name, body));
  } catch (error) { console.error("RELEASE ERROR:", error); res.status(error.status || 500).send(page("Error", `<div class="notice">Failed to load release.<br><br>${escapeHtml(error.message)}</div>`)); }
});

app.get("/api/releases", async (_req, res) => {
  try { const releases = await getReleases(); res.json({ ok: true, count: releases.length, releases }); }
  catch (error) { console.error("API RELEASE ERROR:", error); res.status(error.status || 500).json({ ok: false, error: error.message, github: error.github || null }); }
});

app.get("/admin", async (_req, res) => {
  try {
    const releases = await getReleases();
    const options = releases.filter(r => !r.draft).map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name || r.tag_name)} (${escapeHtml(r.tag_name)})</option>`).join("");
    const body = `<section class="hero"><h1>Admin Upload</h1><p>Upload files directly to a GitHub Release.</p></section><div class="card"><div class="form-group"><label>Admin Key</label><input id="adminKey" type="password" placeholder="Enter ADMIN_KEY"></div><div class="form-group"><label>Release</label><select id="releaseId">${options}</select></div><div class="form-group"><label>File (maximum ${MAX_UPLOAD_MB} MB)</label><input id="file" class="file-input" type="file"></div><button class="btn btn-primary" id="uploadBtn" onclick="uploadFile()">Upload</button><div id="status"></div></div><script>
async function uploadFile(){const key=document.getElementById('adminKey').value,releaseId=document.getElementById('releaseId').value,input=document.getElementById('file'),status=document.getElementById('status'),button=document.getElementById('uploadBtn');if(!key){status.innerHTML='<div class="notice">Admin key required.</div>';return}if(!input.files.length){status.innerHTML='<div class="notice">Please select a file.</div>';return}const file=input.files[0];const fd=new FormData();fd.append('release_id',releaseId);fd.append('file',file,file.name);button.disabled=true;button.textContent='Uploading...';status.innerHTML='<div class="notice">Uploading '+escapeHtml(file.name)+'...</div>';try{const response=await fetch('/api/upload',{method:'POST',headers:{'x-admin-key':key},body:fd});const text=await response.text();let data;try{data=JSON.parse(text)}catch{data={ok:false,error:text||'Invalid server response.'}}if(!response.ok||!data.ok){status.innerHTML='<div class="notice"><strong>Upload failed:</strong><br>'+escapeHtml(data.error||'Unknown error.')+(data.github?'<br><pre style="white-space:pre-wrap">'+escapeHtml(JSON.stringify(data.github,null,2))+'</pre>':'')+'</div>';return}status.innerHTML='<div class="notice"><strong>Upload successful!</strong><br><br><a class="btn btn-primary" href="'+escapeHtml(data.asset.browser_download_url)+'" target="_blank">Open uploaded file</a></div>';input.value=''}catch(error){status.innerHTML='<div class="notice"><strong>Failed to fetch</strong><br><br>The browser could not complete the request.<br>'+escapeHtml(error.message)+'</div>'}finally{button.disabled=false;button.textContent='Upload'}}
function escapeHtml(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}
</script>`;
    res.send(page("Admin", body));
  } catch (error) { console.error("ADMIN PAGE ERROR:", error); res.status(500).send(page("Admin Error", `<div class="notice">${escapeHtml(error.message)}</div>`)); }
});

app.post("/api/upload", requireAdmin, upload.single("file"), async (req, res) => {
  const tempPath = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "No file was uploaded." });
    const releaseId = req.body.release_id;
    if (!releaseId) return res.status(400).json({ ok: false, error: "release_id is required." });
    const filename = path.basename(req.file.originalname);
    const contentType = req.file.mimetype || "application/octet-stream";
    if (!GITHUB_TOKEN) return res.status(500).json({ ok: false, error: "GITHUB_TOKEN is not configured." });
    const uploadUrl = `https://uploads.github.com/repos/${REPO}/releases/${encodeURIComponent(releaseId)}/assets?name=${encodeURIComponent(filename)}`;
    console.log("UPLOAD REQUEST:", JSON.stringify({ repo: REPO, releaseId, filename, mimetype: contentType, size: req.file.size }));
    // Stream the file to GitHub. This avoids buffering large images/videos in memory.
    const githubResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${GITHUB_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28", "Content-Type": contentType, "Content-Length": String(req.file.size) },
      body: fs.createReadStream(tempPath),
      duplex: "half"
    });
    const responseText = await githubResponse.text();
    let githubData; try { githubData = responseText ? JSON.parse(responseText) : {}; } catch { githubData = { raw: responseText }; }
    if (!githubResponse.ok) return res.status(githubResponse.status || 500).json({ ok: false, error: githubData?.message || `GitHub upload failed with HTTP ${githubResponse.status}`, github: githubData, accepted_permissions: githubResponse.headers.get("x-accepted-github-permissions") || null });
    return res.json({ ok: true, message: "File uploaded successfully.", asset: githubData });
  } catch (error) {
    console.error("UPLOAD SERVER ERROR:", error);
    return res.status(error.status || 500).json({ ok: false, error: error.message, github: error.github || null, accepted_permissions: error.acceptedPermissions || null });
  } finally {
    if (tempPath) fs.promises.unlink(tempPath).catch(() => {});
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ ok: false, error: err.code === "LIMIT_FILE_SIZE" ? `File is too large. Maximum allowed size is ${MAX_UPLOAD_MB} MB.` : err.message });
  console.error("GLOBAL ERROR:", err); res.status(500).json({ ok: false, error: err.message || "Internal server error." });
});

app.get("/health", (_req, res) => res.type("text").send("ok"));
app.listen(PORT, "0.0.0.0", () => console.log(`${SITE_NAME} running on port ${PORT}; repository: ${REPO}; max upload: ${MAX_UPLOAD_MB} MB`));
