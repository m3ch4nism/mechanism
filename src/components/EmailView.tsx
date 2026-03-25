import { useAppStore } from "../stores/appStore";
import { ArrowLeft } from "lucide-react";

export default function EmailView() {
  const { selectedEmail, selectEmail } = useAppStore();

  if (!selectedEmail) {
    return <div className="email-view empty">Select an email to read</div>;
  }

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
