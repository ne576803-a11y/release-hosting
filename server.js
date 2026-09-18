const express = require("express");
const multer = require("multer");

const app = express();

const PORT = process.env.PORT || 10000;
const REPO = process.env.REPO_FULL_NAME || "txrszone/release-hosting";
const SITE_NAME = process.env.SITE_NAME || "Release Hosting";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const ADMIN_KEY = process.env.ADMIN_KEY || "";

const MAX_UPLOAD_MB = Math.max(
  1,
  Number(process.env.MAX_UPLOAD_MB || 100)
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024
  }
});

app.use(express.json({ limit: "2mb" }));


// ==================================================
// HTML ESCAPE
// ==================================================

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}


// ==================================================
// ADMIN AUTHENTICATION
// ==================================================

function auth(req, res, next) {
  if (!ADMIN_KEY) {
    return res.status(503).json({
      error: "ADMIN_KEY is not configured on Render."
    });
  }

  const key =
    req.get("x-admin-key") ||
    req.query.key ||
    "";

  if (key !== ADMIN_KEY) {
    return res.status(401).json({
      error: "Invalid admin key."
    });
  }

  next();
}


// ==================================================
// GITHUB API
// ==================================================

async function gh(path, options = {}) {
  const headers = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(options.headers || {})
  };

  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }

  const response = await fetch(
    `https://api.github.com${path}`,
    {
      ...options,
      headers
    }
  );

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message =
      data?.message ||
      `GitHub API error ${response.status}`;

    const error = new Error(message);
    error.status = response.status;

    throw error;
  }

  return data;
}


// ==================================================
// GET RELEASES
// ==================================================

async function releases() {
  return gh(
    `/repos/${REPO}/releases?per_page=100`
  );
}


// ==================================================
// PAGE LAYOUT
// ==================================================

function layout(title, body, extraScript = "") {
  return `<!doctype html>
<html lang="en">

<head>

<meta charset="utf-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>${esc(title)} • ${esc(SITE_NAME)}</title>

<style>

:root {
  color-scheme: dark;
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    Arial,
    sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #0f1220;
  color: #f5f7ff;
}

a {
  color: inherit;
}

.wrap {
  max-width: 1050px;
  margin: auto;
  padding: 20px;
}

nav {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  margin-bottom: 24px;
}

.brand {
  font-size: 22px;
  font-weight: 800;
  text-decoration: none;
}

.btn,
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 10px;
  padding: 10px 14px;
  background: #5865f2;
  color: #fff;
  text-decoration: none;
  cursor: pointer;
  font-weight: 700;
}

.btn.alt {
  background: #252b40;
}

.hero,
.card {
  background: #171b2d;
  border: 1px solid #292f49;
  border-radius: 16px;
  padding: 20px;
}

.hero {
  margin-bottom: 18px;
}

.muted {
  color: #aab2cc;
}

.tag {
  display: inline-block;
  background: #272e48;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 12px;
  margin: 3px;
}

.search {
  width: 100%;
  padding: 13px 15px;
  border-radius: 12px;
  border: 1px solid #343b58;
  background: #0c1020;
  color: #fff;
  margin: 14px 0 18px;
}

.grid {
  display: grid;
  grid-template-columns:
    repeat(auto-fit, minmax(280px, 1fr));
  gap: 15px;
}

.card h2 {
  margin: 0 0 8px;
}

.assets {
  margin-top: 14px;
}

.asset {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  padding: 10px 0;
  border-top: 1px solid #292f49;
}

.asset-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note {
  white-space: pre-wrap;
  line-height: 1.6;
  max-height: 360px;
  overflow: auto;
}

form {
  display: grid;
  gap: 12px;
}

.field {
  display: grid;
  gap: 6px;
}

input,
select,
textarea {
  width: 100%;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid #343b58;
  background: #0c1020;
  color: #fff;
}

.filebox {
  padding: 18px;
  border: 1px dashed #5865f2;
  border-radius: 12px;
}

.preview {
  max-width: 100%;
  max-height: 420px;
  border-radius: 12px;
  margin-top: 10px;
}

video {
  width: 100%;
  max-height: 520px;
  border-radius: 12px;
  margin-top: 10px;
}

.notice {
  padding: 12px;
  border-radius: 10px;
  background: #222941;
  margin: 10px 0;
}

.danger {
  background: #b83b4b;
}

.success {
  background: #245c42;
}

.release-meta {
  margin-top: 8px;
  font-size: 14px;
}

.empty {
  text-align: center;
  padding: 30px;
}

@media (max-width: 600px) {

  .wrap {
    padding: 14px;
  }

  nav {
    flex-direction: column;
    align-items: stretch;
  }

  .brand {
    text-align: center;
  }

  nav .btn {
    width: 100%;
  }

  .asset {
    align-items: flex-start;
    flex-direction: column;
  }

  .asset .btn {
    width: 100%;
  }

}

</style>

</head>

<body>

<main class="wrap">

<nav>

<a
  class="brand"
  href="/"
>
${esc(SITE_NAME)}
</a>

<a
  class="btn alt"
  href="/admin"
>
Admin Upload
</a>

</nav>

${body}

</main>

${extraScript}

</body>

</html>`;
}


// ==================================================
// RELEASE ASSET HTML
// ==================================================

function assetHtml(asset) {

  const safeUrl =
    esc(asset.browser_download_url);

  const name =
    esc(asset.name);

  const size =
    asset.size
      ? `${(asset.size / 1024 / 1024).toFixed(2)} MB`
      : "";

  const extension =
    (asset.name.split(".").pop() || "")
      .toLowerCase();

  let preview = "";

  // IMAGE PREVIEW

  if (
    [
      "jpg",
      "jpeg",
      "png",
      "gif",
      "webp",
      "svg"
    ].includes(extension)
  ) {
    preview = `
      <img
        class="preview"
        src="${safeUrl}"
        alt="${name}"
        loading="lazy"
      >
    `;
  }

  // VIDEO PLAYER

  if (
    [
      "mp4",
      "webm",
      "ogg"
    ].includes(extension)
  ) {
    preview = `
      <video
        controls
        preload="metadata"
        src="${safeUrl}"
      ></video>
    `;
  }

  return `
    <div class="asset">

      <div style="min-width:0">

        <div class="asset-name">
          ${name}
        </div>

        <small class="muted">
          ${size}
          ${size ? " • " : ""}
          ${esc(asset.download_count)}
          downloads
        </small>

        ${preview}

      </div>

      <a
        class="btn"
        href="${safeUrl}"
        target="_blank"
        rel="noopener"
      >
        Download
      </a>

    </div>
  `;
}


// ==================================================
// API: GET RELEASES
// ==================================================

app.get("/api/releases", async (req, res) => {

  try {

    const list = await releases();

    res.json({
      ok: true,
      count: list.length,
      releases: list
    });

  } catch (error) {

    res.status(error.status || 500).json({
      ok: false,
      error: error.message
    });

  }

});


// ==================================================
// HOME PAGE
// ==================================================

app.get("/", async (req, res) => {

  try {

    const list = await releases();

    const cards = list.map((release) => {

      const releaseName =
        release.name ||
        release.tag_name ||
        "Untitled Release";

      const body =
        release.body || "";

      const published =
        release.published_at
          ? new Date(
              release.published_at
            ).toLocaleString()
          : "Unpublished";

      const prerelease =
        release.prerelease
          ? '<span class="tag">Pre-release</span>'
          : "";

      const draft =
        release.draft
          ? '<span class="tag">Draft</span>'
          : "";

      return `
        <article
          class="card release-card"
          data-search="${esc(
            releaseName + " " + body
          )}"
        >

          <h2>
            ${esc(releaseName)}
          </h2>

          <span class="tag">
            ${esc(release.tag_name)}
          </span>

          ${prerelease}

          ${draft}

          <p class="muted release-meta">
            ${esc(published)}
          </p>

          <p>
            ${esc(body.slice(0, 240))}
            ${body.length > 240 ? "…" : ""}
          </p>

          <a
            class="btn"
            href="/release/${encodeURIComponent(
              release.tag_name
            )}"
          >
            View Release
          </a>

        </article>
      `;
    }).join("");


    const content = `
      <section class="hero">

        <h1>
          ${esc(SITE_NAME)}
        </h1>

        <p class="muted">
          Releases from ${esc(REPO)}
        </p>

        <input
          id="search"
          class="search"
          placeholder="Search releases..."
          autocomplete="off"
        >

      </section>

      <section
        class="grid"
        id="list"
      >

        ${
          cards ||
          `
            <div class="card empty">

              <h2>
                No releases found
              </h2>

              <p class="muted">
                No GitHub releases are available.
              </p>

            </div>
          `
        }

      </section>
    `;


    const script = `
      <script>

      const search =
        document.querySelector("#search");

      if (search) {

        search.addEventListener(
          "input",
          () => {

            const query =
              search.value.toLowerCase();

            document
              .querySelectorAll(".release-card")
              .forEach((card) => {

                const text =
                  card.dataset.search
                    .toLowerCase();

                card.style.display =
                  text.includes(query)
                    ? "block"
                    : "none";

              });

          }
        );

      }

      </script>
    `;


    res.send(
      layout(
        SITE_NAME,
        content,
        script
      )
    );

  } catch (error) {

    res.status(500).send(

      layout(
        "Error",

        `
        <div class="card">

          <h2>
            Could not load releases
          </h2>

          <p>
            ${esc(error.message)}
          </p>

          <p class="muted">
            Repository:
            ${esc(REPO)}
          </p>

          <a
            class="btn"
            href="/"
          >
            Try Again
          </a>

        </div>
        `
      )

    );

  }

});


// ==================================================
// SINGLE RELEASE PAGE
// ==================================================

app.get("/release/:tag", async (req, res) => {

  try {

    const tag =
      req.params.tag;

    const release =
      await gh(
        `/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`
      );

    const assets =
      (release.assets || [])
        .map((asset) =>
          assetHtml(asset)
        )
        .join("");


    const releaseName =
      release.name ||
      release.tag_name ||
      "Release";


    const published =
      release.published_at
        ? new Date(
            release.published_at
          ).toLocaleString()
        : "Unpublished";


    const content = `

      <section class="hero">

        <a
          class="muted"
          href="/"
        >
          ← All releases
        </a>

        <h1>
          ${esc(releaseName)}
        </h1>

        <span class="tag">
          ${esc(release.tag_name)}
        </span>

        ${
          release.prerelease
            ? '<span class="tag">Pre-release</span>'
            : ""
        }

        <p class="muted">
          ${esc(published)}
        </p>

        <div class="note">
          ${esc(
            release.body ||
            "No release notes."
          )}
        </div>

      </section>


      <section class="card">

        <h2>
          Files (${release.assets?.length || 0})
        </h2>

        <div class="assets">

          ${
            assets ||
            `
              <p class="muted">
                No files attached to this release.
              </p>
            `
          }

        </div>

      </section>

    `;


    res.send(
      layout(
        releaseName,
        content
      )
    );

  } catch (error) {

    res.status(404).send(

      layout(
        "Release not found",

        `
        <div class="card">

          <h2>
            Release not found
          </h2>

          <p>
            ${esc(error.message)}
          </p>

          <a
            class="btn"
            href="/"
          >
            Back
          </a>

        </div>
        `
      )

    );

  }

});


// ==================================================
// ADMIN PAGE
// ==================================================

app.get("/admin", async (req, res) => {

  let list = [];
  let loadError = "";

  try {

    list = await releases();

  } catch (error) {

    loadError =
      error.message ||
      "Could not load releases.";

  }


  const options =
    list
      .map((release) => {

        const name =
          release.name ||
          release.tag_name ||
          "Untitled Release";

        return `
          <option
            value="${esc(release.id)}"
          >
            ${esc(name)}
            (${esc(release.tag_name)})
          </option>
        `;
      })
      .join("");


  const releaseSelect =
    options
      ? options
      : `
        <option value="">
          No releases available
        </option>
      `;


  const content = `

    <section class="hero">

      <h1>
        Admin Upload
      </h1>

      <p class="muted">
        Upload an image, video or other file
        directly to a GitHub Release.
      </p>

      <div class="notice">

        The admin key is only sent to this
        server and is never placed in the
        page source.

      </div>

      ${
        loadError
          ? `
            <div class="notice danger">
              Could not load releases:
              ${esc(loadError)}
            </div>
          `
          : ""
      }

    </section>


    <section class="card">

      <form id="form">

        <div class="field">

          <label>
            Admin key
          </label>

          <input
            id="key"
            type="password"
            required
            autocomplete="off"
            placeholder="Enter ADMIN_KEY"
          >

        </div>


        <div class="field">

          <label>
            Release
          </label>

          <select
            id="release_id"
            required
          >

            ${releaseSelect}

          </select>

        </div>


        <div class="field">

          <label>
            File
          </label>

          <div class="filebox">

            <input
              id="file"
              type="file"
              required
            >

            <p class="muted">
              Maximum upload size:
              ${MAX_UPLOAD_MB} MB
            </p>

          </div>

        </div>


        <button
          type="submit"
        >
          Upload to GitHub Release
        </button>


        <div id="status"></div>

      </form>

    </section>

  `;


  // IMPORTANT:
  // No nested JavaScript template literals here.
  // This prevents the previous syntax error.

  const script = `

    <script>

    const form =
      document.querySelector("#form");

    const status =
      document.querySelector("#status");


    if (form) {

      form.addEventListener(
        "submit",
        async (event) => {

          event.preventDefault();


          status.innerHTML =
            '<div class="notice">Uploading...</div>';


          const key =
            document.querySelector("#key").value;

          const releaseId =
            document.querySelector("#release_id").value;

          const fileInput =
            document.querySelector("#file");

          const file =
            fileInput.files[0];


          if (!file) {

            status.innerHTML =
              '<div class="notice danger">Please select a file.</div>';

            return;

          }


          const formData =
            new FormData();


          formData.append(
            "release_id",
            releaseId
          );


          formData.append(
            "file",
            file
          );


          try {

            const response =
              await fetch(
                "/api/upload",
                {
                  method: "POST",

                  headers: {
                    "x-admin-key": key
                  },

                  body: formData
                }
              );


            const data =
              await response.json();


            if (!response.ok) {

              throw new Error(
                data.error ||
                "Upload failed."
              );

            }


            const openLink =
              document.createElement("a");

            openLink.href =
              data.download_url;

            openLink.target =
              "_blank";

            openLink.rel =
              "noopener";

            openLink.textContent =
              "Open uploaded file";


            status.innerHTML = "";

            const success =
              document.createElement("div");

            success.className =
              "notice success";


            const strong =
              document.createElement("strong");

            strong.textContent =
              "Upload successful!";


            success.appendChild(
              strong
            );

            success.appendChild(
              document.createElement("br")
            );

            success.appendChild(
              document.createElement("br")
            );

            success.appendChild(
              openLink
            );


            status.appendChild(
              success
            );


            form.reset();

          } catch (error) {

            status.innerHTML =
              '<div class="notice danger">' +
              error.message +
              '</div>';

          }

        }
      );

    }

    </script>

  `;


  res.send(
    layout(
      "Admin Upload",
      content,
      script
    )
  );

});


// ==================================================
// UPLOAD FILE TO GITHUB RELEASE
// ==================================================

app.post(
  "/api/upload",
  auth,
  upload.single("file"),

  async (req, res) => {

    try {

      if (!GITHUB_TOKEN) {

        return res.status(503).json({
          error:
            "GITHUB_TOKEN is not configured."
        });

      }


      if (!req.file) {

        return res.status(400).json({
          error:
            "No file selected."
        });

      }


      const releaseId =
        Number(req.body.release_id);


      if (!releaseId) {

        return res.status(400).json({
          error:
            "Invalid release."
        });

      }


      // Get release

      const release =
        await gh(
          `/repos/${REPO}/releases/${releaseId}`
        );


      // Clean filename

      const filename =
        req.file.originalname
          .replace(/[\/\\]/g, "_");


      // GitHub release upload URL

      const uploadUrl =
        `https://uploads.github.com/repos/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(filename)}`;


      const response =
        await fetch(
          uploadUrl,
          {
            method: "POST",

            headers: {

              "Authorization":
                `Bearer ${GITHUB_TOKEN}`,

              "Accept":
                "application/vnd.github+json",

              "Content-Type":
                req.file.mimetype ||
                "application/octet-stream",

              "Content-Length":
                String(req.file.size),

              "X-GitHub-Api-Version":
                "2022-11-28"

            },

            body:
              req.file.buffer
          }
        );


      const text =
        await response.text();


      let data;

      try {

        data =
          JSON.parse(text);

      } catch {

        data = {
          message: text
        };

      }


      if (!response.ok) {

        return res.status(
          response.status
        ).json({

          error:
            data.message ||
            "GitHub upload failed."

        });

      }


      res.json({

        ok: true,

        name:
          data.name,

        download_url:
          data.browser_download_url,

        release:
          release.tag_name

      });

    } catch (error) {

      res.status(
        error.status || 500
      ).json({

        error:
          error.message ||
          "Upload failed."

      });

    }

  }
);


// ==================================================
// HEALTH CHECK
// ==================================================

app.get(
  "/health",
  (req, res) => {

    res.json({

      ok: true,

      repo:
        REPO,

      site:
        SITE_NAME

    });

  }
);


// ==================================================
// START SERVER
// ==================================================

app.listen(
  PORT,
  () => {

    console.log(
      `${SITE_NAME} running on port ${PORT}`
    );

    console.log(
      `GitHub repository: ${REPO}`
    );

  }
);
