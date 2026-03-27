import initSqlJs from "sql.js";
import fs from "fs";
import path from "path";
import os from "os";

const DB_DIR = path.join(os.homedir(), ".mechanism");
const DB_PATH = path.join(DB_DIR, "data.db");

let db = null;

export async function initDb() {
  if (db) return db;
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  db.run(`CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    imap_host TEXT NOT NULL,
    imap_port INTEGER NOT NULL DEFAULT 993,
    use_ssl INTEGER NOT NULL DEFAULT 1,
    imap_user TEXT
  )`);
  // Migration: add imap_user column if missing
  try { db.run("ALTER TABLE accounts ADD COLUMN imap_user TEXT"); } catch {}
  // Migration: rename gemini_key to groq_key
  try {
    const oldKey = db.exec("SELECT value FROM settings WHERE key = 'gemini_key'");
    if (oldKey.length && oldKey[0].values.length) {
      db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('groq_key', ?)", [oldKey[0].values[0][0]]);
      db.run("DELETE FROM settings WHERE key = 'gemini_key'");
    }
  } catch {}
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS custom_imap (
    domain TEXT PRIMARY KEY,
    imap_host TEXT NOT NULL,
    imap_port INTEGER NOT NULL DEFAULT 993,
    use_ssl INTEGER NOT NULL DEFAULT 1
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS search_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sender TEXT,
    subject TEXT,
    body_text TEXT,
    folder TEXT DEFAULT 'INBOX',
    days_back INTEGER DEFAULT 30
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS email_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_email TEXT NOT NULL,
    uid TEXT NOT NULL,
    folder TEXT NOT NULL DEFAULT 'INBOX',
    subject TEXT,
    sender TEXT,
    date TEXT,
    body_text TEXT,
    body_html TEXT,
    flags TEXT,
    cached_at TEXT DEFAULT (datetime('now')),
    UNIQUE(account_email, uid, folder)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS check_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    checked_at TEXT DEFAULT (datetime('now')),
    report TEXT NOT NULL
  )`);
  save();
  return db;
}

export function saveCheckHistory(email, report) {
  if (!db) return;
  db.run("INSERT INTO check_history (email, report) VALUES (?, ?)", [email, JSON.stringify(report)]);
  // Keep last 20 per email
  db.run("DELETE FROM check_history WHERE email = ? AND id NOT IN (SELECT id FROM check_history WHERE email = ? ORDER BY id DESC LIMIT 20)", [email, email]);
  save();
}

export function getCheckHistory(email) {
  if (!db) return [];
  const rows = db.exec("SELECT id, checked_at, report FROM check_history WHERE email = ? ORDER BY id DESC LIMIT 20", [email]);
  if (!rows.length) return [];
  return rows[0].values.map(r => ({ id: r[0], date: r[1], report: JSON.parse(r[2]) }));
}

export function save() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

export function getDb() {
  return db;
}

export function addAccount(email, password, imapHost, imapPort, useSsl, imapUser) {
  const d = getDb();
  try {
    d.run("INSERT INTO accounts (email, password, imap_host, imap_port, use_ssl, imap_user) VALUES (?, ?, ?, ?, ?, ?)",
      [email, password, imapHost, imapPort, useSsl ? 1 : 0, imapUser || null]);
    save();
    return true;
  } catch { return false; }
}

export function removeAccount(email) {
  const d = getDb();
  d.run("DELETE FROM accounts WHERE email = ?", [email]);
  d.run("DELETE FROM email_cache WHERE account_email = ?", [email]);
  save();
  return true;
}

export function getAccounts() {
  const d = getDb();
  const rows = d.exec("SELECT * FROM accounts");
  if (!rows.length) return [];
  return rows[0].values.map(r => ({
    id: r[0], email: r[1], password: r[2],
    imap_host: r[3], imap_port: r[4], use_ssl: !!r[5], imap_user: r[6] || null
  }));
}

export function setSetting(key, value) {
  const d = getDb();
  d.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value]);
  save();
}

export function getSetting(key) {
  const d = getDb();
  const rows = d.exec("SELECT value FROM settings WHERE key = ?", [key]);
  if (!rows.length || !rows[0].values.length) return null;
  return rows[0].values[0][0];
}

export function deleteSetting(key) {
  const d = getDb();
  d.run("DELETE FROM settings WHERE key = ?", [key]);
  save();
}

export function addCustomImap(domain, imapHost, imapPort, useSsl) {
  const d = getDb();
  d.run("INSERT OR REPLACE INTO custom_imap (domain, imap_host, imap_port, use_ssl) VALUES (?, ?, ?, ?)",
    [domain.toLowerCase(), imapHost, imapPort, useSsl ? 1 : 0]);
  save();
  return true;
}

export function getCustomImap(domain) {
  const d = getDb();
  const rows = d.exec("SELECT * FROM custom_imap WHERE domain = ?", [domain.toLowerCase()]);
  if (!rows.length || !rows[0].values.length) return null;
  const r = rows[0].values[0];
  return { domain: r[0], imap_host: r[1], imap_port: r[2], use_ssl: !!r[3] };
}

export function getAllCustomImap() {
  const d = getDb();
  const rows = d.exec("SELECT * FROM custom_imap ORDER BY domain");
  if (!rows.length) return [];
  return rows[0].values.map(r => ({
    domain: r[0], imap_host: r[1], imap_port: r[2], use_ssl: !!r[3]
  }));
}

export function addPreset(name, sender, subject, bodyText, folder, daysBack) {
  const d = getDb();
  d.run("INSERT INTO search_presets (name, sender, subject, body_text, folder, days_back) VALUES (?, ?, ?, ?, ?, ?)",
    [name, sender || null, subject || null, bodyText || null, folder || "INBOX", daysBack || 30]);
  save();
  return true;
}

export function getPresets() {
  const d = getDb();
  const rows = d.exec("SELECT * FROM search_presets ORDER BY name");
  if (!rows.length) return [];
  return rows[0].values.map(r => ({
    id: r[0], name: r[1], sender: r[2], subject: r[3],
    bodyText: r[4], folder: r[5], daysBack: r[6]
  }));
}

export function updatePreset(id, name, sender, subject, bodyText, folder, daysBack) {
  const d = getDb();
  d.run("UPDATE search_presets SET name=?, sender=?, subject=?, body_text=?, folder=?, days_back=? WHERE id=?",
    [name, sender || null, subject || null, bodyText || null, folder || "INBOX", daysBack || 30, id]);
  save();
  return true;
}

export function removePreset(id) {
  const d = getDb();
  d.run("DELETE FROM search_presets WHERE id = ?", [id]);
  save();
  return true;
}

export function cacheEmails(accountEmail, folder, emails) {
  const d = getDb();
  const stmt = d.prepare(
    "INSERT OR REPLACE INTO email_cache (account_email, uid, folder, subject, sender, date, body_text, body_html, flags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const e of emails) {
    stmt.run([accountEmail, e.uid, folder, e.subject || "", e.sender || "",
      e.date || "", e.bodyText || "", e.bodyHtml || "", JSON.stringify(e.flags || [])]);
  }
  stmt.free();
  save();
}

export function getCachedEmails(accountEmail, folder, limit = 50) {
  const d = getDb();
  const rows = d.exec(
    "SELECT uid, subject, sender, date, body_text, body_html, flags FROM email_cache WHERE account_email = ? AND folder = ? ORDER BY date DESC LIMIT ?",
    [accountEmail, folder, limit]
  );
  if (!rows.length) return [];
  return rows[0].values.map(r => ({
    uid: r[0], subject: r[1], sender: r[2], date: r[3],
    bodyText: r[4], bodyHtml: r[5], flags: JSON.parse(r[6] || "[]")
  }));
}
