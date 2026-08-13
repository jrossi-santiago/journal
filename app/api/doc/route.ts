import { NextRequest, NextResponse } from "next/server";
import {
  composeContent,
  createDoc,
  getAuthenticatedClient,
  getDriveFolderId,
  parseContent,
  readDocText,
  writeDocText,
} from "@/lib/google";

/** Drive file name for a doc whose title field is still empty. */
function fallbackTitle(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Reads one existing doc by id. */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) {
      return NextResponse.json({ authenticated: false });
    }

    const docId = request.nextUrl.searchParams.get("id");
    if (!docId) {
      // No id means "a new, empty document". Nothing is created in Drive
      // until there's something to save.
      return NextResponse.json({
        authenticated: true,
        docId: null,
        title: "",
        body: "",
      });
    }

    const text = await readDocText(auth, docId);
    const { title, body } = parseContent(text);

    return NextResponse.json({ authenticated: true, docId, title, body });
  } catch (err) {
    console.error("GET /api/doc failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown_error" },
      { status: 500 }
    );
  }
}

/**
 * Saves a doc. With a `docId` it amends that existing Drive file; without
 * one it creates a brand new Drive file and returns its id, which the
 * writer then reuses for every subsequent save of that document.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }

    const { docId, title, body } = await request.json();
    const name = (title || "").trim() || fallbackTitle();
    const content = composeContent(title ?? "", body ?? "");

    if (docId && typeof docId === "string") {
      await writeDocText(auth, docId, content, name);
      return NextResponse.json({ docId, created: false });
    }

    const folderId = getDriveFolderId();
    if (!folderId) {
      return NextResponse.json(
        { error: "DRIVE_FOLDER_ID is not configured" },
        { status: 500 }
      );
    }

    const newDocId = await createDoc(auth, folderId, name);
    await writeDocText(auth, newDocId, content);

    return NextResponse.json({ docId: newDocId, created: true });
  } catch (err) {
    console.error("POST /api/doc failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown_error" },
      { status: 500 }
    );
  }
}
