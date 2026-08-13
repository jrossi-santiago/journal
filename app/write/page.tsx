"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

const AUTOSAVE_DEBOUNCE_MS = 2500;
const LOCAL_MIRROR_DEBOUNCE_MS = 300;
const RETRY_DELAY_MS = 5000;

type Status = "loading" | "unauthenticated" | "ready" | "error";

interface LocalBuffer {
  docId: string | null;
  title: string;
  body: string;
}

/** One buffer per document, so drafts of different docs can't overwrite each other. */
function bufferKey(docId: string | null): string {
  return `minimal-writer:buffer:${docId ?? "new"}`;
}

function loadLocalBuffer(docId: string | null): LocalBuffer | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(bufferKey(docId));
    return raw ? (JSON.parse(raw) as LocalBuffer) : null;
  } catch {
    return null;
  }
}

function saveLocalBuffer(buffer: LocalBuffer) {
  try {
    window.localStorage.setItem(bufferKey(buffer.docId), JSON.stringify(buffer));
  } catch {
    // localStorage unavailable (private browsing, quota, etc.) — not fatal.
  }
}

function clearLocalBuffer(docId: string | null) {
  try {
    window.localStorage.removeItem(bufferKey(docId));
  } catch {
    // ignore
  }
}

function composeContent(title: string, body: string): string {
  return `${title}\n\n${body}`;
}

function Writer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const docParam = searchParams.get("doc");

  const [status, setStatus] = useState<Status>("loading");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [docError, setDocError] = useState<string | null>(null);

  // Refs mirror the live values so the save routine always sends the newest
  // text, no matter which timer or retry ends up firing it.
  const titleRef = useRef("");
  const bodyRef = useRef("");
  const docIdRef = useRef<string | null>(docParam);
  const lastSavedRef = useRef<string | null>(null);
  // False until the document's content is on screen. Saving before that
  // would write the empty editor over whatever the file actually holds.
  const loadedRef = useRef(false);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  // Bumped every time a different doc is opened, so a save that resolves
  // after the switch can tell it belongs to the previous document.
  const sessionRef = useRef(0);
  // The id of a file this editor created itself. Putting it in the URL feeds
  // it back through the router as a "new" ?doc=, and reloading the document
  // at that moment would stomp on whatever was typed in the meantime.
  const adoptedIdRef = useRef<string | null>(null);

  // Indirection so the save routine can re-schedule itself (retries, queued
  // saves) without referring to its own binding before it exists.
  const performSaveRef = useRef<() => void>(() => {});

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localMirrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const performSave = useCallback(() => {
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }

    if (!loadedRef.current) return;

    const session = sessionRef.current;
    const targetDocId = docIdRef.current;
    const currentTitle = titleRef.current;
    const currentBody = bodyRef.current;
    const content = composeContent(currentTitle, currentBody);

    // An untouched blank page shouldn't litter Drive with an empty file —
    // the Drive file is created on the first real keystroke instead.
    if (!targetDocId && !currentTitle.trim() && !currentBody.trim()) return;
    if (content === lastSavedRef.current) return;

    // One save at a time. Without this, two saves of a not-yet-created doc
    // would each create their own Drive file.
    if (inFlightRef.current) {
      pendingRef.current = true;
      return;
    }
    inFlightRef.current = true;

    fetch("/api/doc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        docId: targetDocId,
        title: currentTitle,
        body: currentBody,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(`save failed: ${res.status} ${detail}`);
        }
        const data = await res.json();

        // If the user moved to another doc while this was in flight, the
        // result belongs to a document that is no longer on screen.
        if (sessionRef.current !== session) return;

        lastSavedRef.current = content;

        if (!targetDocId && data.docId) {
          // The document just got its Drive file. Adopt the id — every
          // later save amends this same file — and put it in the URL so a
          // reload keeps editing it rather than starting another one.
          clearLocalBuffer(null);
          docIdRef.current = data.docId;
          adoptedIdRef.current = data.docId;
          window.history.replaceState({}, "", `/write?doc=${data.docId}`);
        }

        if (!mountedRef.current) return;
        setSaveStatus("saved");
        if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
        savedFlashTimer.current = setTimeout(() => setSaveStatus("idle"), 1600);
      })
      .catch((err) => {
        console.error("[minimal-writer] autosave failed", err);
        if (sessionRef.current !== session) return;
        if (mountedRef.current) setSaveStatus("error");
        // Keep the local buffer as the safety net and try again shortly.
        retryTimer.current = setTimeout(() => performSaveRef.current(), RETRY_DELAY_MS);
      })
      .finally(() => {
        inFlightRef.current = false;
        if (pendingRef.current) {
          pendingRef.current = false;
          if (sessionRef.current === session) performSaveRef.current();
        }
      });
  }, []);

  useEffect(() => {
    performSaveRef.current = performSave;
  }, [performSave]);

  // Load the requested doc — or start a blank one when there's no ?doc=.
  useEffect(() => {
    let cancelled = false;

    // The document this editor just created is already on screen — the URL
    // only caught up afterwards, so there is nothing to load.
    const isSelfCreated = docParam !== null && docParam === adoptedIdRef.current;

    if (!isSelfCreated) {
      sessionRef.current += 1;
      docIdRef.current = docParam;
      adoptedIdRef.current = null;
      loadedRef.current = false;
      void load();
    }

    async function load() {
      setStatus("loading");
      setDocError(null);

      try {
        const res = await fetch(
          docParam ? `/api/doc?id=${encodeURIComponent(docParam)}` : "/api/doc"
        );
        const data = await res.json();
        if (cancelled) return;

        if (!res.ok) {
          setDocError(data.error ?? "unknown_error");
          setStatus("error");
          return;
        }
        if (!data.authenticated) {
          setStatus("unauthenticated");
          return;
        }

        const loadedTitle = data.title ?? "";
        const loadedBody = data.body ?? "";
        titleRef.current = loadedTitle;
        bodyRef.current = loadedBody;
        lastSavedRef.current = docParam
          ? composeContent(loadedTitle, loadedBody)
          : null;
        setTitle(loadedTitle);
        setBody(loadedBody);
        loadedRef.current = true;
        setStatus("ready");
      } catch {
        if (cancelled) return;
        // Network failure — fall back to whatever was last buffered locally
        // for this doc so the user can keep writing offline.
        const buffer = loadLocalBuffer(docParam);
        const bufferedTitle = buffer?.title ?? "";
        const bufferedBody = buffer?.body ?? "";
        titleRef.current = bufferedTitle;
        bodyRef.current = bufferedBody;
        lastSavedRef.current = null;
        setTitle(bufferedTitle);
        setBody(bufferedBody);
        loadedRef.current = true;
        setStatus("ready");
      }
    }

    return () => {
      cancelled = true;
      // Leaving this doc (back to the dashboard, or on to a new page):
      // flush anything the debounce hasn't written yet.
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      performSave();
    };
  }, [docParam, performSave]);

  // Mirror to localStorage (lightly debounced) and schedule the debounced
  // save to Drive whenever the title or body changes.
  useEffect(() => {
    if (status !== "ready") return;

    titleRef.current = title;
    bodyRef.current = body;

    if (localMirrorTimer.current) clearTimeout(localMirrorTimer.current);
    localMirrorTimer.current = setTimeout(() => {
      saveLocalBuffer({ docId: docIdRef.current, title, body });
    }, LOCAL_MIRROR_DEBOUNCE_MS);

    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(performSave, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      if (localMirrorTimer.current) clearTimeout(localMirrorTimer.current);
    };
  }, [title, body, status, performSave]);

  // A closing tab shouldn't take the last few seconds of writing with it.
  useEffect(() => {
    const flush = () => performSave();
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [performSave]);

  const handleNewDoc = useCallback(() => {
    router.push("/write");
  }, [router]);

  if (status === "loading") {
    return <div style={{ minHeight: "100vh", background: "#fff" }} />;
  }

  if (status === "unauthenticated") {
    return (
      <Centered>
        <p style={{ fontSize: 15, color: "#1a1a1a" }}>
          Your Google Drive connection has expired.
        </p>
        <a href="/api/auth" style={buttonStyle}>
          Reconnect Google Drive
        </a>
      </Centered>
    );
  }

  if (status === "error") {
    return (
      <Centered>
        <p style={{ fontSize: 15, color: "#1a1a1a", maxWidth: 420, textAlign: "center" }}>
          Couldn&apos;t open that document.
        </p>
        {docError && (
          <p style={{ fontSize: 13, color: "#a33", maxWidth: 420, textAlign: "center" }}>
            {docError}
          </p>
        )}
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => window.location.reload()} style={buttonStyle}>
            Retry
          </button>
          <Link href="/" style={buttonStyle}>
            Back to documents
          </Link>
        </div>
      </Centered>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#fff",
        display: "flex",
        justifyContent: "center",
        padding: "8vh 24px 10vh",
      }}
    >
      <Link href="/" className="back-link" aria-label="Back to documents">
        Documents
      </Link>

      <div style={{ width: "100%", maxWidth: 680 }}>
        <div
          className="title-row"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 28,
          }}
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              fontSize: 30,
              fontWeight: 600,
              color: "#1a1a1a",
              background: "transparent",
              padding: 2,
            }}
          />
          <button
            onClick={handleNewDoc}
            title="Start a new document"
            aria-label="Start a new document"
            className="new-doc-button"
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              padding: 6,
              borderRadius: 999,
              color: "#9a9a9a",
              opacity: 0.4,
              transition: "opacity 150ms ease, color 150ms ease, background 150ms ease",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <path
                d="M10 4v12M4 10h12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder=""
          autoFocus={!docParam}
          style={{
            width: "100%",
            minHeight: "70vh",
            border: "none",
            outline: "none",
            resize: "none",
            fontSize: 18,
            lineHeight: 1.8,
            color: "#1a1a1a",
            background: "transparent",
          }}
        />
      </div>

      <div
        style={{
          position: "fixed",
          bottom: 20,
          right: 24,
          fontSize: 12,
          color: saveStatus === "error" ? "#b33" : "#b3b3b3",
          opacity: saveStatus === "idle" ? 0 : 1,
          transition: "opacity 500ms ease",
          pointerEvents: "none",
        }}
      >
        {saveStatus === "error" ? "Couldn't save — retrying…" : "Saved"}
      </div>

      <style jsx global>{`
        .back-link {
          position: fixed;
          top: 22px;
          left: 24px;
          font-size: 13px;
          color: #c4c4c4;
          text-decoration: none;
          transition: color 150ms ease;
        }
        .back-link:hover {
          color: #1a1a1a;
        }
        .title-row:hover .new-doc-button,
        .title-row:focus-within .new-doc-button {
          opacity: 1;
        }
        .new-doc-button:hover {
          background: #f3f3f3;
          color: #444;
        }
        textarea::placeholder,
        input::placeholder {
          color: #c9c9c9;
        }
      `}</style>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  fontSize: 14,
  color: "#1a1a1a",
  textDecoration: "none",
  background: "transparent",
  border: "1px solid #d8d8d8",
  borderRadius: 6,
  padding: "8px 16px",
  cursor: "pointer",
};

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        background: "#fff",
        padding: 24,
      }}
    >
      {children}
    </div>
  );
}

export default function WritePage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#fff" }} />}>
      <Writer />
    </Suspense>
  );
}
