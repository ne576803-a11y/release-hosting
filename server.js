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
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => cb(null, true)
});

app.use(express.json());

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
const safeName = (v) => path.basename(String(v || '').replace(/[\\/]/g, ''));
const extensionOf = (name) => {
  const n = safeName(name || '');
  const match = n.match(/(\.[^.]+)$/i);
  return match ? match[1].toLowerCase() : '';
};
const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
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
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }

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
  if (!ADMIN_KEY || key !== ADMIN_KEY) return res.status(401).json({ ok: false, error: 'Unauthorized.' });
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
        try { data = JSON.parse(body); } catch { data = { message: body }; }
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
          --bg:#0b0d12; --bg-2:#121821; --panel:#171d28; --panel-2:#1f2733; --line:#2d3746; --text:#f4f7fb; --muted:#9aa9ba; --accent:#7c5cff; --accent-2:#9d7cff; --ok:#37d39a; --warn:#ffb84d; --danger:#ff7b7b; --shadow: rgba(0,0,0,.32);
        }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; background: var(--bg); color: var(--text); }
        body { min-height: 100vh; }
        a { color: var(--accent-2); text-decoration: none; }
        .container { max-width: 1100px; margin: 0 auto; padding: 24px 18px 48px; }
        .topbar { display: flex; align-items: center; justify-content: space-between; padding: 14px 0 18px; border-bottom: 1px solid var(--line); margin-bottom: 20px; }
        .brand { font-weight: 800; letter-spacing: .02em; }
        .nav { display: flex; align-items: center; gap: 12px; }
        .pill { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--line); background: var(--panel); padding: 8px 12px; border-radius: 999px; color: var(--text); }
        .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 16px; }
        .card, .panel, .asset-row { background: linear-gradient(180deg, var(--panel), var(--panel-2)); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 10px 24px var(--shadow); }
        .card { padding: 18px; }
        .panel { padding: 18px; }
        .muted { color: var(--muted); }
        .heading { margin: 0 0 10px; font-size: clamp(1.8rem, 3vw, 2.6rem); }
        .release-card h3 { margin: 0 0 6px; }
        .release-card p { margin: 0; }
        .release-card .meta { margin-top: 12px; color: var(--muted); }
        .button, button, input, select { font: inherit; }
        button, .button, input, select { border-radius: 10px; }
        button, .button {
          border: 1px solid var(--line); background: var(--panel-2); color: var(--text); cursor: pointer; padding: 10px 14px; transition: transform .15s ease, opacity .15s ease;
        }
        button:hover, .button:hover { transform: translateY(-1px); }
        .primary { background: linear-gradient(180deg, var(--accent), var(--accent-2)); border-color: transparent; }
        .danger { background: rgba(255,123,123,.1); border-color: rgba(255,123,123,.4); color: var(--danger); }
        input, select {
          display: block; width: 100%; padding: 11px 12px; background: rgba(255,255,255,.02); border: 1px solid var(--line); color: var(--text); outline: none;
        }
        label { display: block; margin-bottom: 12px; font-size: .95rem; color: var(--muted); }
        .asset-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; margin-top: 10px; }
        .asset-main { flex: 1; min-width: 0; }
        .asset-name { font-weight: 700; word-break: break-word; }
        .status { display: block; margin-top: 6px; font-size: .9rem; color: var(--muted); }
        .progress { width: 100%; height: 10px; background: rgba(255,255,255,.06); border-radius: 999px; overflow: hidden; border: 1px solid rgba(255,255,255,.04); margin-top: 8px; }
        .progress > i {
          display: block; width: 0; height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent-2)); border-radius: inherit;
        }
        .error { color: var(--danger); }
        .ok { color: var(--ok); }
        .asset-list { margin-top: 18px; }
        .asset-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: rgba(255,255,255,.02); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
        .asset-item a { font-weight: 600; }
        .asset-item small { color: var(--muted); }
        @media (max-width: 640px) {
          .topbar { align-items: flex-start; flex-direction: column; }
          .nav { width: 100%; justify-content: space-between; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="topbar">
          <div class="brand"><a href="/">${esc(SITE_NAME)}</a></div>
          <div class="nav">
            <a class="pill" href="/">Releases</a>
            <a class="pill" href="/admin">Admin</a>
          </div>
        </div>
        ${body}
      </div>
      <script>${script}</script>
    </body>
  </html>`;
}

function releaseAssetList(assets = []) {
  if (!assets.length) return '<div class="panel"><div class="muted">No files in this release yet.</div></div>';

  return `
    <div class="panel">
      <div class="row" style="justify-content: space-between; margin-bottom: 10px;">
        <strong>Release files</strong>
        <label style="margin:0; min-width:220px;">
          <span class="muted">Sort</span>
          <select id="asset-sort">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="smallest">Smallest first</option>
            <option value="largest">Largest first</option>
          </select>
        </label>
      </div>
      <div id="asset-list" class="asset-list">
        ${assets.map((a) => `
          <div class="asset-item" data-created="${esc(a.created_at || '')}" data-size="${Number(a.size || 0)}">
            <div>
              <a href="${esc(a.browser_download_url || '#')}" target="_blank" rel="noreferrer">${esc(a.name || 'Asset')}</a>
              <br />
              <small>${formatBytes(Number(a.size || 0))} · ${new Date(a.created_at || Date.now()).toLocaleString()}</small>
            </div>
            <div class="muted">${a.content_type || 'file'}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function previewMarkup(asset) {
  const name = asset.name || '';
  if (!/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(name)) return '';
  return `<img src="${esc(asset.browser_download_url || '')}" alt="${esc(name)}" style="max-width:220px; max-height:140px; border-radius:12px; border:1px solid var(--line); background:#0d1117; object-fit:cover;" />`;
}

app.get('/', async (_req, res) => {
  try {
    const releasesData = await releases();
    const cards = releasesData.filter((r) => !r.draft).map((r) => `
      <div class="card release-card">
        <h3><a href="/release/${encodeURIComponent(r.tag_name || r.name)}">${esc(r.name || r.tag_name)}</a></h3>
        <p class="muted">${esc(r.tag_name || '')}</p>
        <div class="meta">${(r.assets || []).length} file(s)</div>
      </div>
    `).join('');

    res.send(page('Releases', `<h1 class="heading">Latest releases</h1><div class="grid">${cards}</div>`));
  } catch (error) {
    res.status(500).send(page('Error', `<div class="panel error">${esc(error.message)}</div>`));
  }
});

app.get('/release/:tag', async (req, res) => {
  try {
    const rel = await release(req.params.tag);
    const assets = rel.assets || [];
    const body = `
      <div class="panel" style="margin-bottom:18px;">
        <a href="/">← Back to releases</a>
        <h1 class="heading" style="margin-top:10px;">${esc(rel.name || rel.tag_name)}</h1>
        <div class="muted">${esc(rel.tag_name || '')}</div>
      </div>
      ${releaseAssetList(assets)}
    `;

    const script = `
      const sortEl = document.getElementById('asset-sort');
      const listEl = document.getElementById('asset-list');
      if (sortEl && listEl) {
        const sortItems = () => {
          const value = sortEl.value;
          const items = Array.from(listEl.children);
          items.sort((a, b) => {
            const aSize = Number(a.dataset.size || 0);
            const bSize = Number(b.dataset.size || 0);
            const aDate = new Date(a.dataset.created || 0).getTime();
            const bDate = new Date(b.dataset.created || 0).getTime();
            if (value === 'newest') return bDate - aDate;
            if (value === 'oldest') return aDate - bDate;
            if (value === 'smallest') return aSize - bSize;
            return bSize - aSize;
          });
          items.forEach((node) => listEl.appendChild(node));
        };
        sortEl.addEventListener('change', sortItems);
      }
    `;

    res.send(page(rel.name || rel.tag_name, body, script));
  } catch (error) {
    res.status(404).send(page('Release not found', `<div class="panel error">${esc(error.message)}</div>`));
  }
});

app.get('/api/releases', async (_req, res) => {
  try {
    const rs = await releases();
    res.json({ ok: true, count: rs.length, releases: rs });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.message });
  }
});

app.get('/admin', async (_req, res) => {
  try {
    const rs = await releases();
    const opts = rs.filter((r) => !r.draft).map((r) => `<option value="${esc(String(r.id))}">${esc(r.name || r.tag_name)} (${esc(r.tag_name)})</option>`).join('');

    const body = `
      <div class="panel">
        <h1 class="heading" style="font-size:1.8rem;">Upload release asset</h1>
        <p class="muted">Maximum file size: ${MAX_MB} MB</p>
        <form id="upload-form">
          <label>
            <span>Admin key</span>
            <input id="admin-key" type="password" placeholder="Enter admin key" required />
          </label>
          <label>
            <span>Release</span>
            <select id="release-id" required>${opts}</select>
          </label>
          <label>
            <span>Files</span>
            <input id="file-input" type="file" multiple required />
          </label>
          <button type="submit" class="primary">Upload files</button>
        </form>
      </div>
      <div id="upload-queue" style="margin-top:18px;"></div>
    `;

    const script = `
      const MAX_BYTES = ${MAX_BYTES};
      const form = document.getElementById('upload-form');
      const fileInput = document.getElementById('file-input');
      const queue = document.getElementById('upload-queue');
      const adminKeyInput = document.getElementById('admin-key');
      const releaseInput = document.getElementById('release-id');

      function formatSpeed(value) {
        return value >= 1048576 ? (value / 1048576).toFixed(1) + ' MB/s' : (value / 1024).toFixed(0) + ' KB/s';
      }

      function startUpload(file) {
        if (file.size > MAX_BYTES) {
          const row = document.createElement('div');
          row.className = 'asset-row';
          row.innerHTML = '<div class="asset-main"><div class="asset-name">' + (file.name || 'File') + '</div><span class="status error">File exceeds the ' + ${MAX_MB} + ' MB upload limit.</span></div>';
          queue.prepend(row);
          return;
        }

        const row = document.createElement('div');
        row.className = 'asset-row';
        row.innerHTML = `
          <div class="asset-main">
            <div class="asset-name">${'${file.name}'}</div>
            <span class="status">Preparing…</span>
            <div class="progress"><i></i></div>
          </div>
          <button type="button" class="danger">✕</button>
        `;
        queue.prepend(row);

        const status = row.querySelector('.status');
        const bar = row.querySelector('.progress i');
        const cancelButton = row.querySelector('button');
        const formData = new FormData();
        formData.append('file', file);
        formData.append('releaseId', releaseInput.value);

        const xhr = new XMLHttpRequest();
        const startedAt = performance.now();
        let lastLoaded = 0;
        let lastTime = startedAt;

        xhr.upload.addEventListener('progress', (e) => {
          if (!e.lengthComputable) return;
          const pct = Math.round((e.loaded / e.total) * 100);
          const now = performance.now();
          const elapsed = Math.max((now - lastTime) / 1000, 0.1);
          const delta = Math.max(e.loaded - lastLoaded, 0);
          lastLoaded = e.loaded;
          lastTime = now;
          const speed = delta / elapsed;
          bar.style.width = pct + '%';
          status.textContent = pct + '% · ' + formatSpeed(speed);
        });

        xhr.addEventListener('load', () => {
          try {
            const res = JSON.parse(xhr.responseText || '{}');
            if (xhr.status >= 200 && xhr.status < 300 && res.ok) {
              status.textContent = 'Uploaded ✓';
              status.classList.add('ok');
              bar.style.width = '100%';
            } else {
              status.textContent = res.error || 'Upload failed';
              status.classList.add('error');
            }
          } catch (error) {
            status.textContent = 'Upload failed';
            status.classList.add('error');
          }
        });

        xhr.addEventListener('error', () => {
          status.textContent = 'Network error';
          status.classList.add('error');
        });

        xhr.addEventListener('abort', () => {
          status.textContent = 'Cancelled';
          status.classList.add('error');
          bar.style.width = '0%';
        });

        cancelButton.addEventListener('click', () => {
          xhr.abort();
        });

        xhr.open('POST', '/api/upload');
        xhr.setRequestHeader('x-admin-key', adminKeyInput.value);
        xhr.send(formData);
      }

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const files = Array.from(fileInput.files || []);
        files.forEach(startUpload);
      });
    `;

    res.send(page('Admin', body, script));
  } catch (error) {
    res.status(500).send(page('Error', `<div class="panel error">${esc(error.message)}</div>`));
  }
});

app.post('/api/upload', auth, upload.single('file'), async (req, res) => {
  const tempFile = req.file?.path;

  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file was uploaded.' });
    if (!req.body.releaseId) return res.status(400).json({ ok: false, error: 'Release is required.' });
    if (req.file.size > MAX_BYTES) return res.status(413).json({ ok: false, error: `File exceeds the ${MAX_MB} MB upload limit.` });

    const originalName = req.file.originalname || req.file.filename;
    const name = safeName(originalName);
    if (!name) return res.status(400).json({ ok: false, error: 'A valid filename is required.' });

    const asset = await uploadAsset(req.body.releaseId, name, req.file.mimetype, tempFile);
    res.json({ ok: true, asset });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Upload failed.' });
  } finally {
    if (tempFile) {
      fs.promises.unlink(tempFile).catch(() => {});
    }
  }
});

app.patch('/api/assets/:id', auth, async (req, res) => {
  try {
    const asset = await gh(`/repos/${REPO}/releases/assets/${req.params.id}`);
    const oldExt = extensionOf(asset.name || '');
    const requested = safeName(req.body?.name || '');

    if (!requested) return res.status(400).json({ ok: false, error: 'A valid filename is required.' });

    const newExt = extensionOf(requested);
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
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.message });
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, repo: REPO, site: SITE_NAME, maxUploadMb: MAX_MB });
});

app.listen(PORT, () => {
  console.log(`${SITE_NAME} listening on ${PORT}`);
});
