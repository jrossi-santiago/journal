import { kv } from "@vercel/kv";

const REFRESH_TOKEN_KEY = "minimal-writer:refreshToken";

export async function getRefreshToken(): Promise<string | null> {
  return (await kv.get<string>(REFRESH_TOKEN_KEY)) ?? null;
}

export async function setRefreshToken(token: string): Promise<void> {
  await kv.set(REFRESH_TOKEN_KEY, token);
}
