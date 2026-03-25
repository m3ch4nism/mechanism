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
  addPreset, getPresets, removePreset,
} from "./db.js";
import {
  connectImap, fetchFolders, fetchEmails, searchEmails, getImapSettings, testProxy,
} from "./imap.js";
import { runAmazonCheck } from "./amazon.js";

const clients = {};
let initDone = false;
let initPromise = null;

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
        result = { connected: true };
        break;
      }

      case "disconnect": {
        const c = clients[params.email];
        if (c) { await c.logout(); delete clients[params.email]; }
        result = { disconnected: true };
        break;
      }

      case "fetchFolders": {
        const c = clients[params.email];
        if (!c) throw new Error("Not connected");
        result = await fetchFolders(c);
        break;
      }

      case "fetchEmails": {
        const c = clients[params.email];
        if (!c) throw new Error("Not connected");
        const emails = await fetchEmails(c, params.folder || "INBOX", params.limit || 50);
        cacheEmails(params.email, params.folder || "INBOX", emails);
        result = emails;
        break;
      }

      case "searchEmails": {
        const c = clients[params.email];
        if (!c) throw new Error("Not connected");
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
        const [c1, c2, c3] = await Promise.all([
          connectImap(email, password, settings, proxy),
          connectImap(email, password, settings, proxy),
          connectImap(email, password, settings, proxy),
        ]);
        try {
          result = await runAmazonCheck([c1, c2, c3], email, geminiKey);
        } finally {
          await Promise.allSettled([c1.logout(), c2.logout(), c3.logout()]);
        }
        break;
      }

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
          const criteria = {};
          if (preset.sender) criteria.from = preset.sender;
          if (preset.subject) criteria.subject = preset.subject;
          if (preset.bodyText) criteria.body = preset.bodyText;
          if (preset.daysBack) {
            const since = new Date();
            since.setDate(since.getDate() - preset.daysBack);
            criteria.since = since;
          }
          log("INFO", `runPreset "${preset.name}" folder=${preset.folder || "INBOX"} criteria=${JSON.stringify(criteria)}`);
          result = await searchEmails(client, preset.folder || "INBOX", criteria, 100);
          log("INFO", `runPreset "${preset.name}" found ${result.length} emails`);
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
