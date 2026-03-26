import { useAppStore } from "../stores/appStore";
import { Loader2, X, Copy, Download, FileText } from "lucide-react";
import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

function reportToText(r: any): string {
  const lines: string[] = [];
  lines.push(`=== AMAZON CHECK: ${r.email} ===`);
  lines.push(`Date: ${new Date().toISOString().slice(0, 19)}`);
  lines.push("");

  lines.push("[1] CARDS ON FILE");
  if (r.cards.length) r.cards.forEach((c: any) => lines.push(`  - ${c.last4 === "????" ? c.type : `${c.type} **** ${c.last4}`}${c.expiry ? ` exp ${c.expiry}` : ""}`));
  if (r.cardsExpired.length) { lines.push("  // expired:"); r.cardsExpired.forEach((c: any) => lines.push(`  - ${c.type} **** ${c.last4}${c.expiry ? ` exp ${c.expiry}` : ""}`)); }
  if (r.expiryDates.length) { lines.push("  // exp_dates:"); r.expiryDates.forEach((d: string) => lines.push(`  - ${d}`)); }
  if (!r.cards.length && !r.cardsExpired.length) lines.push("  null");

  lines.push("\n[2] LAST ORDERS");
  if (r.orders.length) r.orders.forEach((o: any) => lines.push(`  - ${o.date ? `[${o.date}] ` : ""}${o.items?.join(", ") || "unknown"}`));
  else lines.push("  null");

  lines.push("\n[3] SUBSCRIBE & SAVE");
  if (r.subscribeSave.length) r.subscribeSave.forEach((s: string) => lines.push(`  - ${s}`));
  else lines.push("  null");

  lines.push("\n[4] DIGITAL SUBSCRIPTIONS");
  if (r.digitalSubs.length) r.digitalSubs.forEach((s: string) => lines.push(`  - ${s}`));
  else lines.push("  null");

  lines.push("\n[5] ACCOUNT NAME");
  lines.push(`  ${r.accountName || "null"}`);

  lines.push("\n[6] CART INTEREST");
  const groups = r.cartInterest?.groups || [];
  if (groups.length) {
    groups.forEach((g: any) => {
      lines.push(`  - ${g.name}${g.count > 1 ? ` (x${g.count})` : ""}`);
    });
  } else if (r.cartInterest?.recommendations?.length) {
    r.cartInterest.recommendations.slice(0, 10).forEach((p: string) => lines.push(`  - ${p}`));
  } else lines.push("  null");

  if (r.errors.length) { lines.push("\n[!] ERRORS"); r.errors.forEach((e: string) => lines.push(`  - ${e}`)); }
  return lines.join("\n");
}

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
        {amazonReport && (
          <>
            <button className="btn" onClick={() => { navigator.clipboard.writeText(reportToText(amazonReport)); }} title="Copy report">
              <Copy size={14} /> copy
            </button>
            <button className="btn" onClick={async () => {
              const path = await save({
                defaultPath: `${amazonReport.email}-${new Date().toISOString().slice(0, 10)}.txt`,
                filters: [{ name: "Text", extensions: ["txt"] }],
              });
              if (path) await writeTextFile(path, reportToText(amazonReport));
            }} title="Export report">
              <Download size={14} /> .txt
            </button>
            <button className="btn" onClick={async () => {
              const src = amazonReport.sourceEmails || [];
              if (!src.length) return;
              const lines = src.map((e: any) =>
                `[${e.section}] UID:${e.uid}\nFrom: ${e.sender}\nDate: ${e.date}\nSubject: ${e.subject}\n\n${e.bodyText || "(no text)"}\n${"=".repeat(80)}`
              );
              const path = await save({
                defaultPath: `${amazonReport.email}-raw-${new Date().toISOString().slice(0, 10)}.txt`,
                filters: [{ name: "Text", extensions: ["txt"] }],
              });
              if (path) await writeTextFile(path, lines.join("\n\n"));
            }} title="Export raw source emails">
              <FileText size={14} /> raw
            </button>
          </>
        )}
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

      <CartInterestSection report={report} />

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

function CartInterestSection({ report }: { report: any }) {
  const [showAll, setShowAll] = useState(false);
  const groups = report.cartInterest.groups || [];
  // Filter: only show items where AI actually simplified the name (name shorter than original)
  const simplified = groups.filter((g: any) => g.originals.every((o: string) => g.name.length < o.length * 0.6));
  const unsimplified = groups.filter((g: any) => !simplified.includes(g));
  const display = showAll ? groups : simplified.slice(0, 20);
  const hasMore = !showAll && (simplified.length > 20 || unsimplified.length > 0);
  const noData = !report.cartInterest.recommendations.length && !report.cartInterest.storeNews.length;

  return (
    <Section title="[6] cart_interest">
      {display.length > 0 && (
        <>
          <div className="report-label">// identified ({simplified.length}):</div>
          {display.map((g: any, i: number) => (
            <CollapsibleItem key={i} name={g.name} count={g.count} items={g.originals} />
          ))}
          {hasMore && (
            <div className="report-item dim" style={{cursor: "pointer", marginTop: 4}} onClick={() => setShowAll(true)}>
              + {groups.length - display.length} more...
            </div>
          )}
          {showAll && unsimplified.length > 0 && (
            <div className="report-item dim" style={{cursor: "pointer", marginTop: 4}} onClick={() => setShowAll(false)}>
              - collapse
            </div>
          )}
        </>
      )}
      {report.cartInterest.recommendations.length > 0 && !groups.length && (
        <>
          <div className="report-label">// raw (no api key):</div>
          {report.cartInterest.recommendations.slice(0, 10).map((r: string, i: number) => (
            <div key={i} className="report-item">- {r}</div>
          ))}
        </>
      )}
      {noData && <div className="report-empty">null</div>}
    </Section>
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
