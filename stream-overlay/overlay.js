(function () {
  "use strict";

  const STORAGE_KEY = "ql-overlay-config";
  const DEFAULT_PUBLIC_DATA_BASE =
    "https://cdn.jsdelivr.net/gh/alexeytihomirov/ql-public-data@main";

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
  let ws = null;
  let wsReconnectTimer = null;
  let logoCatalog = [];
  let publicMeta = null;
  let cdnOverlayHints = null;

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

  function formTrim(value) {
    return String(value || "").trim();
  }

  function normalizeConfig(raw) {
    const publicDataBase = String(
      raw.publicDataBase || DEFAULT_PUBLIC_DATA_BASE
    ).replace(/\/+$/, "");
    const tournamentSlug = String(raw.tournamentSlug || "")
      .trim()
      .toLowerCase();
    const statsHubBase = String(raw.statsHubBase || "").replace(/\/+$/, "");
    const pollIntervalMs = Math.max(0, Number(raw.pollIntervalMs) ?? 30000);
    const logoId = String(raw.logoId || "").trim();
    const logoUrl = String(raw.logoUrl || "").trim();
    const logoFile = String(raw.logoFile || "").trim();
    const showConnect = raw.showConnect !== false;
    const popupAutoHideMs = Math.max(0, Number(raw.popupAutoHideMs) || 0);

    if (!publicDataBase) {
      throw new Error("Public data base URL (publicDataBase) is required");
    }
    if (!tournamentSlug) {
      throw new Error("Tournament slug is required");
    }

    return {
      publicDataBase,
      tournamentSlug,
      statsHubBase,
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
    const parsed = JSON.parse(stored);
    if (parsed.apiBaseUrl || parsed.overlayToken) {
      throw new Error(
        "Saved config uses deprecated Hub URL/token. Set public data base + tournament slug instead."
      );
    }
    return normalizeConfig(parsed);
  }

  function saveConfigToStorage(raw) {
    const normalized = normalizeConfig(raw);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function fillSetupForm(values) {
    const form = els.setupForm;
    form.publicDataBase.value =
      values?.publicDataBase || DEFAULT_PUBLIC_DATA_BASE;
    form.tournamentSlug.value = values?.tournamentSlug || "";
    form.statsHubBase.value = values?.statsHubBase || "";
    form.pollIntervalMs.value = String(values?.pollIntervalMs ?? 30000);
    form.logoId.value = values?.logoId || "";
    form.logoUrl.value = values?.logoUrl || values?.logoFile || "";
    form.showConnect.checked = values?.showConnect !== false;
    form.popupAutoHideMs.value = String(values?.popupAutoHideMs ?? 0);
  }

  function readSetupForm() {
    return {
      publicDataBase: formTrim(els.setupForm.publicDataBase.value),
      tournamentSlug: formTrim(els.setupForm.tournamentSlug.value).toLowerCase(),
      statsHubBase: formTrim(els.setupForm.statsHubBase.value).replace(/\/+$/, ""),
      pollIntervalMs: Number(els.setupForm.pollIntervalMs.value),
      logoId: formTrim(els.setupForm.logoId.value),
      logoUrl: formTrim(els.setupForm.logoUrl.value),
      showConnect: els.setupForm.showConnect.checked,
      popupAutoHideMs: Number(els.setupForm.popupAutoHideMs.value),
    };
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

  function stopWebSocket() {
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
    }
  }

  function useStatsHubWebSocket() {
    return Boolean(config?.statsHubBase);
  }

  function statsHubWsUrl() {
    const base = config.statsHubBase;
    const wsProto = base.startsWith("https") ? "wss" : "ws";
    const hostPath = base.replace(/^https?:\/\//, "");
    return `${wsProto}://${hostPath}/api/ws/live`;
  }

  async function fetchStatsHubJson(path) {
    const res = await fetch(`${config.statsHubBase}${path}`, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function connectHintFromCdn() {
    const rows = cdnOverlayHints?.matches;
    if (!Array.isArray(rows) || !rows.length) return null;
    return rows[0].connect || null;
  }

  function showPopupFlagFromCdn(matchId) {
    const rows = cdnOverlayHints?.matches;
    if (!Array.isArray(rows)) return true;
    const row = rows.find((m) => String(m.match_id) === String(matchId));
    if (!row) return true;
    return row.show_popup !== false;
  }

  function streamRowToOverlayMatch(row, connectHint) {
    return {
      match_id: row.match_id,
      tournament_name: tournamentDisplayName(row),
      map_name: row.map_name,
      gametype: row.gametype,
      server_name: row.server_name,
      connect: connectHint || null,
      show_popup: true,
      players: row.players || [],
    };
  }

  function matchFromWsPayload(payload) {
    const m = payload.match || payload;
    if (!m || !m.match_id) return null;
    const connectHint = config.showConnect ? connectHintFromCdn() : null;
    return {
      match_id: m.match_id,
      tournament_name: tournamentDisplayName(m),
      map_name: m.map_name,
      gametype: m.gametype,
      server_name: m.server_name,
      connect: connectHint,
      show_popup: showPopupFlagFromCdn(m.match_id),
      players: m.players || [],
    };
  }

  async function refreshCdnOverlayHints() {
    try {
      cdnOverlayHints = await fetchJson(tournamentDataUrl("overlay-live.json"));
    } catch {
      /* keep previous hints */
    }
  }

  function scheduleWsReconnect(ms) {
    if (wsReconnectTimer) return;
    wsReconnectTimer = setTimeout(() => {
      wsReconnectTimer = null;
      startWebSocket();
    }, ms || 2000);
  }

  async function bootstrapStatsHubLive() {
    const rows = await fetchStatsHubJson("/api/stream/matches");
    if (!rows.length) {
      lastMatchId = null;
      hidePopup();
      setStatus("No live matches", false);
      return;
    }
    const connectHint = config.showConnect ? connectHintFromCdn() : null;
    applyLiveData({ matches: [streamRowToOverlayMatch(rows[0], connectHint)] });
  }

  function startWebSocket() {
    stopWebSocket();
    if (!useStatsHubWebSocket()) return;

    bootstrapStatsHubLive().catch((err) => {
      setStatus(err.message || String(err), true);
    });

    ws = new WebSocket(statsHubWsUrl());
    ws.onopen = () => setStatus("WS connected", false);
    ws.onmessage = (ev) => {
      let payload;
      try {
        payload = JSON.parse(ev.data);
      } catch {
        return;
      }
      const event = payload.event;
      if (event === "match_update" || event === "match_status") {
        const match = matchFromWsPayload(payload);
        if (match) applyLiveData({ matches: [match] });
      }
    };
    ws.onclose = () => {
      setStatus("WS disconnected, reconnecting…", true);
      scheduleWsReconnect(2000);
    };
    ws.onerror = () => {
      if (ws) ws.close();
    };
  }

  function publicDataRoot(path) {
    return `${config.publicDataBase}/${path.replace(/^\//, "")}`;
  }

  function tournamentDataUrl(path) {
    return publicDataRoot(`tournaments/${config.tournamentSlug}/${path}`);
  }

  async function fetchJson(url) {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${url.split("/").slice(-2).join("/")}`);
    }
    return res.json();
  }

  async function refreshPublicMeta() {
    try {
      publicMeta = await fetchJson(tournamentDataUrl("meta.json"));
    } catch {
      publicMeta = null;
    }
  }

  function tournamentDisplayName(match) {
    if (match?.tournament_name) return match.tournament_name;
    if (publicMeta?.name) return publicMeta.name;
    return config?.tournamentSlug || "Tournament";
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

  async function loadLogoCatalog(publicDataBase) {
    const base = String(publicDataBase || "").replace(/\/+$/, "");
    if (!base) {
      logoCatalog = [];
      renderLogoPicker("Enter public data base URL to load logos.");
      return;
    }

    renderLogoPicker("Loading logos…");
    try {
      const data = await fetchJson(`${base}/assets/overlay-logos.json`);
      logoCatalog = Array.isArray(data) ? data : [];
      if (!logoCatalog.length) {
        renderLogoPicker(
          "No logos published yet. Organizer adds PNG/SVG to ql-hub overlay-logos and publishes."
        );
        return;
      }
      renderLogoPicker();
    } catch (err) {
      logoCatalog = [];
      renderLogoPicker(`Could not load logos: ${err.message || err}`, true);
    }
  }

  function showSetupPanel(existing) {
    stopPolling();
    stopWebSocket();
    fillSetupForm(existing);
    showSetupError("");
    show(els.setupPanel);
    hide(els.editSettings);
    loadLogoCatalog(
      existing?.publicDataBase || els.setupForm.publicDataBase.value
    );
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
    const timeLabel =
      updated && !Number.isNaN(updated.getTime())
        ? updated.toLocaleTimeString()
        : "";
    setStatus(timeLabel ? `Updated ${timeLabel}` : "", false);
  }

  async function pollOnce() {
    return fetchJson(tournamentDataUrl("overlay-live.json"));
  }

  async function tick() {
    try {
      const data = await pollOnce();
      applyLiveData(data);
    } catch (err) {
      setStatus(err.message || String(err), true);
    }
  }

  function startCdnPolling() {
    stopPolling();
    if (!config.pollIntervalMs) return;
    tick();
    pollTimer = setInterval(tick, config.pollIntervalMs);
  }

  function startLiveTransport() {
    stopPolling();
    stopWebSocket();
    if (useStatsHubWebSocket()) {
      refreshCdnOverlayHints();
      startWebSocket();
      if (config.pollIntervalMs > 0) {
        pollTimer = setInterval(() => {
          refreshCdnOverlayHints();
        }, config.pollIntervalMs);
      }
      return;
    }
    startCdnPolling();
  }

  function applyConfig(nextConfig) {
    config = nextConfig;
    setupLogo(config);
    hidePopup();
    lastMatchId = null;
    publicMeta = null;
    cdnOverlayHints = null;

    refreshPublicMeta();
    startLiveTransport();
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

  function onPublicDataBaseChange() {
    if (els.setupPanel.classList.contains("hidden")) return;
    loadLogoCatalog(els.setupForm.publicDataBase.value);
  }

  function init() {
    els.setupForm.addEventListener("submit", onSetupSubmit);
    els.setupForm.publicDataBase.addEventListener("change", onPublicDataBaseChange);
    els.setupForm.publicDataBase.addEventListener("blur", onPublicDataBaseChange);
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
