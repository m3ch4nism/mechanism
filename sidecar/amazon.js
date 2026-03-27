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

export async function runAmazonCheck(clients, email, geminiKey, folders) {
  const [c1, c2, c3] = Array.isArray(clients) ? clients : [clients, clients, clients];
  // Prioritize INBOX first, then the rest
  const searchFolders = folders && folders.length > 0
    ? ["INBOX", ...folders.filter(f => f !== "INBOX")]
    : ["INBOX"];

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
      extractCards(c1, report, searchFolders),
      extractOrders(c2, report, searchFolders),
      extractAccountName(c3, report, searchFolders),
    ]);
    // Wave 2: subs + digital + cart (parallel on 3 connections)
    await Promise.all([
      extractSubscribeSave(c1, report, searchFolders),
      extractDigitalSubs(c2, report, searchFolders),
      extractCartInterest(c3, report, searchFolders),
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

async function imapSearch(client, criteria, limit = 50, report = null, section = "", folders = ["INBOX"]) {
  const results = [];
  const seenMsgIds = new Set();

  for (const folder of folders) {
    if (results.length >= limit) break;
    try {
      const lock = await client.getMailboxLock(folder);
      try {
        const uids = await client.search(criteria, { uid: true });
        if (!uids.length) continue;
        const remaining = limit - results.length;
        const targetUids = uids.slice(-remaining);
        for await (const msg of client.fetch(targetUids, { uid: true, source: true }, { uid: true })) {
          // Deduplicate by Message-ID header
          const headerChunk = msg.source.toString("utf8", 0, Math.min(msg.source.length, 4000));
          const msgIdMatch = headerChunk.match(/^Message-I[Dd]:\s*(<[^>]+>)/m);
          const msgId = msgIdMatch ? msgIdMatch[1] : null;
          if (msgId && seenMsgIds.has(msgId)) continue;
          if (msgId) seenMsgIds.add(msgId);

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
      } finally {
        lock.release();
      }
    } catch {
      // Skip folders that can't be selected (e.g., \Noselect, namespace roots)
    }
  }
  return results;
}

async function extractCards(client, report, folders) {
  try {
    const returnRaws = await imapSearch(client, { from: "return@amazon.com" }, 50, report, "Cards", folders);
    const payRaws = await imapSearch(client, { from: "payments-messages@amazon.com" }, 50, report, "Cards", folders);
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
    // Also scan for card type mentions (catches "appear on your Visa", "MasterCard Credit Card: $X" etc)
    {
      const PAY_CARD_PAT = /(Visa|MasterCard|Master\s*Card|AmericanExpress|American\s*Express|Amex|Discover|Diners|Amazon\s*(?:Store|Prime|\.com)\s*(?:Credit\s+)?Card)\s+Credit\s+Card/gi;
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
        PAY_CARD_PAT.lastIndex = 0;
        while ((m = PAY_CARD_PAT.exec(body)) !== null) {
          const ctype = normalizeCardType(m[1]);
          if (ctype && !existingTypes.has(ctype)) {
            existingTypes.add(ctype);
            cardsByLast4[`mention_${ctype}`] = { last4: "????", type: ctype, expiry: "" };
          }
        }
        // Fallback: match "TYPE Credit Card: $AMOUNT" lines directly (no prefix required)
        const DIRECT_CARD_PAT = /^\s*(Visa|MasterCard|Master\s*Card|Amex|American\s*Express|Discover)\s+Credit\s+Card\s*:/gim;
        DIRECT_CARD_PAT.lastIndex = 0;
        while ((m = DIRECT_CARD_PAT.exec(body)) !== null) {
          const ctype = normalizeCardType(m[1]);
          if (ctype && !existingTypes.has(ctype)) {
            existingTypes.add(ctype);
            cardsByLast4[`mention_${ctype}`] = { last4: "????", type: ctype, expiry: "" };
          }
        }
        // Also catch "Gift Card: $X" pattern
        if (/Gift\s+Card:\s+\$/i.test(body) && !existingTypes.has("Gift Card")) {
          existingTypes.add("Gift Card");
          cardsByLast4["mention_GiftCard"] = { last4: "----", type: "Gift Card", expiry: "" };
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

async function extractOrders(client, report, folders) {
  try {
    let raws = await imapSearch(client, { from: "shipment-tracking@amazon.com" }, 3, report, "Orders", folders);
    if (!raws.length) raws = await imapSearch(client, { from: "auto-confirm@amazon.com" }, 3, report, "Orders", folders);
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

async function extractSubscribeSave(client, report, folders) {
  try {
    const raws = await imapSearch(client, { from: "no-reply@amazon.com", body: "Subscribe & Save" }, 50, report, "S&S", folders);
    const allItems = new Set();
    for (const raw of raws) {
      const p = await parseRaw(raw);
      const body = getTextBody(p);
      const subj = p.subject || "";
      if (!/subscribe/i.test(body.slice(0, 800)) && !/subscribe/i.test(subj) && !/auto-delivery/i.test(subj)) continue;
      // Skip non-S&S emails (reviews, digital subs)
      if (/did your recent|review it on|will you rate|your opinion matters/i.test(subj)) continue;
      if (/Paramount|Prime Video|HBO|Audible|Kindle Unlimited|Starz|Showtime/i.test(subj)) continue;

      // Method 1: old format -- "N unit(s) every N month(s)" with product name on previous line
      const lines = body.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (/^\d+ unit(?:s)? every \d+ (?:month|week|day)/i.test(lines[i].trim())) {
          if (i > 0) {
            let name = lines[i - 1].trim().replace(/\.{2,}$/, "").trim();
            if (name && name.length > 5 && !/^(Price|Save|Manage|Order|Arriving|Estimated|Subtotal|Shipping|Payment|Last|Delivering)/i.test(name)) {
              allItems.add(name);
            }
          }
        }
      }

      // Method 2: "ITEM N\nPRODUCT NAME\n\nQUANTITY:" format
      for (let i = 0; i < lines.length; i++) {
        if (/^ITEM\s+\d+$/i.test(lines[i].trim())) {
          const next = (lines[i + 1] || "").trim();
          if (next && next.length > 5 && !/^QUANTITY|^ITEM PRICE|^\$/i.test(next)) {
            allItems.add(next.replace(/\.{2,}$/, "").trim());
          }
        }
      }

      // Method 3: new HTML format -- product links to /dp/ with nearby text
      if (p.html) {
        const $ = cheerio.load(p.html);
        $("a").each((_, el) => {
          const href = $(el).attr("href") || "";
          if (/\/dp\/[A-Z0-9]{10}/i.test(href) && !/ref=_sns_ryd_rec|ref=_em_rd_st/i.test(href)) {
            const text = $(el).text().trim().replace(/\.{2,}$/, "").trim();
            if (text && text.length > 10 && text.length < 200 && !/^(Shop|Learn|Manage|View|See|Save|Subscribe)/i.test(text)) {
              allItems.add(text);
            }
          }
        });
      }

      // Method 4: "Your new subscription" -- extract product from body
      if (/your new subscription/i.test(subj)) {
        for (let i = 0; i < lines.length; i++) {
          if (/^(Monthly|Every \d+ month|Weekly)/i.test(lines[i].trim())) {
            for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
              const candidate = lines[j].trim().replace(/\.{2,}$/, "").trim();
              if (candidate && candidate.length > 10 && !/^(SHIP TO|Manage|Ship to|Subscription)/i.test(candidate)) {
                allItems.add(candidate);
                break;
              }
            }
          }
        }
      }

      // Method 5: "ITEMS" section header (plural, no number) followed by product name
      for (let i = 0; i < lines.length; i++) {
        if (/^ITEMS$/i.test(lines[i].trim())) {
          const next = (lines[i + 1] || "").trim();
          if (next && next.length > 5 && !/^(SHIP|ESTIMATED|Subtotal|Manage|http|---|PENDING|APPROVED|NOT IN|IN THIS)/i.test(next)) {
            allItems.add(next.replace(/\.{2,}$/, "").trim());
          }
        }
      }

      // Method 6: "Subscription Details" format (2024+) -- product name with dp/ link in text
      if (/Subscription Details|thank you for setting up.*auto-delivery/i.test(body)) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          const dpMatch = line.match(/^(.{10,}?)\s*\(https?:\/\/www\.amazon\.com\/dp\/[A-Z0-9]{10}/i);
          if (dpMatch) {
            const candidate = dpMatch[1].trim().replace(/\.{2,}$/, "").trim();
            if (candidate && candidate.length > 10 && !/^(Ship|Manage|Learn|Save|Shop|Get|Edit|Up to|Cancel)/i.test(candidate)) {
              allItems.add(candidate);
            }
          }
        }
      }
    }
    // Dedup by prefix (30 chars)
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

async function extractDigitalSubs(client, report, folders) {
  const DIGITAL_SUBS = [
    "Amazon Music", "Amazon Prime", "Prime Video", "Prime Gaming",
    "HBO Max", "Max", "HBO", "Paramount+", "Paramount Plus",
    "Audible", "Kindle Unlimited", "Amazon Kids", "Kids+",
    "Starz", "Showtime", "BritBox", "Discovery+", "Boomerang",
    "AMC+", "MGM+", "Freevee", "Luna", "Amazon Drive", "Amazon Photos",
  ];
  try {
    const raws = await imapSearch(client, { from: "no-reply@amazon.com", body: "subscription" }, 50, report, "Digital Subs", folders);
    // found[name] = { status, date } -- keep most recent email's status
    const found = {};
    for (const raw of raws) {
      const p = await parseRaw(raw);
      const body = getTextBody(p);
      const subj = p.subject || "";
      const text = `${subj}\n${body}`;
      const low = text.toLowerCase();
      const emailDate = p.date ? new Date(p.date).getTime() : 0;
      // Skip S&S emails aggressively
      if (/subscribe & save|auto-delivery|upcoming delivery|your new subscription/i.test(low)) continue;
      if (/review your upcoming|payment method|update your payment/i.test(subj)) continue;
      if (/your opinion matters|did your recent|review it on amazon/i.test(subj)) continue;
      if (/seller.*requests you|message from.*seller/i.test(low)) continue;
      // "cancel/ended" only if it's about cancelling the sub, not price update
      const isCancelled = /cancel(?:led|lation)|ended|expired|removed|opted out/i.test(low)
        && !/price.*(?:increas|chang|updat)/i.test(low);
      const status = isCancelled ? "cancelled" : "active";
      for (const name of DIGITAL_SUBS) {
        const nameLow = name.toLowerCase();
        if (!low.includes(nameLow)) continue;
        const subLow = subj.toLowerCase();
        const inSubject = subLow.includes(nameLow);
        // If only mentioned in body (not subject), require subscription context nearby
        // to avoid false positives like "on Prime Video" in a Paramount+ email
        if (!inSubject) {
          const nameEsc = name.replace(/[+.*?^${}()|[\]\\]/g, "\\$&");
          const ctxRe = new RegExp(
            `(?:your|cancel|trial|renew|billing|charged|price|started|ended|active|sign.?up).{0,50}${nameEsc}|${nameEsc}.{0,50}(?:subscription|trial|cancel|renew|membership|billing|charged|price|started|ended|active)`,
            "i"
          );
          if (!ctxRe.test(text)) continue;
        }
        const prev = found[name];
        if (!prev || emailDate > prev.date) {
          found[name] = { status, date: emailDate };
        }
      }
      // Subject patterns
      const subjPats = [
        /Your\s+(.+?)\s+(?:Free Trial|Subscription)\s+(?:Has|Is)/i,
        /Changes to your\s+(.+?)\s+subscription/i,
        /Update to your\s+(.+?)\s+subscription/i,
      ];
      for (const pat of subjPats) {
        const m = pat.exec(subj);
        if (m) {
          const name = m[1].trim();
          if (name.length > 2 && name.length < 40) {
            const prev = found[name];
            if (!prev || emailDate > prev.date) {
              found[name] = { status, date: emailDate };
            }
          }
        }
      }
    }
    // Normalize: merge "Paramount+" and "Paramount Plus"
    if (found["Paramount Plus"] && !found["Paramount+"]) { found["Paramount+"] = found["Paramount Plus"]; }
    delete found["Paramount Plus"];
    report.digitalSubs = Object.entries(found).map(([name, v]) => `${name} (${v.status})`).sort();
  } catch (e) {
    report.errors.push(`Digital subs error: ${e.message}`);
  }
}

async function extractAccountName(client, report, folders) {
  const BLACKLIST = /^(amazon|hello|dear|items?|order|view|check|track|return|refund|click|manage|update|cancel|shop|learn|see|get|save|sign|log|visit|shipping|delivery|please|thank|buy|sell|price|free|new|from|your|this|that|the|here|more|now|out|all|for|has|was|are|our|its|and|the|you|how|did|not|but|any|can|may|will|have|what|why|per|inc|llc|corp|usa|qty|usd|ups|via|est|sun|mon|tue|wed|thu|fri|sat|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/i;
  // Collect name candidates with weights from multiple sources
  const candidates = {};
  function addCandidate(name, weight) {
    if (!name || name.length < 2 || /\d/.test(name)) return;
    // Check each word against blacklist
    const words = name.split(/\s+/);
    if (words.every(w => BLACKLIST.test(w))) return;
    const key = name.toLowerCase();
    if (!candidates[key]) candidates[key] = { name, count: 0, weight: 0 };
    candidates[key].count++;
    candidates[key].weight += weight;
  }
  try {
    // Source 1: marketplace-messages "NAME, will you rate" (highest reliability)
    const raws = await imapSearch(client, { from: "marketplace-messages@amazon.com" }, 10, report, "Name", folders);
    for (const raw of raws) {
      const p = await parseRaw(raw);
      const subjMatch = (p.subject || "").match(/^(.+?),\s+will you rate/i);
      if (subjMatch) addCandidate(subjMatch[1].trim(), 10);
      const body = getTextBody(p);
      const dearMatch = body.match(/^Dear\s+([A-Za-z]+(?:\s+[A-Za-z]+)*)/im);
      if (dearMatch) addCandidate(dearMatch[1], 8);
    }
    // Source 2: return@ / auto-confirm@ "Hello/Hi/Dear NAME,"
    for (const sender of ["return@amazon.com", "auto-confirm@amazon.com"]) {
      const fbRaws = await imapSearch(client, { from: sender }, 5, report, "Name", folders);
      for (const raw of fbRaws) {
        const p = await parseRaw(raw);
        const body = getTextBody(p);
        for (const pat of [/^Hello\s+([A-Za-z]+(?:\s+[A-Za-z]+)*)/im, /^Hi\s+([A-Za-z]+(?:\s+[A-Za-z]+)*)/im, /^Dear\s+([A-Za-z]+(?:\s+[A-Za-z]+)*)/im, /Thanks for your order,\s+([A-Za-z]+(?:\s+[A-Za-z]+)*)/i, /Delivering to\s+([A-Za-z]+(?:\s+[A-Za-z]+)*)/im]) {
          const m = pat.exec(body);
          if (m) addCandidate(m[1], 5);
        }
      }
    }
    // Source 3: shipment-tracking "Hi NAME," / "Delivering to NAME"
    const stRaws = await imapSearch(client, { from: "shipment-tracking@amazon.com" }, 5, report, "Name", folders);
    for (const raw of stRaws) {
      const p = await parseRaw(raw);
      const body = getTextBody(p);
      for (const pat of [/^Hi\s+([A-Za-z]+(?:\s+[A-Za-z]+)*)/im, /Delivering to\s+([A-Za-z]+(?:\s+[A-Za-z]+)*)/im]) {
        const m = pat.exec(body);
        if (m) addCandidate(m[1], 3);
      }
    }
    // Pick the candidate with highest total weight
    const best = Object.values(candidates).sort((a, b) => b.weight - a.weight)[0];
    if (best) report.accountName = best.name;
  } catch (e) {
    report.errors.push(`Name error: ${e.message}`);
  }
}

async function extractCartInterest(client, report, folders) {
  try {
    // Method 1: recommendations from shipment/order emails
    const senders = ["shipment-tracking@amazon.com", "auto-confirm@amazon.com"];
    for (const sender of senders) {
      const raws = await imapSearch(client, { from: sender }, 10, report, "Cart", folders);
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
    const newsRaws = await imapSearch(client, { from: "store-news@amazon.com" }, 5, report, "Cart", folders);
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


