import { simpleParser } from "mailparser";
import * as cheerio from "cheerio";
import { analyzeInterests } from "./classifier.js";

const CARD_PATTERNS = [
  /(?:ending|ends)\s+(?:in|on)\s+(\d{4})/gi,
  /card\s+\*+(\d{4})/gi,
  /Visa\s+[*.]+(\d{4})/g,
  /Master(?:card)?\s+[*.]+(\d{4})/gi,
  /Am(?:ex|erican\s*Express)\s+[*.]*(\d{4})/gi,
  /Discover\s+[*.]+(\d{4})/g,
];

const CARD_TYPE_PATTERNS = [
  [/Amazon\s*(?:Store|Prime|\.com)\s*(?:Credit\s+)?Card/i, "Amazon Store Card"],
  [/Visa/i, "Visa"],
  [/Master\s*Card/i, "MasterCard"],
  [/Amex|American\s*Express/i, "AmEx"],
  [/Discover/i, "Discover"],
  [/Diners/i, "Diners"],
];

const CARD_TYPE_EXPIRY_PAT = /(Amazon\s*(?:Store|Prime|\.com)|Visa|Mastercard|Master\s*Card|Amex|American\s*Express|Discover)\s+(?:Credit\s+)?Card\s*\[expiring\s+on\s+(\d{1,2})\/(\d{4})\]/gi;

const CARD_MENTION_PAT = /(?:your|charged\s+to|refund\s+(?:on|to)|appear\s+on|appear\s+on\s+your|refund.*?(?:on|to)\s+your|will\s+appear\s+on\s+your)\s+(Visa|Master\s*Card|Amex|American\s*Express|Discover|Diners|Amazon\s*(?:Store|Prime|\.com)\s*(?:Credit\s+)?Card)/gi;

function normalizeCardType(raw) {
  const r = raw.toLowerCase().replace(/\s/g, "");
  if (r.includes("amazonstore") || r.includes("amazonprime") || r.includes("amazon.com")) return "Amazon Store Card";
  if (r.includes("visa")) return "Visa";
  if (r.includes("master")) return "MasterCard";
  if (r.includes("amex") || r.includes("americanexpress")) return "AmEx";
  if (r.includes("discover")) return "Discover";
  if (r.includes("diners")) return "Diners";
  return raw.trim();
}

function detectCardType(text, last4) {
  const idx = text.indexOf(last4);
  const start = Math.max(0, idx - 80);
  const context = idx >= 0 ? text.slice(start, idx + 10) : text;
  for (const [pat, name] of CARD_TYPE_PATTERNS) {
    if (pat.test(context)) return name;
  }
  return "";
}

async function parseRaw(rawBuf) {
  const parsed = await simpleParser(rawBuf);
  return {
    subject: parsed.subject || "",
    text: parsed.text || "",
    html: parsed.html || "",
    date: parsed.date || null,
    from: parsed.from?.text || "",
  };
}

function getTextBody(parsed) {
  if (parsed.text) return parsed.text;
  if (parsed.html) {
    const $ = cheerio.load(parsed.html);
    $("style, script").remove();
    return $.text();
  }
  return "";
}

export async function runAmazonCheck(clients, email, geminiKey) {
  const [c1, c2, c3] = Array.isArray(clients) ? clients : [clients, clients, clients];

  const report = {
    email,
    cards: [],
    cardsExpired: [],
    expiryDates: [],
    orders: [],
    subscribeSave: [],
    digitalSubs: [],
    accountName: null,
    cartInterest: { recommendations: [], storeNews: [], classified: [], groups: [] },
    errors: [],
    raw: {},
    sourceEmails: [],
  };

  try {
    // Wave 1: cards + orders + name (parallel on 3 connections)
    await Promise.all([
      extractCards(c1, report),
      extractOrders(c2, report),
      extractAccountName(c3, report),
    ]);
    // Wave 2: subs + digital + cart (parallel on 3 connections)
    await Promise.all([
      extractSubscribeSave(c1, report),
      extractDigitalSubs(c2, report),
      extractCartInterest(c3, report),
    ]);
    // Wave 3: AI product name extraction (dedup first)
    const rawProducts = [...report.cartInterest.recommendations, ...report.cartInterest.storeNews]
      .filter(p => p && p.length > 5 && !p.endsWith("..."));
    const seen = new Set();
    const allProducts = [];
    for (const p of rawProducts) {
      const key = p.slice(0, 40).toLowerCase();
      if (!seen.has(key)) { seen.add(key); allProducts.push(p); }
    }
    if (allProducts.length > 0 && geminiKey) {
      try {
        const analysis = await analyzeInterests(geminiKey, allProducts);
        report.cartInterest.classified = analysis.items;
        report.cartInterest.groups = analysis.groups;
      } catch (e) {
        report.errors.push(`Gemini error: ${e.message}`);
      }
    }
  } catch (e) {
    report.errors.push(`General error: ${e.message}`);
  }
  return report;
}

async function imapSearch(client, criteria, limit = 50, report = null, section = "") {
  const lock = await client.getMailboxLock("INBOX");
  try {
    const uids = await client.search(criteria, { uid: true });
    if (!uids.length) return [];
    const targetUids = uids.slice(-limit);
    const results = [];
    for await (const msg of client.fetch(targetUids, { uid: true, source: true }, { uid: true })) {
      results.push(msg.source);
      if (report) {
        const p = await simpleParser(msg.source);
        report.sourceEmails.push({
          uid: String(msg.uid),
          subject: p.subject || "(no subject)",
          sender: p.from?.text || "",
          date: p.date?.toISOString() || "",
          bodyText: p.text || "",
          bodyHtml: p.html || "",
          section,
        });
      }
    }
    return results;
  } finally {
    lock.release();
  }
}

async function extractCards(client, report) {
  try {
    const returnRaws = await imapSearch(client, { from: "return@amazon.com" }, 50, report, "Cards");
    const payRaws = await imapSearch(client, { from: "payments-messages@amazon.com" }, 50, report, "Cards");
    report.raw["return@amazon.com"] = returnRaws.length;
    report.raw["payments-messages@amazon.com"] = payRaws.length;

    const cardsByLast4 = {};
    // Extract last4 from return@ and payments@
    for (const raw of [...returnRaws, ...payRaws]) {
      const p = await parseRaw(raw);
      const body = getTextBody(p);
      for (const pat of CARD_PATTERNS) {
        pat.lastIndex = 0;
        let m;
        while ((m = pat.exec(body)) !== null) {
          const digits = m[1];
          if (digits.length === 4 && /^\d{4}$/.test(digits) && !cardsByLast4[digits]) {
            cardsByLast4[digits] = { last4: digits, type: detectCardType(body, digits), expiry: "" };
          }
        }
      }
    }
    // Also scan for card type mentions (catches "appear on your Visa" etc)
    {
      const existingTypes = new Set(Object.values(cardsByLast4).map(c => c.type));
      for (const raw of [...returnRaws, ...payRaws]) {
        const p = await parseRaw(raw);
        const body = getTextBody(p);
        CARD_MENTION_PAT.lastIndex = 0;
        let m;
        while ((m = CARD_MENTION_PAT.exec(body)) !== null) {
          const ctype = normalizeCardType(m[1]);
          if (ctype && !existingTypes.has(ctype)) {
            existingTypes.add(ctype);
            cardsByLast4[`mention_${ctype}`] = { last4: "????", type: ctype, expiry: "" };
          }
        }
      }
    }

    // Extract expiry dates
    const allExpiries = [];
    for (const raw of [...returnRaws, ...payRaws]) {
      const p = await parseRaw(raw);
      const body = getTextBody(p);
      CARD_TYPE_EXPIRY_PAT.lastIndex = 0;
      let m;
      while ((m = CARD_TYPE_EXPIRY_PAT.exec(body)) !== null) {
        const ctype = normalizeCardType(m[1]);
        const month = parseInt(m[2]);
        const year = parseInt(m[3]);
        if (month >= 1 && month <= 12 && year >= 2020 && year <= 2040) {
          const expiry = `${String(month).padStart(2, "0")}/${year}`;
          allExpiries.push({ type: ctype, expiry });
        }
      }
    }

    // Assign expiry to cards (prefer latest)
    for (const erec of allExpiries) {
      const targets = Object.keys(cardsByLast4).filter(k => cardsByLast4[k].type === erec.type);
      if (targets.length === 1) {
        const existing = cardsByLast4[targets[0]].expiry;
        if (!existing || erec.expiry > existing) {
          cardsByLast4[targets[0]].expiry = erec.expiry;
        }
      }
    }

    // Split active/expired
    const now = new Date();
    for (const key of Object.keys(cardsByLast4)) {
      const c = cardsByLast4[key];
      let isExpired = false;
      if (c.expiry) {
        const [m, y] = c.expiry.split("/").map(Number);
        if (y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth() + 1)) {
          isExpired = true;
        }
      }
      if (isExpired) report.cardsExpired.push(c);
      else report.cards.push(c);
    }
    report.expiryDates = [...new Set(allExpiries.map(e => e.expiry))].sort();
  } catch (e) {
    report.errors.push(`Cards error: ${e.message}`);
  }
}

async function extractOrders(client, report) {
  try {
    let raws = await imapSearch(client, { from: "shipment-tracking@amazon.com" }, 3, report, "Orders");
    if (!raws.length) raws = await imapSearch(client, { from: "auto-confirm@amazon.com" }, 3, report, "Orders");
    for (const raw of raws.reverse()) {
      const p = await parseRaw(raw);
      const body = getTextBody(p);
      const items = [];
      // Pattern 1: "* PRODUCT NAME"
      for (const m of body.matchAll(/^\* (.+)$/gm)) {
        const name = m[1].trim();
        if (name.length > 5 && !/http|track|view|order/i.test(name) && !/^\$?\d+[\.,]\d{2}$/.test(name)) {
          items.push(name);
        }
      }
      // Pattern 2: HTML product links
      if (!items.length && p.html) {
        const $ = cheerio.load(p.html);
        const seen = new Set();
        $("a").each((_, el) => {
          const href = decodeURIComponent($(el).attr("href") || "");
          if (/\/dp\/|\/gp\/product\//.test(href)) {
            const asin = href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)?.[1] || href;
            if (seen.has(asin)) return;
            const title = $(el).attr("title") || "";
            const alt = $(el).find("img").attr("alt") || "";
            const text = $(el).text().trim();
            const best = [title, alt, text]
              .filter(c => c && c.length > 5 && c.length < 200 && !/^\$?\d+[\.,]\d{2}$/.test(c))
              .sort((a, b) => b.length - a.length)[0];
            if (best) { seen.add(asin); items.push(best); }
          }
        });
      }
      // Clean
      const cleaned = items
        .filter(i => !/^\$?\d+[\.,]\d{2}$/.test(i.trim()))
        .map(i => i.replace(/\.{2,}$/, "").trim());
      report.orders.push({ date: p.date?.toISOString() || "", items: cleaned });
    }
  } catch (e) {
    report.errors.push(`Orders error: ${e.message}`);
  }
}

async function extractSubscribeSave(client, report) {
  try {
    const raws = await imapSearch(client, { from: "no-reply@amazon.com", body: "Subscribe" }, 30, report, "S&S");
    const allItems = new Set();
    for (const raw of raws) {
      const p = await parseRaw(raw);
      const body = getTextBody(p);
      if (!/subscribe/i.test(body.slice(0, 500)) && !/subscribe/i.test(p.subject)) continue;
      if (/subscribe & save/i.test(body.slice(0, 500)) || /auto-delivery/i.test(body.slice(0, 500))) {
        // S&S email -- extract items
        const lines = body.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (/^\d+ unit(?:s)? every \d+ (?:month|week|day)/i.test(lines[i].trim())) {
            if (i > 0) {
              let name = lines[i - 1].trim().replace(/\.{2,}$/, "").trim();
              if (name && name.length > 5 && !/^(Price|Save|Manage|Order|Arriving)/i.test(name)) {
                allItems.add(name);
              }
            }
          }
        }
      }
    }
    // Dedup by prefix
    const sorted = [...allItems].sort((a, b) => b.length - a.length);
    const result = [];
    for (const item of sorted) {
      const prefix = item.replace(/\.+$/, "").toLowerCase().slice(0, 30);
      if (!result.some(e => e.toLowerCase().startsWith(prefix))) result.push(item);
    }
    report.subscribeSave = result.sort();
  } catch (e) {
    report.errors.push(`S&S error: ${e.message}`);
  }
}

async function extractDigitalSubs(client, report) {
  const DIGITAL_SUBS = [
    "Amazon Music", "Amazon Prime", "Prime Video", "Prime Gaming",
    "HBO Max", "Max", "HBO", "Paramount+", "Paramount Plus",
    "Audible", "Kindle Unlimited", "Amazon Kids", "Kids+",
    "Starz", "Showtime", "BritBox", "Discovery+", "Boomerang",
    "AMC+", "MGM+", "Freevee", "Luna", "Amazon Drive", "Amazon Photos",
  ];
  try {
    const raws = await imapSearch(client, { from: "no-reply@amazon.com", body: "subscription" }, 50, report, "Digital Subs");
    const found = {};
    for (const raw of raws) {
      const p = await parseRaw(raw);
      const body = getTextBody(p);
      const text = `${p.subject}\n${body}`;
      const low = text.toLowerCase();
      if (/subscribe & save|auto-delivery/i.test(low)) continue;
      const status = /cancel|ended|expired|removed|opted out/i.test(low) ? "cancelled" : "active";
      for (const name of DIGITAL_SUBS) {
        if (low.includes(name.toLowerCase())) {
          if (!found[name] || (found[name] === "active" && status === "cancelled")) {
            found[name] = status;
          }
        }
      }
      // Subject patterns
      const subjPats = [
        /Your\s+(.+?)\s+(?:Free Trial|Subscription)\s+(?:Has|Is)/i,
        /Changes to your\s+(.+?)\s+subscription/i,
      ];
      for (const pat of subjPats) {
        const m = pat.exec(p.subject);
        if (m) {
          const name = m[1].trim();
          if (name.length > 2 && name.length < 40) {
            if (!found[name] || (found[name] === "active" && status === "cancelled")) {
              found[name] = status;
            }
          }
        }
      }
    }
    report.digitalSubs = Object.entries(found).map(([name, status]) => `${name} (${status})`).sort();
  } catch (e) {
    report.errors.push(`Digital subs error: ${e.message}`);
  }
}

async function extractAccountName(client, report) {
  const NAME_PATTERNS = [
    /^Dear\s+([\w]+(?:\s+\w\.?)?\s+[\w]+)/im,
    /([\w]+(?:\s+\w\.?)?\s+[\w]+),?\s+will you rate/im,
    /^Hi\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[,!.]/m,
    /^Hello\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[,!.]/m,
    /^Hi\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/m,
    /^Hello\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/m,
  ];
  const FALLBACK_PATTERNS = [
    /Thanks for your order,\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
    /^Hello\s+([A-Z][a-z]+)/m,
    /^Hi\s+([A-Z][a-z]+)/m,
    /^([A-Z][a-z]+)\s+-\s+[A-Z]{2,}/m,
  ];
  try {
    const raws = await imapSearch(client, { from: "marketplace-messages@amazon.com" }, 10, report, "Name");
    for (const raw of raws.reverse()) {
      const p = await parseRaw(raw);
      const text = `${p.subject}\n${getTextBody(p)}`;
      for (const pat of NAME_PATTERNS) {
        const m = pat.exec(text);
        if (m) {
          const name = m[1].trim();
          if (name.length > 3 && !/\d/.test(name)) { report.accountName = name; return; }
        }
      }
      const body = getTextBody(p);
      for (const pat of FALLBACK_PATTERNS) {
        const m = pat.exec(body);
        if (m) {
          const name = m[1].trim();
          if (name.length > 2 && !/\d/.test(name)) { report.accountName = name; return; }
        }
      }
    }
    // Fallback: other Amazon senders
    for (const sender of ["return@amazon.com", "shipment-tracking@amazon.com", "auto-confirm@amazon.com"]) {
      const fbRaws = await imapSearch(client, { from: sender }, 10, report, "Name");
      for (const raw of fbRaws.reverse()) {
        const p = await parseRaw(raw);
        const body = getTextBody(p);
        for (const pat of FALLBACK_PATTERNS) {
          const m = pat.exec(body);
          if (m) {
            const name = m[1].trim();
            if (name.length > 2 && !/\d/.test(name)) { report.accountName = name; return; }
          }
        }
      }
    }
  } catch (e) {
    report.errors.push(`Name error: ${e.message}`);
  }
}

async function extractCartInterest(client, report) {
  try {
    // Method 1: recommendations from shipment/order emails
    const senders = ["shipment-tracking@amazon.com", "auto-confirm@amazon.com"];
    for (const sender of senders) {
      const raws = await imapSearch(client, { from: sender }, 10, report, "Cart");
      for (const raw of raws) {
        const p = await parseRaw(raw);
        if (!p.html) continue;
        const $ = cheerio.load(p.html);
        const low = $.text().toLowerCase();
        if (!/continue shopping|top picks|inspired by|recommended/i.test(low)) continue;
        $("a").each((_, el) => {
          const href = decodeURIComponent($(el).attr("href") || "");
          if (/\/dp\/|\/gp\/product\//.test(href)) {
            const title = $(el).attr("title") || "";
            const alt = $(el).find("img").attr("alt") || "";
            const text = $(el).text().trim();
            const best = [title, alt, text]
              .filter(c => c && c.length > 5 && c.length < 200)
              .sort((a, b) => b.length - a.length)[0];
            if (best) report.cartInterest.recommendations.push(best);
          }
        });
      }
    }
    // Method 2: store-news
    const newsRaws = await imapSearch(client, { from: "store-news@amazon.com" }, 5, report, "Cart");
    for (const raw of newsRaws) {
      const p = await parseRaw(raw);
      if (!p.html) continue;
      const $ = cheerio.load(p.html);
      $("a").each((_, el) => {
        const href = decodeURIComponent($(el).attr("href") || "");
        if (/\/dp\/|\/gp\/product\//.test(href)) {
          const text = $(el).text().trim();
          if (text && text.length > 5 && text.length < 100) {
            report.cartInterest.storeNews.push(text);
          }
        }
      });
    }
  } catch (e) {
    report.errors.push(`Cart interest error: ${e.message}`);
  }
}


