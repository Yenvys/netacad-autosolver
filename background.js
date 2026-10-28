// NetAcad AI & Auto-Submit Assistant - Background Service Worker (v1.8.0 Multi-Key Fallback Edition)

const DEFAULT_CONFIG = {
  enabled: false,          // AI Auto-Solve toggle
  manualAutoSubmit: true,  // Auto-Submit when user manually clicks option(s) (works with 0 quota / AI OFF)
  provider: "gemini",
  model: "gemini-3.8-flash",
  apiKey: "",              // Slot Key #1 (Utama)
  apiKey2: "",             // Slot Key #2 (Fallback Cadangan 1)
  apiKey3: "",             // Slot Key #3 (Fallback Cadangan 2)
  activeKeySlot: 1,        // Currently preferred key slot (1, 2, or 3)
  keySlotStatuses: {},     // { 1: { state: 'ok'|'limit'|'err', msg: '...' }, ... }
  customEndpoint: "",
  quotaLevel: "lvl1_eco",  // 'lvl1_eco' | 'lvl2_smart' | 'lvl3_pro' | 'lvl4_max'
  useLocalCache: true,
  autoSelect: true,
  autoSubmit: true,
  autoNext: true,
  reloadAfterSubmit: false,
  stealthMode: false,
  showExplanation: true,   // Default true so Expand Detail always has explanation ready
  actionDelayMs: 750,
  courseContext: "Cisco CCNA / NetAcad",
  lastResult: null,
  apiCallCount: 0,
  cacheHitCount: 0
};

const LEGACY_GEMINI_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-pro"
]);

const inFlightRequests = new Map();
// Temporary cooldown map for rate-limited keys: slotNumber -> timestamp when cooldown expires
const rateLimitedSlots = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(null);
  const merged = { ...DEFAULT_CONFIG, ...stored };
  if (merged.provider === "gemini" && LEGACY_GEMINI_MODELS.has(merged.model)) {
    merged.model = "gemini-3.8-flash";
  }
  if (!merged.quotaLevel) merged.quotaLevel = "lvl1_eco";
  if (merged.manualAutoSubmit === undefined) merged.manualAutoSubmit = true;
  await chrome.storage.local.set(merged);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const targetUrl = changeInfo.url || tab?.url || "";
  if (!/netacad\.com|skillsforall\.com|cisco\.com/i.test(targetUrl)) return;

  if (changeInfo.url || changeInfo.status === "complete") {
    chrome.tabs.sendMessage(tabId, {
      type: "URL_CONTEXT_CHANGED",
      payload: {
        url: targetUrl,
        title: tab?.title || "",
        reason: changeInfo.url ? "url_changed" : "page_loaded"
      }
    }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SOLVE_QUESTION") {
    handleSolveQuestion(message.payload, sender.tab)
      .then((res) => sendResponse({ ok: true, data: res }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message.type === "TEST_API_KEY") {
    handleTestAllApiKeys(message.payload)
      .then((res) => sendResponse({ ok: true, data: res }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message.type === "CLEAR_ANSWER_CACHE") {
    chrome.storage.local.set({ answerCache: {}, cacheHitCount: 0, apiCallCount: 0 })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "BROADCAST_TO_TAB") {
    broadcastToActiveTab(message.payload)
      .then((res) => sendResponse({ ok: true, data: res }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message.type === "RELOAD_ACTIVE_TAB" && sender.tab?.id) {
    chrome.tabs.reload(sender.tab.id)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "FORWARD_HUD_UPDATE" && sender.tab?.id) {
    chrome.tabs.sendMessage(sender.tab.id, {
      type: "HUD_STATUS_UPDATE",
      payload: message.payload
    }).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }
});

async function broadcastToActiveTab(payload) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("Tidak ada tab aktif yang ditemukan.");
  await chrome.tabs.sendMessage(tab.id, payload);
  return { tabId: tab.id };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function captureCleanTabScreenshot(tab, jpegQuality = 55) {
  try {
    if (!tab || !tab.windowId || !tab.id) return null;
    await chrome.tabs.sendMessage(tab.id, { type: "TEMP_HIDE_HUD", hide: true }).catch(() => {});
    await sleep(60);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality: jpegQuality
    });
    await chrome.tabs.sendMessage(tab.id, { type: "TEMP_HIDE_HUD", hide: false }).catch(() => {});
    return dataUrl;
  } catch {
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: "TEMP_HIDE_HUD", hide: false }).catch(() => {});
    }
    return null;
  }
}

function buildCacheKey(payload) {
  const qNorm = (payload.questionText || "").toLowerCase().replace(/\s+/g, " ").trim();
  const optNorm = (payload.options || []).map((o) => o.toLowerCase().replace(/\s+/g, " ").trim()).join("|");
  return `${payload.requiredCount || 1}::${qNorm}::${optNorm}`;
}

// Always include concise explanation "r" so the Expand Detail button on the HUD always has rich detail to show!
function buildPromptsByLevel(payload, config) {
  const level = config.quotaLevel || "lvl1_eco";
  const count = Number(payload.requiredCount) || 1;
  const opts = (payload.options || []).map((o, i) => `[${i}] ${o}`).join("\n");

  if (level === "lvl1_eco") {
    const systemPrompt = `You are a Cisco NetAcad quiz solver. Select the exact ${count} correct 0-based option index(es). Return ONLY valid JSON: {"selectedIndices":[0],"selectedTexts":["exact option text"],"explanation":"1 kalimat singkat alasan jawaban dalam Bahasa Indonesia"}`;
    const userPrompt = `Question (pick ${count}):\n${payload.questionText}\n\nOptions:\n${opts}`;
    return { systemPrompt, userPrompt };
  }

  if (level === "lvl2_smart") {
    const systemPrompt = `You are a Cisco NetAcad (${config.courseContext || "CCNA"}) solver. Select the exact ${count} correct 0-based option index(es). Return ONLY valid JSON: {"selectedIndices":[0],"selectedTexts":["exact option text"],"explanation":"alasan singkat 1-2 kalimat dalam Bahasa Indonesia"}`;
    const userPrompt = `[${payload.moduleHeading || "Quiz"}] Question (pick ${count}):\n${payload.questionText}\n\nOptions:\n${opts}`;
    return { systemPrompt, userPrompt };
  }

  if (level === "lvl3_pro") {
    const systemPrompt = `You are an expert Cisco NetAcad solver (${config.courseContext || "CCNA"}). Select the exact ${count} correct option(s). Return ONLY valid JSON: {"selectedIndices":[0],"selectedTexts":["exact option text"],"confidence":99,"explanation":"penjelasan jelas dalam Bahasa Indonesia"}`;
    const userPrompt = `Module: ${payload.moduleHeading || "Quiz"}\nQuestion (${payload.questionNumberLabel || ""} - pick ${count}):\n${payload.questionText}\n\nOptions:\n${opts}`;
    return { systemPrompt, userPrompt };
  }

  const systemPrompt = `You are a Senior Cisco CCNA/CCNP Exam Solver. Carefully analyze the question, exhibit/topology, and options. Select the exact ${count} correct answer(s). Return ONLY valid JSON: {"selectedIndices":[0],"selectedTexts":["exact option text"],"confidence":99,"explanation":"penjelasan teknis lengkap dalam Bahasa Indonesia"}`;
  const userPrompt = `Module: ${payload.moduleHeading || "Cisco NetAcad"}\nQuestion (${payload.questionNumberLabel || ""} - pick ${count}):\n${payload.questionText}\n\nOptions:\n${opts}`;
  return { systemPrompt, userPrompt };
}

function normalizeAiResponse(rawText, options) {
  if (!rawText) throw new Error("Respons AI kosong.");
  let cleaned = rawText.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/"(?:i|selectedIndices)"\s*:\s*\[([0-9,\s]+)\]/);
    if (m) {
      const nums = m[1].split(",").map((n) => parseInt(n.trim(), 10)).filter((n) => !Number.isNaN(n));
      parsed = { selectedIndices: nums };
    } else {
      throw new Error(`Format JSON AI tidak valid: ${cleaned.slice(0, 100)}`);
    }
  }

  const indices = Array.isArray(parsed.selectedIndices)
    ? parsed.selectedIndices
    : Array.isArray(parsed.i)
    ? parsed.i
    : [];

  const validIndices = indices
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 0 && n < (options?.length || 20));

  const texts = Array.isArray(parsed.selectedTexts)
    ? parsed.selectedTexts
    : Array.isArray(parsed.t)
    ? parsed.t
    : validIndices.map((idx) => options?.[idx]).filter(Boolean);

  const letters = Array.isArray(parsed.selectedLetters) && parsed.selectedLetters.length > 0
    ? parsed.selectedLetters
    : validIndices.map((idx) => String.fromCharCode(65 + idx));

  const explanation = parsed.explanation || parsed.r || "";
  const confidence = parsed.confidence || parsed.c || 99;

  return {
    selectedIndices: validIndices,
    selectedLetters: letters,
    selectedTexts: texts,
    confidence,
    explanation
  };
}

function extractGeminiCandidateText(data) {
  const candidates = data?.candidates || [];
  for (const cand of candidates) {
    const parts = cand?.content?.parts || [];
    const visibleParts = parts.filter((p) => !p.thought && typeof p.text === "string" && p.text.trim().length > 0);
    if (visibleParts.length > 0) {
      return visibleParts.map((p) => p.text).join("\n").trim();
    }
    const jsonParts = parts.filter((p) => typeof p.text === "string" && p.text.includes("{") && p.text.includes("}"));
    if (jsonParts.length > 0) {
      return jsonParts.map((p) => p.text).join("\n").trim();
    }
    const allText = parts.map((p) => p.text || "").join("\n").trim();
    if (allText) return allText;
  }
  return "";
}

async function callSingleGeminiKey({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  screenshotDataUrl,
  options
}) {
  const modelName = model || "gemini-3.8-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const parts = [{ text: userPrompt }];
  if (screenshotDataUrl && screenshotDataUrl.startsWith("data:image/")) {
    const [meta, base64Data] = screenshotDataUrl.split(",");
    const mimeMatch = meta.match(/data:(image\/[a-zA-Z0-9+.-]+);base64/);
    if (base64Data) {
      parts.push({
        inline_data: {
          mime_type: mimeMatch ? mimeMatch[1] : "image/jpeg",
          data: base64Data
        }
      });
    }
  }

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.0,
      responseMimeType: "application/json"
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    const err = new Error(`HTTP ${res.status}: ${errText.slice(0, 180)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  let text = extractGeminiCandidateText(data);

  if (!text) {
    const fallbackBody = {
      contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
      generationConfig: { temperature: 0.0 }
    };
    const retryRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fallbackBody)
    });
    if (retryRes.ok) {
      const retryData = await retryRes.json();
      text = extractGeminiCandidateText(retryData);
    }
  }

  if (!text) {
    const finishReason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || "EMPTY";
    const err = new Error(`Respons AI kosong (${finishReason})`);
    err.status = 502;
    throw err;
  }

  return normalizeAiResponse(text, options);
}

async function callSingleOpenAiKey({
  endpoint,
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  screenshotDataUrl,
  options,
  extraHeaders = {}
}) {
  const userContent = [{ type: "text", text: userPrompt }];
  if (screenshotDataUrl && screenshotDataUrl.startsWith("data:image/")) {
    userContent.push({
      type: "image_url",
      image_url: { url: screenshotDataUrl }
    });
  }

  const body = {
    model,
    temperature: 0.0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: screenshotDataUrl ? userContent : userPrompt }
    ]
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      ...extraHeaders
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    const err = new Error(`HTTP ${res.status}: ${errText.slice(0, 180)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  return normalizeAiResponse(text, options);
}

// Build ordered list of available API key slots [{ slot: 1, key: '...' }, ...]
// Prioritizing slots that are NOT currently in rate-limit cooldown
function getOrderedKeySlots(config) {
  const rawSlots = [
    { slot: 1, key: (config.apiKey || "").trim() },
    { slot: 2, key: (config.apiKey2 || "").trim() },
    { slot: 3, key: (config.apiKey3 || "").trim() }
  ].filter((s) => s.key.length > 0);

  const now = Date.now();
  const ready = [];
  const cooled = [];

  for (const item of rawSlots) {
    const until = rateLimitedSlots.get(item.slot) || 0;
    if (now < until) {
      cooled.push(item);
    } else {
      rateLimitedSlots.delete(item.slot);
      ready.push(item);
    }
  }

  // Put ready slots first, followed by cooled slots as last-resort retry
  return [...ready, ...cooled];
}

// Execute AI request with automatic Multi-Key Fallback (Slot 1 -> Slot 2 -> Slot 3)
async function callAiWithMultiKeyFallback({
  config,
  systemPrompt,
  userPrompt,
  screenshotDataUrl,
  options
}) {
  const keySlots = getOrderedKeySlots(config);
  if (keySlots.length === 0) {
    throw new Error("NO_API_KEY: Belum ada API Key yang diisi di Slot #1/#2/#3.");
  }

  const provider = config.provider || "gemini";
  const model = config.model || "gemini-3.8-flash";
  const errorsPerSlot = [];
  const slotStatuses = { ...(config.keySlotStatuses || {}) };
  let fallbackOccurred = false;
  let initialSlot = keySlots[0].slot;

  for (let i = 0; i < keySlots.length; i++) {
    const { slot, key } = keySlots[i];
    if (i > 0) fallbackOccurred = true;

    try {
      let res;
      if (provider === "gemini") {
        res = await callSingleGeminiKey({
          apiKey: key,
          model,
          systemPrompt,
          userPrompt,
          screenshotDataUrl,
          options
        });
      } else {
        let endpoint = "https://api.openai.com/v1/chat/completions";
        let extraHeaders = {};
        if (provider === "groq") {
          endpoint = "https://api.groq.com/openai/v1/chat/completions";
        } else if (provider === "openrouter") {
          endpoint = config.customEndpoint?.trim() || "https://openrouter.ai/api/v1/chat/completions";
          extraHeaders = { "HTTP-Referer": "https://www.netacad.com", "X-Title": "NetAcad Assistant" };
        }
        res = await callSingleOpenAiKey({
          endpoint,
          apiKey: key,
          model,
          systemPrompt,
          userPrompt,
          screenshotDataUrl,
          options,
          extraHeaders
        });
      }

      // Mark this slot healthy
      slotStatuses[slot] = { state: "ok", msg: "Aktif", updatedAt: Date.now() };
      await chrome.storage.local.set({ activeKeySlot: slot, keySlotStatuses: slotStatuses });

      return {
        ...res,
        usedKeySlot: slot,
        fallbackOccurred,
        fallbackFromSlot: fallbackOccurred ? initialSlot : null,
        totalConfiguredKeys: keySlots.length
      };
    } catch (err) {
      const status = err.status || 0;
      const isLimit = status === 429 || status === 503 || /429|quota|rate|exhausted/i.test(err.message || "");
      if (isLimit) {
        // Put this key slot on a 60-second cooldown and immediately try the next key slot!
        rateLimitedSlots.set(slot, Date.now() + 60000);
        slotStatuses[slot] = { state: "limit", msg: "Limit 429", updatedAt: Date.now() };
      } else {
        slotStatuses[slot] = { state: "err", msg: `Err ${status || ""}`.trim(), updatedAt: Date.now() };
      }
      errorsPerSlot.push(`Key #${slot}: ${isLimit ? "Limit Kuota (429)" : err.message}`);
    }
  }

  await chrome.storage.local.set({ keySlotStatuses: slotStatuses });
  throw new Error(
    `QUOTA_EXCEEDED: Semua API Key (${keySlots.length} slot) limit/gagal. Detail: ${errorsPerSlot.join(" | ")}`
  );
}

async function handleSolveQuestion(payload, tab) {
  const stored = await chrome.storage.local.get(null);
  const config = { ...DEFAULT_CONFIG, ...stored };

  const cacheKey = buildCacheKey(payload);
  const answerCache = stored.answerCache || {};

  if (
    config.useLocalCache &&
    answerCache[cacheKey] &&
    Array.isArray(answerCache[cacheKey].selectedIndices) &&
    answerCache[cacheKey].selectedIndices.length > 0
  ) {
    const cachedResult = {
      ...answerCache[cacheKey],
      fromCache: true,
      timestamp: new Date().toISOString()
    };
    const nextHitCount = (Number(stored.cacheHitCount) || 0) + 1;
    await chrome.storage.local.set({
      lastResult: cachedResult,
      cacheHitCount: nextHitCount
    });
    return cachedResult;
  }

  if (inFlightRequests.has(cacheKey)) {
    return await inFlightRequests.get(cacheKey);
  }

  const requestPromise = (async () => {
    const level = config.quotaLevel || "lvl1_eco";

    let screenshotDataUrl = null;
    if (tab) {
      if (level === "lvl2_smart" && payload.hasVisualExhibit) {
        screenshotDataUrl = await captureCleanTabScreenshot(tab, 50);
      } else if (level === "lvl3_pro") {
        screenshotDataUrl = await captureCleanTabScreenshot(tab, 50);
      } else if (level === "lvl4_max") {
        screenshotDataUrl = await captureCleanTabScreenshot(tab, 80);
      }
    }

    const { systemPrompt, userPrompt } = buildPromptsByLevel(payload, config);

    const result = await callAiWithMultiKeyFallback({
      config,
      systemPrompt,
      userPrompt,
      screenshotDataUrl,
      options: payload.options
    });

    const enriched = {
      ...result,
      fromCache: false,
      quotaLevel: level,
      usedVision: Boolean(screenshotDataUrl),
      timestamp: new Date().toISOString(),
      questionNumberLabel: payload.questionNumberLabel || "",
      questionSnippet: (payload.questionText || "").slice(0, 120),
      provider: config.provider || "gemini",
      model: config.model || "gemini-3.8-flash"
    };

    const latestStore = await chrome.storage.local.get(["answerCache", "apiCallCount"]);
    const updatedCache = { ...(latestStore.answerCache || {}), [cacheKey]: enriched };
    const nextApiCount = (Number(latestStore.apiCallCount) || 0) + 1;

    await chrome.storage.local.set({
      answerCache: updatedCache,
      lastResult: enriched,
      apiCallCount: nextApiCount
    });

    return enriched;
  })();

  inFlightRequests.set(cacheKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

// Test ALL configured API Key Slots (#1, #2, #3) with real quota & model check and return detailed notification report
async function handleTestAllApiKeys(testPayload) {
  const { provider, model, apiKey, apiKey2, apiKey3, customEndpoint } = testPayload;
  const slots = [
    { slot: 1, key: (apiKey || "").trim() },
    { slot: 2, key: (apiKey2 || "").trim() },
    { slot: 3, key: (apiKey3 || "").trim() }
  ].filter((s) => s.key.length > 0);

  if (slots.length === 0) {
    throw new Error("Masukkan minimal 1 API Key di Slot #1 terlebih dahulu.");
  }

  const modelName = model || "gemini-3.8-flash";
  const results = [];
  const slotStatuses = {};

  for (const { slot, key } of slots) {
    const startMs = Date.now();
    try {
      if (provider === "gemini") {
        // Test real lightweight generation so we know both validity AND whether quota (429) is available!
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(key)}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: "Reply OK" }] }]
          })
        });
        const elapsed = Date.now() - startMs;

        if (!res.ok) {
          const errText = await res.text();
          const isLimit = res.status === 429 || /quota|rate|exhausted/i.test(errText);
          slotStatuses[slot] = {
            state: isLimit ? "limit" : "err",
            msg: isLimit ? "Limit 429" : `Err ${res.status}`
          };
          results.push({
            slot,
            ok: false,
            state: isLimit ? "limit" : "err",
            status: res.status,
            latencyMs: elapsed,
            summary: isLimit ? `Key #${slot}: Limit Kuota (429)` : `Key #${slot}: Error (${res.status})`,
            detail: errText.slice(0, 220)
          });
          continue;
        }

        rateLimitedSlots.delete(slot);
        slotStatuses[slot] = { state: "ok", msg: `Aktif (${elapsed}ms)` };
        results.push({
          slot,
          ok: true,
          state: "ok",
          status: 200,
          latencyMs: elapsed,
          summary: `Key #${slot}: Aktif & Kuota Tersedia (${elapsed}ms)`,
          detail: `Model ${modelName} siap digunakan pada Slot #${slot}.`
        });
      } else {
        let endpoint = "https://api.openai.com/v1/chat/completions";
        if (provider === "groq") endpoint = "https://api.groq.com/openai/v1/chat/completions";
        if (provider === "openrouter") endpoint = customEndpoint?.trim() || "https://openrouter.ai/api/v1/chat/completions";

        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${key}`
          },
          body: JSON.stringify({
            model: modelName,
            messages: [{ role: "user", content: "OK" }]
          })
        });
        const elapsed = Date.now() - startMs;

        if (!res.ok) {
          const errText = await res.text();
          const isLimit = res.status === 429;
          slotStatuses[slot] = { state: isLimit ? "limit" : "err", msg: isLimit ? "Limit 429" : `Err ${res.status}` };
          results.push({
            slot,
            ok: false,
            state: isLimit ? "limit" : "err",
            status: res.status,
            latencyMs: elapsed,
            summary: isLimit ? `Key #${slot}: Limit Kuota (429)` : `Key #${slot}: Error (${res.status})`,
            detail: errText.slice(0, 220)
          });
          continue;
        }

        rateLimitedSlots.delete(slot);
        slotStatuses[slot] = { state: "ok", msg: `Aktif (${elapsed}ms)` };
        results.push({
          slot,
          ok: true,
          state: "ok",
          status: 200,
          latencyMs: elapsed,
          summary: `Key #${slot}: Aktif & Siap (${elapsed}ms)`,
          detail: `Model ${modelName} merespons normal.`
        });
      }
    } catch (netErr) {
      slotStatuses[slot] = { state: "err", msg: "Gagal" };
      results.push({
        slot,
        ok: false,
        state: "err",
        status: 0,
        latencyMs: Date.now() - startMs,
        summary: `Key #${slot}: Gagal Koneksi`,
        detail: netErr.message || String(netErr)
      });
    }
  }

  const firstWorking = results.find((r) => r.ok);
  await chrome.storage.local.set({
    keySlotStatuses: slotStatuses,
    activeKeySlot: firstWorking ? firstWorking.slot : 1
  });

  return {
    anyOk: Boolean(firstWorking),
    activeSlot: firstWorking ? firstWorking.slot : null,
    results
  };
}
