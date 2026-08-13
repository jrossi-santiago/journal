# minimal-writer

A blank-white-screen writing app backed by Google Drive. Signing in lands
you on a minimal dashboard listing every document in the Drive folder you
chose, most recently edited first — click one to keep writing in it, or hit
"New" for a blank page. Each new document becomes its own Google Doc;
reopening an old one amends that same Doc rather than making another copy.

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
   of the URL: `https://drive.google.com/drive/folders/<FOLDER_ID>`. Set
   `DRIVE_FOLDER_ID` to just the `<FOLDER_ID>` part, not the whole URL
   (a pasted URL is tolerated, but the bare ID is what Drive wants).

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
with the Google account you added as a test user. After that you land on
the dashboard; click "New" to start writing.

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
- `/` is the dashboard. `GET /api/docs` lists the Docs in the configured
  folder (`files.list`, newest edit first) and each row links to
  `/write?doc=<fileId>`.
- `/write` is the editor. With a `?doc=` id it loads that file and every
  save amends it. Without one it starts a blank document; the Drive file is
  created on the first save that has any content (so an abandoned blank page
  leaves nothing behind), and the returned file id is then written into the
  URL so reloads and later saves stay on that same file.
- The Doc's plain-text content is `title\n\nbody`; the Drive API's
  `files.export` / `files.update` read and overwrite it wholesale on each
  sync (no Docs API index-based diffing). The same update call renames the
  Drive file to match the title, which is what the dashboard lists.
- Typing debounces an autosave (~2.5s of inactivity) and mirrors content
  into `localStorage` (keyed per document) as an offline buffer. A failed
  save retries automatically, saves are serialized so a new document can
  never be created twice, and leaving the page flushes any pending edit.
- Drive is the only source of truth for documents — the KV store now holds
  just the Google refresh token. (The old `minimal-writer:masterDocId` key
  is unused; that Doc still shows up in the dashboard like any other.)
