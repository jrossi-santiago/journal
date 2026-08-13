import { NextResponse } from "next/server";
import { getAuthenticatedClient, getDriveFolderId, listDocs } from "@/lib/google";

export async function GET() {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) {
      return NextResponse.json({ authenticated: false, docs: [] });
    }

    const folderId = getDriveFolderId();
    if (!folderId) {
      return NextResponse.json(
        { error: "DRIVE_FOLDER_ID is not configured" },
        { status: 500 }
      );
    }

    const docs = await listDocs(auth, folderId);
    return NextResponse.json({ authenticated: true, docs });
  } catch (err) {
    console.error("GET /api/docs failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown_error" },
      { status: 500 }
    );
  }
}
