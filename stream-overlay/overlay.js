(function () {
  "use strict";

  const STORAGE_KEY = "ql-overlay-config";

  const els = {
    logo: document.getElementById("tournament-logo"),
    popup: document.getElementById("match-popup"),
    tournament: document.getElementById("popup-tournament"),
    title: document.getElementById("popup-title"),
    meta: document.getElementById("popup-meta"),
    connect: document.getElementById("popup-connect"),
    players: document.getElementById("popup-players"),
    status: document.getElementById("status"),
    setupPanel: document.getElementById("setup-panel"),
    setupForm: document.getElementById("setup-form"),
    setupError: document.getElementById("setup-error"),
    editSettings: document.getElementById("edit-settings"),
    logoPicker: document.getElementById("logo-picker"),
  };

  let config = null;
  let lastMatchId = null;
  let hideTimer = null;
  let pollTimer = null;
  let publicDataTimer = null;
  let logoCatalog = [];
  let publicMeta = null;
  let publicBracket = null;

  function setStatus(text, isError) {
    if (!text) {
      els.status.classList.add("hidden");
      els.status.textContent = "";
      return;
    }
    els.status.textContent = text;
    els.status.classList.toggle("error", !!isError);
    els.status.classList.remove("hidden");
  }

  function show(el) {
    el.classList.remove("hidden");
  }

  function hide(el) {
    el.classList.add("hidden");
  }

  function normalizeConfig(raw) {
    const apiBaseUrl = String(raw.apiBaseUrl || "").replace(/\/+$/, "");
    const overlayToken = String(raw.overlayToken || "").trim();
    const tournamentId = raw.tournamentId;
    const publicDataBase = String(raw.publicDataBase || "").replace(/\/+$/, "");
    const tournamentSlug = String(raw.tournamentSlug || "").trim().toLowerCase();
    const pollIntervalMs = Math.max(1000, Number(raw.pollIntervalMs) || 2000);
    const logoId = String(raw.logoId || "").trim();
    const logoUrl = String(raw.logoUrl || "").trim();
    const logoFile = String(raw.logoFile || "").trim();
    const showConnect = raw.showConnect !== false;
    const popupAutoHideMs = Math.max(0, Number(raw.popupAutoHideMs) || 0);

    if (!apiBaseUrl) {
      throw new Error("Hub URL (apiBaseUrl) is required");
    }

    return {
      apiBaseUrl,
      overlayToken,
      tournamentId:
        tournamentId === null || tournamentId === undefined || tournamentId === ""
          ? null
          : Number(tournamentId),
      publicDataBase,
      tournamentSlug,
      pollIntervalMs,
      logoId,
      logoUrl,
      logoFile,
      showConnect,
      popupAutoHideMs,
    };
  }

  function loadConfigFromStorage() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    try {
      return normalizeConfig(JSON.parse(stored));
    } catch (err) {
      throw new Error(`Invalid saved config: ${err.message || err}`);
    }
  }

  function saveConfigToStorage(raw) {
    const normalized = normalizeConfig(raw);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function fillSetupForm(values) {
    const form = els.setupForm;
    form.apiBaseUrl.value = values?.apiBaseUrl || "";
    form.overlayToken.value = values?.overlayToken || "";
    form.tournamentId.value =
      values?.tournamentId != null && !Number.isNaN(values.tournamentId)
        ? String(values.tournamentId)
        : "";
    form.publicDataBase.value = values?.publicDataBase || "";
    form.tournamentSlug.value = values?.tournamentSlug || "";
    form.pollIntervalMs.value = String(values?.pollIntervalMs ?? 2000);
    form.logoId.value = values?.logoId || "";
    form.logoUrl.value = values?.logoUrl || values?.logoFile || "";
    form.showConnect.checked = values?.showConnect !== false;
    form.popupAutoHideMs.value = String(values?.popupAutoHideMs ?? 0);
  }

  function readSetupForm() {
    const tournamentRaw = formTrim(els.setupForm.tournamentId.value);
    return {
      apiBaseUrl: formTrim(els.setupForm.apiBaseUrl.value),
      overlayToken: formTrim(els.setupForm.overlayToken.value),
      tournamentId: tournamentRaw === "" ? null : Number(tournamentRaw),
      publicDataBase: formTrim(els.setupForm.publicDataBase.value),
      tournamentSlug: formTrim(els.setupForm.tournamentSlug.value).toLowerCase(),
      pollIntervalMs: Number(els.setupForm.pollIntervalMs.value),
      logoId: formTrim(els.setupForm.logoId.value),
      logoUrl: formTrim(els.setupForm.logoUrl.value),
      showConnect: els.setupForm.showConnect.checked,
      popupAutoHideMs: Number(els.setupForm.popupAutoHideMs.value),
    };
  }

  function formTrim(value) {
    return String(value || "").trim();
  }

  function showSetupError(message) {
    if (!message) {
      hide(els.setupError);
      els.setupError.textContent = "";
      return;
    }
    els.setupError.textContent = message;
    show(els.setupError);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function stopPublicDataPolling() {
    if (publicDataTimer) {
      clearInterval(publicDataTimer);
      publicDataTimer = null;
    }
  }

  function publicDataEnabled() {
    return Boolean(config?.publicDataBase && config?.tournamentSlug);
  }

  function publicDataUrl(path) {
    return `${config.publicDataBase}/tournaments/${config.tournamentSlug}/${path}`;
  }

  async function fetchPublicJson(path) {
    const res = await fetch(publicDataUrl(path), {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Public data ${res.status} (${path})`);
    }
    return res.json();
  }

  async function refreshPublicData() {
    if (!publicDataEnabled()) {
      publicMeta = null;
      publicBracket = null;
      return;
    }
    try {
      const [meta, bracket] = await Promise.all([
        fetchPublicJson("meta.json"),
        fetchPublicJson("bracket.json"),
      ]);
      publicMeta = meta;
      publicBracket = bracket;
    } catch (err) {
      publicMeta = null;
      publicBracket = null;
      setStatus(`Public data: ${err.message || err}`, true);
    }
  }

  function startPublicDataPolling() {
    stopPublicDataPolling();
    if (!publicDataEnabled()) return;
    refreshPublicData();
    publicDataTimer = setInterval(refreshPublicData, Math.max(config.pollIntervalMs, 5000));
  }

  function tournamentDisplayName(match) {
    if (match?.tournament_name) return match.tournament_name;
    if (publicMeta?.name) return publicMeta.name;
    return "Tournament";
  }

  function selectedLogoId() {
    return formTrim(els.setupForm.logoId.value);
  }

  function setSelectedLogo(logo) {
    els.setupForm.logoId.value = logo ? logo.id : "";
    els.setupForm.logoUrl.value = logo ? logo.url : "";
    renderLogoPicker();
  }

  function renderLogoPicker(message, isError) {
    const picker = els.logoPicker;
    picker.innerHTML = "";

    if (message) {
      const hint = document.createElement("p");
      hint.className = isError ? "logo-picker-status error" : "logo-picker-hint";
      hint.textContent = message;
      picker.appendChild(hint);
      return;
    }

    const selectedId = selectedLogoId();

    const noneBtn = document.createElement("button");
    noneBtn.type = "button";
    noneBtn.className = `logo-option${selectedId === "" ? " selected" : ""}`;
    noneBtn.textContent = "None";
    noneBtn.addEventListener("click", () => setSelectedLogo(null));
    picker.appendChild(noneBtn);

    for (const logo of logoCatalog) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `logo-option${selectedId === logo.id ? " selected" : ""}`;
      btn.title = logo.name;

      const img = document.createElement("img");
      img.src = logo.url;
      img.alt = logo.name;
      btn.appendChild(img);

      const label = document.createElement("span");
      label.textContent = logo.name;
      btn.appendChild(label);

      btn.addEventListener("click", () => setSelectedLogo(logo));
      picker.appendChild(btn);
    }
  }

  async function loadLogoCatalog(apiBaseUrl) {
    const base = String(apiBaseUrl || "").replace(/\/+$/, "");
    if (!base) {
      logoCatalog = [];
      renderLogoPicker("Enter Hub URL above to load official logos.");
      return;
    }

    renderLogoPicker("Loading logos…");
    try {
      const res = await fetch(`${base}/api/overlay/logos`, {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`Hub ${res.status}`);
      }
      const data = await res.json();
      logoCatalog = Array.isArray(data) ? data : [];
      if (!logoCatalog.length) {
        renderLogoPicker("No logos on Hub yet. Ask the organizer to add PNG/SVG files.");
        return;
      }
      renderLogoPicker();
    } catch (err) {
      logoCatalog = [];
      renderLogoPicker(
        `Could not load logos: ${err.message || err}. Check Hub URL and CORS.`,
        true
      );
    }
  }

  function showSetupPanel(existing) {
    stopPolling();
    stopPublicDataPolling();
    fillSetupForm(existing);
    showSetupError("");
    show(els.setupPanel);
    hide(els.editSettings);
    loadLogoCatalog(existing?.apiBaseUrl || els.setupForm.apiBaseUrl.value);
  }

  function hideSetupPanel() {
    hide(els.setupPanel);
    show(els.editSettings);
  }

  function resolveLogoSrc(cfg) {
    return cfg.logoUrl || cfg.logoFile || "";
  }

  function setupLogo(cfg) {
    const src = resolveLogoSrc(cfg);
    if (!src) {
      hide(els.logo);
      return;
    }
    els.logo.src = src;
    els.logo.alt = cfg.logoId ? "Tournament logo" : "Logo";
    els.logo.onerror = () => hide(els.logo);
    els.logo.onload = () => show(els.logo);
  }

  function buildOverlayUrl() {
    const params = new URLSearchParams({ token: config.overlayToken });
    if (config.tournamentId != null && !Number.isNaN(config.tournamentId)) {
      params.set("tournament_id", String(config.tournamentId));
    }
    return `${config.apiBaseUrl}/api/overlay/live?${params.toString()}`;
  }

  function formatMeta(match) {
    const parts = [];
    if (match.map_name) parts.push(match.map_name);
    if (match.gametype) parts.push(match.gametype);
    if (match.server_name) parts.push(match.server_name);
    return parts.join(" · ") || "Live";
  }

  function renderPlayers(players) {
    els.players.innerHTML = "";
    const list = Array.isArray(players) ? players : [];
    if (!list.length) {
      const li = document.createElement("li");
      li.textContent = "Waiting for player stats…";
      els.players.appendChild(li);
      return;
    }
    for (const p of list) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.className = "player-name";
      name.textContent = p.nickname || p.steam_id64 || "Player";
      const stats = document.createElement("span");
      stats.className = "player-stats";
      stats.textContent = `Score ${p.score ?? 0} · K ${p.kills ?? 0} · D ${p.deaths ?? 0}`;
      li.appendChild(name);
      li.appendChild(stats);
      els.players.appendChild(li);
    }
  }

  function renderMatch(match) {
    els.tournament.textContent = tournamentDisplayName(match);
    els.title.textContent = `Match #${match.match_id}`;
    els.meta.textContent = formatMeta(match);
    if (config.showConnect && match.connect) {
      els.connect.textContent = `/connect ${match.connect}`;
      show(els.connect);
    } else {
      hide(els.connect);
    }
    renderPlayers(match.players);
  }

  function clearHideTimer() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function scheduleAutoHide() {
    clearHideTimer();
    if (!config.popupAutoHideMs) return;
    hideTimer = setTimeout(() => hidePopup(), config.popupAutoHideMs);
  }

  function showPopup(match) {
    renderMatch(match);
    show(els.popup);
    scheduleAutoHide();
  }

  function hidePopup() {
    clearHideTimer();
    hide(els.popup);
  }

  function pickPrimaryMatch(data) {
    const matches = data && Array.isArray(data.matches) ? data.matches : [];
    return matches.length ? matches[0] : null;
  }

  function shouldShowPopup(match) {
    const matchId = match.match_id;
    const matchChanged = lastMatchId !== null && lastMatchId !== matchId;
    lastMatchId = matchId;
    if (matchChanged) return true;
    return !!match.show_popup;
  }

  function applyLiveData(data) {
    const match = pickPrimaryMatch(data);
    if (!match) {
      lastMatchId = null;
      hidePopup();
      setStatus("No live matches", false);
      return;
    }

    const visible = shouldShowPopup(match);
    if (visible) {
      showPopup(match);
    } else {
      hidePopup();
    }

    const updated = data.updated_at ? new Date(data.updated_at) : null;
    const timeLabel = updated && !Number.isNaN(updated.getTime())
      ? updated.toLocaleTimeString()
      : "";
    setStatus(timeLabel ? `Updated ${timeLabel}` : "", false);
  }

  async function pollOnce() {
    const url = buildOverlayUrl();
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Hub ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`);
    }
    return res.json();
  }

  async function tick() {
    try {
      const data = await pollOnce();
      applyLiveData(data);
    } catch (err) {
      setStatus(err.message || String(err), true);
    }
  }

  function startPolling() {
    stopPolling();
    tick();
    pollTimer = setInterval(tick, config.pollIntervalMs);
  }

  function applyConfig(nextConfig) {
    config = nextConfig;
    setupLogo(config);
    hidePopup();
    lastMatchId = null;
    publicMeta = null;
    publicBracket = null;

    startPublicDataPolling();

    if (config.overlayToken) {
      startPolling();
    } else {
      stopPolling();
      if (publicDataEnabled()) {
        setStatus("Public bracket loaded — add overlay token for live match popups", false);
      } else {
        setStatus("Logo only — add overlay token for live match popups", false);
      }
    }
    hideSetupPanel();
  }

  function onSetupSubmit(event) {
    event.preventDefault();
    try {
      applyConfig(saveConfigToStorage(readSetupForm()));
      showSetupError("");
    } catch (err) {
      showSetupError(err.message || String(err));
    }
  }

  function onApiBaseUrlChange() {
    if (els.setupPanel.classList.contains("hidden")) return;
    loadLogoCatalog(els.setupForm.apiBaseUrl.value);
  }

  function init() {
    els.setupForm.addEventListener("submit", onSetupSubmit);
    els.setupForm.apiBaseUrl.addEventListener("change", onApiBaseUrlChange);
    els.setupForm.apiBaseUrl.addEventListener("blur", onApiBaseUrlChange);
    els.editSettings.addEventListener("click", () => showSetupPanel(config));

    try {
      const stored = loadConfigFromStorage();
      if (!stored) {
        showSetupPanel(null);
        return;
      }
      applyConfig(stored);
    } catch (err) {
      setStatus(err.message || String(err), true);
      showSetupPanel(null);
      console.error("[stream-overlay]", err);
    }
  }

  init();
})();
