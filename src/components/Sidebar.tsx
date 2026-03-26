import { useAppStore } from "../stores/appStore";
import { useConfirm } from "./ConfirmDialog";
import { Plus, Trash2, Settings, ShieldCheck, FolderOpen, Filter, Loader2 } from "lucide-react";
import { useState } from "react";

export default function Sidebar() {
  const { accounts, selectedAccount, folders, selectedFolder, selectAccount, selectFolder, removeAccount, connectedAccounts, failedAccounts } = useAppStore();
  const confirm = useConfirm();
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span style={{letterSpacing: "2px", textTransform: "lowercase"}}>mechanism</span>
        <span style={{fontSize: 9, color: "var(--text-dim)", marginLeft: "auto"}}>v{__APP_VERSION__}</span>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-title">
          <span>Accounts</span>
          <button className="icon-btn" onClick={() => setShowAdd(true)} title="Add account">
            <Plus size={14} />
          </button>
        </div>
        {accounts.map(acc => (
          <div
            key={acc.email}
            className={`sidebar-item ${selectedAccount === acc.email ? "active" : ""}`}
            onClick={() => { window.location.hash = "/"; selectAccount(acc.email); }}
          >
            <span style={{width: 6, height: 6, borderRadius: "50%", background: connectedAccounts.has(acc.email) ? "var(--success)" : failedAccounts.has(acc.email) ? "var(--error)" : "var(--text-dim)", flexShrink: 0}} />
            <span className="truncate">{acc.email}</span>
            <button
              className="icon-btn delete-btn"
              onClick={async (e) => { e.stopPropagation(); if (await confirm(`Remove ${acc.email}?`)) removeAccount(acc.email); }}
              title="Remove"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {accounts.length === 0 && <div className="sidebar-empty">No accounts</div>}
      </div>

      {selectedAccount && folders.length > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-section-title"><span>Folders</span></div>
          {folders.map(f => (
            <div
              key={f.path}
              className={`sidebar-item ${selectedFolder === f.path ? "active" : ""}`}
              onClick={() => { window.location.hash = "/"; selectFolder(f.path); }}
            >
              <FolderOpen size={14} />
              <span>{f.name}</span>
            </div>
          ))}
        </div>
      )}

      <div className="sidebar-footer">
        <a href="#/settings" className="sidebar-item">
          <Settings size={14} /><span>Settings</span>
        </a>
        <a href="#/presets" className="sidebar-item">
          <Filter size={14} /><span>Search Presets</span>
        </a>
        {selectedAccount && (
          <a href="#/amazon" className="sidebar-item">
            <ShieldCheck size={14} /><span>Amazon Check</span>
          </a>
        )}
      </div>

      {showAdd && <AddAccountModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}

function AddAccountModal({ onClose }: { onClose: () => void }) {
  const { addAccount, proxy } = useAppStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("993");
  const [ssl, setSsl] = useState(true);
  const [imapUser, setImapUser] = useState("");
  const [error, setError] = useState("");
  const [validating, setValidating] = useState(false);

  const handleSubmit = async () => {
    if (!proxy) { setError("Set up proxy in Settings before adding accounts"); return; }
    if (!email || !password) { setError("Email and password required"); return; }
    let h = host, p = parseInt(port);
    if (!h) {
      const domain = email.split("@")[1];
      try {
        const settings = await import("../lib/sidecar").then(m => m.call("getImapSettings", { email }));
        if (settings) { h = settings.host; p = settings.port; }
        else { setError(`Unknown domain: ${domain}. Enter IMAP settings manually.`); return; }
      } catch { setError("Failed to get IMAP settings"); return; }
    }
    // Validate connection before adding
    setValidating(true);
    setError("");
    try {
      const sidecar = await import("../lib/sidecar");
      await sidecar.call("connect", { email, password, host: h, port: p, secure: ssl, imapUser: imapUser || null });
      await sidecar.call("disconnect", { email });
    } catch (e: any) {
      setValidating(false);
      setError(`Connection failed: ${e.message}`);
      return;
    }
    setValidating(false);
    const ok = await addAccount(email, password, h, p, ssl, imapUser || undefined);
    if (ok) onClose();
    else setError("Account already exists");
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Add Account</h3>
        {!proxy && <div className="error">Proxy not configured. Go to Settings first.</div>}
        <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
        <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        <input placeholder="IMAP host (auto-detect)" value={host} onChange={e => setHost(e.target.value)} />
        <input placeholder="IMAP username (optional, defaults to email)" value={imapUser} onChange={e => setImapUser(e.target.value)} />
        <div className="row">
          <input placeholder="Port" value={port} onChange={e => setPort(e.target.value)} style={{ width: 80 }} />
          <label><input type="checkbox" checked={ssl} onChange={e => setSsl(e.target.checked)} /> SSL</label>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="row">
          <button className="btn primary" onClick={handleSubmit} disabled={validating}>
            {validating ? <><Loader2 size={14} className="spin" /> checking...</> : "Add"}
          </button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
