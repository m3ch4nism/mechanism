import { useAppStore } from "../stores/appStore";
import { RefreshCw } from "lucide-react";

export default function EmailList() {
  const { emails, selectedEmail, selectEmail, loading, refreshEmails, selectedAccount } = useAppStore();

  if (!selectedAccount) {
    return <div className="email-list empty">Select an account</div>;
  }

  return (
    <div className="email-list">
      <div className="email-list-header">
        <span>{emails.length} emails</span>
        <button className="icon-btn" onClick={refreshEmails} disabled={loading} title="Refresh">
          <RefreshCw size={14} className={loading ? "spin" : ""} />
        </button>
      </div>
      {loading && <div className="loading">Loading...</div>}
      <div className="email-list-items">
        {emails.map(e => (
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
