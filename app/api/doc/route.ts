import { NextRequest, NextResponse } from "next/server";
import {
  composeContent,
  createDoc,
  getAuthenticatedClient,
  parseContent,
  readDocText,
  writeDocText,
} from "@/lib/google";
import { getMasterDocId, setMasterDocId } from "@/lib/kv";

function todayTitle(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET() {
  const auth = await getAuthenticatedClient();
  if (!auth) {
    return NextResponse.json({ authenticated: false });
  }

  const folderId = process.env.DRIVE_FOLDER_ID;
  if (!folderId) {
    return NextResponse.json(
      { error: "DRIVE_FOLDER_ID is not configured" },
      { status: 500 }
    );
  }

  let docId = await getMasterDocId();
  let title = "";
  let body = "";

  if (!docId) {
    docId = await createDoc(auth, folderId, todayTitle());
    await setMasterDocId(docId);
  } else {
    try {
      const text = await readDocText(auth, docId);
      ({ title, body } = parseContent(text));
    } catch (err) {
      console.error("Failed to read master doc, it may have been deleted", err);
    }
  }

  return NextResponse.json({ authenticated: true, docId, title, body });
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedClient();
  if (!auth) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const { docId, title, body } = await request.json();
  if (!docId || typeof docId !== "string") {
    return NextResponse.json({ error: "docId is required" }, { status: 400 });
  }

  await writeDocText(
    auth,
    docId,
    composeContent(title ?? "", body ?? "")
  );

  return NextResponse.json({ ok: true });
}
