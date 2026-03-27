import { useAppStore } from "../stores/appStore";
import { call } from "../lib/sidecar";
import { Settings, Globe, Loader2, Wifi, Brain, Palette } from "lucide-react";
import { useState, useEffect } from "react";

export default function SettingsPage() {
  const { proxy, setProxy } = useAppStore();
  const [proxyInput, setProxyInput] = useState(proxy || "");
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "dark");
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ directIp: string; proxyIp: string; working: boolean } | null>(null);
  const [testError, setTestError] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiSaved, setGeminiSaved] = useState(false);

  useEffect(() => { call("getGeminiKey").then(k => { if (k) setGeminiKey(k); }); }, []);

  const handleSave = async () => {
    await setProxy(proxyInput || null);
    setSaved(true);
    setTestResult(null);
    setTestError("");
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setTestError("");
    try {
      const result = await call("testProxy", { proxy: proxyInput || undefined });
      setTestResult(result);
    } catch (e: any) {
      setTestError(e.message || "Proxy test failed");
    }
    setTesting(false);
  };

  return (
    <div className="page settings-page">
      <h2><Settings size={20} /> Settings</h2>

      <div className="settings-section">
        <h3><Globe size={16} /> Proxy</h3>
        <p className="hint">SOCKS5: user:pass@host:port | HTTP: http://user:pass@host:port</p>
        <div className="row">
          <input
            placeholder="user:pass@host:port or http://host:port"
            value={proxyInput}
            onChange={e => setProxyInput(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn primary" onClick={handleSave}>
            {saved ? "Saved!" : "Save"}
          </button>
          <button className="btn" onClick={handleTest} disabled={testing}>
            {testing ? <><Loader2 size={14} className="spin" /> Testing...</> : <><Wifi size={14} /> Test</>}
          </button>
        </div>

        {testResult && (
          <div className={`proxy-test-result ${testResult.working ? "success" : "warning"}`}>
            <div>Your IP: <strong>{testResult.directIp}</strong></div>
            <div>Proxy IP: <strong>{testResult.proxyIp}</strong></div>
            <div>{testResult.working ? "Proxy works! IP changed." : "Warning: IP same as direct. Proxy might not be working."}</div>
          </div>
        )}

        {testError && <div className="proxy-test-result error">{testError}</div>}
      </div>

      <div className="settings-section">
        <h3><Brain size={16} /> Groq AI</h3>
        <p className="hint">Free API key from console.groq.com -- used in Amazon Check to identify products</p>
        <div className="row">
          <input
            placeholder="Groq API key (gsk_...)"
            type="password"
            value={geminiKey}
            onChange={e => setGeminiKey(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn primary" onClick={async () => {
            await call("setGeminiKey", { key: geminiKey || null });
            setGeminiSaved(true);
            setTimeout(() => setGeminiSaved(false), 2000);
          }}>
            {geminiSaved ? "Saved!" : "Save"}
          </button>
        </div>
        <p className="hint" style={{marginTop: 4}}>Without key: raw product names. With key: AI extracts short names (Fishing Rod, Headphones, etc.). Free, no billing.</p>
      </div>

      <div className="settings-section">
        <h3><Palette size={16} /> Theme</h3>
        <div className="row">
          {(["dark", "light"] as const).map(t => (
            <button key={t} className={`btn ${theme === t ? "primary" : ""}`} onClick={() => {
              setTheme(t);
              localStorage.setItem("theme", t);
              document.documentElement.setAttribute("data-theme", t);
            }}>{t}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
