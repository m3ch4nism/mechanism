import https from "https";

function llmRequest(apiKey, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 2048,
    });
    const req = https.request({
      hostname: "api.groq.com",
      path: "/openai/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message));
          resolve(json.choices?.[0]?.message?.content || "");
        } catch { reject(new Error("Failed to parse API response")); }
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("API timeout")); });
    req.write(body);
    req.end();
  });
}

const PROMPT_TEMPLATE = `Extract the SHORT product name (1-3 words) for each item. Remove brands, sizes, colors, model numbers.

Examples: "Sony WH-1000XM5 Wireless Headphones Black" → "Headphones" | "SAMSUNG Galaxy S24 Case" → "Phone Case"

Return ONLY JSON: [{"id":1,"name":"short name"},...]

Products:
`;

async function classifyBatch(apiKey, items) {
  const list = items.map((n, i) => `${i + 1}. ${n}`).join("\n");
  const raw = await llmRequest(apiKey, PROMPT_TEMPLATE + list);
  try {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```/g, "").trim();
    const results = JSON.parse(cleaned);
    return items.map((original, i) => {
      const match = results.find(r => r.id === i + 1);
      return match?.name || original;
    });
  } catch {
    return items.map(n => n);
  }
}

export async function classifyProducts(apiKey, productNames) {
  if (!apiKey || !productNames.length) return [];

  const filtered = productNames.filter(n => n && n.length > 3);
  const BATCH = 15;
  const allNames = [];

  for (let i = 0; i < filtered.length; i += BATCH) {
    const batch = filtered.slice(i, i + BATCH);
    try {
      const names = await classifyBatch(apiKey, batch);
      allNames.push(...names);
    } catch {
      allNames.push(...batch);
    }
  }

  return filtered.map((original, i) => ({
    original,
    name: allNames[i] || original,
  }));
}

export async function analyzeInterests(apiKey, productNames) {
  if (!apiKey || !productNames.length) return { items: productNames.map(p => ({ original: p, name: p })), summary: null };

  const classified = await classifyProducts(apiKey, productNames);

  const groups = {};
  for (const item of classified) {
    const key = item.name.toLowerCase().trim();
    if (!groups[key]) groups[key] = { name: item.name, count: 0, originals: [] };
    groups[key].count++;
    if (groups[key].originals.length < 3) groups[key].originals.push(item.original);
  }

  const sorted = Object.values(groups).sort((a, b) => b.count - a.count);
  return { items: classified, groups: sorted };
}
