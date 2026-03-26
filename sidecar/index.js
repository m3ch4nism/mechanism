import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { appendFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import readline from "readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
process.chdir(__dirname);

// File logging
const LOG_DIR = join(homedir(), ".mechanism");
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = join(LOG_DIR, "mechanism.log");

function log(level, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}\n`;
  try { appendFileSync(LOG_FILE, line); } catch {}
  if (level === "ERROR") process.stderr.write(line);
}

process.on("uncaughtException", (err) => {
  log("FATAL", `Uncaught: ${err.stack || err.message}`);
});
process.on("unhandledRejection", (err) => {
  log("ERROR", `Unhandled rejection: ${err?.stack || err?.message || err}`);
});
import {
  initDb, save, addAccount, removeAccount, getAccounts,
  setSetting, getSetting, deleteSetting,
  addCustomImap, getCustomImap, getAllCustomImap,
  cacheEmails, getCachedEmails,
  addPreset, updatePreset, getPresets, removePreset,
  saveCheckHistory, getCheckHistory,
} from "./db.js";
import {
  connectImap, fetchFolders, fetchEmails, searchEmails, deleteEmails, getImapSettings, testProxy,
} from "./imap.js";
import { runAmazonCheck } from "./amazon.js";

const clients = {};
const idleWatchers = {};
let initDone = false;
let initPromise = null;

function pushNotification(data) {
  const msg = JSON.stringify({ id: 0, push: data });
  process.stdout.write(msg + "\n");
}

function startIdleWatch(email, client) {
  if (idleWatchers[email]) return;
  idleWatchers[email] = true;
  client.on("exists", async (data) => {
    log("INFO", `IDLE: new mail in ${email} (${data.path}, count: ${data.count})`);
    let subject = "New email";
    let sender = "";
    try {
      const lock = await client.getMailboxLock(data.path);
      try {
        const total = client.mailbox.exists;
        if (total > 0) {
          for await (const msg of client.fetch(`${total}:${total}`, { uid: true, envelope: true })) {
            subject = msg.envelope?.subject || "New email";
            sender = msg.envelope?.from?.[0]?.address || "";
          }
        }
      } finally { lock.release(); }
    } catch (e) {
      log("ERROR", `IDLE fetch preview: ${e.message}`);
    }
    pushNotification({ type: "newMail", email, folder: data.path, subject, sender });
  });
  const reconnect = async () => {
    delete idleWatchers[email];
    delete clients[email];
    log("INFO", `IDLE: reconnecting ${email}...`);
    try {
      const account = getAccounts().find(a => a.email === email);
      if (!account) return;
      const customs = getAllCustomImap();
      const settings = getImapSettings(email, customs) || { host: account.imap_host, port: account.imap_port, secure: !!account.use_ssl };
      const proxy = getSetting("proxy");
      const newClient = await connectImap(email, account.password, settings, proxy);
      clients[email] = newClient;
      startIdleWatch(email, newClient);
      log("INFO", `IDLE: reconnected ${email}`);
    } catch (e) {
      log("ERROR", `IDLE: reconnect failed for ${email}: ${e.message}`);
      // Retry in 30 seconds
      setTimeout(() => reconnect(), 30000);
    }
  };
  client.on("close", () => {
    log("INFO", `IDLE: connection closed for ${email}`);
    reconnect();
  });
  client.on("error", (err) => {
    log("ERROR", `IDLE: error for ${email}: ${err.message}`);
    // close event will fire after error, triggering reconnect
  });
  log("INFO", `IDLE: watching ${email}`);
}

const rl = readline.createInterface({ input: process.stdin });

function send(id, result, error) {
  const msg = JSON.stringify({ id, result: result ?? null, error: error ?? null });
  process.stdout.write(msg + "\n");
}

async function handleRequest(req) {
  const { id, method, params } = req;
  try {
    if (method !== "init" && !initDone) {
      if (initPromise) await initPromise;
      else { initPromise = initDb(); await initPromise; initDone = true; }
    }
    let result;
    switch (method) {
      case "init":
        initPromise = initDb();
        await initPromise;
        initDone = true;
        result = { ok: true };
        break;

      case "getAccounts":
        result = getAccounts();
        break;

      case "addAccount": {
        const { email, password, imapHost, imapPort, useSsl } = params;
        result = addAccount(email, password, imapHost, imapPort, useSsl);
        break;
      }

      case "removeAccount":
        result = removeAccount(params.email);
        break;

      case "getImapSettings": {
        const customs = getAllCustomImap();
        result = getImapSettings(params.email, customs);
        break;
      }

      case "setSetting":
        setSetting(params.key, params.value);
        result = true;
        break;

      case "getSetting":
        result = getSetting(params.key);
        break;

      case "deleteSetting":
        deleteSetting(params.key);
        result = true;
        break;

      case "addCustomImap":
        result = addCustomImap(params.domain, params.imapHost, params.imapPort, params.useSsl);
        break;

      case "getAllCustomImap":
        result = getAllCustomImap();
        break;

      case "connect": {
        const { email, password, host, port, secure } = params;
        const proxy = getSetting("proxy");
        const client = await connectImap(email, password, { host, port, secure }, proxy);
        clients[email] = client;
        startIdleWatch(email, client);
        result = { connected: true };
        break;
      }

      case "disconnect": {
        const c = clients[params.email];
        if (c) { await c.logout(); delete clients[params.email]; }
        result = { disconnected: true };
        break;
      }

      case "verifyAccount": {
        const { email, password, host, port, secure } = params;
        const proxy = getSetting("proxy");
        try {
          const client = await connectImap(email, password, { host, port, secure }, proxy);
          clients[email] = client;
          startIdleWatch(email, client);
          result = { status: "ok" };
        } catch (e) {
          result = { status: "error", error: e.message };
        }
        break;
      }

      case "fetchFolders": {
        let c = clients[params.email];
        if (!c) {
          const account = getAccounts().find(a => a.email === params.email);
          if (!account) throw new Error("Account not found");
          const customs = getAllCustomImap();
          const settings = getImapSettings(params.email, customs) || { host: account.imap_host, port: account.imap_port, secure: !!account.use_ssl };
          const proxy = getSetting("proxy");
          c = await connectImap(params.email, account.password, settings, proxy);
          clients[params.email] = c;
        }
        result = await fetchFolders(c);
        break;
      }

      case "fetchEmails": {
        let c = clients[params.email];
        if (!c) {
          // Auto-reconnect
          const account = getAccounts().find(a => a.email === params.email);
          if (!account) throw new Error("Account not found");
          const customs = getAllCustomImap();
          const settings = getImapSettings(params.email, customs) || { host: account.imap_host, port: account.imap_port, secure: !!account.use_ssl };
          const proxy = getSetting("proxy");
          c = await connectImap(params.email, account.password, settings, proxy);
          clients[params.email] = c;
          log("INFO", `auto-reconnected ${params.email}`);
        }
        const emails = await fetchEmails(c, params.folder || "INBOX", params.limit || 50);
        cacheEmails(params.email, params.folder || "INBOX", emails);
        result = emails;
        break;
      }

      case "deleteEmails": {
        let c = clients[params.email];
        if (!c) {
          const account = getAccounts().find(a => a.email === params.email);
          if (!account) throw new Error("Account not found");
          const customs = getAllCustomImap();
          const settings = getImapSettings(params.email, customs) || { host: account.imap_host, port: account.imap_port, secure: !!account.use_ssl };
          const proxy = getSetting("proxy");
          c = await connectImap(params.email, account.password, settings, proxy);
          clients[params.email] = c;
        }
        result = await deleteEmails(c, params.folder || "INBOX", params.uids);
        break;
      }

      case "searchEmails": {
        let c = clients[params.email];
        if (!c) {
          const account = getAccounts().find(a => a.email === params.email);
          if (!account) throw new Error("Account not found");
          const customs = getAllCustomImap();
          const settings = getImapSettings(params.email, customs) || { host: account.imap_host, port: account.imap_port, secure: !!account.use_ssl };
          const proxy = getSetting("proxy");
          c = await connectImap(params.email, account.password, settings, proxy);
          clients[params.email] = c;
        }
        result = await searchEmails(c, params.folder || "INBOX", params.criteria || {}, params.limit || 50);
        break;
      }

      case "getCachedEmails":
        result = getCachedEmails(params.email, params.folder || "INBOX", params.limit || 50);
        break;

      case "amazonCheck": {
        const { email, password, host, port, secure } = params;
        const proxy = getSetting("proxy");
        const geminiKey = getSetting("gemini_key");
        const settings = { host, port, secure };
        const clients = [];
        // Try 3 parallel connections, fallback to fewer if proxy can't handle it
        const tryConnect = async () => {
          try { return await connectImap(email, password, settings, proxy); }
          catch (e) { log("ERROR", `amazonCheck connect failed: ${e.message}`); return null; }
        };
        const [r1, r2, r3] = await Promise.all([tryConnect(), tryConnect(), tryConnect()]);
        if (r1) clients.push(r1);
        if (r2) clients.push(r2);
        if (r3) clients.push(r3);
        // If less than 3 connected, retry missing ones sequentially
        while (clients.length < 3) {
          try {
            const c = await connectImap(email, password, settings, proxy);
            clients.push(c);
          } catch (e) {
            log("ERROR", `amazonCheck retry connect failed: ${e.message}`);
            break;
          }
        }
        if (clients.length === 0) throw new Error("Failed to connect to IMAP server");
        // Pad to 3 by reusing connections
        while (clients.length < 3) clients.push(clients[0]);
        try {
          result = await runAmazonCheck(clients, email, geminiKey);
          saveCheckHistory(email, result);
        } finally {
          const unique = [...new Set(clients)];
          await Promise.allSettled(unique.map(c => c.logout()));
        }
        break;
      }

      case "getCheckHistory":
        result = getCheckHistory(params.email);
        break;

      case "setProxy":
        if (params.proxy) setSetting("proxy", params.proxy);
        else deleteSetting("proxy");
        result = true;
        break;

      case "getProxy":
        result = getSetting("proxy");
        break;

      case "setGeminiKey":
        if (params.key) setSetting("gemini_key", params.key);
        else deleteSetting("gemini_key");
        result = true;
        break;

      case "getGeminiKey":
        result = getSetting("gemini_key");
        break;

      case "testProxy": {
        const proxyVal = params.proxy || getSetting("proxy");
        if (!proxyVal) throw new Error("No proxy configured");
        result = await testProxy(proxyVal);
        break;
      }

      case "addPreset":
        result = addPreset(params.name, params.sender, params.subject, params.bodyText, params.folder, params.daysBack);
        break;

      case "getPresets":
        result = getPresets();
        break;

      case "updatePreset":
        result = updatePreset(params.id, params.name, params.sender, params.subject, params.bodyText, params.folder, params.daysBack);
        break;

      case "removePreset":
        result = removePreset(params.id);
        break;

      case "runPreset": {
        const { email, password, host, port, secure, preset } = params;
        const proxy = getSetting("proxy");
        let client = clients[email];
        let needClose = false;
        if (!client) {
          client = await connectImap(email, password, { host, port, secure }, proxy);
          needClose = true;
        }
        try {
          const senders = preset.sender ? preset.sender.split(",").map(s => s.trim()).filter(Boolean) : [];
          const folders = preset.folder === "*" ? (await fetchFolders(client)).map(f => f.path) : [preset.folder || "INBOX"];
          const allResults = [];
          const seenUids = new Set();
          for (const folder of folders) {
            const senderList = senders.length ? senders : [null];
            for (const sender of senderList) {
              const criteria = {};
              if (sender) criteria.from = sender;
              if (preset.subject) criteria.subject = preset.subject;
              if (preset.bodyText) criteria.body = preset.bodyText;
              if (preset.daysBack) {
                const since = new Date();
                since.setDate(since.getDate() - preset.daysBack);
                criteria.since = since;
              }
              log("INFO", `runPreset "${preset.name}" folder=${folder} sender=${sender || "*"} criteria=${JSON.stringify(criteria)}`);
              try {
                const msgs = await searchEmails(client, folder, criteria, 100);
                for (const m of msgs) {
                  const key = `${folder}:${m.uid}`;
                  if (!seenUids.has(key)) { seenUids.add(key); allResults.push({ ...m, folder }); }
                }
              } catch (e) {
                log("ERROR", `runPreset folder=${folder}: ${e.message}`);
              }
            }
          }
          allResults.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
          result = allResults.slice(0, 200);
          log("INFO", `runPreset "${preset.name}" total ${result.length} emails`);
        } finally {
          if (needClose) { try { await client.logout(); } catch {} }
        }
        break;
      }

      default:
        throw new Error(`Unknown method: ${method}`);
    }
    log("INFO", `${method} ok`);
    send(id, result);
  } catch (e) {
    const detail = e.cause ? ` (${e.cause.message || e.cause})` : "";
    log("ERROR", `${method}: ${e.stack || e.message}${detail}`);
    send(id, null, e.message + detail);
  }
}

rl.on("line", (line) => {
  try {
    const req = JSON.parse(line);
    handleRequest(req);
  } catch (e) {
    log("ERROR", `Parse: ${e.message}`);
  }
});

log("INFO", `sidecar started, log: ${LOG_FILE}`);
process.stderr.write("sidecar ready\n");
