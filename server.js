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
const safeName = value => {
  const name = path.basename(String(value || '')).replace(/[\\/]/g, '-').trim();
  return name && name !== '.' && name !== '..' ? name : '';
};
const requestKey = req => req.headers['x-admin-key'] || req.query.key || req.body?.key || '';

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(500).json({ ok: false, error: 'ADMIN_KEY is not configured.' });
  if (requestKey(req) !== ADMIN_KEY) return res.status(401).json({ ok: false, error: 'Invalid admin key.' });
  next();
}

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
    stream.on('error', err => { req.destroy(); reject(err); });
    stream.pipe(req);
  });
}

const CSS = `:root{--bg:#08090d;--surface:#11141c;--surface2:#191d28;--text:#f8fafc;--muted:#9aa5b5;--line:#293141;--accent:#7c5cff;--good:#23d5ab}body.light{--bg:#f4f7fb;--surface:#fff;--surface2:#edf1f7;--text:#111827;--muted:#5d6878;--line:#d8e0eb}*{box-sizing:border-box}body{margin:0;font:16px Inter,system-ui,Arial,sans-serif;background:var(--bg);color:var(--text)}a{color:inherit;text-decoration:none}.container{width:min(1120px,calc(100% - 24px));margin:auto}header{position:sticky;top:0;z-index:10;background:var(--bg);border-bottom:1px solid var(--line)}.nav{min-height:68px;display:flex;align-items:center;justify-content:space-between;gap:12px}.logo{font-weight:800;font-size:20px}.logo span{color:var(--accent)}.nav-links{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.btn{display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--text);cursor:pointer}.btn:hover{border-color:var(--accent)}.primary{border:0;background:linear-gradient(135deg,var(--accent),#4f9cff);color:#fff}.danger{color:#ef4444}main{padding:28px 0 60px}.hero{padding:30px 0 20px}.hero h1{font-size:clamp(32px,6vw,58px);margin:0 0 14px}.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}.card,.asset{background:linear-gradient(145deg,var(--surface),var(--surface2));border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:0 18px 55px #0003}.asset{margin-top:14px;position:relative}.asset-name{font-weight:700;word-break:break-word;padding-right:48px}.asset-menu{position:absolute;right:14px;top:14px}.dots{font-size:22px;width:38px;height:38px;padding:0}.menu-panel{display:none;position:absolute;right:0;top:44px;z-index:5;min-width:190px;padding:7px;border:1px solid var(--line);border-radius:12px;background:var(--surface);box-shadow:0 12px 35px #0008}.menu-panel.open{display:grid;gap:5px}.menu-panel button{padding:9px;text-align:left;border:0;border-radius:8px;background:transparent;color:var(--text);cursor:pointer}.menu-panel button:hover{background:var(--surface2)}.preview{margin-top:14px}.preview img,.preview video{max-width:100%;max-height:450px;border-radius:14px}.notice{padding:16px;border:1px solid var(--line);border-radius:14px;background:var(--surface2);margin:16px 0}.form-group{margin-bottom:20px}.form-group label{display:block;margin-bottom:8px;font-weight:700}.form-group input,.form-group select,.file-input{width:100%;padding:13px;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--text)}.selected-list{display:grid;gap:10px;margin:12px 0 20px}.selected-file{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:9px;align-items:center;padding:10px;border:1px solid var(--line);border-radius:10px}.selected-file small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.selected-file .btn{padding:7px 10px;font-size:13px}.progress{height:14px;background:var(--line);border-radius:20px;overflow:hidden;margin-top:14px}.progress-bar{height:100%;background:linear-gradient(90deg,var(--accent),var(--good));transition:width .15s}.progress-bar.orange{background:linear-gradient(90deg,#ff9f43,#ffb74d)}footer{padding:34px 0;border-top:1px solid var(--line);text-align:center;color:var(--muted)}@media(max-width:650px){.selected-file{grid-template-columns:1fr auto}.selected-file small{grid-column:1/-1}}`;

function page(title, body, script = '') {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} - ${esc(SITE_NAME)}</title><style>${CSS}</style></head><body><header><div class="container nav"><a class="logo" href="/"><span>✦</span> ${esc(SITE_NAME)}</a><div class="nav-links"><a class="btn" href="/">Releases</a><a class="btn" href="/admin">Upload</a><button class="btn" id="themeBtn" type="button">☀️ Light mode</button></div></div></header><main><div class="container">${body}</div></main><footer>${esc(SITE_NAME)} · Fast, simple release hosting</footer><script>
  function applyTheme() {
    const isLight = localStorage.getItem('release_theme') === 'light';
    document.body.classList.toggle('light', isLight);
    const themeBtn = document.getElementById('themeBtn');
    if (themeBtn) themeBtn.textContent = isLight ? '🌙 Dark mode' : '☀️ Light mode';
  }
  applyTheme();
  document.getElementById('themeBtn').addEventListener('click', () => {
    const next = document.body.classList.contains('light') ? 'dark' : 'light';
    localStorage.setItem('release_theme', next);
    applyTheme();
  });
  ${script}
</script></body></html>`;
}

function preview(asset) {
  const name = asset.name || '';
  const url = asset.browser_download_url || '';
  if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(name)) return `<div class="preview"><img src="${esc(url)}" alt="${esc(name)}" loading="lazy"></div>`;
  if (/\.(mp4|webm|ogg|mov|m4v)$/i.test(name)) return `<div class="preview"><video controls preload="metadata"><source src="${esc(url)}"></video></div>`;
  return '';
}

app.get('/', async (_req, res) => {
  try {
    const releases = await getReleases();
    const cards = releases.filter(r => !r.draft).map(r => `
      <div class="card">
        <h2><a href="/release/${encodeURIComponent(r.tag_name)}">${esc(r.name || r.tag_name)}</a></h2>
        <p class="muted">Version: ${esc(r.tag_name)}</p>
        <p>📦 ${r.assets?.length || 0} files</p>
        <a class="btn primary" href="/release/${encodeURIComponent(r.tag_name)}">Explore release →</a>
      </div>
    `).join('');

    res.send(page('Releases', `
      <section class="hero">
        <h1>Share your releases<br>with style.</h1>
        <p class="muted">Browse releases, preview media, and download files in one place.</p>
      </section>
      <input id="search" class="form-group" placeholder="⌕ Search releases...">
      ${cards ? `<div class="grid" id="releaseGrid">${cards}</div>` : '<div class="notice">No releases available yet.</div>'}
    `, `
      const search = document.getElementById('search');
      search.oninput = () => {
        const value = search.value.toLowerCase();
        document.querySelectorAll('#releaseGrid .card').forEach(card => {
          card.style.display = card.innerText.toLowerCase().includes(value) ? '' : 'none';
        });
      };
    `));
  } catch (e) {
    res.status(500).send(page('Error', `<div class="notice">${esc(e.message)}</div>`));
  }
});

app.get('/release/:tag', async (req, res) => {
  try {
    const release = await getReleaseByTag(req.params.tag);
    const assets = (release.assets || []).map(asset => `
      <div class="asset" data-asset data-id="${asset.id}" data-created="${asset.created_at || ''}">
        <div class="asset-menu">
          <button class="btn dots" data-menu type="button" aria-label="File actions">⋮</button>
          <div class="menu-panel">
            <button data-action="rename" type="button">Rename</button>
            <button data-action="delete" class="danger" type="button">Delete</button>
            <button data-action="copy" type="button">Copy direct link</button>
          </div>
        </div>
        <div class="asset-name">${esc(asset.name)}</div>
        <p class="muted">${(asset.size / 1024 / 1024).toFixed(2)} MB</p>
        ${preview(asset)}
        <br>
        <a class="btn primary" href="${esc(asset.browser_download_url)}">Download ↘</a>
      </div>
    `).join('');

    const body = `
      <section class="hero"><h1>${esc(release.name || release.tag_name)}</h1><p class="muted">Version: ${esc(release.tag_name)}</p></section>
      <div class="card">
        <label>Sort files: <select id="sort"><option value="oldest">Oldest first</option><option value="newest">Newest first</option></select></label>
      </div>
      <div id="status"></div>
      <div id="files">${assets || '<div class="notice">This release has no files.</div>'}</div>
    `;

    const script = `
      const files = document.getElementById('files');
      const status = document.getElementById('status');
      const sort = document.getElementById('sort');
      const admin = () => {
        let key = localStorage.getItem('release_admin_key') || prompt('Enter admin key');
        if (key) localStorage.setItem('release_admin_key', key);
        return key || '';
      };
      const showMessage = (text, ok = true) => {
        status.innerHTML = '<div class="notice" style="color:' + (ok ? 'var(--good)' : '#ef4444') + '">' + text + '</div>';
      };
      function reorderAssets() {
        [...files.querySelectorAll('[data-asset]')].sort((a, b) => {
          const diff = new Date(a.dataset.created) - new Date(b.dataset.created);
          return sort.value === 'oldest' ? diff : -diff;
        }).forEach(node => files.appendChild(node));
      }
      sort.onchange = reorderAssets;
      reorderAssets();

      document.addEventListener('click', async event => {
        const menuButton = event.target.closest('[data-menu]');
        if (menuButton) {
          document.querySelectorAll('.menu-panel.open').forEach(panel => panel.classList.remove('open'));
          menuButton.nextElementSibling.classList.toggle('open');
          return;
        }

        if (!event.target.closest('.asset-menu')) {
          document.querySelectorAll('.menu-panel.open').forEach(panel => panel.classList.remove('open'));
        }

        const actionButton = event.target.closest('[data-action]');
        if (!actionButton) return;

        const card = actionButton.closest('[data-asset]');
        const id = card.dataset.id;
        const oldName = card.querySelector('.asset-name').textContent;
        const key = admin();
        if (!key) return;

        if (actionButton.dataset.action === 'rename') {
          const next = prompt('New filename:', oldName);
          if (!next || next === oldName) return;
          try {
            const response = await fetch('/api/assets/' + id, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'x-admin-key': key },
              body: JSON.stringify({ name: next })
            });
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.error || 'Rename failed');
            card.querySelector('.asset-name').textContent = data.asset.name;
            showMessage('File renamed successfully.');
          } catch (error) {
            showMessage(error.message, false);
          }
          return;
        }

        if (actionButton.dataset.action === 'delete') {
          if (!confirm('Delete ' + oldName + ' permanently?')) return;
          try {
            const response = await fetch('/api/assets/' + id, {
              method: 'DELETE',
              headers: { 'x-admin-key': key }
            });
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.error || 'Delete failed');
            card.remove();
            showMessage('File deleted successfully.');
          } catch (error) {
            showMessage(error.message, false);
          }
          return;
        }

        if (actionButton.dataset.action === 'copy') {
          const url = card.querySelector('a.primary').href;
          try {
            await navigator.clipboard.writeText(url);
            showMessage('Direct download link copied.');
          } catch {
            prompt('Copy this link:', url);
          }
        }
      });
    `;

    res.send(page(release.name || release.tag_name, body, script));
  } catch (e) {
    res.status(e.status || 500).send(page('Error', `<div class="notice">${esc(e.message)}</div>`));
  }
});

app.get('/admin', async (_req, res) => {
  try {
    const releases = await getReleases();
    const options = releases.filter(r => !r.draft).map(r => `<option value="${r.id}">${esc(r.name || r.tag_name)} (${esc(r.tag_name)})</option>`).join('');

    const body = `
      <section class="hero"><h1>Upload files</h1><p class="muted">Rename selected files before uploading.</p></section>
      <div class="card">
        <div class="form-group" id="keyBox">
          <label>Admin key</label>
          <input id="adminKey" type="password" placeholder="Enter your admin key">
        </div>
        <div class="form-group">
          <label>Destination release</label>
          <select id="releaseId">${options}</select>
        </div>
        <div class="form-group">
          <label>Select files <span class="muted">(each up to ${MAX_MB} MB)</span></label>
          <input id="file" class="file-input" type="file" multiple>
          <div id="selected" class="selected-list"></div>
        </div>
        <button class="btn primary" id="uploadBtn" type="button">Upload selected files ↥</button>
        <div id="status"></div>
      </div>
    `;

    const script = `
      const keyInput = document.getElementById('adminKey');
      const fileInput = document.getElementById('file');
      const selectedBox = document.getElementById('selected');
      const statusBox = document.getElementById('status');
      const uploadBtn = document.getElementById('uploadBtn');
      const keyBox = document.getElementById('keyBox');

      let files = [];
      const savedKey = localStorage.getItem('release_admin_key');
      if (savedKey) {
        keyInput.value = savedKey;
        keyBox.style.display = 'none';
      }

      const htmlSafe = value => String(value).replace(/[&<>\"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#039;' }[c]));

      function renderSelectedFiles() {
        selectedBox.innerHTML = files.map((item, index) => `
          <div class="selected-file">
            <small title="${htmlSafe(item.name)}">${htmlSafe(item.name)}</small>
            <button class="btn" type="button" data-rename="${index}">Rename</button>
            <button class="btn danger" type="button" data-remove="${index}">Remove</button>
          </div>
        `).join('');
      }

      fileInput.onchange = () => {
        files = [...fileInput.files].map(file => ({ file, name: file.name }));
        renderSelectedFiles();
      };

      selectedBox.onclick = event => {
        const renameBtn = event.target.closest('[data-rename]');
        const removeBtn = event.target.closest('[data-remove]');

        if (renameBtn) {
          const index = Number(renameBtn.dataset.rename);
          const next = prompt('Filename for upload:', files[index].name);
          const clean = next && next.replace(/[\\/]/g, '-').trim();
          if (clean) files[index].name = clean;
          renderSelectedFiles();
        }

        if (removeBtn) {
          const index = Number(removeBtn.dataset.remove);
          files.splice(index, 1);
          renderSelectedFiles();
        }
      };

      function uploadOne(item, index, total, retry = 0) {
        return new Promise(resolve => {
          const form = new FormData();
          form.append('release_id', document.getElementById('releaseId').value);
          form.append('file', item.file, item.name);

          const request = new XMLHttpRequest();
          const startedAt = performance.now();
          request.open('POST', '/api/upload');
          request.setRequestHeader('x-admin-key', keyInput.value.trim());
          request.timeout = 30 * 60 * 1000;

          request.upload.onprogress = e => {
            if (!e.lengthComputable) return;
            const elapsed = Math.max((performance.now() - startedAt) / 1000, 0.001);
            const uploadedMB = e.loaded / 1048576;
            const totalMB = e.total / 1048576;
            const speedMB = uploadedMB / elapsed;
            statusBox.innerHTML = '<div class="notice"><b>' + index + '/' + total + ' file uploading:</b> ' + htmlSafe(item.name) + '<br>Uploaded file size: ' + uploadedMB.toFixed(1) + 'MB/' + totalMB.toFixed(1) + 'MB<br>Upload speed: ' + speedMB.toFixed(2) + ' MB/s<div class="progress"><div class="progress-bar" style="width:' + (e.loaded / e.total * 100) + '%"></div></div></div>';
          };

          request.onload = () => {
            let data = {};
            try { data = JSON.parse(request.responseText); } catch {}
            const result = { ok: request.status >= 200 && request.status < 300 && data.ok, name: item.name, error: data.error };

            if (!result.ok && retry < 2 && /connection|timeout/i.test(result.error || '')) {
              return setTimeout(() => uploadOne(item, index, total, retry + 1).then(resolve), 1500 * (retry + 1));
            }

            resolve(result);
          };

          request.onerror = () => {
            if (retry < 2) {
              return setTimeout(() => uploadOne(item, index, total, retry + 1).then(resolve), 1500 * (retry + 1));
            }
            resolve({ ok: false, name: item.name, error: 'Connection interrupted after retries.' });
          };

          request.ontimeout = () => resolve({ ok: false, name: item.name, error: 'Upload timed out.' });
          request.send(form);
        });
      }

      uploadBtn.onclick = async () => {
        const key = keyInput.value.trim();
        if (!key) {
          statusBox.innerHTML = '<div class="notice">Admin key required.</div>';
          return;
        }
        if (!files.length) {
          statusBox.innerHTML = '<div class="notice">Select at least one file.</div>';
          return;
        }

        localStorage.setItem('release_admin_key', key);
        keyBox.style.display = 'none';
        uploadBtn.disabled = true;

        const results = [];
        for (let i = 0; i < files.length; i++) {
          results.push(await uploadOne(files[i], i + 1, files.length));
        }

        const failed = results.filter(result => !result.ok);
        statusBox.innerHTML = '<div class="notice"><b>' + (failed.length ? 'Some files failed.' : 'All files uploaded successfully.') + '</b><br>' +
          results.map(result => (result.ok ? '✓ ' : '✗ ') + htmlSafe(result.name) + (result.error ? ' — ' + htmlSafe(result.error) : '')).join('<br>') + '</div>';

        uploadBtn.disabled = false;
        if (!failed.length) {
          fileInput.value = '';
          files = [];
          renderSelectedFiles();
        }
      };
    `;

    res.send(page('Admin', body, script));
  } catch (e) {
    res.status(500).send(page('Admin Error', `<div class="notice">${esc(e.message)}</div>`));
  }
});

app.post('/api/upload', requireAdmin, upload.single('file'), async (req, res) => {
  const tempPath = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file was uploaded.' });
    if (!req.body.release_id) return res.status(400).json({ ok: false, error: 'release_id is required.' });

    const fileName = safeName(req.file.originalname);
    const existingAssets = await githubApi(`/repos/${REPO}/releases/${encodeURIComponent(req.body.release_id)}/assets`);
    let finalName = fileName;
    if (existingAssets.some(asset => asset.name === finalName)) {
      const ext = path.extname(finalName);
      const base = path.basename(finalName, ext);
      finalName = `${base}-${Date.now()}${ext}`;
    }

    const result = await uploadAsset(req.body.release_id, finalName, req.file.mimetype, tempPath, req.file.size);
    if (!result.ok) {
      return res.status(result.status).json({ ok: false, error: result.data?.message || `GitHub upload failed (${result.status}).` });
    }

    res.json({ ok: true, asset: result.data });
  } catch (e) {
    res.status(e.status || 502).json({ ok: false, error: e.message });
  } finally {
    if (tempPath) fs.promises.unlink(tempPath).catch(() => {});
  }
});

app.patch('/api/assets/:id', requireAdmin, async (req, res) => {
  try {
    const name = safeName(req.body?.name);
    if (!name) return res.status(400).json({ ok: false, error: 'A valid filename is required.' });
    const asset = await githubApi(`/repos/${REPO}/releases/assets/${encodeURIComponent(req.params.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name })
    });
    res.json({ ok: true, asset });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/assets/:id', requireAdmin, async (req, res) => {
  try {
    await githubApi(`/repos/${REPO}/releases/assets/${encodeURIComponent(req.params.id)}`, { method: 'DELETE' });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.get('/health', (_req, res) => res.type('text').send('ok'));
app.use((error, _req, res, _next) => res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ ok: false, error: error.code === 'LIMIT_FILE_SIZE' ? `File is too large. Maximum allowed size is ${MAX_MB} MB.` : error.message }));

app.listen(PORT, '0.0.0.0', () => console.log(`${SITE_NAME} running on port ${PORT}`));
