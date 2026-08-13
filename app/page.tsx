"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Status = "loading" | "unauthenticated" | "ready" | "error";

interface DocSummary {
  id: string;
  name: string;
  modifiedTime: string | null;
}

/** Short, quiet timestamps: "2:14 PM", "Yesterday", "Mar 4", "Mar 4, 2024". */
function formatModified(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDiff = Math.floor((startOfToday.getTime() - date.getTime()) / 86_400_000);

  if (date >= startOfToday) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (dayDiff < 1) return "Yesterday";
  if (dayDiff < 6) {
    return date.toLocaleDateString(undefined, { weekday: "long" });
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

export default function Dashboard() {
  const [status, setStatus] = useState<Status>("loading");
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const err = params.get("error");
      if (err) {
        setOauthError(err);
        window.history.replaceState({}, "", "/");
      }

      try {
        const res = await fetch("/api/docs");
        const data = await res.json();

        if (!res.ok) {
          // Authenticated with Google but something else failed server-side
          // (e.g. DRIVE_FOLDER_ID is misconfigured) — not a login problem.
          setError(data.error ?? "unknown_error");
          setStatus("error");
          return;
        }
        if (!data.authenticated) {
          setStatus("unauthenticated");
          return;
        }

        setDocs(data.docs ?? []);
        setStatus("ready");
      } catch {
        setError("network_error");
        setStatus("error");
      }
    })();
  }, []);

  if (status === "loading") {
    return <div style={{ minHeight: "100vh", background: "#fff" }} />;
  }

  if (status === "unauthenticated") {
    return (
      <Centered>
        <a href="/api/auth" style={{ ...buttonStyle, fontSize: 16, padding: "10px 20px" }}>
          Connect Google Drive
        </a>
        {oauthError && (
          <p style={{ fontSize: 13, color: "#a33", maxWidth: 360, textAlign: "center" }}>
            Something went wrong connecting to Google ({oauthError}). Please try again.
          </p>
        )}
      </Centered>
    );
  }

  if (status === "error") {
    return (
      <Centered>
        <p style={{ fontSize: 15, color: "#1a1a1a", maxWidth: 420, textAlign: "center" }}>
          Connected to Google, but couldn&apos;t list your documents.
        </p>
        {error && (
          <p style={{ fontSize: 13, color: "#a33", maxWidth: 420, textAlign: "center" }}>
            {error}
          </p>
        )}
        <p style={{ fontSize: 13, color: "#8a8a8a", maxWidth: 420, textAlign: "center" }}>
          This usually means either the configured Drive folder doesn&apos;t exist /
          isn&apos;t accessible to the signed-in Google account, or your stored
          Google authorization predates a change to the app&apos;s required Drive
          permissions and needs to be renewed.
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => window.location.reload()} style={buttonStyle}>
            Retry
          </button>
          <a href="/api/auth" style={buttonStyle}>
            Reconnect Google Drive
          </a>
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
      <div style={{ width: "100%", maxWidth: 680 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 36,
          }}
        >
          <h1 style={{ fontSize: 30, fontWeight: 600, color: "#1a1a1a", margin: 0 }}>
            Documents
          </h1>
          <Link href="/write" className="new-link">
            New
          </Link>
        </div>

        {docs.length === 0 ? (
          <p style={{ fontSize: 15, color: "#b3b3b3" }}>
            Nothing here yet.{" "}
            <Link href="/write" className="inline-link">
              Start writing
            </Link>
            .
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {docs.map((doc) => (
              <li key={doc.id}>
                <Link href={`/write?doc=${doc.id}`} className="doc-row">
                  <span className="doc-name">{doc.name || "Untitled"}</span>
                  <span className="doc-date">{formatModified(doc.modifiedTime)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <style jsx global>{`
        .new-link,
        .inline-link {
          font-size: 14px;
          color: #8a8a8a;
          text-decoration: none;
          transition: color 150ms ease;
        }
        .new-link:hover,
        .inline-link:hover {
          color: #1a1a1a;
        }
        .inline-link {
          text-decoration: underline;
          text-underline-offset: 3px;
        }
        .doc-row {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 20px;
          padding: 14px 12px;
          margin: 0 -12px;
          border-radius: 6px;
          text-decoration: none;
          color: inherit;
          border-bottom: 1px solid #f0f0f0;
          transition: background 150ms ease;
        }
        .doc-row:hover {
          background: #fafafa;
        }
        .doc-name {
          font-size: 17px;
          color: #1a1a1a;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .doc-date {
          font-size: 13px;
          color: #b3b3b3;
          flex-shrink: 0;
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
