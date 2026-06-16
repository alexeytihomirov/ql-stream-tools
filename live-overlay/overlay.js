(function () {
  "use strict";

  var STORAGE_KEY = "ql-live-overlay-base";

  function qs(name, fallback) {
    var params = new URLSearchParams(window.location.search);
    if (!params.has(name)) return fallback || "";
    var v = params.get(name);
    return v === null ? fallback || "" : v;
  }

  function apiBase() {
    var explicit = qs("base");
    if (explicit) return explicit.replace(/\/+$/, "");
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return stored.replace(/\/+$/, "");
    } catch (_e) {
      /* private mode */
    }
    return "";
  }

  function requireApiBase() {
    var base = apiBase();
    if (!base) {
      throw new Error(
        "Missing stats hub URL — add ?base=http://HOST:8090 to the OBS URL",
      );
    }
    return base;
  }

  function pollMs() {
    return Math.max(500, Number(qs("poll", "500")) || 500);
  }

  function mapPollMs() {
    return Math.max(500, Number(qs("poll", "100")) || 100);
  }

  function mapSmoothEnabled() {
    var v = String(qs("smooth", "1")).toLowerCase();
    return v !== "0" && v !== "false" && v !== "off";
  }

  function mapSmoothMs() {
    return Math.max(40, Math.min(800, Number(qs("smooth_ms", "180")) || 180));
  }

  function mapSmoothAlpha() {
    // Per-frame blend (~60fps); higher smooth_ms = slower catch-up.
    return 1 - Math.exp(-16.67 / mapSmoothMs());
  }

  function useWebSocket() {
    return qs("transport", "ws") !== "poll";
  }

  function matchId() {
    return qs("match");
  }

  function overlayPageUrl(page, id) {
    var base = apiBase();
    var params = new URLSearchParams(window.location.search);
    if (base && !params.get("base")) {
      params.set("base", base);
    }
    if (id) {
      params.set("match", id);
    } else {
      params.delete("match");
    }
    var path = page + ".html";
    var query = params.toString();
    return query ? path + "?" + query : path;
  }

  function openOverlayWindow(page, id, features) {
    var url = overlayPageUrl(page, id);
    var name = "ql-overlay-" + page + (id ? "-" + id : "");
    window.open(
      url,
      name,
      features || "noopener,noreferrer,width=960,height=720",
    );
  }

  function setStatus(text, isError) {
    var el = document.getElementById("status");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("error", !!isError);
  }

  async function fetchJson(path) {
    var base = requireApiBase();
    var res = await fetch(base + path, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  function renderPlayers(players) {
    var body = document.getElementById("players-body");
    if (!body) return;
    body.innerHTML = "";
    var sorted = (players || []).slice().sort(function (a, b) {
      return (b.score || 0) - (a.score || 0);
    });
    for (var i = 0; i < sorted.length; i++) {
      var p = sorted[i];
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        (p.nickname || p.steam_id64) +
        "</td><td>" +
        (p.score || 0) +
        "</td><td>" +
        (p.kills || 0) +
        "</td><td>" +
        (p.deaths || 0) +
        "</td>";
      body.appendChild(tr);
    }
  }

  async function refreshScoreboard() {
    var id = matchId();
    if (!id) {
      var rows = await fetchJson("/api/stream/matches");
      if (!rows.length) {
        setStatus("No live matches");
        return;
      }
      return refreshScoreboardFor(rows[0].match_id);
    }
    return refreshScoreboardFor(id);
  }

  async function refreshScoreboardFor(id) {
    var data = await fetchJson("/api/stream/matches/" + encodeURIComponent(id));
    var board = document.getElementById("scoreboard");
    var title = document.getElementById("match-title");
    var meta = document.getElementById("match-meta");
    if (board) board.classList.remove("hidden");
    if (title) title.textContent = data.score_summary || data.match_id;
    if (meta)
      meta.textContent = [data.map_name, data.gametype, data.server_name]
        .filter(Boolean)
        .join(" · ");
    renderPlayers(data.players);
    setStatus("");
  }

  async function refreshMatchList() {
    var list = document.getElementById("match-list");
    if (!list) return;
    var rows = await fetchJson("/api/stream/matches");
    list.innerHTML = "";
    if (!rows.length) {
      setStatus("No live matches exposed");
      return;
    }
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var card = document.createElement("div");
      card.className = "match-card";
      var mid = row.match_id || "";
      card.innerHTML =
        "<h3>" +
        (row.score_summary || mid) +
        "</h3><p>" +
        [row.map_name, row.gametype, row.server_name]
          .filter(Boolean)
          .join(" · ") +
        "</p>" +
        '<p class="match-card-id">' +
        mid +
        "</p>" +
        '<div class="match-card-actions">' +
        '<button type="button" class="overlay-btn" data-open="scoreboard" data-match="' +
        mid +
        '">Scoreboard</button>' +
        '<button type="button" class="overlay-btn" data-open="map" data-match="' +
        mid +
        '">Map</button>' +
        "</div>";
      list.appendChild(card);
    }
    list.querySelectorAll("[data-open]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openOverlayWindow(
          btn.getAttribute("data-open"),
          btn.getAttribute("data-match"),
        );
      });
    });
    setStatus(rows.length + " match(es)");
  }

  var cachedMapKey = "";
  var cachedTransform = null;
  var currentImageSrc = "";
  var mapImageLoaded = false;
  var lastMapContext = { map_name: null, gametype: null };
  var mapMotion = {
    byId: {},
    loopId: 0,
    renderTransform: null,
    zFloor: null,
    zCeiling: null,
    zSpanMin: 48,
  };

  var mapKillFeed = [];
  var mapPickupFeed = [];

  var PICKUP_LABELS = {
    item_armor_body: "RA",
    item_armor_combat: "YA",
    item_armor_shard: "Shard",
    item_health_mega: "Mega",
    item_health_large: "50hp",
    item_health: "25hp",
    item_quad: "Quad",
    item_regen: "Regen",
    item_haste: "Haste",
    item_enviro: "BS",
    item_invis: "Invis",
    item_invulnerability: "Invuln",
  };

  function pickupLabel(item) {
    return PICKUP_LABELS[item] || String(item || "item").replace(/^item_/, "");
  }

  function pushPickupFeed(entry) {
    mapPickupFeed.unshift(entry);
    if (mapPickupFeed.length > 4) mapPickupFeed.length = 4;
    renderPickupFeed();
  }

  function renderPickupFeed() {
    var el = document.getElementById("map-pickups");
    if (!el) return;
    el.innerHTML = "";
    for (var i = 0; i < mapPickupFeed.length; i++) {
      var row = mapPickupFeed[i];
      var line = document.createElement("div");
      line.className = "map-pickup-line";
      var who = stripQuakeColors(row.nickname || row.steam_id64 || "?");
      line.textContent = who + " · " + pickupLabel(row.item);
      el.appendChild(line);
    }
  }

  function handlePickupEvent(data) {
    pushPickupFeed(data);
    if (typeof console !== "undefined" && console.info) {
      console.info("[overlay] pickup", data);
    }
  }

  function pushKillFeed(entry) {
    mapKillFeed.unshift(entry);
    if (mapKillFeed.length > 5) mapKillFeed.length = 5;
    renderKillFeed();
  }

  function renderKillFeed() {
    var el = document.getElementById("map-killfeed");
    if (!el) return;
    el.innerHTML = "";
    for (var i = 0; i < mapKillFeed.length; i++) {
      var row = mapKillFeed[i];
      var line = document.createElement("div");
      line.className = "map-killfeed-line";
      var killer = stripQuakeColors(row.killer_name || row.killer_steam_id64 || "");
      var victim = stripQuakeColors(row.victim_name || row.victim_steam_id64 || "?");
      line.textContent = killer ? killer + " → " + victim : victim + " died";
      el.appendChild(line);
    }
  }

  function handleDeathEvent(data) {
    pushKillFeed(data);
    if (typeof console !== "undefined" && console.info) {
      console.info("[overlay] death", data);
    }
  }

  function stripQuakeColors(text) {
    return String(text || "")
      .replace(/\^[0-9a-zA-Z]/g, "")
      .trim();
  }

  function fmtCoord(v) {
    if (v == null) return "?";
    return Math.round(Number(v) * 10) / 10;
  }

  function lerpNum(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpYaw(a, b, t) {
    var delta = ((b - a + 540) % 360) - 180;
    return a + delta * t;
  }

  function cloneWorldPose(p) {
    return {
      x: p.x,
      y: p.y,
      z: p.z != null ? p.z : null,
      yaw: p.yaw != null ? p.yaw : null,
    };
  }

  function noteZExtent(z) {
    if (z == null || !isFinite(Number(z))) return;
    var v = Number(z);
    if (mapMotion.zFloor == null || v < mapMotion.zFloor) {
      mapMotion.zFloor = v;
    }
    if (mapMotion.zCeiling == null || v > mapMotion.zCeiling) {
      mapMotion.zCeiling = v;
    }
  }

  function dotSizeFromZ(z) {
    var base = 8;
    var extra = 6;
    if (z == null) return base;
    var floor = mapMotion.zFloor;
    var ceil = mapMotion.zCeiling;
    if (floor == null || ceil == null) return base;
    var span = ceil - floor;
    if (span < mapMotion.zSpanMin) {
      return base + extra * 0.5;
    }
    var t = Math.max(0, Math.min(1, (Number(z) - floor) / span));
    return base + t * extra;
  }

  function playerMotionId(p, index) {
    if (p.steam_id64 != null && String(p.steam_id64).trim() !== "") {
      return String(p.steam_id64).trim();
    }
    return String(p.nickname || "p" + index);
  }

  function normalizePlayersList(raw) {
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [];
  }

  function prunePlayerMarkers(layer, seen) {
    for (var key in mapMotion.byId) {
      if (seen[key]) continue;
      var gone = mapMotion.byId[key];
      if (gone.el && gone.el.marker && gone.el.marker.parentNode) {
        gone.el.marker.parentNode.removeChild(gone.el.marker);
      }
      delete mapMotion.byId[key];
    }
    if (!Object.keys(mapMotion.byId).length) {
      stopMotionLoop();
    }
  }

  function stopMotionLoop() {
    if (mapMotion.loopId) {
      cancelAnimationFrame(mapMotion.loopId);
      mapMotion.loopId = 0;
    }
  }

  function clearMapMotion() {
    stopMotionLoop();
    for (var id in mapMotion.byId) {
      var st = mapMotion.byId[id];
      if (st.el.marker && st.el.marker.parentNode)
        st.el.marker.parentNode.removeChild(st.el.marker);
    }
    mapMotion.byId = {};
    mapMotion.renderTransform = null;
    mapMotion.zFloor = null;
    mapMotion.zCeiling = null;
  }

  function playerLabelText(p) {
    var base = stripQuakeColors(p.nickname || p.steam_id64 || "");
    if (p.health == null) return base;
    var hp = Math.round(Number(p.health));
    if (!isFinite(hp)) return base;
    var bits = [base, hp + "hp"];
    if (p.armor != null && isFinite(Number(p.armor))) {
      bits.push(Math.round(Number(p.armor)) + "ar");
    }
    if (p.powerups && p.powerups.length) {
      bits.push(p.powerups.join("+"));
    }
    return bits.join(" · ");
  }

  function createPlayerElements(layer, p) {
    var marker = document.createElement("div");
    marker.className = "map-marker";
    var label = document.createElement("div");
    label.className = "map-label";
    var labelText = playerLabelText(p);
    label.textContent = labelText;
    if (!labelText) label.style.display = "none";
    var dot = document.createElement("div");
    dot.className = "map-dot";
    var view = document.createElement("div");
    view.className = "map-view";
    view.setAttribute("aria-hidden", "true");
    marker.appendChild(label);
    marker.appendChild(dot);
    marker.appendChild(view);
    layer.appendChild(marker);
    marker.title =
      playerLabelText(p) +
      " (" +
      fmtCoord(p.x) +
      ", " +
      fmtCoord(p.y) +
      ", z " +
      fmtCoord(p.z) +
      ")";
    return { marker: marker, label: label, dot: dot, view: view };
  }

  function updatePlayerTitle(el, p) {
    if (!el || !el.marker) return;
    var text = playerLabelText(p);
    if (el.label) {
      el.label.textContent = text;
      el.label.style.display = text ? "" : "none";
    }
    el.marker.title =
      text +
      " (" +
      fmtCoord(p.x) +
      ", " +
      fmtCoord(p.y) +
      ", z " +
      fmtCoord(p.z) +
      ")";
  }

  function placePlayerElement(el, pos, yaw, dotSize) {
    if (!el || !el.marker) return;
    el.marker.style.left = pos.x + "px";
    el.marker.style.top = pos.y + "px";
    var size = dotSize != null ? dotSize : 8;
    el.dot.style.width = size + "px";
    el.dot.style.height = size + "px";
    if (yaw != null && !isNaN(yaw) && el.view) {
      el.view.style.display = "";
      el.view.style.transform = "rotate(" + -yaw + "deg)";
    } else if (el.view) {
      el.view.style.display = "none";
    }
  }

  function worldToDisplayPos(transform, wrap, x, y) {
    if (!transform || !wrap || !window.MapCoords) return null;
    var pixel = MapCoords.worldToPixel(transform, x, y);
    var rect = MapCoords.imageDisplayRect(
      wrap,
      transform.image_width,
      transform.image_height,
    );
    return MapCoords.pixelToDisplay(rect, pixel);
  }

  function ensureMotionLoop() {
    if (mapMotion.loopId) return;

    function frame() {
      var wrap = document.getElementById("map-wrap");
      var transform = mapMotion.renderTransform || cachedTransform;
      if (!wrap || !transform || !window.MapCoords) {
        mapMotion.loopId = 0;
        return;
      }

      var ids = Object.keys(mapMotion.byId);
      if (!ids.length) {
        mapMotion.loopId = 0;
        return;
      }

      var smooth = mapSmoothEnabled();
      var alpha = smooth ? mapSmoothAlpha() : 1;

      for (var i = 0; i < ids.length; i++) {
        var st = mapMotion.byId[ids[i]];
        var d = st.display;
        var tg = st.target;
        d.x = lerpNum(d.x, tg.x, alpha);
        d.y = lerpNum(d.y, tg.y, alpha);
        if (tg.z != null) {
          d.z = d.z == null ? tg.z : lerpNum(d.z, tg.z, alpha);
        } else {
          d.z = null;
        }
        if (tg.yaw != null) {
          d.yaw = d.yaw == null ? tg.yaw : lerpYaw(d.yaw, tg.yaw, alpha);
        } else {
          d.yaw = null;
        }
        var pos = worldToDisplayPos(transform, wrap, d.x, d.y);
        if (pos) placePlayerElement(st.el, pos, d.yaw, dotSizeFromZ(d.z));
      }

      mapMotion.loopId = requestAnimationFrame(frame);
    }

    mapMotion.loopId = requestAnimationFrame(frame);
  }

  function setMapSnapshot(payload, opts) {
    opts = opts || {};
    var instant = !!opts.instant || !mapSmoothEnabled();
    var layer = document.getElementById("map-players");
    var wrap = document.getElementById("map-wrap");
    var meta = document.getElementById("map-meta");
    if (!layer) return;

    var players = normalizePlayersList(payload.players);
    var seen = {};
    for (var i = 0; i < players.length; i++) {
      var probe = players[i];
      if (probe.x == null || probe.y == null) continue;
      seen[playerMotionId(probe, i)] = true;
    }
    prunePlayerMarkers(layer, seen);

    var transform = payload.transform || cachedTransform;
    if (!transform || !wrap) return;
    mapMotion.renderTransform = transform;

    if (payload.transform && payload.transform.world_z_span != null) {
      mapMotion.zSpanMin =
        Number(payload.transform.world_z_span) || mapMotion.zSpanMin;
    }

    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (p.z != null) noteZExtent(Number(p.z));
    }

    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (p.x == null || p.y == null) continue;
      var id = playerMotionId(p, i);
      var target = {
        x: Number(p.x),
        y: Number(p.y),
        z: p.z != null ? Number(p.z) : null,
        yaw: p.yaw != null ? Number(p.yaw) : null,
      };

      var st = mapMotion.byId[id];
      if (!st) {
        st = mapMotion.byId[id] = {
          el: createPlayerElements(layer, p),
          display: cloneWorldPose(target),
          target: cloneWorldPose(target),
        };
      } else {
        updatePlayerTitle(st.el, p);
        st.target = cloneWorldPose(target);
        if (instant) {
          st.display = cloneWorldPose(target);
        }
      }
    }

    if (meta) {
      meta.textContent = [payload.map_name, players.length + " players"].join(
        " · ",
      );
    }

    ensureMotionLoop();
  }

  function mapKey(payload) {
    var t = payload.transform;
    var name = payload.map_name || "";
    if (!t) return name;
    return name + "|" + (t.image_url || "");
  }

  function resolveImageUrl(transform) {
    if (window.MapCoords) {
      return MapCoords.resolveImageUrl(transform);
    }
    return "";
  }

  function applyMapImage(payload) {
    var transform = payload.transform;
    if (!transform) return;

    var key = mapKey(payload);
    var image = document.getElementById("map-image");
    var wrap = document.getElementById("map-wrap");
    if (!image || !wrap) return;

    var url = resolveImageUrl(transform);
    if (key !== cachedMapKey || url !== currentImageSrc) {
      if (key !== cachedMapKey) {
        clearMapMotion();
        mapMotion.zFloor = null;
        mapMotion.zCeiling = null;
      }
      cachedMapKey = key;
      cachedTransform = transform;
      if (url && url !== currentImageSrc) {
        currentImageSrc = url;
        image.src = url;
      }
    }
    wrap.classList.remove("hidden");
  }

  function applyMapDots(payload) {
    setMapSnapshot(payload, { instant: false });
  }

  function applyMapDotsPreview(payload) {
    setMapSnapshot(payload, { instant: true });
  }

  function applyMapPayload(payload) {
    applyMapImage(payload);
    applyMapDots(payload);
    notifyMapPayload(payload);
  }

  var mapPayloadListeners = [];

  function notifyMapPayload(payload) {
    for (var i = 0; i < mapPayloadListeners.length; i++) {
      try {
        mapPayloadListeners[i](payload);
      } catch (_err) {
        /* debug hook */
      }
    }
  }

  function showNoMatchStatus(id) {
    setStatus("No data for " + id, true);
  }

  async function loadDefaultTransform() {
    try {
      await handleMapSnapshot({ map_name: "_default", players: [] });
    } catch (_err) {
      /* placeholder unavailable */
    }
  }

  async function handleMapSnapshot(data) {
    if (!window.MapCoords) {
      setStatus("map-coords.js missing", true);
      return;
    }
    if (data.map_name) {
      lastMapContext.map_name = data.map_name;
    } else if (lastMapContext.map_name) {
      data.map_name = lastMapContext.map_name;
    }
    if (data.gametype != null && data.gametype !== "") {
      lastMapContext.gametype = data.gametype;
    }

    var prepared = await MapCoords.prepareMapPayload(
      data.map_name,
      normalizePlayersList(data.players),
    );
    var merged = Object.assign({}, data, prepared);
    if (merged.gametype == null || merged.gametype === "") {
      merged.gametype = lastMapContext.gametype;
    }
    if (
      window.MapDebug &&
      typeof window.MapDebug.applyTransform === "function"
    ) {
      merged.transform =
        window.MapDebug.applyTransform(merged.transform) || merged.transform;
    }
    if (merged.transform) {
      mapImageLoaded = true;
    }
    applyMapPayload(merged);
    if (data.status === "no_match") {
      showNoMatchStatus(data.match_id || matchId());
      return;
    }
    setStatus("");
  }

  async function resolveMapMatchId() {
    var id = matchId();
    if (!id) {
      var rows = await fetchJson("/api/stream/matches");
      if (!rows.length) throw new Error("No live matches");
      id = rows[0].match_id;
    }
    return id;
  }

  async function prefetchMapHttp(id) {
    try {
      var data = await fetchJson(
        "/api/matches/" + encodeURIComponent(id) + "/positions",
      );
      await handleMapSnapshot(data);
    } catch (err) {
      if (String(err.message || err).indexOf("404") >= 0) {
        showNoMatchStatus(id);
        await loadDefaultTransform();
      } else {
        throw err;
      }
    }
  }

  async function refreshMap() {
    var id = await resolveMapMatchId();
    var suffix = mapImageLoaded ? "?players_only=1" : "";
    try {
      var data = await fetchJson(
        "/api/matches/" + encodeURIComponent(id) + "/positions" + suffix,
      );
      await handleMapSnapshot(data);
    } catch (err) {
      if (String(err.message || err).indexOf("404") >= 0) {
        showNoMatchStatus(id);
        await loadDefaultTransform();
        return;
      }
      throw err;
    }
  }

  function wsUrlForMatch(id) {
    var base = requireApiBase();
    var wsProto = base.startsWith("https") ? "wss" : "ws";
    var hostPath = base.replace(/^https?:\/\//, "");
    return (
      wsProto +
      "://" +
      hostPath +
      "/api/ws/live?match=" +
      encodeURIComponent(id)
    );
  }

  function initMapWebSocket() {
    var ws = null;
    var reconnectTimer = null;
    var silentTimer = null;
    var httpPollTimer = null;
    var gotWsFrame = false;

    function clearSilentTimer() {
      if (silentTimer) {
        clearTimeout(silentTimer);
        silentTimer = null;
      }
    }

    function stopHttpPoll() {
      if (httpPollTimer) {
        clearInterval(httpPollTimer);
        httpPollTimer = null;
      }
    }

    function startHttpPoll() {
      if (httpPollTimer) return;
      refreshMap().catch(function (err) {
        setStatus(String(err.message || err), true);
      });
      httpPollTimer = setInterval(function () {
        refreshMap().catch(function (err) {
          setStatus(String(err.message || err), true);
        });
      }, mapPollMs());
    }

    function scheduleReconnect(ms) {
      if (reconnectTimer) return;
      reconnectTimer = setTimeout(function () {
        reconnectTimer = null;
        connect();
      }, ms || 2000);
    }

    function connect() {
      clearSilentTimer();
      stopHttpPoll();
      gotWsFrame = false;

      resolveMapMatchId()
        .then(function (id) {
          prefetchMapHttp(id).catch(function (err) {
            setStatus(String(err.message || err), true);
          });

          if (ws) {
            ws.onclose = null;
            ws.close();
          }
          ws = new WebSocket(wsUrlForMatch(id));
          ws.onopen = function () {
            setStatus("Connecting…");
            silentTimer = setTimeout(function () {
              if (!gotWsFrame) {
                setStatus("WS silent, using HTTP…", true);
                startHttpPoll();
              }
            }, 2000);
          };
          ws.onmessage = function (ev) {
            gotWsFrame = true;
            clearSilentTimer();
            stopHttpPoll();
            var data = JSON.parse(ev.data);
            if (data.event === "positions" || data.event === "snapshot") {
              handleMapSnapshot(data).catch(function (err) {
                setStatus(String(err.message || err), true);
              });
            } else if (data.event === "death") {
              handleDeathEvent(data);
            } else if (data.event === "pickup") {
              handlePickupEvent(data);
            }
          };
          ws.onclose = function () {
            clearSilentTimer();
            setStatus("WS disconnected, reconnecting…", true);
            scheduleReconnect(2000);
          };
          ws.onerror = function () {
            if (ws) ws.close();
          };
        })
        .catch(function (err) {
          setStatus(String(err.message || err), true);
          scheduleReconnect(3000);
        });
    }

    if (matchId()) {
      setStatus("Connecting…");
    }
    connect();
  }

  function loop(fn, intervalMs) {
    var ms = intervalMs || pollMs();
    fn().catch(function (err) {
      setStatus(String(err.message || err), true);
    });
    setInterval(function () {
      fn().catch(function (err) {
        setStatus(String(err.message || err), true);
      });
    }, ms);
  }

  function boot(fn) {
    try {
      requireApiBase();
      fn();
    } catch (err) {
      setStatus(String(err.message || err), true);
    }
  }

  function initViewer() {
    var select = document.getElementById("viewer-match");
    var openScoreboard = document.getElementById("viewer-open-scoreboard");
    var openMap = document.getElementById("viewer-open-map");
    var openMatches = document.getElementById("viewer-open-matches");

    function selectedMatchId() {
      return select && select.value ? select.value : "";
    }

    function bindOpen(btn, page) {
      if (!btn) return;
      btn.addEventListener("click", function () {
        try {
          requireApiBase();
          openOverlayWindow(page, selectedMatchId());
        } catch (err) {
          setStatus(String(err.message || err), true);
        }
      });
    }

    bindOpen(openScoreboard, "scoreboard");
    bindOpen(openMap, "map");
    bindOpen(openMatches, "matches");

    async function refreshViewer() {
      try {
        requireApiBase();
        var rows = await fetchJson("/api/stream/matches");
        if (!select) return;
        var prev = select.value;
        select.innerHTML = "";
        var auto = document.createElement("option");
        auto.value = "";
        auto.textContent = rows.length
          ? "First live match (auto)"
          : "No live matches";
        select.appendChild(auto);
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          var opt = document.createElement("option");
          opt.value = row.match_id;
          opt.textContent =
            (row.score_summary || row.match_id) +
            (row.map_name ? " · " + row.map_name : "");
          select.appendChild(opt);
        }
        if (prev && select.querySelector('option[value="' + prev + '"]')) {
          select.value = prev;
        }
        setStatus(
          rows.length ? rows.length + " live match(es)" : "No live matches",
        );
      } catch (err) {
        setStatus(String(err.message || err), true);
      }
    }

    boot(function () {
      refreshViewer();
      setInterval(refreshViewer, pollMs());
    });
  }

  window.OverlayApp = {
    initScoreboard: function () {
      boot(function () {
        loop(refreshScoreboard);
      });
    },
    initMatchList: function () {
      boot(function () {
        loop(refreshMatchList);
      });
    },
    initMap: function () {
      boot(function () {
        var wrap = document.getElementById("map-wrap");
        if (wrap && window.ResizeObserver) {
          new ResizeObserver(function () {
            ensureMotionLoop();
          }).observe(wrap);
        }
        if (useWebSocket()) {
          initMapWebSocket();
        } else {
          loop(refreshMap, mapPollMs());
        }
      });
    },
    initViewer: initViewer,
    onMapPayload: function (fn) {
      mapPayloadListeners.push(fn);
    },
    _applyMapDotsPreview: applyMapDotsPreview,
    overlayPageUrl: overlayPageUrl,
    openOverlayWindow: openOverlayWindow,
    _mapKey: mapKey,
    _resolveImageUrl: resolveImageUrl,
    useWebSocket: useWebSocket,
    mapPollMs: mapPollMs,
  };
})();
