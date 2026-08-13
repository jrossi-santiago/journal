import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/google";
import { setRefreshToken } from "@/lib/kv";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/?error=${encodeURIComponent(error)}`, request.url)
    );
  }
  if (!code) {
    return NextResponse.redirect(
      new URL("/?error=missing_code", request.url)
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // Happens if the user has already granted consent before and Google
      // doesn't re-issue a refresh token. Ask them to revoke access at
      // https://myaccount.google.com/permissions and try again.
      return NextResponse.redirect(
        new URL("/?error=no_refresh_token", request.url)
      );
    }
    await setRefreshToken(tokens.refresh_token);
  } catch (err) {
    console.error("OAuth callback failed", err);
    return NextResponse.redirect(
      new URL("/?error=token_exchange_failed", request.url)
    );
  }

  return NextResponse.redirect(new URL("/", request.url));
}
