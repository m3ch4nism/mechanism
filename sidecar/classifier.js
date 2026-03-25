import https from "https";

function llmRequest(apiKey, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 1024,
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

export async function classifyProducts(apiKey, productNames) {
  if (!apiKey || !productNames.length) return [];

  const list = productNames
    .filter(n => n && n.length > 3)
    .slice(0, 30)
    .map((n, i) => `${i + 1}. ${n}`)
    .join("\n");

  const prompt = `You are a product name simplifier. For each Amazon product listing below, extract the SHORT common product name (what the item actually is).

Rules:
- Return ONLY the simple product name (1-3 words max)
- Remove brands, model numbers, sizes, colors, materials, quantities
- Examples:
  "Telescopic Fishing Rod Carbon Fiber 12ft" → "Fishing Rod"
  "Sony WH-1000XM5 Wireless Noise Cancelling Headphones Black" → "Headphones"
  "SAMSUNG Galaxy S24 Ultra Case Clear Slim" → "Phone Case"
  "Instant Pot Duo 7-in-1 Electric Pressure Cooker 6Qt" → "Pressure Cooker"
  "Crest 3D White Toothpaste Radiant Mint 3.8oz 3-Pack" → "Toothpaste"

Return ONLY a JSON array of objects: [{"id": 1, "name": "short name"}, ...]
No explanation, no markdown, just the JSON array.

Products:
${list}`;

  const raw = await llmRequest(apiKey, prompt);
  try {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```/g, "").trim();
    const results = JSON.parse(cleaned);
    return productNames.map((original, i) => {
      const match = results.find(r => r.id === i + 1);
      return { original, name: match?.name || original };
    });
  } catch {
    return productNames.map(p => ({ original: p, name: p }));
  }
}

export async function analyzeInterests(apiKey, productNames) {
  if (!apiKey || !productNames.length) return { items: productNames.map(p => ({ original: p, name: p })), summary: null };

  const classified = await classifyProducts(apiKey, productNames);

  const groups = {};
  for (const item of classified) {
    const key = item.name.toLowerCase();
    if (!groups[key]) groups[key] = { name: item.name, count: 0, originals: [] };
    groups[key].count++;
    if (groups[key].originals.length < 3) groups[key].originals.push(item.original);
  }

  const sorted = Object.values(groups).sort((a, b) => b.count - a.count);
  return { items: classified, groups: sorted };
}
