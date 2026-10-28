// NetAcad Assistant - Popup Controller (v1.8.0)

const MODEL_PRESETS = {
  gemini: [
    { value: "gemini-3.8-flash", label: "3.8 Flash (Default)" },
    { value: "gemini-3.5-flash-lite", label: "3.5 Flash-Lite (Irit)" },
    { value: "gemini-3.1-flash-lite", label: "3.1 Flash-Lite" },
    { value: "gemini-3.6-flash", label: "3.6 Flash" },
    { value: "gemini-3-flash-preview", label: "3.0 Flash" },
    { value: "gemini-omni-1.1-flash", label: "Omni 1.1 Flash" },
    { value: "gemini-3.1-pro-preview", label: "3.1 Pro" },
    { value: "gemini-3.8-live", label: "3.8 Live" },
    { value: "gemini-3.8-live-extended-thinking", label: "3.8 Extended Thinking" },
    { value: "gemini-3.1-flash-live-preview", label: "3.1 Flash Live" },
    { value: "gemini-nano-banana-2.1", label: "Nano Banana 2.1" },
    { value: "gemini-3.1-flash-image", label: "Nano Banana 2" },
    { value: "gemini-3.1-flash-lite-image", label: "Nano Banana 2 Lite" },
    { value: "gemini-3-pro-image", label: "Nano Banana Pro" },
    { value: "gemini-3.5-transcribe", label: "3.5 Transcribe" },
    { value: "gemini-3.5-transcribe-live", label: "3.5 Transcribe Live" },
    { value: "gemini-3.5-live-translate-preview", label: "3.5 Live Translate" },
    { value: "gemini-3.8-flash-tts", label: "3.8 Flash TTS" },
    { value: "gemini-3.8-flash-lite-tts", label: "3.8 Lite TTS" },
    { value: "gemini-3.1-flash-tts-preview", label: "3.1 Flash TTS" }
  ],
  openrouter: [
    { value: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash" },
    { value: "google/gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
    { value: "google/gemini-3.6-flash", label: "Gemini 3.6 Flash" },
    { value: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" }
  ],
  openai: [
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "o3-mini", label: "o3-mini" }
  ],
  groq: [
    { value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
    { value: "deepseek-r1-distill-llama-70b", label: "DeepSeek R1 70B" }
  ]
};

const els = {
  enabled: document.getElementById("enabled"),
  aiModeCard: document.getElementById("aiModeCard"),
  manualAutoSubmit: document.getElementById("manualAutoSubmit"),
  manualModeCard: document.getElementById("manualModeCard"),
  quotaLevel: document.getElementById("quotaLevel"),
  levelTabs: document.querySelectorAll(".lvl-tab"),
  useLocalCache: document.getElementById("useLocalCache"),
  quotaStats: document.getElementById("quotaStats"),
  clearCacheBtn: document.getElementById("clearCacheBtn"),
  provider: document.getElementById("provider"),
  modelSelect: document.getElementById("modelSelect"),
  customModel: document.getElementById("customModel"),
  customEndpoint: document.getElementById("customEndpoint"),
  apiKey: document.getElementById("apiKey"),
  apiKey2: document.getElementById("apiKey2"),
  apiKey3: document.getElementById("apiKey3"),
  slotBadge1: document.getElementById("slotBadge1"),
  slotBadge2: document.getElementById("slotBadge2"),
  slotBadge3: document.getElementById("slotBadge3"),
  toggleFallbackBtn: document.getElementById("toggleFallbackBtn"),
  fallbackSlotsContainer: document.getElementById("fallbackSlotsContainer"),
  toggleKeyBtn: document.getElementById("toggleKeyBtn"),
  testApiBtn: document.getElementById("testApiBtn"),
  apiTestNotif: document.getElementById("apiTestNotif"),
  apiNotifSummary: document.getElementById("apiNotifSummary"),
  apiNotifExpandBtn: document.getElementById("apiNotifExpandBtn"),
  apiNotifDetail: document.getElementById("apiNotifDetail"),
  autoSelect: document.getElementById("autoSelect"),
  autoSubmit: document.getElementById("autoSubmit"),
  autoNext: document.getElementById("autoNext"),
  reloadAfterSubmit: document.getElementById("reloadAfterSubmit"),
  showExplanation: document.getElementById("showExplanation"),
  stealthMode: document.getElementById("stealthMode"),
  actionDelayMs: document.getElementById("actionDelayMs"),
  delayLabel: document.getElementById("delayLabel"),
  courseContext: document.getElementById("courseContext"),
  solveNowBtn: document.getElementById("solveNowBtn"),
  lastResultCard: document.getElementById("lastResultCard"),
  lastResultTitle: document.getElementById("lastResultTitle"),
  lastResultSummary: document.getElementById("lastResultSummary"),
  lastResultExplanation: document.getElementById("lastResultExplanation"),
  expandExplanationBtn: document.getElementById("expandExplanationBtn")
};

function populateModels(provider, currentModel) {
  const list = MODEL_PRESETS[provider] || MODEL_PRESETS.gemini;
  els.modelSelect.innerHTML = "";
  let matched = false;

  for (const item of list) {
    const opt = document.createElement("option");
    opt.value = item.value;
    opt.textContent = item.label;
    if (item.value === currentModel) {
      opt.selected = true;
      matched = true;
    }
    els.modelSelect.appendChild(opt);
  }

  if (currentModel && !matched) {
    els.customModel.value = currentModel;
  } else {
    els.customModel.value = "";
  }
}

function getEffectiveModel() {
  const custom = els.customModel.value.trim();
  return custom || els.modelSelect.value;
}

function syncVisualStates() {
  els.aiModeCard.classList.toggle("active-ai", els.enabled.checked);
  els.manualModeCard.classList.toggle("active-manual", els.manualAutoSubmit.checked);

  els.levelTabs.forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-lvl") === els.quotaLevel.value);
  });

  [
    els.autoSelect,
    els.autoSubmit,
    els.autoNext,
    els.useLocalCache,
    els.showExplanation,
    els.stealthMode
  ].forEach((inp) => {
    const tile = inp.closest(".tile");
    if (tile) tile.classList.toggle("is-checked", inp.checked);
  });
}

function renderSlotBadges(keySlotStatuses = {}) {
  const map = [
    { slot: 1, el: els.slotBadge1 },
    { slot: 2, el: els.slotBadge2 },
    { slot: 3, el: els.slotBadge3 }
  ];
  for (const { slot, el } of map) {
    if (!el) continue;
    el.className = "slot-tag";
    const st = keySlotStatuses[slot];
    if (st?.state === "ok") {
      el.classList.add("ok");
      el.title = `Key #${slot}: ${st.msg || "Aktif"}`;
    } else if (st?.state === "limit") {
      el.classList.add("limit");
      el.title = `Key #${slot}: Limit Kuota (429)`;
    } else if (st?.state === "err") {
      el.classList.add("err");
      el.title = `Key #${slot}: ${st.msg || "Error"}`;
    }
  }
}

function renderQuotaStats(data) {
  const cacheCount = Object.keys(data.answerCache || {}).length;
  const apiCalls = Number(data.apiCallCount) || 0;
  const activeSlot = data.activeKeySlot || 1;
  els.quotaStats.textContent = `Key #${activeSlot} · API ${apiCalls} · Cache ${cacheCount}`;
}

function renderLastResult(lastResult) {
  if (!lastResult || !Array.isArray(lastResult.selectedIndices) || lastResult.selectedIndices.length === 0) {
    els.lastResultCard.style.display = "none";
    return;
  }
  els.lastResultCard.style.display = "flex";
  const letters =
    (lastResult.selectedLetters || []).join(", ") ||
    (lastResult.selectedIndices || []).map((i) => String.fromCharCode(65 + i)).join(", ");
  const texts = (lastResult.selectedTexts || []).join(" | ");
  const slotTag = lastResult.fromCache
    ? "Cache 0Q"
    : `Key #${lastResult.usedKeySlot || 1}${lastResult.fallbackOccurred ? " (Fallback)" : ""}`;

  els.lastResultTitle.textContent = `${lastResult.questionNumberLabel || "Jawaban Terakhir"} · ${slotTag}`;
  els.lastResultSummary.textContent = `Opsi ${letters}: ${texts}`;
  els.lastResultExplanation.textContent =
    lastResult.explanation || "Tidak ada detail penjelasan tambahan untuk soal ini.";
}

async function saveSettings() {
  syncVisualStates();
  const payload = {
    enabled: els.enabled.checked,
    manualAutoSubmit: els.manualAutoSubmit.checked,
    quotaLevel: els.quotaLevel.value,
    useLocalCache: els.useLocalCache.checked,
    provider: els.provider.value,
    model: getEffectiveModel(),
    customEndpoint: els.customEndpoint.value.trim(),
    apiKey: els.apiKey.value.trim(),
    apiKey2: els.apiKey2.value.trim(),
    apiKey3: els.apiKey3.value.trim(),
    autoSelect: els.autoSelect.checked,
    autoSubmit: els.autoSubmit.checked,
    autoNext: els.autoNext.checked,
    reloadAfterSubmit: els.reloadAfterSubmit.checked,
    showExplanation: els.showExplanation.checked,
    stealthMode: els.stealthMode.checked,
    actionDelayMs: Number(els.actionDelayMs.value),
    courseContext: els.courseContext.value.trim()
  };
  await chrome.storage.local.set(payload);
}

async function initPopup() {
  const data = await chrome.storage.local.get(null);

  els.enabled.checked = Boolean(data.enabled);
  els.manualAutoSubmit.checked = data.manualAutoSubmit !== false;
  els.quotaLevel.value = data.quotaLevel || "lvl1_eco";
  els.useLocalCache.checked = data.useLocalCache !== false;

  els.provider.value = data.provider || "gemini";
  populateModels(els.provider.value, data.model || "gemini-3.8-flash");

  els.customEndpoint.value = data.customEndpoint || "";
  els.apiKey.value = data.apiKey || "";
  els.apiKey2.value = data.apiKey2 || "";
  els.apiKey3.value = data.apiKey3 || "";

  // Auto-open fallback drawer if user already filled Key #2 or Key #3
  if (els.apiKey2.value || els.apiKey3.value) {
    els.fallbackSlotsContainer.classList.add("open");
    els.toggleFallbackBtn.classList.add("active");
  }

  renderSlotBadges(data.keySlotStatuses);
  renderQuotaStats(data);
  renderLastResult(data.lastResult);

  els.autoSelect.checked = data.autoSelect !== false;
  els.autoSubmit.checked = data.autoSubmit !== false;
  els.autoNext.checked = data.autoNext !== false;
  els.reloadAfterSubmit.checked = Boolean(data.reloadAfterSubmit);
  els.showExplanation.checked = data.showExplanation !== false;
  els.stealthMode.checked = Boolean(data.stealthMode);

  const delay = Number(data.actionDelayMs) || 750;
  els.actionDelayMs.value = delay;
  els.delayLabel.textContent = delay;

  syncVisualStates();

  els.levelTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      els.quotaLevel.value = btn.getAttribute("data-lvl");
      saveSettings();
    });
  });

  els.provider.addEventListener("change", () => {
    const defaultModel = MODEL_PRESETS[els.provider.value]?.[0]?.value || "";
    populateModels(els.provider.value, defaultModel);
    saveSettings();
  });

  [
    els.enabled,
    els.manualAutoSubmit,
    els.useLocalCache,
    els.modelSelect,
    els.customModel,
    els.customEndpoint,
    els.apiKey,
    els.apiKey2,
    els.apiKey3,
    els.autoSelect,
    els.autoSubmit,
    els.autoNext,
    els.reloadAfterSubmit,
    els.showExplanation,
    els.stealthMode
  ].forEach((el) => {
    el.addEventListener("change", saveSettings);
    el.addEventListener("input", saveSettings);
  });

  els.actionDelayMs.addEventListener("input", () => {
    els.delayLabel.textContent = els.actionDelayMs.value;
    saveSettings();
  });

  els.toggleFallbackBtn.addEventListener("click", () => {
    const isOpen = els.fallbackSlotsContainer.classList.toggle("open");
    els.toggleFallbackBtn.classList.toggle("active", isOpen);
  });

  els.toggleKeyBtn.addEventListener("click", () => {
    const nextType = els.apiKey.type === "password" ? "text" : "password";
    els.apiKey.type = nextType;
    els.apiKey2.type = nextType;
    els.apiKey3.type = nextType;
  });

  els.apiNotifExpandBtn.addEventListener("click", () => {
    const isHidden = els.apiNotifDetail.style.display === "none";
    els.apiNotifDetail.style.display = isHidden ? "block" : "none";
    els.apiNotifExpandBtn.classList.toggle("expanded", isHidden);
  });

  els.expandExplanationBtn.addEventListener("click", () => {
    const isHidden = els.lastResultExplanation.style.display === "none";
    els.lastResultExplanation.style.display = isHidden ? "block" : "none";
    els.expandExplanationBtn.classList.toggle("expanded", isHidden);
  });

  els.clearCacheBtn.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "CLEAR_ANSWER_CACHE" });
    const refreshed = await chrome.storage.local.get(null);
    renderQuotaStats(refreshed);
  });

  els.testApiBtn.addEventListener("click", async () => {
    await saveSettings();
    els.testApiBtn.classList.remove("ok", "err");
    els.apiTestNotif.style.display = "flex";
    els.apiTestNotif.className = "api-notif";
    els.apiNotifSummary.textContent = "Menguji semua slot API Key...";
    els.apiNotifDetail.style.display = "none";

    const res = await chrome.runtime.sendMessage({
      type: "TEST_API_KEY",
      payload: {
        provider: els.provider.value,
        model: getEffectiveModel(),
        apiKey: els.apiKey.value.trim(),
        apiKey2: els.apiKey2.value.trim(),
        apiKey3: els.apiKey3.value.trim(),
        customEndpoint: els.customEndpoint.value.trim()
      }
    });

    const refreshed = await chrome.storage.local.get(null);
    renderSlotBadges(refreshed.keySlotStatuses);
    renderQuotaStats(refreshed);

    if (!res || !res.ok) {
      els.testApiBtn.classList.add("err");
      els.apiTestNotif.className = "api-notif err";
      els.apiNotifSummary.textContent = res?.error || "Gagal menguji API Key";
      els.apiNotifDetail.textContent = res?.error || "Periksa kembali koneksi atau API Key.";
      return;
    }

    const { anyOk, activeSlot, results } = res.data;
    const okCount = results.filter((r) => r.ok).length;
    const limitCount = results.filter((r) => r.state === "limit").length;

    if (anyOk) {
      els.testApiBtn.classList.add("ok");
      els.apiTestNotif.className = limitCount > 0 ? "api-notif warn" : "api-notif ok";
      els.apiNotifSummary.textContent =
        limitCount > 0
          ? `${okCount}/${results.length} Key Aktif · Pakai Key #${activeSlot} (Ada Key Limit)`
          : `${okCount}/${results.length} Slot API Key Aktif & Siap (Key #${activeSlot})`;
    } else {
      els.testApiBtn.classList.add("err");
      els.apiTestNotif.className = "api-notif err";
      els.apiNotifSummary.textContent = `Semua Slot (${results.length} Key) Limit / Gagal!`;
    }

    els.apiNotifDetail.textContent = results
      .map((r) => `[Slot #${r.slot}] ${r.summary}\n   -> ${r.detail}`)
      .join("\n\n");
  });

  els.solveNowBtn.addEventListener("click", async () => {
    await saveSettings();
    await chrome.runtime.sendMessage({
      type: "BROADCAST_TO_TAB",
      payload: { type: "TRIGGER_SOLVE_NOW" }
    });
    window.close();
  });
}

document.addEventListener("DOMContentLoaded", initPopup);
