# Release Hosting

A Node.js + Express website that reads GitHub Releases and provides an admin page for uploading release assets.

## Features
- Release list from GitHub
- Individual release pages
- Download links
- Image previews
- Browser video player for common video files
- Admin upload to an existing GitHub Release
- Search
- `/health` endpoint

## Render environment variables

Required for public release viewing:
- `REPO_FULL_NAME=txrszone/release-hosting`
- `SITE_NAME=Release Hosting`

Required for admin upload:
- `GITHUB_TOKEN=<GitHub token with permission to upload release assets>`
- `ADMIN_KEY=<long random secret used by the /admin page>`

Optional:
- `MAX_UPLOAD_MB=100`

## Important security notes

Never put `GITHUB_TOKEN` in frontend JavaScript or commit it to GitHub.

For the GitHub token, use the minimum repository permissions needed for the private admin operation. For a fine-grained token, grant access to the target repository and the repository permission needed to manage releases/assets. Keep the token private.

The website stores no uploaded files on Render. The file is uploaded from the browser to the Render server and then to the selected GitHub Release asset. Visitors download the asset from GitHub.

## Local run

```bash
npm install
REPO_FULL_NAME=txrszone/release-hosting GITHUB_TOKEN=your_token ADMIN_KEY=your_admin_key npm start
```

Open `http://localhost:10000`.

## Render

Create a Web Service from this repository.
Build command: `npm install`
Start command: `npm start`

Add the environment variables in Render's Environment settings. Do not commit secrets.