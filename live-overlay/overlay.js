(function () {
  "use strict";

  var STORAGE_KEY = "ql-live-overlay-base";

  function qs(name, fallback) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name) || fallback || "";
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
      throw new Error("Missing stats hub URL — add ?base=http://HOST:8090 to the OBS URL");
    }
    return base;
  }

  function pollMs() {
    return Math.max(500, Number(qs("poll", "500")) || 500);
  }

  function mapPollMs() {
    return Math.max(500, Number(qs("poll", "100")) || 100);
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
    window.open(url, name, features || "noopener,noreferrer,width=960,height=720");
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
      meta.textContent = [data.map_name, data.gametype, data.server_name].filter(Boolean).join(" · ");
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
        [row.map_name, row.gametype, row.server_name].filter(Boolean).join(" · ") +
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
        openOverlayWindow(btn.getAttribute("data-open"), btn.getAttribute("data-match"));
      });
    });
    setStatus(rows.length + " match(es)");
  }

  var cachedMapKey = "";
  var cachedTransform = null;
  var currentImageSrc = "";
  var mapImageLoaded = false;

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
    var layer = document.getElementById("map-players");
    var wrap = document.getElementById("map-wrap");
    var meta = document.getElementById("map-meta");
    if (!layer || !wrap) return;

    var transform = payload.transform || cachedTransform;
    layer.innerHTML = "";

    var scaleX = wrap.clientWidth / (transform && transform.image_width ? transform.image_width : 512);
    var scaleY = wrap.clientHeight / (transform && transform.image_height ? transform.image_height : 512);

    var players = payload.players || [];
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (!p.pixel) continue;
      var dot = document.createElement("div");
      dot.className = "map-dot";
      dot.style.left = p.pixel.x * scaleX + "px";
      dot.style.top = p.pixel.y * scaleY + "px";
      dot.title = p.nickname || p.steam_id64;
      layer.appendChild(dot);

      if (p.yaw != null) {
        var view = document.createElement("div");
        view.className = "map-view";
        view.style.left = p.pixel.x * scaleX + "px";
        view.style.top = p.pixel.y * scaleY + "px";
        view.style.transform = "rotate(" + (-p.yaw + 90) + "deg)";
        layer.appendChild(view);
      }
    }

    if (meta) {
      meta.textContent = [payload.map_name, players.length + " players"].join(" · ");
    }
  }

  function applyMapPayload(payload) {
    applyMapImage(payload);
    applyMapDots(payload);
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
    var prepared = await MapCoords.prepareMapPayload(data.map_name, data.players || []);
    var merged = Object.assign({}, data, prepared);
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
      var data = await fetchJson("/api/matches/" + encodeURIComponent(id) + "/positions");
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
        "/api/matches/" + encodeURIComponent(id) + "/positions" + suffix
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
    return wsProto + "://" + hostPath + "/api/ws/live?match=" + encodeURIComponent(id);
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
        auto.textContent = rows.length ? "First live match (auto)" : "No live matches";
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
        setStatus(rows.length ? rows.length + " live match(es)" : "No live matches");
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
        if (useWebSocket()) {
          initMapWebSocket();
        } else {
          loop(refreshMap, mapPollMs());
        }
      });
    },
    initViewer: initViewer,
    overlayPageUrl: overlayPageUrl,
    openOverlayWindow: openOverlayWindow,
    _mapKey: mapKey,
    _resolveImageUrl: resolveImageUrl,
    useWebSocket: useWebSocket,
    mapPollMs: mapPollMs,
  };
})();
