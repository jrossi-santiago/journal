import { NextRequest, NextResponse } from "next/server";
import {
  composeContent,
  createDoc,
  getAuthenticatedClient,
  getDriveFolderId,
  writeDocText,
} from "@/lib/google";

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }

    const folderId = getDriveFolderId();
    if (!folderId) {
      return NextResponse.json(
        { error: "DRIVE_FOLDER_ID is not configured" },
        { status: 500 }
      );
    }

    const { title, body } = await request.json().catch(() => ({ title: "", body: "" }));
    const docTitle = (title || "").trim() || new Date().toISOString().slice(0, 10);

    // Intentionally does NOT touch masterDocId in KV: this new doc is only
    // the active doc for the rest of the current browser session.
    const docId = await createDoc(auth, folderId, docTitle);
    if (title || body) {
      await writeDocText(auth, docId, composeContent(title ?? "", body ?? ""));
    }

    return NextResponse.json({ docId });
  } catch (err) {
    console.error("POST /api/doc/new failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown_error" },
      { status: 500 }
    );
  }
}
