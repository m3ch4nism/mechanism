import { useAppStore, type SearchPreset, type Email } from "../stores/appStore";
import { useConfirm } from "../components/ConfirmDialog";
import { Filter, Plus, Trash2, Play, Loader2, Download, ArrowLeft } from "lucide-react";
import { useState } from "react";

export default function PresetsPage() {
  const { accounts, presets, presetResults, presetLoading, removePreset, runPreset, error } = useAppStore();
  const confirm = useConfirm();
  const [showAdd, setShowAdd] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(accounts[0]?.email || "");
  const [activePreset, setActivePreset] = useState<SearchPreset | null>(null);

  const handleRun = (preset: SearchPreset) => {
    setActivePreset(preset);
    if (selectedAccount) runPreset(selectedAccount, preset);
  };

  // If we have results, show email client view
  if (activePreset && presetResults !== null && !presetLoading) {
    return <PresetMailView
      preset={activePreset}
      emails={presetResults}
      onBack={() => setActivePreset(null)}
    />;
  }

  return (
    <div className="page presets-page">
      <h2><Filter size={20} /> Search Presets</h2>

      <div className="row" style={{ marginBottom: 12 }}>
        <select value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)}>
          {accounts.map(a => <option key={a.email} value={a.email}>{a.email}</option>)}
        </select>
        <button className="btn" onClick={() => setShowAdd(true)}>
          <Plus size={14} /> New Preset
        </button>
      </div>

      {presets.length === 0 && <div className="empty">No presets. Create one to search by sender/subject/text.</div>}

      {presetLoading && <div className="loading-bar"><Loader2 size={16} className="spin" /> Searching...</div>}

      <div className="preset-list">
        {presets.map(p => (
          <div key={p.id} className="preset-card">
            <div className="preset-info">
              <div className="preset-name">{p.name}</div>
              <div className="preset-filters">
                {p.sender && <span className="tag">From: {p.sender}</span>}
                {p.subject && <span className="tag">Subj: {p.subject}</span>}
                {p.bodyText && <span className="tag">Text: {p.bodyText}</span>}
                <span className="tag">{p.folder} / {p.daysBack}d</span>
              </div>
            </div>
            <div className="preset-actions">
              <button className="btn primary" onClick={() => handleRun(p)} disabled={presetLoading || !selectedAccount}>
                <Play size={14} />
              </button>
              <button className="btn danger" onClick={async () => { if (await confirm(`Delete preset "${p.name}"?`)) removePreset(p.id); }}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {error && <div className="error">{error}</div>}
      {showAdd && <AddPresetModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}

function PresetMailView({ preset, emails, onBack }: { preset: SearchPreset; emails: Email[]; onBack: () => void }) {
  const [selected, setSelected] = useState<Email | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredEmails = searchQuery.trim()
    ? emails.filter(e => {
        const q = searchQuery.toLowerCase();
        return (e.subject?.toLowerCase().includes(q) || e.sender?.toLowerCase().includes(q) || e.bodyText?.toLowerCase().includes(q));
      })
    : emails;

  const handleExport = () => {
    if (!filteredEmails.length) return;
    const lines = filteredEmails.map(e =>
      `From: ${e.sender}\nDate: ${e.date}\nSubject: ${e.subject}\n\n${e.bodyText || "(no text)"}\n${"=".repeat(60)}`
    );
    const blob = new Blob([lines.join("\n\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${preset.name}-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="preset-mail-view">
      <div className="preset-mail-header">
        <button className="btn" onClick={onBack}><ArrowLeft size={14} /> Back</button>
        <h3>{preset.name} ({filteredEmails.length}/{emails.length})</h3>
        {emails.length > 0 && (
          <button className="btn" onClick={handleExport}><Download size={14} /> Export</button>
        )}
      </div>

      <div className="preset-mail-layout">
        <div className="preset-mail-list">
          <div style={{padding: "4px 8px", borderBottom: "1px solid var(--border)"}}>
            <input
              placeholder="search emails..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{width: "100%", fontSize: 11}}
            />
          </div>
          {filteredEmails.length === 0 && <div className="empty">No emails found</div>}
          {filteredEmails.map(e => (
            <div
              key={e.uid}
              className={`pm-item ${selected?.uid === e.uid ? "active" : ""}`}
              onClick={() => setSelected(e)}
            >
              <div className="pm-from">{e.sender}</div>
              <div className="pm-subject">{e.subject}</div>
              <div className="pm-date">{e.date ? new Date(e.date).toLocaleDateString() : ""}</div>
            </div>
          ))}
        </div>

        <div className="preset-mail-reader">
          {selected ? (
            <>
              <div className="pm-reader-header">
                <div className="pm-reader-subject">{selected.subject}</div>
                <div className="pm-reader-meta">
                  From: {selected.sender} | {selected.date ? new Date(selected.date).toLocaleString() : ""}
                </div>
              </div>
              <div className="pm-reader-body">
                {selected.bodyHtml
                  ? <iframe srcDoc={`<style>body{background:#fff;color:#000;font-family:sans-serif;font-size:14px}</style>${selected.bodyHtml}`} sandbox="" style={{background:"#fff"}} />
                  : <pre>{selected.bodyText}</pre>}
              </div>
            </>
          ) : (
            <div className="pm-reader-empty">Select an email to read</div>
          )}
        </div>
      </div>
    </div>
  );
}

function AddPresetModal({ onClose }: { onClose: () => void }) {
  const { addPreset } = useAppStore();
  const [name, setName] = useState("");
  const [sender, setSender] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [folder, setFolder] = useState("INBOX");
  const [daysBack, setDaysBack] = useState("30");

  const handleSubmit = async () => {
    if (!name.trim()) return;
    await addPreset({ name: name.trim(), sender: sender || null, subject: subject || null, bodyText: bodyText || null, folder, daysBack: parseInt(daysBack) || 30 });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>New Search Preset</h3>
        <input placeholder="Preset name" value={name} onChange={e => setName(e.target.value)} />
        <input placeholder="Sender email includes..." value={sender} onChange={e => setSender(e.target.value)} />
        <input placeholder="Subject contains..." value={subject} onChange={e => setSubject(e.target.value)} />
        <input placeholder="Body text contains..." value={bodyText} onChange={e => setBodyText(e.target.value)} />
        <div className="row">
          <input placeholder="Folder" value={folder} onChange={e => setFolder(e.target.value)} style={{ flex: 1 }} />
          <input placeholder="Days back" value={daysBack} onChange={e => setDaysBack(e.target.value)} style={{ width: 80 }} />
        </div>
        <div className="hint">At least one filter (sender, subject, or body) required.</div>
        <div className="row">
          <button className="btn primary" onClick={handleSubmit} disabled={!name.trim() || (!sender && !subject && !bodyText)}>Create</button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
