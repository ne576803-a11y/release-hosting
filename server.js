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
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 500);
const MAX_BYTES = MAX_MB * 1024 * 1024;

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_BYTES }
});

app.use(express.json());

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;'
}[c]));

const safe = (v) => path.basename(String(v || '').replace(/[\\/]/g, ''));
const ext = (v) => (safe(v).match(/(\.[^.]+)$/i) || ['', ''])[1].toLowerCase();
const formatBytes = (n) => {
  if (!n || Number(n) <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(n);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value = value / 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
};
const formatSpeed = (bytesPerSecond) => {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '0 KB/s';
  if (bytesPerSecond >= 1024 * 1024) return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bytesPerSecond >= 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${Math.round(bytesPerSecond)} B/s`;
};

async function gh(endpoint, options = {}) {
  if (!TOKEN) throw new Error('GITHUB_TOKEN is not configured.');
  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${TOKEN}`,
      'User-Agent': 'release-hosting',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    const err = new Error(data.message || `GitHub request failed (${response.status})`);
    err.status = response.status;
    throw err;
  }

  return data;
}

function releases() {
  return gh(`/repos/${REPO}/releases?per_page=100`);
}

function release(tag) {
  return gh(`/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`);
}

function auth(req, res, next) {
  const key = req.get('x-admin-key') || req.body?.adminKey || req.query?.adminKey;
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: 'Unauthorized.' });
  }
  next();
}

function uploadAsset(id, name, type, filePath) {
  return new Promise((resolve, reject) => {
    const stat = fs.statSync(filePath);
    const req = https.request({
      hostname: 'uploads.github.com',
      method: 'POST',
      path: `/repos/${REPO}/releases/${encodeURIComponent(id)}/assets?name=${encodeURIComponent(name)}`,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${TOKEN}`,
        'User-Agent': 'release-hosting',
        'Content-Type': type || 'application/octet-stream',
        'Content-Length': stat.size
      }
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        let data;
        try {
          data = JSON.parse(body);
        } catch {
          data = { message: body };
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          const err = new Error(data.message || `Upload failed (${res.statusCode})`);
          err.status = res.statusCode;
          reject(err);
        }
      });
    });

    req.on('error', reject);
    fs.createReadStream(filePath).on('error', reject).pipe(req);
  });
}

function page(title, body, script = '') {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} - ${esc(SITE_NAME)}</title>
  <style>
    :root {
      --bg: #0b0f13;
      --bg-soft: #121a1d;
      --panel: #121b21;
      --panel-2: #171f24;
      --line: #2a3941;
      --text: #edf2f7;
      --muted: #a8b6c1;
      --accent: #5bd5b3;
      --accent-2: #84d9ff;
      --accent-3: #96f0c8;
      --danger: #ff8a80;
      --warning: #f7c96b;
      --ok: #60d996;
      --shadow: rgba(0,0,0,0.22);
      --white: #ffffff;
    }
    body.light {
      --bg: #eef7f1;
      --bg-soft: #f5faf7;
      --panel: #ffffff;
      --panel-2: #f1f7f2;
      --line: #d9e8dd;
      --text: #183129;
      --muted: #586f68;
      --shadow: rgba(24, 49, 41, 0.12);
      --white: #ffffff;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: linear-gradient(180deg, var(--bg) 0%, var(--bg-soft) 100%);
      color: var(--text);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    a { color: var(--accent-2); text-decoration: none; }
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      pointer-events: none;
      background: radial-gradient(circle at top left, rgba(91, 213, 179, 0.16), transparent 30%), radial-gradient(circle at bottom right, rgba(132, 217, 255, 0.14), transparent 35%);
    }
    .wrap { position: relative; max-width: 1120px; margin: 0 auto; padding: 18px 18px 42px; }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 0 18px;
      border-bottom: 1px solid var(--line);
      margin-bottom: 16px;
    }
    .brand {
      font-weight: 800;
      letter-spacing: 0.04em;
      font-size: 1.05rem;
    }
    .nav {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .pill, button, input, select {
      border-radius: 10px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.02);
      color: var(--text);
      font: inherit;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 8px 12px;
      background: rgba(255,255,255,0.04);
    }
    .btn, button {
      cursor: pointer;
      transition: transform 0.15s ease, opacity 0.15s ease;
    }
    .btn:hover, button:hover { transform: translateY(-1px); }
    .primary {
      background: linear-gradient(180deg, var(--accent), #2bb78c);
      border-color: transparent;
      color: #07110f;
      font-weight: 700;
    }
    .danger {
      color: var(--danger);
      background: rgba(255,138,128,0.08);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 14px;
      margin-top: 14px;
    }
    .card, .panel, .asset, .upload-row {
      background: linear-gradient(180deg, var(--panel), var(--panel-2));
      border: 1px solid var(--line);
      border-radius: 14px;
      box-shadow: 0 12px 26px var(--shadow);
    }
    .card, .panel {
      padding: 16px;
    }
    .muted { color: var(--muted); }
    .error { color: var(--danger); }
    .ok { color: var(--ok); }
    .heading {
      font-size: clamp(1.8rem, 3vw, 2.8rem);
      margin: 8px 0 10px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(91,213,179,0.08);
      border: 1px solid rgba(91,213,179,0.26);
      color: var(--accent-3);
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      margin-bottom: 14px;
    }
    .badge::before {
      content: '●';
      font-size: 0.7rem;
    }
    .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    label {
      display: block;
      margin: 10px 0;
      color: var(--muted);
    }
    input, select {
      width: 100%;
      margin-top: 6px;
      padding: 10px 12px;
      outline: none;
      background: rgba(255,255,255,0.02);
      color: var(--text);
    }
    .upload-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      margin-top: 10px;
    }
    .upload-main {
      flex: 1;
      min-width: 0;
    }
    .upload-name {
      font-weight: 700;
      word-break: break-word;
    }
    .status {
      display: block;
      margin-top: 4px;
      font-size: 0.9rem;
      color: var(--muted);
    }
    .progress {
      position: relative;
      width: 100%;
      height: 10px;
      margin-top: 8px;
      border-radius: 999px;
      background: rgba(255,255,255,0.06);
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.04);
    }
    .progress i {
      display: block;
      height: 100%;
      width: 0;
      background: linear-gradient(90deg, var(--accent), var(--accent-2));
      border-radius: inherit;
    }
    .asset {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 10px;
      padding: 12px 14px;
    }
    .asset-main {
      min-width: 0;
      flex: 1;
    }
    .asset-name {
      font-weight: 700;
      word-break: break-word;
    }
    .asset-file {
      color: var(--muted);
      font-size: 0.87rem;
    }
    .menu {
      position: relative;
    }
    .menu button {
      padding: 8px 10px;
      background: rgba(255,255,255,0.04);
      border-color: var(--line);
    }
    .menu-list {
      position: absolute;
      right: 0;
      top: calc(100% + 8px);
      z-index: 10;
      min-width: 150px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 10px;
      display: none;
      box-shadow: 0 12px 24px var(--shadow);
    }
    .menu.open .menu-list { display: block; }
    .menu-list button {
      width: 100%;
      text-align: left;
      background: transparent;
      border: none;
      border-bottom: 1px solid var(--line);
      padding: 10px 12px;
      border-radius: 0;
    }
    .menu-list button:last-child { border-bottom: none; }
    .theme-toggle {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--line);
      cursor: pointer;
    }
    .theme-toggle .dot {
      width: 12px;
      height: 12px;
      background: linear-gradient(180deg, var(--accent), var(--accent-2));
      border-radius: 50%;
      display: inline-block;
    }
    @media (max-width: 700px) {
      .topbar { align-items: flex-start; flex-direction: column; }
      .nav { width: 100%; justify-content: space-between; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="topbar">
      <div class="brand"><a href="/">${esc(SITE_NAME)}</a></div>
      <div class="nav">
        <a class="pill" href="/">Releases</a>
        <a class="pill" href="/admin">Admin</a>
        <button class="theme-toggle" type="button" onclick="document.body.classList.toggle('light'); localStorage.setItem('release-theme', document.body.classList.contains('light') ? 'light' : 'dark');">
          <span class="dot"></span>
          <span id="theme-label">Theme</span>
        </button>
      </div>
    </header>
    <div class="badge">Secure Release Hosting</div>
    ${body}
  </div>
  <script>
    (function(){
      var saved = localStorage.getItem('release-theme');
      if (saved === 'light') document.body.classList.add('light');
      var label = document.getElementById('theme-label');
      if (label) label.textContent = document.body.classList.contains('light') ? 'Light' : 'Dark';
    })();
    document.addEventListener('click', function(event){
      var menu = event.target.closest('.menu');
      if (!menu) {
        document.querySelectorAll('.menu.open').forEach(function(el){ el.classList.remove('open'); });
        return;
      }
      event.stopPropagation();
      var open = document.querySelector('.menu.open');
      if (open && open !== menu) open.classList.remove('open');
      menu.classList.toggle('open');
    });
    document.addEventListener('click', function(event){
      if (event.target.closest('.menu-item')) return;
      document.querySelectorAll('.menu.open').forEach(function(el){ el.classList.remove('open'); });
    });
    document.addEventListener('click', function(event){
      var toggle = event.target.closest('[data-theme-toggle]');
      if (!toggle) return;
      document.body.classList.toggle('light');
      var dark = !document.body.classList.contains('light');
      localStorage.setItem('release-theme', dark ? 'dark' : 'light');
      var label = document.getElementById('theme-label');
      if (label) label.textContent = dark ? 'Dark' : 'Light';
    });
  </script>
  ${script}
</body>
</html>`;
}

function assetCard(asset, includeMenu = true) {
  const name = asset.name || 'Asset';
  const created = asset.created_at || '';
  const size = Number(asset.size || 0);
  const assetId = asset.id;
  const item = `
    <div class="asset" data-asset-id="${esc(String(assetId))}" data-created="${esc(created)}" data-size="${size}">
      <div class="asset-main">
        <div class="asset-name"><a href="${esc(asset.browser_download_url || '#')}" target="_blank" rel="noreferrer">${esc(name)}</a></div>
        <div class="asset-file">${formatBytes(size)} · ${created ? new Date(created).toLocaleString() : 'Unknown date'}</div>
      </div>
      ${includeMenu ? `
        <div class="menu">
          <button type="button" aria-label="Asset actions">⋯</button>
          <div class="menu-list">
            <button type="button" class="menu-item" data-action="rename" data-asset-id="${esc(String(assetId))}" data-asset-name="${esc(name)}">Rename</button>
            <button type="button" class="menu-item" data-action="delete" data-asset-id="${esc(String(assetId))}" data-asset-name="${esc(name)}">Delete</button>
          </div>
        </div>
      ` : ''}
    </div>
  `;
  return item;
}

app.get('/', async (_req, res) => {
  try {
    const rs = await releases();
    const cards = rs.filter((r) => !r.draft).map((r) => {
      return `
        <div class="card">
          <h2><a href="/release/${encodeURIComponent(r.tag_name || r.name)}">${esc(r.name || r.tag_name)}</a></h2>
          <p class="muted">${esc(r.tag_name || '')}</p>
          <p>📦 ${(r.assets || []).length} file(s)</p>
        </div>
      `;
    }).join('');

    const body = `
      <h1 class="heading">Latest releases</h1>
      <div class="grid">${cards}</div>
    `;

    res.send(page('Releases', body));
  } catch (err) {
    res.status(500).send(page('Error', `<div class="panel error">${esc(err.message)}</div>`));
  }
});

app.get('/release/:tag', async (req, res) => {
  try {
    const rel = await release(req.params.tag);
    const assets = rel.assets || [];
    const searchScript = `
      (function(){
        var search = document.getElementById('release-search');
        var list = document.getElementById('asset-list');
        if (!search || !list) return;
        search.addEventListener('input', function(){
          var q = (search.value || '').toLowerCase();
          Array.from(list.children).forEach(function(node){
            var name = (node.getAttribute('data-name') || '').toLowerCase();
            node.style.display = (q && name.indexOf(q) === -1) ? 'none' : '';
          });
        });

        document.addEventListener('click', function(event){
          var target = event.target.closest('[data-action]');
          if (!target) return;
          var action = target.getAttribute('data-action');
          var assetId = target.getAttribute('data-asset-id');
          var assetName = target.getAttribute('data-asset-name');
          if (!assetId) return;

          if (action === 'rename') {
            var next = prompt('Rename file to:', assetName);
            if (next === null) return;
            var cleaned = String(next).trim();
            if (!cleaned) return alert('A valid filename is required.');
            var oldExt = (assetName.match(/(\\.[^.]+)$/i) || [''])[0];
            var newExt = (cleaned.match(/(\\.[^.]+)$/i) || [''])[0];
            if (oldExt && newExt && oldExt.toLowerCase() !== newExt.toLowerCase()) {
              alert('Extension cannot be changed. Keep the original format.');
              return;
            }
            if (oldExt && !newExt) cleaned = cleaned + oldExt;
            fetch('/api/assets/' + assetId, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'x-admin-key': localStorage.getItem('release-admin-key') || '' },
              body: JSON.stringify({ name: cleaned })
            }).then(function(res){ return res.json(); }).then(function(json){
              if (!json.ok) throw new Error(json.error || 'Rename failed.');
              var row = document.querySelector('[data-asset-id="' + assetId + '"]');
              if (row) {
                var anchor = row.querySelector('a');
                if (anchor) anchor.textContent = cleaned;
                target.setAttribute('data-asset-name', cleaned);
              }
              alert('File renamed successfully.');
            }).catch(function(err){ alert(err.message || 'Rename failed.'); });
          }

          if (action === 'delete') {
            var ok = confirm('Delete file: ' + assetName + '?');
            if (!ok) return;
            fetch('/api/assets/' + assetId, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json', 'x-admin-key': localStorage.getItem('release-admin-key') || '' }
            }).then(function(res){ return res.json(); }).then(function(json){
              if (!json.ok) throw new Error(json.error || 'Delete failed.');
              var row = document.querySelector('[data-asset-id="' + assetId + '"]');
              if (row) row.remove();
              alert('File deleted.');
            }).catch(function(err){ alert(err.message || 'Delete failed.'); });
          }
        });
      })();
    `;

    const body = `
      <div class="panel">
        <a href="/">← Back to releases</a>
        <h1 class="heading">${esc(rel.name || rel.tag_name)}</h1>
        <p class="muted">${esc(rel.tag_name || '')}</p>
        <div class="row" style="margin-top:12px;">
          <input id="release-search" type="search" placeholder="Search files..." style="max-width:260px;" />
          <select id="sort" style="max-width:200px;">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="smallest">Smallest first</option>
            <option value="largest">Largest first</option>
          </select>
        </div>
      </div>
      <div id="asset-list">
        ${assets.map((a) => assetCard(a)).join('')}
      </div>
    `;

    res.send(page(rel.name || rel.tag_name, body, searchScript + `
      (function(){
        var sort = document.getElementById('sort');
        var list = document.getElementById('asset-list');
        if (!sort || !list) return;
        sort.addEventListener('change', function(){
          var items = Array.from(list.children);
          items.sort(function(a, b){
            var aSize = Number(a.getAttribute('data-size') || 0);
            var bSize = Number(b.getAttribute('data-size') || 0);
            var aDate = new Date(a.getAttribute('data-created') || 0).getTime();
            var bDate = new Date(b.getAttribute('data-created') || 0).getTime();
            if (sort.value === 'newest') return bDate - aDate;
            if (sort.value === 'oldest') return aDate - bDate;
            if (sort.value === 'smallest') return aSize - bSize;
            return bSize - aSize;
          });
          items.forEach(function(item){ list.appendChild(item); });
        });
      })();
    `));
  } catch (err) {
    res.status(404).send(page('Not found', `<div class="panel error">${esc(err.message)}</div>`));
  }
});

app.get('/api/releases', async (_req, res) => {
  try {
    const rs = await releases();
    res.json({ ok: true, count: rs.length, releases: rs });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

app.get('/admin', async (_req, res) => {
  try {
    const rs = await releases();
    const opts = rs.filter((r) => !r.draft).map((r) => {
      return `<option value="${esc(String(r.id))}">${esc(r.name || r.tag_name)} (${esc(r.tag_name)})</option>`;
    }).join('');

    const body = `
      <div class="panel">
        <h1 class="heading">Upload release asset</h1>
        <p class="muted">Maximum file size: ${MAX_MB} MB</p>
        <div class="badge" style="margin-bottom:12px;">Protected admin upload</div>
        <form id="upload-form">
          <label>
            Admin key
            <input id="admin-key" type="password" placeholder="Enter admin key" required />
          </label>
          <label>
            Release
            <select id="release-id" required>${opts}</select>
          </label>
          <label>
            Files
            <input id="file-input" type="file" multiple required />
          </label>
          <button class="primary" type="submit">Upload files</button>
        </form>
      </div>
      <div id="upload-queue" style="margin-top: 18px;"></div>
    `;

    const script = `
      (function(){
        var savedKey = localStorage.getItem('release-admin-key');
        var adminInput = document.getElementById('admin-key');
        if (savedKey && adminInput) {
          adminInput.value = savedKey;
          adminInput.closest('label').style.display = 'none';
        }
      })();

      (function(){
        var form = document.getElementById('upload-form');
        var fileInput = document.getElementById('file-input');
        var queue = document.getElementById('upload-queue');
        var keyInput = document.getElementById('admin-key');
        var releaseInput = document.getElementById('release-id');

        async function uploadOne(file) {
          if (file.size > ${MAX_BYTES}) {
            return { ok: false, error: 'File exceeds the ${MAX_MB} MB upload limit.' };
          }

          var row = document.createElement('div');
          row.className = 'upload-row';

          var main = document.createElement('div');
          main.className = 'upload-main';

          var title = document.createElement('div');
          title.className = 'upload-name';
          title.textContent = file.name;

          var status = document.createElement('span');
          status.className = 'status';
          status.textContent = 'Preparing…';

          var progress = document.createElement('div');
          progress.className = 'progress';
          var bar = document.createElement('i');
          progress.appendChild(bar);

          main.appendChild(title);
          main.appendChild(status);
          main.appendChild(progress);

          var cancelBtn = document.createElement('button');
          cancelBtn.type = 'button';
          cancelBtn.className = 'danger';
          cancelBtn.textContent = '✕';

          row.appendChild(main);
          row.appendChild(cancelBtn);
          queue.prepend(row);

          var fd = new FormData();
          fd.append('files', file);
          fd.append('releaseId', releaseInput.value);

          var startAt = performance.now();
          var prevLoaded = 0;
          var prevTime = startAt;

          var xhr = new XMLHttpRequest();
          var key = keyInput.value || localStorage.getItem('release-admin-key') || '';
          xhr.open('POST', '/api/upload', true);
          xhr.setRequestHeader('x-admin-key', key);

          xhr.upload.onprogress = function(e){
            if (!e.lengthComputable) return;
            var pct = Math.round((e.loaded / e.total) * 100);
            var now = performance.now();
            var elapsed = Math.max((now - prevTime) / 1000, 0.1);
            var delta = Math.max(e.loaded - prevLoaded, 0);
            prevLoaded = e.loaded;
            prevTime = now;
            var speed = delta / elapsed;
            status.textContent = pct + '% • ' + (file.size ? (e.loaded / 1024 / 1024).toFixed(1) + ' MB / ' + (file.size / 1024 / 1024).toFixed(1) + ' MB • ' : '') + (speed >= 1048576 ? (speed / 1048576).toFixed(1) + ' MB/s' : (speed / 1024).toFixed(1) + ' KB/s');
            bar.style.width = pct + '%';
          };

          xhr.onreadystatechange = function(){
            if (xhr.readyState !== 4) return;
            if (xhr.status >= 200 && xhr.status < 300) {
              status.textContent = 'Uploaded ✓';
              status.classList.add('ok');
              bar.style.width = '100%';
            } else {
              try {
                var payload = JSON.parse(xhr.responseText || '{}');
                status.textContent = payload.error || 'Upload failed';
              } catch {
                status.textContent = 'Upload failed';
              }
              status.classList.add('error');
            }
          };

          xhr.onerror = function(){
            status.textContent = 'Connection failed. Please retry.';
            status.classList.add('error');
          };

          xhr.onabort = function(){
            status.textContent = 'Cancelled';
            status.classList.add('error');
            bar.style.width = '0%';
          };

          cancelBtn.onclick = function(){ xhr.abort(); };

          var promise = new Promise(function(resolve){
            xhr.onload = function(){
              var payload = {};
              try { payload = JSON.parse(xhr.responseText || '{}'); } catch {}
              if (xhr.status >= 200 && xhr.status < 300 && payload.ok) {
                resolve({ ok: true, file: file.name });
              } else {
                resolve({ ok: false, error: payload.error || 'Upload failed' });
              }
            };
            xhr.send(fd);
          });

          return promise;
        }

        form.addEventListener('submit', async function(event){
          event.preventDefault();
          var files = Array.from(fileInput.files || []);
          if (!files.length) return alert('Choose at least one file.');

          var key = keyInput.value.trim();
          if (key) {
            localStorage.setItem('release-admin-key', key);
          }

          for (var i = 0; i < files.length; i += 1) {
            var result = await uploadOne(files[i]);
            if (!result.ok) {
              alert(result.error || 'Upload failed.');
            }
          }
        });
      })();
    `;

    res.send(page('Admin', body, script));
  } catch (err) {
    res.status(500).send(page('Error', `<div class="panel error">${esc(err.message)}</div>`));
  }
});

app.post('/api/upload', auth, (req, res, next) => {
  upload.array('files', 20)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ ok: false, error: `File exceeds the ${MAX_MB} MB upload limit.` });
      }
      return res.status(400).json({ ok: false, error: err.message });
    }
    next();
  });
}, async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  const releaseId = req.body.releaseId;

  try {
    if (!releaseId) return res.status(400).json({ ok: false, error: 'Release is required.' });
    if (!files.length) return res.status(400).json({ ok: false, error: 'No files selected.' });

    const results = [];
    for (const file of files) {
      if (file.size > MAX_BYTES) {
        results.push({ ok: false, file: file.originalname, error: `File exceeds the ${MAX_MB} MB upload limit.` });
        continue;
      }
      const name = safe(file.originalname || file.filename);
      if (!name) {
        results.push({ ok: false, file: file.originalname || file.filename, error: 'Invalid filename.' });
        continue;
      }
      const uploaded = await uploadAsset(releaseId, name, file.mimetype, file.path);
      results.push({ ok: true, file: name, asset: uploaded });
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length && results.length === failed.length) {
      return res.status(400).json({ ok: false, error: failed[0].error || 'Upload failed.' });
    }

    res.json({ ok: true, count: results.filter((r) => r.ok).length, results });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message || 'Upload failed.' });
  } finally {
    for (const file of files) {
      if (file && file.path) {
        fs.promises.unlink(file.path).catch(() => {});
      }
    }
  }
});

app.patch('/api/assets/:id', auth, async (req, res) => {
  try {
    const asset = await gh(`/repos/${REPO}/releases/assets/${req.params.id}`);
    const oldExt = ext(asset.name || '');
    const requested = safe(req.body?.name || '');

    if (!requested) return res.status(400).json({ ok: false, error: 'A valid filename is required.' });

    const newExt = ext(requested);
    if (oldExt && newExt && oldExt !== newExt) {
      return res.status(400).json({ ok: false, error: `The file extension must remain ${oldExt}.` });
    }

    const finalName = oldExt && !newExt ? `${requested}${oldExt}` : requested;
    const updated = await gh(`/repos/${REPO}/releases/assets/${req.params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: finalName })
    });

    res.json({ ok: true, asset: updated });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/assets/:id', auth, async (req, res) => {
  try {
    await gh(`/repos/${REPO}/releases/assets/${req.params.id}`, { method: 'DELETE' });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, repo: REPO, maxUploadMb: MAX_MB });
});

app.listen(PORT, () => {
  console.log(`${SITE_NAME} listening on ${PORT}`);
});
