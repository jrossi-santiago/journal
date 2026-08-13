import { NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/google";

export async function GET() {
  return NextResponse.redirect(getAuthUrl());
}
