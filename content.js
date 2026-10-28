// NetAcad AI & Auto-Submit Assistant - Content Script (v1.8.0)

(() => {
  if (window.__NETACAD_AI_SOLVER_LOADED__) return;
  window.__NETACAD_AI_SOLVER_LOADED__ = true;

  const IS_TOP_WINDOW = window === window.top;
  const RELEVANT_HOST_PATTERN = /netacad\.com|skillsforall\.com|cisco\.com|adapt|scorm|assessment/i;

  const LEVEL_SHORT = {
    lvl1_eco: "ECO",
    lvl2_smart: "SMART",
    lvl3_pro: "PRO",
    lvl4_max: "MAX"
  };

  const SVG = {
    spark: `<svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    bot: `<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>`,
    checkSend: `<svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    chevronDown: `<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>`,
    minus: `<svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    close: `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
  };

  let config = {
    enabled: false,
    manualAutoSubmit: true,
    provider: "gemini",
    model: "gemini-3.8-flash",
    apiKey: "",
    apiKey2: "",
    apiKey3: "",
    quotaLevel: "lvl1_eco",
    useLocalCache: true,
    autoSelect: true,
    autoSubmit: true,
    autoNext: true,
    reloadAfterSubmit: false,
    stealthMode: false,
    showExplanation: false,
    actionDelayMs: 750
  };

  let isSolving = false;
  let isManualSubmitting = false;
  let isDetailExpanded = false;
  let lastSolveTimestamp = 0;
  let lastSolvedSignature = "";
  let lastKnownUrl = location.href;
  let lastQuestionHeader = "";
  let hudEl = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function cleanText(str) {
    return (str || "")
      .replace(/\{\{[^}]+\}\}/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanOptionText(str) {
    return cleanText(str).replace(/\s+\d+\s+of\s+\d+$/i, "").trim();
  }

  function normalizeForMatch(str) {
    return cleanOptionText(str).toLowerCase().replace(/[^a-z0-9+#.-]/g, "");
  }

  function querySelectorAllDeep(selector, root = document) {
    const results = [];
    const visited = new Set();
    const collect = (node) => {
      if (!node || visited.has(node)) return;
      visited.add(node);
      try {
        if (node.querySelectorAll) {
          const matched = node.querySelectorAll(selector);
          for (let i = 0; i < matched.length; i++) {
            results.push(matched[i]);
          }
        }
      } catch {}
      try {
        const allChildren = node.querySelectorAll ? node.querySelectorAll("*") : [];
        for (let i = 0; i < allChildren.length; i++) {
          const el = allChildren[i];
          if (el.shadowRoot) {
            collect(el.shadowRoot);
          }
        }
      } catch {}
    };
    collect(root);
    return Array.from(new Set(results));
  }

  function isInsideHud(el) {
    if (!el) return false;
    if (el.id === "netacad-ai-hud") return true;
    try {
      return Boolean(el.closest && el.closest("#netacad-ai-hud"));
    } catch {
      return false;
    }
  }

  function isStrictlyInViewport(el) {
    if (!el || isInsideHud(el)) return false;
    try {
      let cur = el;
      while (cur && cur !== document.documentElement) {
        if (cur.nodeType === 1) {
          if (
            cur.hasAttribute("hidden") ||
            cur.getAttribute("aria-hidden") === "true" ||
            cur.classList?.contains("is-hidden") ||
            cur.classList?.contains("u-display-none") ||
            cur.classList?.contains("hide")
          ) {
            return false;
          }
          const st = window.getComputedStyle(cur);
          if (st.display === "none" || st.visibility === "hidden" || parseFloat(st.opacity || "1") < 0.05) {
            return false;
          }
        }
        cur = cur.parentElement || (cur.getRootNode && cur.getRootNode().host) || null;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return false;

      const vw = window.innerWidth || document.documentElement.clientWidth || 1024;
      const vh = window.innerHeight || document.documentElement.clientHeight || 768;

      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      if (centerX < 10 || centerX > vw - 10) return false;
      if (centerY < -30 || centerY > vh + 100) return false;

      return true;
    } catch {
      return false;
    }
  }

  function isRelevantContext() {
    try {
      if (RELEVANT_HOST_PATTERN.test(location.href)) return true;
      if (document.referrer && RELEVANT_HOST_PATTERN.test(document.referrer)) return true;
      return Boolean(detectActiveQuestionOnScreen());
    } catch {
      return false;
    }
  }

  function extractPageMetadata() {
    let moduleHeading = "";
    const topSelectors = [".nav__title", ".page__title", ".course-title", ".module-title", "header h1", "header", "h1"];
    for (const sel of topSelectors) {
      const els = querySelectorAllDeep(sel).filter(isStrictlyInViewport);
      for (const el of els) {
        const t = cleanText(el.innerText || el.textContent);
        if (t && t.length >= 4 && t.length <= 110 && !/^(Question|Soal)\s*\d+/i.test(t)) {
          moduleHeading = t;
          break;
        }
      }
      if (moduleHeading) break;
    }

    let questionNumberLabel = "";
    let questionHeaderEl = null;
    const allHeadings = querySelectorAllDeep(
      "h1, h2, h3, h4, h5, [class*='question-title'], [class*='question-header'], [class*='title'], div, p, span"
    ).filter(isStrictlyInViewport);

    for (const h of allHeadings) {
      if (h.children && h.children.length > 3) continue;
      const t = cleanText(h.innerText || h.textContent);
      if (t.length > 35) continue;
      const m = t.match(/^(Question|Soal|Pertanyaan)\s*(\d+)\b/i);
      if (m) {
        questionNumberLabel = `Question ${m[2]}`;
        questionHeaderEl = h;
        break;
      }
    }

    let progressLabel = "";
    const allBadges = querySelectorAllDeep("div, span, p").filter(isStrictlyInViewport);
    for (const b of allBadges) {
      if (b.children && b.children.length > 2) continue;
      const t = cleanText(b.innerText || b.textContent);
      const pm = t.match(/^(\d+\s+of\s+\d+\s+Questions?)$/i);
      if (pm) {
        progressLabel = pm[1];
        break;
      }
    }

    if (!questionNumberLabel && progressLabel) {
      const numMatch = progressLabel.match(/^(\d+)\s+of\s+\d+/i);
      if (numMatch) questionNumberLabel = `Question ${numMatch[1]}`;
    }

    return {
      moduleHeading: moduleHeading || cleanText(document.title) || location.hostname,
      questionNumberLabel,
      questionHeaderEl,
      progressLabel
    };
  }

  function parseRequiredAnswerCount(questionText, isMultiDom) {
    const t = (questionText || "").toLowerCase();
    if (
      /\b(choose|select|pilih|pick)\s+(three|3|tiga)\b/i.test(t) ||
      /\b(three|3|tiga)\s+(options|answers|choices|pilihan|jawaban|port states|statements|characteristics|features|functions|commands)\b/i.test(t) ||
      /\bwhich\s+(three|3)\b/i.test(t)
    ) {
      return 3;
    }
    if (/\b(choose|select|pilih|pick)\s+(four|4|empat)\b/i.test(t) || /\bwhich\s+(four|4)\b/i.test(t)) {
      return 4;
    }
    if (
      /\b(choose|select|pilih|pick)\s+(two|2|dua)\b/i.test(t) ||
      /\b(two|2|dua)\s+(options|answers|choices|pilihan|jawaban|statements|characteristics|features|functions|commands)\b/i.test(t) ||
      /\bwhich\s+(two|2)\b/i.test(t)
    ) {
      return 2;
    }
    return isMultiDom ? 2 : 1;
  }

  function detectVisualExhibitInQuestion(activeScope, questionText, firstOptionTop, headerTop) {
    if (/exhibit|diagram|topology|topologi|gambar|tabel|table|output|perhatikan/i.test(questionText || "")) {
      return true;
    }
    const mediaEls = querySelectorAllDeep("img, canvas, table, svg.diagram", activeScope).filter(isStrictlyInViewport);
    for (const m of mediaEls) {
      const r = m.getBoundingClientRect();
      if (r.width >= 120 && r.height >= 75 && r.top >= Math.max(50, headerTop - 20) && r.top <= firstOptionTop + 40) {
        return true;
      }
    }
    return false;
  }

  function detectActiveQuestionOnScreen() {
    const meta = extractPageMetadata();

    const optionItemSelectors = [
      ".mcq-item",
      ".gmcq-item",
      ".question-option",
      ".answer-option",
      "[role='radio']",
      "[role='checkbox']",
      "label"
    ];

    let visibleOptionEls = [];
    let activeScope = document;

    if (meta.questionHeaderEl) {
      let anc = meta.questionHeaderEl.parentElement;
      while (anc && anc !== document.body) {
        const inputsOrRoles = querySelectorAllDeep(
          "input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox'], .mcq-item, .question-option, label",
          anc
        ).filter(isStrictlyInViewport);
        if (inputsOrRoles.length >= 2) {
          activeScope = anc;
          break;
        }
        anc = anc.parentElement;
      }
    }

    for (const sel of optionItemSelectors) {
      const found = querySelectorAllDeep(sel, activeScope).filter(isStrictlyInViewport);
      const filtered = found
        .map((el) => {
          let row = el;
          let txt = cleanOptionText(row.innerText || row.textContent || row.getAttribute("aria-label") || "");
          if (!txt && row.parentElement && isStrictlyInViewport(row.parentElement)) {
            row = row.parentElement;
            txt = cleanOptionText(row.innerText || row.textContent || "");
          }
          return { el: row, txt };
        })
        .filter((item) => {
          if (!item.txt) return false;
          if (/^(Q\d+|Skip All|Skip Question|Submit|Next|Previous|Check)$/i.test(item.txt)) return false;
          return true;
        });

      if (filtered.length >= 2) {
        visibleOptionEls = filtered.map((f) => f.el);
        break;
      }
    }

    if (visibleOptionEls.length < 2) {
      const rawInputs = querySelectorAllDeep("input[type='radio'], input[type='checkbox']", activeScope).filter((inp) => {
        const target = inp.closest("label") || inp.parentElement || inp;
        return isStrictlyInViewport(target);
      });
      if (rawInputs.length >= 2) {
        visibleOptionEls = rawInputs.map((inp) => inp.closest("label") || inp.parentElement || inp);
      }
    }

    if (visibleOptionEls.length < 2) return null;

    const dedupedOptions = [];
    const seenTexts = new Set();

    for (const el of visibleOptionEls) {
      if (visibleOptionEls.some((other) => other !== el && el.contains(other))) {
        continue;
      }
      const txt = cleanOptionText(el.innerText || el.textContent || el.getAttribute("aria-label") || "");
      if (!txt || seenTexts.has(txt)) continue;
      if (/^(Q\d+|Skip All|Skip Question|Submit|\d+\s+of\s+\d+\s+Questions?)$/i.test(txt)) continue;
      seenTexts.add(txt);
      dedupedOptions.push({
        element: el,
        text: txt,
        rect: el.getBoundingClientRect()
      });
    }

    if (dedupedOptions.length < 2) return null;

    dedupedOptions.sort((a, b) => a.rect.top - b.rect.top);

    const firstOptionTop = dedupedOptions[0].rect.top;
    const headerTop = meta.questionHeaderEl ? meta.questionHeaderEl.getBoundingClientRect().bottom : 45;

    const stemCandidates = querySelectorAllDeep(
      ".mcq-body, .component-body, .question-stem, .question-text, .question-prompt, p, div, span, legend, h3, h4",
      activeScope
    ).filter(isStrictlyInViewport);

    const stemParts = [];
    for (const el of stemCandidates) {
      if (dedupedOptions.some((o) => o.element.contains(el) || el.contains(o.element))) continue;
      if (meta.questionHeaderEl && (meta.questionHeaderEl.contains(el) || el.contains(meta.questionHeaderEl))) continue;

      const blockChildren = Array.from(el.children || []).filter((c) =>
        /^(DIV|P|UL|OL|TABLE|FIELDSET|FORM|SECTION)$/i.test(c.tagName)
      );
      if (blockChildren.length > 0) continue;

      const r = el.getBoundingClientRect();
      if (r.bottom <= firstOptionTop + 15 && r.top >= Math.max(45, headerTop - 10)) {
        const txt = cleanText(el.innerText || el.textContent);
        if (
          txt &&
          txt.length > 6 &&
          !/^(Q\d+|Question\s*\d+|\d+\s+of\s+\d+\s+Questions?|Skip All|Skip Question|Submit)$/i.test(txt) &&
          !stemParts.includes(txt)
        ) {
          stemParts.push(txt);
        }
      }
    }

    const questionText = stemParts.join("\n") || "Perhatikan pertanyaan aktif pada layar berikut:";
    const hasCheckboxes =
      querySelectorAllDeep("input[type='checkbox'], [role='checkbox']", activeScope).filter(isStrictlyInViewport).length >= 2;
    const requiredCount = parseRequiredAnswerCount(questionText, hasCheckboxes);
    const isMulti = requiredCount > 1 || hasCheckboxes;
    const hasVisualExhibit = detectVisualExhibitInQuestion(activeScope, questionText, firstOptionTop, headerTop);

    return {
      container: activeScope === document ? document.body : activeScope,
      moduleHeading: meta.moduleHeading,
      questionNumberLabel: meta.questionNumberLabel || "Soal Aktif",
      progressLabel: meta.progressLabel || "",
      questionText,
      options: dedupedOptions.map((o) => o.text),
      optionElements: dedupedOptions.map((o) => o.element),
      questionType: isMulti ? "multiple-choice" : "single-choice",
      requiredCount,
      hasVisualExhibit
    };
  }

  function isOptionSelected(optionEl) {
    if (!optionEl) return false;
    try {
      const wrapper =
        optionEl.closest?.(".mcq-item, .gmcq-item, .question-option, .answer-option, [role='radio'], [role='checkbox'], label") ||
        optionEl;

      const nodesToCheck = [
        wrapper,
        optionEl,
        ...querySelectorAllDeep("input, [role='checkbox'], [role='radio'], label, div, span", wrapper)
      ];

      for (const node of nodesToCheck) {
        if (!node) continue;
        if (node.tagName === "INPUT" && (node.type === "checkbox" || node.type === "radio") && node.checked) {
          return true;
        }
        const ariaChecked = node.getAttribute?.("aria-checked");
        const ariaSelected = node.getAttribute?.("aria-selected");
        const ariaPressed = node.getAttribute?.("aria-pressed");
        if (ariaChecked === "true" || ariaSelected === "true" || ariaPressed === "true") {
          return true;
        }
        const cls = node.className && typeof node.className === "string" ? node.className : "";
        if (/\b(is-selected|selected|is-checked|checked|mcq-item--selected|u-selected)\b/i.test(cls)) {
          return true;
        }
        if (node.tagName === "LABEL" && node.htmlFor) {
          const linkedInput = document.getElementById(node.htmlFor);
          if (linkedInput && linkedInput.checked) return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  function dispatchSingleCleanClick(target, customX, customY) {
    if (!target) return;
    try {
      const rect = target.getBoundingClientRect();
      const clientX = customX !== undefined ? customX : rect.left + rect.width / 2;
      const clientY = customY !== undefined ? customY : rect.top + rect.height / 2;
      const eventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX,
        clientY,
        button: 0,
        buttons: 1
      };

      target.dispatchEvent(new PointerEvent("pointerover", eventInit));
      target.dispatchEvent(new MouseEvent("mouseover", eventInit));
      target.dispatchEvent(new PointerEvent("pointerdown", eventInit));
      target.dispatchEvent(new MouseEvent("mousedown", eventInit));
      if (typeof target.focus === "function") target.focus({ preventScroll: true });
      target.dispatchEvent(new PointerEvent("pointerup", eventInit));
      target.dispatchEvent(new MouseEvent("mouseup", eventInit));

      if (typeof target.click === "function") {
        target.click();
      } else {
        target.dispatchEvent(new MouseEvent("click", eventInit));
      }
    } catch {
      try {
        target.click?.();
      } catch {}
    }
  }

  async function clickOptionOnce(optionEl, strategy = "primary") {
    if (!optionEl) return;

    optionEl.classList.add(config.stealthMode ? "nai-stealth-highlight" : "nai-correct-highlight");
    if (config.stealthMode && !config.autoSelect) return;

    if (isOptionSelected(optionEl)) return;

    const outerRow =
      optionEl.closest?.(".mcq-item, .gmcq-item, .question-option, .answer-option, [role='radio'], [role='checkbox'], label") ||
      optionEl;

    if (strategy === "primary") {
      const innerLabel = querySelectorAllDeep("label, .mcq-item-label, .mcq-item__label", outerRow)[0];
      const innerRole = querySelectorAllDeep("[role='checkbox'], [role='radio']", outerRow)[0];
      const innerInput = querySelectorAllDeep("input[type='checkbox'], input[type='radio']", outerRow)[0];
      const target = innerLabel || innerInput || innerRole || outerRow;
      dispatchSingleCleanClick(target);
    } else if (strategy === "box-coord") {
      const rect = outerRow.getBoundingClientRect();
      const boxX = rect.left + Math.min(28, rect.width * 0.12);
      const boxY = rect.top + rect.height / 2;
      const hitEl = document.elementFromPoint(boxX, boxY);
      if (hitEl && !isInsideHud(hitEl)) {
        dispatchSingleCleanClick(hitEl, boxX, boxY);
      } else {
        dispatchSingleCleanClick(outerRow, boxX, boxY);
      }
    } else if (strategy === "raw-input") {
      const innerInput = querySelectorAllDeep("input[type='checkbox'], input[type='radio']", outerRow)[0];
      if (innerInput) {
        dispatchSingleCleanClick(innerInput);
      } else {
        dispatchSingleCleanClick(optionEl);
      }
    }
  }

  function isButtonDisabled(btn) {
    if (!btn) return true;
    if (btn.disabled) return true;
    if (btn.getAttribute("aria-disabled") === "true") return true;
    if (btn.classList?.contains("is-disabled") || btn.classList?.contains("disabled")) return true;
    return false;
  }

  function findSubmitButton() {
    const candidates = querySelectorAllDeep(
      "button, input[type='submit'], input[type='button'], [role='button'], .btn__action, .mcq-submit"
    ).filter(isStrictlyInViewport);

    for (const btn of candidates) {
      const label = cleanText(
        btn.innerText || btn.textContent || btn.value || btn.getAttribute("aria-label") || ""
      );
      if (/^(submit|submit answer|check|check answer|periksa|kirim)$/i.test(label)) {
        return btn;
      }
    }
    return null;
  }

  function findNextButton() {
    const candidates = querySelectorAllDeep(
      "button, a.btn, [role='button'], .btn__action"
    ).filter(isStrictlyInViewport);

    for (const btn of candidates) {
      const label = cleanText(
        btn.innerText || btn.textContent || btn.value || btn.getAttribute("aria-label") || ""
      );
      if (/^(next|next question|continue|lanjut|berikutnya)$/i.test(label) && !isButtonDisabled(btn)) {
        return btn;
      }
    }
    return null;
  }

  // --- MANUAL PICK + AUTO-SUBMIT LISTENER ---
  function setupManualPickAutoSubmitListener() {
    document.addEventListener(
      "click",
      async (e) => {
        if (isSolving || isManualSubmitting) return;
        if (!config.manualAutoSubmit && !config.autoSubmit) return;

        const target = e.target;
        if (!target || isInsideHud(target)) return;

        const clickedText = cleanText(target.innerText || target.textContent || "");
        if (/^(Submit|Skip All|Skip Question|Next|Previous|Q\d+)$/i.test(clickedText)) return;

        const detected = detectActiveQuestionOnScreen();
        if (!detected) return;

        const clickedOptionIdx = detected.optionElements.findIndex(
          (optEl) => optEl === target || optEl.contains(target) || target.contains(optEl)
        );
        if (clickedOptionIdx === -1) return;

        await sleep(180);

        const needed = Math.max(1, Number(detected.requiredCount) || 1);
        const selectedIndices = [];
        detected.optionElements.forEach((optEl, idx) => {
          if (isOptionSelected(optEl)) {
            selectedIndices.push(idx);
          }
        });

        const submitBtn = findSubmitButton();
        const isSubmitReady = submitBtn && !isButtonDisabled(submitBtn);

        if (needed > 1 && selectedIndices.length < needed) {
          notifyHud({
            statusText: `Pilih manual: ${selectedIndices.length}/${needed} opsi terpilih...`,
            state: "manual",
            badgeText: `${selectedIndices.length}/${needed} OPSI`
          });
          return;
        }

        if (isSubmitReady && (needed === 1 || selectedIndices.length >= needed)) {
          isManualSubmitting = true;
          try {
            const delay = Math.min(800, Math.max(200, Number(config.actionDelayMs) || 400));
            const letters =
              selectedIndices.map((i) => String.fromCharCode(65 + i)).join(", ") ||
              String.fromCharCode(65 + clickedOptionIdx);
            notifyHud({
              statusText: `Auto-Submit Pilihan Manual (${letters})...`,
              state: "working",
              badgeText: "MANUAL·SUBMIT"
            });

            await sleep(delay);
            const freshSubmit = findSubmitButton();
            if (freshSubmit && !isButtonDisabled(freshSubmit)) {
              dispatchSingleCleanClick(freshSubmit);

              if (config.autoNext) {
                await sleep(450);
                const nextBtn = findNextButton();
                if (nextBtn) dispatchSingleCleanClick(nextBtn);
              }

              if (config.reloadAfterSubmit) {
                await sleep(300);
                chrome.runtime.sendMessage({ type: "RELOAD_ACTIVE_TAB" }).catch(() => location.reload());
                return;
              }

              notifyHud({
                statusText: `Terkirim (${letters}) · Siap soal berikutnya`,
                state: config.enabled ? "active" : "manual",
                badgeText: "SUBMITTED",
                clearAnswerBox: true
              });
            }
          } finally {
            setTimeout(() => {
              isManualSubmitting = false;
            }, 400);
          }
        }
      },
      true
    );
  }

  function resolveTargetIndices(detected, aiData) {
    const resolved = new Set();
    const options = detected.options || [];
    const needed = Math.max(1, Number(detected.requiredCount) || 1);

    if (Array.isArray(aiData.selectedIndices) && aiData.selectedIndices.length > 0) {
      for (const idx of aiData.selectedIndices) {
        const num = Number(idx);
        if (Number.isInteger(num) && num >= 0 && num < options.length) {
          resolved.add(num);
        }
      }
    }

    if (resolved.size < needed && Array.isArray(aiData.selectedTexts) && aiData.selectedTexts.length > 0) {
      for (const aiTxt of aiData.selectedTexts) {
        const normAi = normalizeForMatch(aiTxt);
        if (!normAi) continue;
        let foundIdx = options.findIndex((opt) => normalizeForMatch(opt) === normAi);
        if (foundIdx === -1 && normAi.length >= 2) {
          foundIdx = options.findIndex((opt) => {
            const normOpt = normalizeForMatch(opt);
            return normOpt.includes(normAi) || normAi.includes(normOpt);
          });
        }
        if (foundIdx !== -1) resolved.add(foundIdx);
      }
    }

    if (resolved.size < needed && Array.isArray(aiData.selectedLetters)) {
      for (const letter of aiData.selectedLetters) {
        const cleanL = String(letter || "").trim().toUpperCase();
        if (cleanL.length === 1) {
          const idx = cleanL.charCodeAt(0) - 65;
          if (idx >= 0 && idx < options.length) resolved.add(idx);
        }
      }
    }

    return Array.from(resolved).slice(0, needed);
  }

  function clearHighlightsAndResetState(statusMsg = "Siap memindai soal...") {
    querySelectorAllDeep(".nai-correct-highlight, .nai-stealth-highlight").forEach((el) => {
      el.classList.remove("nai-correct-highlight", "nai-stealth-highlight");
    });
    lastSolvedSignature = "";
    notifyHud({
      statusText: statusMsg,
      state: config.enabled ? "active" : config.manualAutoSubmit ? "manual" : "idle",
      clearAnswerBox: true
    });
  }

  // --- MAIN AI SOLVE PIPELINE ---
  async function runSolvePipeline(manualTrigger = false) {
    if (isSolving || isManualSubmitting) return;

    const now = Date.now();
    if (!manualTrigger && now - lastSolveTimestamp < 900) return;

    const detected = detectActiveQuestionOnScreen();
    if (!detected) {
      if (manualTrigger && IS_TOP_WINDOW) {
        notifyHud({ statusText: "Tidak ada soal aktif di layar", state: "idle" });
      }
      return;
    }

    const signature = [
      location.pathname,
      location.search,
      detected.questionNumberLabel,
      detected.progressLabel,
      detected.questionText,
      detected.options.join("|")
    ].join("::");

    if (!manualTrigger && signature === lastSolvedSignature) return;

    isSolving = true;
    lastSolveTimestamp = Date.now();

    const lvlTag = LEVEL_SHORT[config.quotaLevel] || "ECO";
    const reqBadge = detected.requiredCount > 1 ? `PILIH ${detected.requiredCount}` : lvlTag;

    notifyHud({
      statusText: `Memindai ${detected.questionNumberLabel}...`,
      state: "working",
      badgeText: reqBadge,
      clearAnswerBox: true
    });

    try {
      querySelectorAllDeep(".nai-correct-highlight, .nai-stealth-highlight").forEach((el) => {
        el.classList.remove("nai-correct-highlight", "nai-stealth-highlight");
      });

      const response = await chrome.runtime.sendMessage({
        type: "SOLVE_QUESTION",
        payload: {
          questionNumberLabel: detected.questionNumberLabel,
          progressLabel: detected.progressLabel,
          questionText: detected.questionText,
          options: detected.options,
          questionType: detected.questionType,
          requiredCount: detected.requiredCount,
          hasVisualExhibit: detected.hasVisualExhibit,
          moduleHeading: detected.moduleHeading,
          pageUrl: location.href
        }
      });

      if (!response || !response.ok) {
        throw new Error(response?.error || "Gagal menghubungi AI.");
      }

      const aiData = response.data;
      const targetIndices = resolveTargetIndices(detected, aiData);
      if (targetIndices.length === 0) {
        throw new Error("Indeks jawaban tidak ditemukan.");
      }

      const chosenLetters = targetIndices.map((i) => String.fromCharCode(65 + i)).join(", ");
      const chosenTexts = targetIndices.map((i) => detected.options[i]).filter(Boolean);
      const slotInfo = aiData.fromCache
        ? "CACHE · 0Q"
        : aiData.fallbackOccurred
        ? `KEY #${aiData.usedKeySlot} (FALLBACK)`
        : `KEY #${aiData.usedKeySlot || 1} · ${lvlTag}`;

      lastSolvedSignature = signature;
      lastQuestionHeader = detected.questionNumberLabel;

      const delay = Math.max(150, Number(config.actionDelayMs) || 750);
      await sleep(aiData.fromCache ? 220 : delay);

      notifyHud({
        statusText: `Memilih Opsi ${chosenLetters}...`,
        state: "working",
        badgeText: slotInfo,
        answerTitle: `${detected.questionNumberLabel} · Opsi ${chosenLetters}: ${chosenTexts.join(" | ")}`,
        explanation: aiData.explanation || "Jawaban dipilih berdasarkan analisis materi Cisco NetAcad.",
        detailMeta: {
          slotLabel: aiData.fromCache
            ? "Sumber: Memori Cache Lokal (0 Kuota)"
            : aiData.fallbackOccurred
            ? `Sumber: API Key #${aiData.usedKeySlot} (Auto-Fallback dari Key #${aiData.fallbackFromSlot} yang Limit)`
            : `Sumber: API Key #${aiData.usedKeySlot || 1} (${aiData.model || config.model})`,
          fallback: Boolean(aiData.fallbackOccurred),
          questionLabel: `${detected.questionNumberLabel} (${detected.progressLabel || "Quiz"})`
        }
      });

      for (const idx of targetIndices) {
        const targetEl = detected.optionElements[idx];
        if (targetEl) {
          await clickOptionOnce(targetEl, "primary");
          await sleep(220);
        }
      }

      await sleep(200);
      let submitBtn = findSubmitButton();
      if (submitBtn && isButtonDisabled(submitBtn) && config.autoSelect) {
        for (const idx of targetIndices) {
          const targetEl = detected.optionElements[idx];
          if (targetEl && !isOptionSelected(targetEl)) {
            await clickOptionOnce(targetEl, "box-coord");
            await sleep(200);
          }
        }
      }

      await sleep(160);
      submitBtn = findSubmitButton();
      if (submitBtn && isButtonDisabled(submitBtn) && config.autoSelect) {
        for (const idx of targetIndices) {
          const targetEl = detected.optionElements[idx];
          if (targetEl && !isOptionSelected(targetEl)) {
            await clickOptionOnce(targetEl, "raw-input");
            await sleep(200);
          }
        }
      }

      let finalStatus = config.autoSelect
        ? `Opsi ${chosenLetters}: ${chosenTexts.join(", ")}`
        : `Highlight: Opsi ${chosenLetters}`;

      if (config.autoSubmit) {
        await sleep(Math.max(220, delay));

        for (let attempt = 0; attempt < 4; attempt++) {
          submitBtn = findSubmitButton();
          if (submitBtn && !isButtonDisabled(submitBtn)) break;
          await sleep(180);
        }

        if (submitBtn && !isButtonDisabled(submitBtn)) {
          dispatchSingleCleanClick(submitBtn);
          finalStatus += " · Terkirim";

          await sleep(Math.max(450, delay));

          if (config.autoNext) {
            const nextBtn = findNextButton();
            if (nextBtn) {
              dispatchSingleCleanClick(nextBtn);
              await sleep(400);
            }
          }

          if (config.reloadAfterSubmit) {
            await sleep(300);
            chrome.runtime.sendMessage({ type: "RELOAD_ACTIVE_TAB" }).catch(() => location.reload());
            return;
          }

          setTimeout(() => {
            const nextDetected = detectActiveQuestionOnScreen();
            if (
              nextDetected &&
              (nextDetected.questionNumberLabel !== detected.questionNumberLabel ||
                nextDetected.questionText !== detected.questionText)
            ) {
              clearHighlightsAndResetState(`Lanjut ${nextDetected.questionNumberLabel}...`);
              if (config.enabled) {
                runSolvePipeline(false);
              }
            }
          }, 500);
        }
      }

      notifyHud({
        statusText: finalStatus,
        state: config.enabled ? "active" : config.manualAutoSubmit ? "manual" : "idle",
        badgeText: slotInfo,
        answerTitle: `${detected.questionNumberLabel} · Opsi ${chosenLetters}: ${chosenTexts.join(" | ")}`,
        explanation: aiData.explanation || "Jawaban dipilih berdasarkan analisis materi Cisco NetAcad.",
        detailMeta: {
          slotLabel: aiData.fromCache
            ? "Sumber: Memori Cache Lokal (0 Kuota)"
            : aiData.fallbackOccurred
            ? `Sumber: API Key #${aiData.usedKeySlot} (Auto-Fallback dari Key #${aiData.fallbackFromSlot} yang Limit)`
            : `Sumber: API Key #${aiData.usedKeySlot || 1} (${aiData.model || config.model})`,
          fallback: Boolean(aiData.fallbackOccurred),
          questionLabel: `${detected.questionNumberLabel} (${detected.progressLabel || "Quiz"})`
        }
      });
    } catch (err) {
      const msg = err.message || String(err);
      const isQuotaOrNoKey = /QUOTA_EXCEEDED|NO_API_KEY|429/i.test(msg);
      notifyHud({
        statusText: isQuotaOrNoKey ? "Kuota API Limit · Klik Manual Tetap Auto-Submit" : msg.slice(0, 65),
        state: config.manualAutoSubmit ? "manual" : "idle",
        badgeText: isQuotaOrNoKey ? "MANUAL·AUTO" : "ERR",
        answerTitle: isQuotaOrNoKey ? "Semua Slot API Key Mencapai Limit Kuota" : "Detail Kendala",
        explanation: msg,
        detailMeta: {
          slotLabel: "Mode Fallback Manual Aktif (Pilih opsi sendiri -> otomatis klik Submit)",
          fallback: true,
          questionLabel: detected.questionNumberLabel || ""
        }
      });
    } finally {
      isSolving = false;
    }
  }

  function notifyHud(payload) {
    if (IS_TOP_WINDOW) {
      renderHudUpdate(payload);
    } else {
      chrome.runtime.sendMessage({
        type: "FORWARD_HUD_UPDATE",
        payload
      }).catch(() => {});
    }
  }

  function ensureHud() {
    if (!IS_TOP_WINDOW) return;
    if (hudEl && document.documentElement.contains(hudEl)) return;
    if (!RELEVANT_HOST_PATTERN.test(location.href) && !document.querySelector("iframe") && !detectActiveQuestionOnScreen()) return;

    hudEl = document.createElement("div");
    hudEl.id = "netacad-ai-hud";
    if (config.stealthMode) hudEl.classList.add("nai-hidden");

    const lvlTag = LEVEL_SHORT[config.quotaLevel] || "ECO";
    const dotState = config.enabled ? "active" : config.manualAutoSubmit ? "manual" : "";
    isDetailExpanded = Boolean(config.showExplanation);

    hudEl.innerHTML = `
      <div class="nai-header" id="nai-drag-handle">
        <div class="nai-brand">
          <span class="nai-dot ${dotState}" id="nai-status-dot"></span>
          <span>NetAcad Assistant</span>
        </div>
        <div class="nai-header-actions">
          <button class="nai-icon-btn ${config.manualAutoSubmit ? "is-on" : ""}" id="nai-manual-sub-btn" title="Auto-Submit Saat Klik Manual (Jalan Tanpa Kuota API)">
            ${SVG.checkSend}
          </button>
          <button class="nai-icon-btn" id="nai-min-btn" title="Minimize">
            ${SVG.minus}
          </button>
          <button class="nai-icon-btn" id="nai-hide-btn" title="Sembunyikan (Alt+H)">
            ${SVG.close}
          </button>
        </div>
      </div>
      <div class="nai-body">
        <div class="nai-status-row">
          <span class="nai-status-text" id="nai-status-text">${
            config.enabled
              ? "AI Auto-Solve Aktif"
              : config.manualAutoSubmit
              ? "Klik Manual -> Auto-Submit"
              : "Mode Siaga"
          }</span>
          <div class="nai-status-right">
            <span class="nai-badge" id="nai-badge">${lvlTag}</span>
            <button class="nai-expand-btn ${isDetailExpanded ? "expanded" : ""}" id="nai-expand-btn" title="Lihat / Sembunyikan Detail & Penjelasan Lengkap">
              <span>Detail</span>
              ${SVG.chevronDown}
            </button>
          </div>
        </div>

        <div class="nai-answer-summary" id="nai-answer-box" style="display:none;">
          <div class="nai-answer-key" id="nai-answer-key"></div>
        </div>

        <!-- Expandable Explanation & Detail Drawer -->
        <div class="nai-detail-drawer ${isDetailExpanded ? "open" : ""}" id="nai-detail-drawer">
          <div class="nai-detail-meta" id="nai-detail-meta">
            <span class="nai-detail-chip">Klik tombol Scan / Jawab AI untuk melihat detail penjelasan soal.</span>
          </div>
          <div class="nai-detail-explanation" id="nai-explanation">Belum ada detail penjelasan.</div>
        </div>

        <div class="nai-toolbar">
          <button class="nai-pill-btn primary" id="nai-solve-now-btn" title="Scan & Jawab dengan AI (Alt+S)">
            ${SVG.spark}
            <span>Jawab AI</span>
          </button>
          <button class="nai-pill-btn ${config.enabled ? "active-mode" : ""}" id="nai-toggle-auto-btn" title="Aktifkan/Matikan AI Otomatis (Alt+A)">
            ${SVG.bot}
            <span id="nai-auto-label">${config.enabled ? "AI: ON" : "AI: OFF"}</span>
          </button>
        </div>
      </div>
    `;

    document.documentElement.appendChild(hudEl);

    hudEl.querySelector("#nai-min-btn").addEventListener("click", () => {
      hudEl.classList.toggle("nai-minimized");
    });

    hudEl.querySelector("#nai-hide-btn").addEventListener("click", () => {
      hudEl.classList.add("nai-hidden");
    });

    hudEl.querySelector("#nai-expand-btn").addEventListener("click", () => {
      isDetailExpanded = !isDetailExpanded;
      const expandBtn = hudEl.querySelector("#nai-expand-btn");
      const drawer = hudEl.querySelector("#nai-detail-drawer");
      if (expandBtn) expandBtn.classList.toggle("expanded", isDetailExpanded);
      if (drawer) drawer.classList.toggle("open", isDetailExpanded);
    });

    hudEl.querySelector("#nai-manual-sub-btn").addEventListener("click", async () => {
      const nextManual = !config.manualAutoSubmit;
      await chrome.storage.local.set({ manualAutoSubmit: nextManual });
    });

    hudEl.querySelector("#nai-solve-now-btn").addEventListener("click", () => {
      lastSolvedSignature = "";
      chrome.runtime.sendMessage({
        type: "BROADCAST_TO_TAB",
        payload: { type: "TRIGGER_SOLVE_NOW" }
      });
    });

    hudEl.querySelector("#nai-toggle-auto-btn").addEventListener("click", async () => {
      const nextState = !config.enabled;
      await chrome.storage.local.set({ enabled: nextState });
    });

    const handle = hudEl.querySelector("#nai-drag-handle");
    let dragging = false;
    let startX = 0, startY = 0, origRight = 22, origBottom = 74;

    handle.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = hudEl.getBoundingClientRect();
      origRight = window.innerWidth - rect.right;
      origBottom = window.innerHeight - rect.bottom;
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      hudEl.style.right = `${Math.max(8, origRight - dx)}px`;
      hudEl.style.bottom = `${Math.max(8, origBottom - dy)}px`;
    });

    window.addEventListener("mouseup", () => {
      dragging = false;
    });
  }

  function renderHudUpdate(payload) {
    if (!IS_TOP_WINDOW) return;
    ensureHud();
    if (!hudEl) return;

    const dot = hudEl.querySelector("#nai-status-dot");
    const statusText = hudEl.querySelector("#nai-status-text");
    const badge = hudEl.querySelector("#nai-badge");
    const answerBox = hudEl.querySelector("#nai-answer-box");
    const answerKey = hudEl.querySelector("#nai-answer-key");
    const detailMeta = hudEl.querySelector("#nai-detail-meta");
    const explanation = hudEl.querySelector("#nai-explanation");

    if (payload.statusText && statusText) {
      statusText.textContent = payload.statusText;
      statusText.title = payload.statusText;
    }
    if (payload.badgeText && badge) badge.textContent = payload.badgeText;

    if (dot) {
      dot.className = "nai-dot";
      if (payload.state === "working") dot.classList.add("working");
      else if (payload.state === "active" || config.enabled) dot.classList.add("active");
      else if (payload.state === "manual" || config.manualAutoSubmit) dot.classList.add("manual");
    }

    if (payload.clearAnswerBox && answerBox) {
      answerBox.style.display = "none";
      if (answerKey) answerKey.textContent = "";
    }

    if (payload.answerTitle && answerBox && answerKey) {
      answerBox.style.display = "flex";
      answerKey.textContent = payload.answerTitle;
      answerKey.title = payload.answerTitle;
    }

    if (payload.detailMeta && detailMeta) {
      const chipCls = payload.detailMeta.fallback ? "nai-detail-chip fallback" : "nai-detail-chip";
      detailMeta.innerHTML = `
        <span class="${chipCls}">${payload.detailMeta.slotLabel || ""}</span>
        ${payload.detailMeta.questionLabel ? `<span class="nai-detail-chip">${payload.detailMeta.questionLabel}</span>` : ""}
      `;
    }

    if (payload.explanation !== undefined && explanation) {
      explanation.textContent = payload.explanation || "Tidak ada detail tambahan.";
    }
  }

  function handleRouteOrQuestionTransition() {
    lastKnownUrl = location.href;
    clearHighlightsAndResetState(
      config.enabled
        ? "Memindai soal berikutnya..."
        : config.manualAutoSubmit
        ? "Klik Manual -> Auto-Submit"
        : "Mode Siaga"
    );
    if (config.enabled && isRelevantContext()) {
      setTimeout(() => {
        runSolvePipeline(false);
      }, 600);
    }
  }

  function setupNavigationWatchers() {
    window.addEventListener("popstate", () => handleRouteOrQuestionTransition());
    window.addEventListener("hashchange", () => handleRouteOrQuestionTransition());

    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;

    history.pushState = function (...args) {
      const ret = origPushState.apply(this, args);
      handleRouteOrQuestionTransition();
      return ret;
    };

    history.replaceState = function (...args) {
      const ret = origReplaceState.apply(this, args);
      handleRouteOrQuestionTransition();
      return ret;
    };
  }

  async function init() {
    const stored = await chrome.storage.local.get(null);
    config = { ...config, ...stored };

    setupNavigationWatchers();
    setupManualPickAutoSubmitListener();

    if (IS_TOP_WINDOW && isRelevantContext()) {
      ensureHud();
    }

    chrome.storage.onChanged.addListener((changes) => {
      for (const [k, v] of Object.entries(changes)) {
        config[k] = v.newValue;
      }
      if (IS_TOP_WINDOW && hudEl) {
        const toggleBtn = hudEl.querySelector("#nai-toggle-auto-btn");
        const autoLabel = hudEl.querySelector("#nai-auto-label");
        if (toggleBtn) toggleBtn.classList.toggle("active-mode", Boolean(config.enabled));
        if (autoLabel) autoLabel.textContent = config.enabled ? "AI: ON" : "AI: OFF";

        const manualBtn = hudEl.querySelector("#nai-manual-sub-btn");
        if (manualBtn) manualBtn.classList.toggle("is-on", Boolean(config.manualAutoSubmit));

        const dot = hudEl.querySelector("#nai-status-dot");
        if (dot) {
          dot.className = "nai-dot";
          if (config.enabled) dot.classList.add("active");
          else if (config.manualAutoSubmit) dot.classList.add("manual");
        }

        const badge = hudEl.querySelector("#nai-badge");
        if (badge) badge.textContent = LEVEL_SHORT[config.quotaLevel] || "ECO";
      }
      if (changes.enabled && changes.enabled.newValue === true) {
        lastSolvedSignature = "";
        runSolvePipeline(false);
      }
    });

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === "TRIGGER_SOLVE_NOW") {
        lastSolvedSignature = "";
        runSolvePipeline(true);
        sendResponse({ ok: true });
      } else if (msg.type === "HUD_STATUS_UPDATE" && IS_TOP_WINDOW) {
        renderHudUpdate(msg.payload);
        sendResponse({ ok: true });
      } else if (msg.type === "URL_CONTEXT_CHANGED") {
        handleRouteOrQuestionTransition();
        sendResponse({ ok: true });
      } else if (msg.type === "TEMP_HIDE_HUD" && IS_TOP_WINDOW && hudEl) {
        if (msg.hide) hudEl.classList.add("nai-temp-capture-hide");
        else hudEl.classList.remove("nai-temp-capture-hide");
        sendResponse({ ok: true });
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.altKey && e.code === "KeyS") {
        e.preventDefault();
        lastSolvedSignature = "";
        runSolvePipeline(true);
      } else if (e.altKey && e.code === "KeyA") {
        e.preventDefault();
        chrome.storage.local.set({ enabled: !config.enabled });
      } else if (e.altKey && e.code === "KeyH" && IS_TOP_WINDOW) {
        e.preventDefault();
        ensureHud();
        if (hudEl) hudEl.classList.toggle("nai-hidden");
      }
    });

    setInterval(() => {
      if (location.href !== lastKnownUrl) {
        handleRouteOrQuestionTransition();
        return;
      }

      const meta = extractPageMetadata();
      if (meta.questionNumberLabel && lastQuestionHeader && meta.questionNumberLabel !== lastQuestionHeader && !isSolving) {
        lastQuestionHeader = meta.questionNumberLabel;
        clearHighlightsAndResetState(`${meta.questionNumberLabel} siap`);
      }

      if (IS_TOP_WINDOW && isRelevantContext()) {
        ensureHud();
      }

      if (!config.enabled || isSolving || isManualSubmitting) return;
      if (!isRelevantContext()) return;
      runSolvePipeline(false);
    }, 1400);
  }

  init();
})();
