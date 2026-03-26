import { useAppStore } from "../stores/appStore";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useConfirm } from "./ConfirmDialog";
import { useEffect, useRef } from "react";

export default function EmailView() {
  const { selectedEmail, selectEmail, deleteEmails } = useAppStore();
  const confirm = useConfirm();
  const deletingRef = useRef(false);

  const quickDelete = async () => {
    if (!selectedEmail || deletingRef.current) return;
    deletingRef.current = true;
    try {
      const uid = selectedEmail.uid;
      selectEmail(null);
      await deleteEmails([uid]);
    } finally {
      deletingRef.current = false;
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Delete" && selectedEmail && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        quickDelete();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  if (!selectedEmail) {
    return <div className="email-view empty">Select an email to read</div>;
  }

  const handleDelete = async () => {
    if (await confirm("Delete this email permanently?")) {
      await deleteEmails([selectedEmail.uid]);
      selectEmail(null);
    }
  };

  return (
    <div className="email-view">
      <div className="email-view-header">
        <button className="icon-btn" onClick={() => selectEmail(null)}>
          <ArrowLeft size={16} />
        </button>
        <div className="email-view-meta">
          <h2>{selectedEmail.subject}</h2>
          <div className="email-view-info">
            <span className="sender">{selectedEmail.sender}</span>
            <span className="date">{new Date(selectedEmail.date).toLocaleString()}</span>
          </div>
        </div>
        <button className="icon-btn" onClick={handleDelete} title="Delete email" style={{marginLeft: "auto", color: "var(--error)"}}>
          <Trash2 size={16} />
        </button>
      </div>
      <div className="email-view-body">
        {selectedEmail.bodyHtml ? (
          <iframe
            srcDoc={`<style>body{background:#fff;color:#000;font-family:sans-serif;font-size:14px}</style>${selectedEmail.bodyHtml}`}
            sandbox="allow-same-origin"
            title="email"
            style={{ width: "100%", height: "100%", border: "none", background: "#fff" }}
          />
        ) : (
          <pre className="email-text">{selectedEmail.bodyText}</pre>
        )}
      </div>
    </div>
  );
}
