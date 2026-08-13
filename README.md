# minimal-writer

A single-page, blank-white-screen writing app. Everything you type is
continuously backed up to one Google Doc in a Drive folder you choose. A
small checkmark next to the title lets you branch into a fresh Doc for the
current browser session only; the next page load goes back to the master
doc.

## 1. Set up Google Cloud (you do this part)

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com).
2. Enable the **Google Drive API** (APIs & Services → Library). The Docs API
   is not needed — content is read/written as plain text via the Drive API.
3. Configure the **OAuth consent screen**: type "External", publishing
   status "Testing" is fine since only you will use this. Add your own
   Google account under "Test users".
4. Create **OAuth 2.0 credentials** (APIs & Services → Credentials → Create
   Credentials → OAuth client ID → type "Web application").
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/callback` (local dev)
     - `https://<your-vercel-domain>/api/auth/callback` (add this once you
       have a real Vercel domain — you can update it later)
   - This gives you a **Client ID** and **Client Secret**.
5. Create the destination folder in Google Drive and copy the folder ID out
   of the URL: `https://drive.google.com/drive/folders/<FOLDER_ID>`.

## 2. Set up storage

The app needs a small persistent key-value store (serverless functions are
stateless, so something has to remember the refresh token and the master
doc's ID between requests). Easiest path: add **Vercel KV** (or any Upstash
Redis) from the Vercel dashboard — it auto-injects `KV_REST_API_URL` and
`KV_REST_API_TOKEN` into your project's env vars.

## 3. Environment variables

Copy `.env.example` to `.env.local` for local dev, and add the same values
in the Vercel project settings for production:

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=            # must exactly match a redirect URI on the OAuth client
DRIVE_FOLDER_ID=
KV_REST_API_URL=                # auto-added by Vercel KV
KV_REST_API_TOKEN=              # auto-added by Vercel KV
```

## 4. Run locally

```
npm install
npm run dev
```

Open `http://localhost:3000`, click "Connect Google Drive", and authorize
with the Google account you added as a test user. After that it creates (or
reuses) the master doc and you can start typing.

## 5. Deploy

Push this repo to GitHub and import it into Vercel. Add the environment
variables above in the Vercel project settings, then once you have your
real `*.vercel.app` (or custom) domain, add
`https://<your-domain>/api/auth/callback` to the OAuth client's authorized
redirect URIs in Google Cloud Console and set `GOOGLE_REDIRECT_URI`
accordingly.

## How it works

- All Google OAuth and Drive calls happen server-side in API routes
  (`app/api/**`) — the browser never sees Google credentials.
- The Doc's plain-text content is `title\n\nbody`; the Drive API's
  `files.export` / `files.update` read and overwrite it wholesale on each
  sync (no Docs API index-based diffing).
- Typing debounces an autosave (~2.5s of inactivity) to the currently active
  doc, and mirrors content into `localStorage` on every change as an
  offline buffer. A failed save retries automatically.
- The checkmark button creates a new Doc in the same folder (titled from
  the current title field, or today's date if it's empty) and makes it the
  active doc for the rest of the browser session — it does not touch the
  stored `masterDocId`, so a fresh page load always goes back to the master
  doc.
