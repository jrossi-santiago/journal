import { kv } from "@vercel/kv";

const REFRESH_TOKEN_KEY = "minimal-writer:refreshToken";
const MASTER_DOC_ID_KEY = "minimal-writer:masterDocId";

export async function getRefreshToken(): Promise<string | null> {
  return (await kv.get<string>(REFRESH_TOKEN_KEY)) ?? null;
}

export async function setRefreshToken(token: string): Promise<void> {
  await kv.set(REFRESH_TOKEN_KEY, token);
}

export async function getMasterDocId(): Promise<string | null> {
  return (await kv.get<string>(MASTER_DOC_ID_KEY)) ?? null;
}

export async function setMasterDocId(docId: string): Promise<void> {
  await kv.set(MASTER_DOC_ID_KEY, docId);
}
