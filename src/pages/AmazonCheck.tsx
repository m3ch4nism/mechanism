import { useAppStore } from "../stores/appStore";
import { Loader2, X } from "lucide-react";
import { useState } from "react";

export default function AmazonCheck() {
  const { accounts, amazonReport, amazonLoading, runAmazonCheck, error } = useAppStore();
  const [selected, setSelected] = useState(accounts[0]?.email || "");
  const [viewEmail, setViewEmail] = useState<any>(null);
  const [sectionFilter, setSectionFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");

  const handleRun = () => {
    setViewEmail(null);
    if (selected) runAmazonCheck(selected);
  };

  const sourceEmails: any[] = amazonReport?.sourceEmails || [];
  const sections = ["All", ...new Set(sourceEmails.map((e: any) => e.section))];
  let filtered = sectionFilter === "All" ? sourceEmails : sourceEmails.filter((e: any) => e.section === sectionFilter);
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter((e: any) =>
      (e.subject || "").toLowerCase().includes(q) ||
      (e.sender || "").toLowerCase().includes(q) ||
      (e.bodyText || "").toLowerCase().includes(q)
    );
  }
  const seen = new Set();
  const uniqueEmails = filtered.filter((e: any) => { if (seen.has(e.uid)) return false; seen.add(e.uid); return true; });

  return (
    <div className="page amazon-page-full">
      <div className="amazon-toolbar">
        <span className="toolbar-title">[AMAZON_CHECK]</span>
        <select value={selected} onChange={e => setSelected(e.target.value)}>
          {accounts.map(a => <option key={a.email} value={a.email}>{a.email}</option>)}
        </select>
        <button className="btn primary" onClick={handleRun} disabled={amazonLoading}>
          {amazonLoading ? <><Loader2 size={14} className="spin" /> scanning...</> : "> run"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}

      {amazonReport && (
        <div className="amazon-split">
          <div className="amazon-emails-panel">
            <div className="amazon-emails-header">
              <span>src ({uniqueEmails.length})</span>
              <select value={sectionFilter} onChange={e => setSectionFilter(e.target.value)} className="section-filter">
                {sections.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{padding: "4px 8px", borderBottom: "1px solid var(--border)"}}>
              <input
                placeholder="search emails..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{width: "100%", fontSize: 11}}
              />
            </div>
            <div className="amazon-emails-list">
              {uniqueEmails.map((e: any) => (
                <div key={e.uid} className="ae-item" onClick={() => setViewEmail(e)}>
                  <div className="ae-section-tag">{e.section}</div>
                  <div className="ae-from">{e.sender}</div>
                  <div className="ae-subject">{e.subject}</div>
                  <div className="ae-date">{e.date ? new Date(e.date).toLocaleDateString() : ""}</div>
                </div>
              ))}
              {!uniqueEmails.length && <div className="empty">no emails</div>}
            </div>
          </div>

          <div className="amazon-right-panel">
            <div className="amazon-report-scroll">
              <AmazonReport report={amazonReport} />
            </div>
          </div>
        </div>
      )}

      {viewEmail && (
        <div className="modal-overlay" onClick={() => setViewEmail(null)}>
          <div className="modal wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{viewEmail.subject}</h3>
              <button className="icon-btn" onClick={() => setViewEmail(null)}><X size={16} /></button>
            </div>
            <div className="meta">From: {viewEmail.sender} | {viewEmail.date ? new Date(viewEmail.date).toLocaleString() : ""}</div>
            <div className="email-body">
              {viewEmail.bodyHtml
                ? <iframe srcDoc={`<style>body{background:#fff;color:#000;font-family:sans-serif;font-size:14px}</style>${viewEmail.bodyHtml}`} sandbox="" style={{ width: "100%", height: 450, border: "1px solid #333", borderRadius: 4, background: "#fff" }} />
                : <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.9em" }}>{viewEmail.bodyText}</pre>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AmazonReport({ report }: { report: any }) {
  return (
    <div className="amazon-report">
      <div className="report-target">&gt; {report.email}</div>

      <Section title="[1] cards_on_file">
        {report.cards.length || report.cardsExpired.length ? (
          <>
            {report.cards.map((c: any, i: number) => (
              <div key={i} className="report-item">
                - {c.last4 === "????" ? c.type : `${c.type} **** ${c.last4}`}
                {c.expiry && ` exp ${c.expiry}`}
              </div>
            ))}
            {report.cardsExpired.length > 0 && (
              <>
                <div className="report-label">// expired:</div>
                {report.cardsExpired.map((c: any, i: number) => (
                  <div key={i} className="report-item dim">
                    - {c.last4 === "????" ? c.type : `${c.type} **** ${c.last4}`}
                    {c.expiry && ` exp ${c.expiry}`}
                  </div>
                ))}
              </>
            )}
            {report.expiryDates.length > 0 && (
              <>
                <div className="report-label">// exp_dates:</div>
                {report.expiryDates.map((d: string, i: number) => (
                  <div key={i} className="report-item">- {d}</div>
                ))}
              </>
            )}
          </>
        ) : <div className="report-empty">null</div>}
      </Section>

      <Section title="[2] last_orders">
        {report.orders.length ? report.orders.map((o: any, i: number) => (
          <div key={i} className="report-order">
            {o.items.length ? o.items.map((item: string, j: number) => (
              <div key={j} className="report-item">- {item}</div>
            )) : <div className="report-empty">(unrecognized)</div>}
          </div>
        )) : <div className="report-empty">null</div>}
      </Section>

      <Section title="[3] subscribe_save">
        {report.subscribeSave.length ? report.subscribeSave.map((s: string, i: number) => (
          <div key={i} className="report-item">- {s}</div>
        )) : <div className="report-empty">null</div>}
      </Section>

      <Section title="[4] digital_subs">
        {report.digitalSubs.length ? report.digitalSubs.map((s: string, i: number) => (
          <div key={i} className="report-item">- {s}</div>
        )) : <div className="report-empty">null</div>}
      </Section>

      <Section title="[5] account_name">
        {report.accountName
          ? <div className="report-item highlight">{report.accountName}</div>
          : <div className="report-empty">null</div>}
      </Section>

      <Section title="[6] cart_interest">
        {report.cartInterest.groups?.length > 0 && (
          <>
            <div className="report-label">// identified ({report.cartInterest.groups.length} categories):</div>
            {report.cartInterest.groups.map((g: any, i: number) => (
              <CollapsibleItem key={i} name={g.name} count={g.count} items={g.originals} />
            ))}
          </>
        )}
        {report.cartInterest.recommendations.length > 0 && !report.cartInterest.groups?.length && (
          <>
            <div className="report-label">// raw (no api key):</div>
            {report.cartInterest.recommendations.slice(0, 10).map((r: string, i: number) => (
              <div key={i} className="report-item">- {r}</div>
            ))}
          </>
        )}
        {!report.cartInterest.recommendations.length && !report.cartInterest.storeNews.length && (
          <div className="report-empty">null</div>
        )}
      </Section>

      {report.errors.length > 0 && (
        <Section title="[!] errors">
          {report.errors.map((e: string, i: number) => (
            <div key={i} className="report-item error">{e}</div>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="report-section">
      <h4>{title}</h4>
      {children}
    </div>
  );
}

function CollapsibleItem({ name, count, items }: { name: string; count: number; items: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="report-item highlight collapsible-header" onClick={() => setOpen(!open)} style={{cursor: "pointer"}}>
        <span style={{marginRight: 6, fontSize: 10, display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s"}}>{"\u25B6"}</span>
        {name}{count > 1 ? ` (x${count})` : ""}
      </div>
      {open && items.map((o: string, j: number) => (
        <div key={j} className="report-item dim" style={{paddingLeft: 24, fontSize: 11}}>- {o}</div>
      ))}
    </div>
  );
}
