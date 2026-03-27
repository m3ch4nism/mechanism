import { useEffect, useState } from "react";
import { startSidecar, checkNodeInstalled, installNode, onPush } from "./lib/sidecar";
import { useAppStore } from "./stores/appStore";
import { ConfirmProvider } from "./components/ConfirmDialog";
import { check } from "@tauri-apps/plugin-updater";
import Sidebar from "./components/Sidebar";
import Inbox from "./pages/Inbox";
import AmazonCheck from "./pages/AmazonCheck";
import SettingsPage from "./pages/SettingsPage";
import PresetsPage from "./pages/PresetsPage";
import "./App.css";

export default function App() {
  const init = useAppStore(s => s.init);
  const error = useAppStore(s => s.error);
  const [ready, setReady] = useState(false);
  const [startError, setStartError] = useState("");
  const [needsNode, setNeedsNode] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installStatus, setInstallStatus] = useState("");
  const [page, setPage] = useState("inbox");
  const [updateAvailable, setUpdateAvailable] = useState<{ version: string; download: () => Promise<void> } | null>(null);
  const [updating, setUpdating] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);

  const CHANGELOG: Record<string, string> = {
    "0.2.4": "• Исправлена стабильность Sidecar (фикс EPIPE и Connection not available)\n• Повышена надёжность IMAP-соединений при разрывах",
    "0.2.3": "• Добавлен плавающий стикер (блокнот) во вкладке Amazon Check. Текст сохраняется при смене вкладок и сбрасывается при перезапуске программы.\n• Теперь при переключении вкладок результат Amazon Check автоматически загружается из кеша (больше не нужно сканировать заново!)",
    "0.2.2": "• Фикс утечки памяти (OOM) и починена загрузка писем\n• Переименован API ключ Gemini в Groq для прозрачности",
    "0.2.1": "• Фикс: пресеты больше не спамят \"Connection not available\" при разрыве соединения\n• Авто-переподключение IMAP при таймауте во время работы пресета\n• Очистка мёртвых соединений из кэша",
    "0.2.0": "• Amazon Check ищет по ВСЕМ папкам (не только INBOX)\n• Фикс имени аккаунта (полное имя вместо первого слова)\n• Дедупликация писем по Message-ID",
    "0.1.9": "• Добавлено поле IMAP Username (для провайдеров типа Comcast/TWC)\n• Удаление писем через IMAP (кнопка + клавиша Delete)\n• Статус подключения: зелёный/красный/серый индикатор\n• Авто-проверка всех аккаунтов при запуске\n• Исправлен анализ Amazon: карты, подписки S&S, имя аккаунта, цифровые подписки\n• Исправлены крашы ECONNRESET/Socket timeout",
  };

  useEffect(() => {
    const t = localStorage.getItem("theme");
    if (t) document.documentElement.setAttribute("data-theme", t);
    // Show changelog after update
    const lastVersion = localStorage.getItem("lastSeenVersion");
    const currentVersion = __APP_VERSION__;
    if (lastVersion && lastVersion !== currentVersion && CHANGELOG[currentVersion]) {
      setShowChangelog(true);
    }
    localStorage.setItem("lastSeenVersion", currentVersion);
  }, []);

  const boot = async () => {
    try {
      setStartError("");
      setInstallStatus("checking node.js...");
      const hasNode = await checkNodeInstalled();
      if (!hasNode) {
        setNeedsNode(true);
        setInstallStatus("");
        return;
      }
      setInstallStatus("starting sidecar...");
      await startSidecar();
      await init();
      setReady(true);
    } catch (e: any) {
      setStartError(e.message || "Failed to start");
    }
  };

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    const unsub = onPush((data) => {
      if (data.type === "newMail") {
        try {
          new Notification(data.sender || data.email, { body: data.subject, icon: undefined });
        } catch {}
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    boot();
    check().then(update => {
      console.log("updater check result:", update);
      if (update) {
        setUpdateAvailable({
          version: update.version,
          download: async () => {
            setUpdating(true);
            await update.downloadAndInstall();
          },
        });
      }
    }).catch(e => {
      console.error("updater error:", e);
    });
  }, []);

  useEffect(() => {
    const onHash = () => {
      const hash = window.location.hash.slice(1) || "/";
      if (hash === "/amazon") setPage("amazon");
      else if (hash === "/settings") setPage("settings");
      else if (hash === "/presets") setPage("presets");
      else setPage("inbox");
    };
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const handleInstallNode = async () => {
    setInstalling(true);
    setInstallStatus("downloading node.js v22 LTS...");
    try {
      await installNode();
      setInstallStatus("installed! restarting...");
      setNeedsNode(false);
      await boot();
    } catch (e: any) {
      setInstallStatus("install failed: " + e.message);
      setInstalling(false);
    }
  };

  if (needsNode) {
    return (
      <div className="loading-screen">
        <div className="setup-box">
          <div className="setup-title">mechanism</div>
          <div className="setup-msg">node.js is required but not found on this system</div>
          {installStatus && <div className="setup-status">{installStatus}</div>}
          {!installing && (
            <button className="btn primary" onClick={handleInstallNode} style={{marginTop: 12}}>
              download &amp; install node.js
            </button>
          )}
          {installing && <div className="setup-status">please wait, this takes a minute...</div>}
        </div>
      </div>
    );
  }

  if (startError) return (
    <div className="loading-screen">
      <div className="setup-box">
        <div className="setup-title">mechanism</div>
        <div className="setup-msg" style={{color: "#ff3333"}}>{startError}</div>
        <button className="btn" onClick={() => { setStartError(""); boot(); }} style={{marginTop: 12}}>retry</button>
      </div>
    </div>
  );

  if (!ready) return (
    <div className="loading-screen">
      <div className="setup-box">
        <div className="setup-title">mechanism</div>
        <div className="setup-status">{installStatus || "initializing..."}</div>
      </div>
    </div>
  );

  return (
    <ConfirmProvider>
      <div className="app">
        <Sidebar />
        <div className="main-content">
          {updateAvailable && !updating && (
            <div className="update-bar">
              <span>v{updateAvailable.version} available</span>
              <button className="btn primary" onClick={updateAvailable.download} style={{padding: "2px 10px", fontSize: 11}}>Update</button>
            </div>
          )}
          {updating && <div className="update-bar">Downloading update...</div>}
          {error && <div className="error-bar">{error}</div>}
          {page === "inbox" && <Inbox />}
          {page === "amazon" && <AmazonCheck />}
          {page === "presets" && <PresetsPage />}
          {page === "settings" && <SettingsPage />}
        </div>
      </div>
      {showChangelog && (
        <div className="modal-overlay" onClick={() => setShowChangelog(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{maxWidth: 420}}>
            <h3>Обновлено до v{__APP_VERSION__}</h3>
            <pre style={{whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.6, color: "var(--text)", margin: "8px 0"}}>{CHANGELOG[__APP_VERSION__] || "Багфиксы и улучшения"}</pre>
            <button className="btn primary" onClick={() => setShowChangelog(false)} style={{marginTop: 8}}>Ок</button>
          </div>
        </div>
      )}
    </ConfirmProvider>
  );
}
