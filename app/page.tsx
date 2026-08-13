"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const LOCAL_STORAGE_KEY = "minimal-writer:buffer";
const AUTOSAVE_DEBOUNCE_MS = 2500;
const LOCAL_MIRROR_DEBOUNCE_MS = 300;
const RETRY_DELAY_MS = 5000;

type Status = "loading" | "unauthenticated" | "ready";

interface LocalBuffer {
  docId: string;
  title: string;
  body: string;
}

function loadLocalBuffer(): LocalBuffer | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LocalBuffer) : null;
  } catch {
    return null;
  }
}

function saveLocalBuffer(buffer: LocalBuffer) {
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(buffer));
  } catch {
    // localStorage unavailable (private browsing, quota, etc.) — not fatal.
  }
}

export default function Home() {
  const [status, setStatus] = useState<Status>("loading");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [docId, setDocId] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [newDocFlash, setNewDocFlash] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localMirrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const newDocFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load initial state on mount.
  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const err = params.get("error");
      if (err) {
        setOauthError(err);
        window.history.replaceState({}, "", "/");
      }

      try {
        const res = await fetch("/api/doc");
        const data = await res.json();

        if (!data.authenticated) {
          setStatus("unauthenticated");
          return;
        }

        setDocId(data.docId);
        setTitle(data.title ?? "");
        setBody(data.body ?? "");
        setStatus("ready");
      } catch {
        // Network failure on initial load — fall back to whatever we last
        // buffered locally so the user can keep writing offline.
        const buffer = loadLocalBuffer();
        if (buffer) {
          setDocId(buffer.docId);
          setTitle(buffer.title);
          setBody(buffer.body);
        }
        setStatus("ready");
      }
    })();
  }, []);

  type SaveFn = (docId: string, title: string, body: string) => void;
  const performSaveRef = useRef<SaveFn>(() => {});

  const performSave = useCallback<SaveFn>(
    (targetDocId, currentTitle, currentBody) => {
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }

      fetch("/api/doc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docId: targetDocId,
          title: currentTitle,
          body: currentBody,
        }),
      })
        .then((res) => {
          if (!res.ok) throw new Error("save failed");
          setSavedFlash(true);
          if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
          savedFlashTimer.current = setTimeout(() => setSavedFlash(false), 1600);
        })
        .catch(() => {
          // Keep the local buffer as the safety net and try again shortly.
          retryTimer.current = setTimeout(
            () => performSaveRef.current(targetDocId, currentTitle, currentBody),
            RETRY_DELAY_MS
          );
        });
    },
    []
  );

  useEffect(() => {
    performSaveRef.current = performSave;
  }, [performSave]);

  // Mirror to localStorage (lightly debounced) and schedule the debounced
  // autosave to Drive whenever the title or body changes.
  useEffect(() => {
    if (status !== "ready" || !docId) return;

    if (localMirrorTimer.current) clearTimeout(localMirrorTimer.current);
    localMirrorTimer.current = setTimeout(() => {
      saveLocalBuffer({ docId, title, body });
    }, LOCAL_MIRROR_DEBOUNCE_MS);

    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      performSave(docId, title, body);
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      if (localMirrorTimer.current) clearTimeout(localMirrorTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body, docId, status]);

  const handleNewDoc = useCallback(async () => {
    try {
      const res = await fetch("/api/doc/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      if (!res.ok) throw new Error("failed to create new doc");
      const data = await res.json();
      setDocId(data.docId);
      saveLocalBuffer({ docId: data.docId, title, body });
      setNewDocFlash(true);
      if (newDocFlashTimer.current) clearTimeout(newDocFlashTimer.current);
      newDocFlashTimer.current = setTimeout(() => setNewDocFlash(false), 2200);
    } catch {
      // Leave the user on the current doc; they can try the button again.
    }
  }, [title, body]);

  if (status === "loading") {
    return <div style={{ minHeight: "100vh", background: "#fff" }} />;
  }

  if (status === "unauthenticated") {
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
        }}
      >
        <a
          href="/api/auth"
          style={{
            fontSize: 16,
            color: "#1a1a1a",
            textDecoration: "none",
            border: "1px solid #d8d8d8",
            borderRadius: 6,
            padding: "10px 20px",
            transition: "border-color 150ms ease",
          }}
        >
          Connect Google Drive
        </a>
        {oauthError && (
          <p style={{ fontSize: 13, color: "#a33", maxWidth: 360, textAlign: "center" }}>
            Something went wrong connecting to Google ({oauthError}). Please try again.
          </p>
        )}
      </div>
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
            title="Start a new document for this session"
            aria-label="Start a new document for this session"
            className="new-doc-button"
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              padding: 6,
              borderRadius: 999,
              color: "#9a9a9a",
              opacity: 0,
              transition: "opacity 150ms ease, color 150ms ease, background 150ms ease",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <path
                d="M4 10.5 8 14.5 16 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder=""
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
          color: "#b3b3b3",
          opacity: savedFlash ? 1 : 0,
          transition: "opacity 500ms ease",
          pointerEvents: "none",
        }}
      >
        Saved
      </div>

      <div
        style={{
          position: "fixed",
          bottom: 20,
          left: "50%",
          transform: "translateX(-50%)",
          fontSize: 13,
          color: "#8a8a8a",
          opacity: newDocFlash ? 1 : 0,
          transition: "opacity 400ms ease",
          pointerEvents: "none",
        }}
      >
        New document started
      </div>

      <style jsx global>{`
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
