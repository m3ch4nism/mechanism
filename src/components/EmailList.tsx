import { useAppStore } from "../stores/appStore";
import { RefreshCw, Search } from "lucide-react";
import { useState } from "react";

export default function EmailList() {
  const { emails, selectedEmail, selectEmail, loading, refreshEmails, selectedAccount } = useAppStore();
  const [search, setSearch] = useState("");

  if (!selectedAccount) {
    return <div className="email-list empty">Select an account</div>;
  }

  const filtered = search.trim()
    ? emails.filter(e => {
        const q = search.toLowerCase();
        return (e.subject?.toLowerCase().includes(q) || e.sender?.toLowerCase().includes(q) || e.bodyText?.toLowerCase().includes(q));
      })
    : emails;

  return (
    <div className="email-list">
      <div className="email-list-header">
        <span>{filtered.length}{search ? `/${emails.length}` : ""} emails</span>
        <button className="icon-btn" onClick={refreshEmails} disabled={loading} title="Refresh">
          <RefreshCw size={14} className={loading ? "spin" : ""} />
        </button>
      </div>
      <div style={{padding: "4px 8px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 4}}>
        <Search size={12} style={{color: "var(--text-dim)", flexShrink: 0}} />
        <input
          placeholder="search emails..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{width: "100%", fontSize: 11, border: "none", background: "transparent", color: "var(--text)", outline: "none"}}
        />
      </div>
      {loading && <div className="loading">Loading...</div>}
      <div className="email-list-items">
        {filtered.map(e => (
          <div
            key={e.uid}
            className={`email-item ${selectedEmail?.uid === e.uid ? "active" : ""} ${e.flags.includes("\\Seen") ? "read" : "unread"}`}
            onClick={() => selectEmail(e)}
          >
            <div className="email-item-sender">{e.sender.split("<")[0].trim() || e.sender}</div>
            <div className="email-item-subject">{e.subject}</div>
            <div className="email-item-date">{formatDate(e.date)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
