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
      card.innerHTML =
        "<h3>" +
        (row.score_summary || row.match_id) +
        "</h3><p>" +
        [row.map_name, row.gametype, row.server_name].filter(Boolean).join(" · ") +
        "</p>";
      list.appendChild(card);
    }
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
    if (!transform || !transform.image_url) return "";
    var base = requireApiBase();
    return transform.image_url.startsWith("http")
      ? transform.image_url
      : base + transform.image_url;
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
      var transform = await fetchJson("/api/maps/_default/transform");
      applyMapPayload({ transform: transform, map_name: transform.map_name, players: [] });
    } catch (_err) {
      /* placeholder unavailable */
    }
  }

  async function handleMapSnapshot(data) {
    if (data.transform) mapImageLoaded = true;
    applyMapPayload(data);
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
    _mapKey: mapKey,
    _resolveImageUrl: resolveImageUrl,
    useWebSocket: useWebSocket,
    mapPollMs: mapPollMs,
  };
})();
