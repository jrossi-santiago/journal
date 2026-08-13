import { google } from "googleapis";
import { getRefreshToken } from "./kv";

// Full Drive access is required (not drive.file) because the target folder
// is created by the user in the Drive UI, not by this app — drive.file only
// grants access to files/folders the app itself created or opened.
const SCOPES = ["https://www.googleapis.com/auth/drive"];

const DOC_MIME_TYPE = "application/vnd.google-apps.document";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function createOAuthClient() {
  return new google.auth.OAuth2(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    requireEnv("GOOGLE_REDIRECT_URI")
  );
}

export function getAuthUrl(): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
}

export async function exchangeCodeForTokens(code: string) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

/**
 * Returns an authenticated OAuth2 client, or null if we haven't
 * completed the OAuth flow yet (no refresh token stored in KV).
 * google-auth-library refreshes the access token automatically
 * using the refresh token whenever an API call needs it.
 */
export async function getAuthenticatedClient() {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;

  const client = createOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

function drive(auth: InstanceType<typeof google.auth.OAuth2>) {
  return google.drive({ version: "v3", auth });
}

export async function createDoc(
  auth: InstanceType<typeof google.auth.OAuth2>,
  folderId: string,
  title: string
): Promise<string> {
  const res = await drive(auth).files.create({
    requestBody: {
      name: title || "Untitled",
      mimeType: DOC_MIME_TYPE,
      parents: [folderId],
    },
    fields: "id",
  });
  const id = res.data.id;
  if (!id) throw new Error("Drive did not return an id for the new doc");
  return id;
}

export async function readDocText(
  auth: InstanceType<typeof google.auth.OAuth2>,
  docId: string
): Promise<string> {
  const res = await drive(auth).files.export(
    { fileId: docId, mimeType: "text/plain" },
    { responseType: "text" }
  );
  return (res.data as unknown as string) ?? "";
}

export async function writeDocText(
  auth: InstanceType<typeof google.auth.OAuth2>,
  docId: string,
  text: string
): Promise<void> {
  await drive(auth).files.update({
    fileId: docId,
    media: {
      mimeType: "text/plain",
      body: text,
    },
  });
}

/** Combines the title + body into the single plain-text blob stored in the Doc. */
export function composeContent(title: string, body: string): string {
  return `${title}\n\n${body}`;
}

/** Splits the Doc's plain-text content back into title + body. */
export function parseContent(text: string): { title: string; body: string } {
  const normalized = text.replace(/\r\n/g, "\n");
  const separatorIndex = normalized.indexOf("\n\n");
  if (separatorIndex === -1) {
    return { title: normalized.trim(), body: "" };
  }
  const title = normalized.slice(0, separatorIndex).trim();
  const body = normalized.slice(separatorIndex + 2).replace(/\n$/, "");
  return { title, body };
}
