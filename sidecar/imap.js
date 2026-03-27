import { ImapFlow } from "imapflow";
import { SocksClient } from "socks";
import { simpleParser } from "mailparser";
import net from "net";
import http from "http";
import tls from "tls";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

const KNOWN_PROVIDERS = {
  "comcast.net": { host: "imap.comcast.net", port: 993, secure: true },
  "zoominternet.net": { host: "imap.zoominternet.net", port: 993, secure: true },
  "charter.net": { host: "imap.charter.net", port: 993, secure: true },
  "spectrum.net": { host: "imap.charter.net", port: 993, secure: true },
  "suddenlink.net": { host: "imap.suddenlink.net", port: 993, secure: true },
  "optonline.net": { host: "mail.optimum.net", port: 993, secure: true },
  "optimum.net": { host: "mail.optimum.net", port: 993, secure: true },
  "wavecable.com": { host: "mail.wavecable.com", port: 993, secure: true },
  "mediacombb.net": { host: "mail.mediacombb.net", port: 993, secure: true },
  "windstream.net": { host: "imap.windstream.net", port: 993, secure: true },
  "rushmore.com": { host: "mail.rushmore.com", port: 993, secure: true },
  "hughes.net": { host: "mail.hughes.net", port: 993, secure: true },
  "northstate.net": { host: "imap.northstate.net", port: 993, secure: true },
  "fuse.net": { host: "imap.fuse.net", port: 993, secure: true },
  "gmail.com": { host: "imap.gmail.com", port: 993, secure: true },
  "yahoo.com": { host: "imap.mail.yahoo.com", port: 993, secure: true },
  "outlook.com": { host: "outlook.office365.com", port: 993, secure: true },
  "hotmail.com": { host: "outlook.office365.com", port: 993, secure: true },
  "aol.com": { host: "imap.aol.com", port: 993, secure: true },
};

function parseProxy(proxyStr) {
  if (!proxyStr) return null;
  try {
    let s = proxyStr.trim();
    // detect type prefix
    let type = "socks5";
    if (/^https?:\/\//i.test(s)) { type = "http"; s = s.replace(/^https?:\/\//i, ""); }
    else if (/^socks5?:\/\//i.test(s)) { type = "socks5"; s = s.replace(/^socks5?:\/\//i, ""); }
    if (s.includes("@")) {
      const atIdx = s.lastIndexOf("@");
      const userpass = s.slice(0, atIdx);
      const hostport = s.slice(atIdx + 1);
      const colonIdx = userpass.indexOf(":");
      const username = userpass.slice(0, colonIdx);
      const password = userpass.slice(colonIdx + 1);
      const [host, port] = hostport.split(":");
      return { type, host, port: parseInt(port), userId: username, password };
    } else {
      const [host, port] = s.split(":");
      return { type, host, port: parseInt(port) };
    }
  } catch { return null; }
}

function buildProxyUrl(proxy) {
  const scheme = proxy.type === "http" ? "http" : "socks5";
  if (proxy.userId && proxy.password) {
    const u = encodeURIComponent(proxy.userId);
    const p = encodeURIComponent(proxy.password);
    return `${scheme}://${u}:${p}@${proxy.host}:${proxy.port}`;
  }
  return `${scheme}://${proxy.host}:${proxy.port}`;
}

function httpConnectTunnel(proxy, destHost, destPort) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("HTTP proxy CONNECT timeout")), 15000);
    const headers = { Host: `${destHost}:${destPort}` };
    if (proxy.userId && proxy.password) {
      headers["Proxy-Authorization"] = "Basic " + Buffer.from(`${proxy.userId}:${proxy.password}`).toString("base64");
    }
    const req = http.request({
      host: proxy.host,
      port: proxy.port,
      method: "CONNECT",
      path: `${destHost}:${destPort}`,
      headers,
    });
    req.on("connect", (_res, socket) => {
      clearTimeout(timeout);
      if (_res.statusCode === 200) resolve(socket);
      else reject(new Error(`HTTP proxy CONNECT failed: ${_res.statusCode}`));
    });
    req.on("error", (e) => { clearTimeout(timeout); reject(e); });
    req.end();
  });
}

export function getImapSettings(email, customImaps) {
  const domain = email.split("@")[1].toLowerCase();
  const custom = customImaps?.find(c => c.domain === domain);
  if (custom) return { host: custom.imap_host, port: custom.imap_port, secure: !!custom.use_ssl };
  return KNOWN_PROVIDERS[domain] || null;
}

export async function connectImap(email, password, settings, proxyStr, imapUser) {
  const proxy = parseProxy(proxyStr);
  const config = {
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: { user: imapUser || email, pass: password },
    logger: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15000,
  };
  try {
    return await _doConnect(config, proxy, settings);
  } catch (e) {
    const msg = e.message || "";
    if (/wrong version number|packet length too long/i.test(msg)) {
      throw new Error(`SSL mismatch for ${settings.host}:${settings.port}. Try ${settings.secure ? "disabling" : "enabling"} SSL or port ${settings.secure ? "143" : "993"}`);
    }
    if (/AUTHENTICATIONFAILED|LOGIN/i.test(msg)) {
      throw new Error(`Wrong password for ${email}`);
    }
    throw e;
  }
}

async function _doConnect(config, proxy, settings) {

  if (proxy && proxy.type === "http") {
    // HTTP CONNECT tunnel: get raw TCP socket, then hand to ImapFlow
    const tunnel = await httpConnectTunnel(proxy, settings.host, settings.port);
    if (settings.secure) {
      const tlsSocket = tls.connect({ socket: tunnel, host: settings.host, servername: settings.host, rejectUnauthorized: false });
      await new Promise((res, rej) => { tlsSocket.on("secureConnect", res); tlsSocket.on("error", rej); });
      config.connection = tlsSocket;
    } else {
      config.connection = tunnel;
    }
    delete config.host;
    delete config.port;
    delete config.secure;
    const client = new ImapFlow(config);
    client.on("error", (err) => console.error(`[imapflow error] ${config.auth.user}: ${err.message}`));
    await client.connect();
    return client;
  }

  if (proxy) {
    const dns = await import("dns");
    const origResolve = dns.promises.resolve;
    dns.promises.resolve = async (hostname) => {
      if (net.isIP(hostname)) return [hostname];
      return [hostname];
    };
    config.proxy = buildProxyUrl(proxy);
    const client = new ImapFlow(config);
    client.on("error", (err) => console.error(`[imapflow error] ${config.auth.user}: ${err.message}`));
    try {
      await client.connect();
    } finally {
      dns.promises.resolve = origResolve;
    }
    return client;
  }

  const client = new ImapFlow(config);
  client.on("error", (err) => console.error(`[imapflow error] ${config.auth.user}: ${err.message}`));
  await client.connect();
  return client;
}

export async function fetchFolders(client) {
  const tree = await client.listTree();
  const folders = [];
  function walk(items) {
    for (const item of items) {
      folders.push({
        name: item.name,
        path: item.path,
        specialUse: item.specialUse || null,
        listed: item.listed,
      });
      if (item.folders?.length) walk(item.folders);
    }
  }
  walk(tree.folders || []);
  return folders;
}

export async function fetchEmails(client, folder, limit = 50) {
  const lock = await client.getMailboxLock(folder);
  try {
    const messages = [];
    const total = client.mailbox.exists;
    if (!total) return [];
    
    // 1. Fetch metadata first (fast, minimal RAM)
    const from = Math.max(1, total - limit + 1);
    const uids = [];
    const flagsMap = new Map();
    for await (const msg of client.fetch(`${from}:*`, { uid: true, flags: true })) {
      uids.push(msg.uid);
      flagsMap.set(msg.uid, Array.from(msg.flags || []));
    }

    // 2. Stream sources one by one to disk to avoid out-of-memory errors
    const tmpDir = path.join(os.homedir(), ".mechanism", "tmp");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    for (const uid of uids) {
      const tmpPath = path.join(tmpDir, `email_${uid}_${crypto.randomBytes(4).toString("hex")}.eml`);
      try {
        const { content } = await client.download(String(uid), undefined, { uid: true });
        await new Promise((resolve, reject) => {
          const ws = fs.createWriteStream(tmpPath);
          content.pipe(ws);
          content.on("error", reject);
          ws.on("finish", resolve);
        });
        
        const parsed = await simpleParser(fs.createReadStream(tmpPath));
        messages.push({
          uid: String(uid),
          subject: parsed.subject || "(no subject)",
          sender: parsed.from?.text || "",
          date: parsed.date?.toISOString() || "",
          bodyText: parsed.text || "",
          bodyHtml: parsed.html || "",
          flags: flagsMap.get(uid) || [],
          attachments: (parsed.attachments || []).map(a => ({
            filename: a.filename, size: a.size, contentType: a.contentType,
          })),
        });
      } catch (e) {
        console.error(`Failed to download/parse email uid=${uid}`, e);
      } finally {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      }
    }
    return messages.reverse();
  } finally {
    lock.release();
  }
}

export async function searchEmails(client, folder, criteria, limit = 50) {
  const lock = await client.getMailboxLock(folder);
  try {
    const searchCriteria = {};
    if (criteria.from) searchCriteria.from = criteria.from;
    if (criteria.subject) searchCriteria.subject = criteria.subject;
    if (criteria.body) searchCriteria.body = criteria.body;
    if (criteria.since) searchCriteria.since = new Date(criteria.since);
    if (criteria.before) searchCriteria.before = new Date(criteria.before);
    
    // 1. Get UIDs
    const allUids = await client.search(searchCriteria, { uid: true });
    if (!allUids.length) return [];
    const targetUids = allUids.slice(-limit);
    
    // 2. Fetch metadata
    const uids = [];
    const flagsMap = new Map();
    for await (const msg of client.fetch(targetUids, { uid: true, flags: true }, { uid: true })) {
      uids.push(msg.uid);
      flagsMap.set(msg.uid, Array.from(msg.flags || []));
    }

    // 3. Stream to disk to save memory
    const tmpDir = path.join(os.homedir(), ".mechanism", "tmp");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    
    const messages = [];
    for (const uid of uids) {
      const tmpPath = path.join(tmpDir, `email_${uid}_${crypto.randomBytes(4).toString("hex")}.eml`);
      try {
        const { content } = await client.download(String(uid), undefined, { uid: true });
        await new Promise((resolve, reject) => {
          const ws = fs.createWriteStream(tmpPath);
          content.pipe(ws);
          content.on("error", reject);
          ws.on("finish", resolve);
        });

        const parsed = await simpleParser(fs.createReadStream(tmpPath));
        messages.push({
          uid: String(uid),
          subject: parsed.subject || "(no subject)",
          sender: parsed.from?.text || "",
          date: parsed.date?.toISOString() || "",
          bodyText: parsed.text || "",
          bodyHtml: parsed.html || "",
          flags: flagsMap.get(uid) || [],
        });
      } catch (e) {
        console.error(`Failed to download/parse email uid=${uid}`, e);
      } finally {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      }
    }
    return messages.reverse();
  } finally {
    lock.release();
  }
}

export async function fetchRawBySearch(client, searchQuery, limit = 50) {
  const lock = await client.getMailboxLock("INBOX");
  try {
    const uids = await client.search(searchQuery, { uid: true });
    if (!uids.length) return [];
    const targetUids = uids.slice(-limit);
    const raws = [];
    for await (const msg of client.fetch(targetUids, { uid: true, source: true }, { uid: true })) {
      raws.push(msg.source);
    }
    return raws;
  } finally {
    lock.release();
  }
}

export async function deleteEmails(client, folder, uids) {
  const lock = await client.getMailboxLock(folder);
  try {
    const uidList = uids.map(u => typeof u === "string" ? parseInt(u) : u);
    await client.messageDelete(uidList, { uid: true });
    return { deleted: uidList.length };
  } finally {
    lock.release();
  }
}

export async function testProxy(proxyStr) {
  const directIp = await getExternalIp(null);
  const proxy = parseProxy(proxyStr);
  if (!proxy) throw new Error("Invalid proxy format. Use user:pass@host:port or host:port");
  const proxyIp = await getExternalIp(proxy);
  return { directIp, proxyIp, working: directIp !== proxyIp };
}

function getExternalIp(proxy) {
  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timeout getting IP")), 10000);
    try {
      let socket;
      if (proxy && proxy.type === "http") {
        // HTTP proxy: use regular GET through proxy
        const headers = { Host: "api.ipify.org" };
        if (proxy.userId && proxy.password) {
          headers["Proxy-Authorization"] = "Basic " + Buffer.from(`${proxy.userId}:${proxy.password}`).toString("base64");
        }
        const req = http.request({
          host: proxy.host,
          port: proxy.port,
          path: "http://api.ipify.org/",
          method: "GET",
          headers,
        }, (res) => {
          let data = "";
          res.on("data", (chunk) => { data += chunk.toString(); });
          res.on("end", () => {
            clearTimeout(timeout);
            const ip = data.trim();
            if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) resolve(ip);
            else reject(new Error("Bad IP response: " + ip.slice(0, 80)));
          });
        });
        req.on("error", (e) => { clearTimeout(timeout); reject(e); });
        req.end();
        return;
      } else if (proxy) {
        const proxyOpts = { host: proxy.host, port: proxy.port, type: 5 };
        if (proxy.userId) proxyOpts.userId = proxy.userId;
        if (proxy.password) proxyOpts.password = proxy.password;
        const info = await SocksClient.createConnection({
          proxy: proxyOpts,
          command: "connect",
          destination: { host: "api.ipify.org", port: 80 },
        });
        socket = info.socket;
      } else {
        socket = net.connect(80, "api.ipify.org");
        await new Promise((res, rej) => { socket.on("connect", res); socket.on("error", rej); });
      }
      socket.write("GET / HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n");
      let data = "";
      socket.on("data", (chunk) => { data += chunk.toString(); });
      socket.on("end", () => {
        clearTimeout(timeout);
        const body = data.split("\r\n\r\n").pop() || "";
        const ip = body.trim();
        if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) resolve(ip);
        else reject(new Error("Bad IP response: " + ip.slice(0, 80)));
      });
      socket.on("error", (e) => { clearTimeout(timeout); reject(e); });
    } catch (e) {
      clearTimeout(timeout);
      reject(e);
    }
  });
}
