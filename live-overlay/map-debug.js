(function () {
  "use strict";

  function qs(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function debugEnabled() {
    var v = (qs("debug") || "").toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "entities";
  }

  function entitiesDebugEnabled() {
    var d = (qs("debug") || "").toLowerCase();
    if (d === "entities") return true;
    var e = (qs("entities") || "").toLowerCase();
    return e === "1" || e === "true" || e === "yes";
  }

  function calibrationDebugEnabled() {
    var d = (qs("debug") || "").toLowerCase();
    return d === "1" || d === "true" || d === "yes";
  }

  if (!debugEnabled()) {
    return;
  }

  var lastPayload = null;
  var boundsDirty = false;
  var clickMarker = null;
  var dragState = null;

  var editFields = [
    { id: "dbg-span-x", label: "Scale — world width (units)", min: 400, max: 16000, step: 16 },
    { id: "dbg-span-y", label: "Scale — world height (units)", min: 400, max: 16000, step: 16 },
    { id: "dbg-center-x", label: "Offset X (world at image center)", min: -8000, max: 8000, step: 8 },
    { id: "dbg-center-y", label: "Offset Y (world at image center)", min: -8000, max: 8000, step: 8 },
    { id: "dbg-grid-cell", label: "Grid cell (world units)", min: 32, max: 2048, step: 32 },
  ];

  function num(id, fallback) {
    var el = document.getElementById(id);
    if (!el || el.value === "") return fallback;
    var n = Number(el.value);
    return Number.isFinite(n) ? n : fallback;
  }

  function setInput(id, value) {
    var el = document.getElementById(id);
    if (el) el.value = String(Math.round(value));
    syncSliderFromInput(id);
  }

  function syncSliderFromInput(inputId) {
    var input = document.getElementById(inputId);
    var slider = document.getElementById(inputId + "-range");
    if (!input || !slider) return;
    var n = Number(input.value);
    if (!Number.isFinite(n)) return;
    if (n < Number(slider.min)) slider.min = String(Math.floor(n));
    if (n > Number(slider.max)) slider.max = String(Math.ceil(n));
    slider.value = String(n);
  }

  function syncInputFromSlider(sliderId) {
    var slider = document.getElementById(sliderId);
    var inputId = sliderId.replace(/-range$/, "");
    var input = document.getElementById(inputId);
    if (!slider || !input) return;
    input.value = String(slider.value);
  }

  function linkSpanEnabled() {
    var el = document.getElementById("dbg-link-span");
    return !el || el.checked;
  }

  function gridEnabled() {
    var el = document.getElementById("dbg-show-grid");
    return !el || el.checked;
  }

  function markBoundsDirty() {
    boundsDirty = true;
    var cb = document.getElementById("dbg-lock-edits");
    if (cb) cb.checked = true;
  }

  function activeTransform(base) {
    if (!base || !boundsDirty || !window.MapCoords) {
      return base;
    }
    var center = MapCoords.toCenter(base);
    var spanX = num("dbg-span-x", center.span_x);
    var spanY = linkSpanEnabled() ? spanX : num("dbg-span-y", center.span_y);
    return MapCoords.fromCenter(
      num("dbg-center-x", center.center_x),
      num("dbg-center-y", center.center_y),
      spanX,
      spanY,
      num("dbg-image-width", base.image_width),
      num("dbg-image-height", base.image_height),
      base.image_url,
      base.map_name
    );
  }

  function syncEditorsFromTransform(transform) {
    if (!transform || !window.MapCoords) return;
    var c = MapCoords.toCenter(transform);
    setInput("dbg-span-x", c.span_x);
    setInput("dbg-span-y", c.span_y);
    setInput("dbg-center-x", c.center_x);
    setInput("dbg-center-y", c.center_y);
    setInput("dbg-image-width", transform.image_width);
    setInput("dbg-image-height", transform.image_height);
  }

  function fmt(n) {
    if (n == null || n === "") return "—";
    return typeof n === "number" ? n.toFixed(1) : String(n);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    var ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  function applyBoundsPreview() {
    if (!lastPayload || !lastPayload.transform) return;
    var base = lastPayload.transform;
    var transform = activeTransform(base);
    renderMeta(lastPayload, transform);
    renderPlayers(lastPayload, transform);
    renderSnippet(lastPayload.map_name, transform);
    renderGrid(transform);
    if (window.OverlayApp && typeof OverlayApp._applyMapDotsPreview === "function") {
      var players = (lastPayload.players || []).map(function (p) {
        var row = Object.assign({}, p);
        if (row.x != null && row.y != null && window.MapCoords) {
          row.pixel = MapCoords.worldToPixel(transform, Number(row.x), Number(row.y));
        }
        return row;
      });
      OverlayApp._applyMapDotsPreview(
        Object.assign({}, lastPayload, { transform: transform, players: players })
      );
    }
    layoutCalibGizmo();
  }

  function onEditChange(fromSlider, fieldId) {
    markBoundsDirty();
    if (fromSlider) {
      syncInputFromSlider(fieldId + "-range");
    } else {
      syncSliderFromInput(fieldId);
    }
    if (fieldId === "dbg-span-x" && linkSpanEnabled()) {
      setInput("dbg-span-y", num("dbg-span-x", 0));
    }
    applyBoundsPreview();
  }

  function layoutCalibGizmo() {
    var wrap = document.getElementById("map-wrap");
    var calib = document.getElementById("map-calib");
    var box = calib && calib.querySelector(".map-calib-box");
    var svg = document.getElementById("map-calib-grid");
    if (!wrap || !calib || !box || !lastPayload || !lastPayload.transform || !window.MapCoords) {
      return;
    }
    var transform = activeTransform(lastPayload.transform);
    var rect = MapCoords.imageDisplayRect(wrap, transform.image_width, transform.image_height);
    calib.classList.remove("hidden");
    box.style.left = rect.offsetX + "px";
    box.style.top = rect.offsetY + "px";
    box.style.width = rect.width + "px";
    box.style.height = rect.height + "px";
    if (svg) {
      svg.setAttribute("viewBox", "0 0 " + transform.image_width + " " + transform.image_height);
    }
  }

  function renderGrid(transform) {
    var svg = document.getElementById("map-calib-grid");
    if (!svg || !window.MapCoords) return;
    if (!gridEnabled()) {
      svg.innerHTML = "";
      return;
    }
    var cell = Math.max(16, num("dbg-grid-cell", 256));
    var iw = transform.image_width || 512;
    var ih = transform.image_height || 512;
    var lines = [];
    var x0 = Math.floor(transform.world_min_x / cell) * cell;
    var x1 = Math.ceil(transform.world_max_x / cell) * cell;
    var y0 = Math.floor(transform.world_min_y / cell) * cell;
    var y1 = Math.ceil(transform.world_max_y / cell) * cell;

    for (var wx = x0; wx <= x1; wx += cell) {
      var top = MapCoords.worldToPixel(transform, wx, transform.world_max_y);
      var bot = MapCoords.worldToPixel(transform, wx, transform.world_min_y);
      lines.push(
        '<line class="map-grid-line" x1="' +
          top.x +
          '" y1="' +
          top.y +
          '" x2="' +
          bot.x +
          '" y2="' +
          bot.y +
          '" />'
      );
    }
    for (var wy = y0; wy <= y1; wy += cell) {
      var left = MapCoords.worldToPixel(transform, transform.world_min_x, wy);
      var right = MapCoords.worldToPixel(transform, transform.world_max_x, wy);
      lines.push(
        '<line class="map-grid-line" x1="' +
          left.x +
          '" y1="' +
          left.y +
          '" x2="' +
          right.x +
          '" y2="' +
          right.y +
          '" />'
      );
    }
    svg.innerHTML = lines.join("");
  }

  function renderMeta(payload, transform) {
    var meta = document.getElementById("dbg-meta");
    if (!meta || !window.MapCoords) return;
    var c = MapCoords.toCenter(transform);
    meta.innerHTML =
      "<div><b>match</b> " +
      (payload.match_id || "—") +
      "</div>" +
      "<div><b>map</b> " +
      (payload.map_name || "—") +
      "</div>" +
      "<div><b>scale</b> " +
      fmt(c.span_x) +
      " × " +
      fmt(c.span_y) +
      " world units</div>" +
      "<div><b>offset</b> center (" +
      fmt(c.center_x) +
      ", " +
      fmt(c.center_y) +
      ")" +
      (boundsDirty ? " <span class='dbg-tag'>editing</span>" : "") +
      "</div>";
  }

  function renderPlayers(payload, transform) {
    var tbody = document.getElementById("dbg-players-body");
    if (!tbody) return;
    tbody.innerHTML = "";
    var players = payload.players || [];
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      var pixel = p.pixel;
      if (transform && p.x != null && p.y != null && window.MapCoords) {
        pixel = MapCoords.worldToPixel(transform, Number(p.x), Number(p.y));
      }
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        (p.nickname || p.steam_id64 || "?") +
        "</td>" +
        "<td class='mono'>" +
        fmt(p.x) +
        ", " +
        fmt(p.y) +
        "</td>" +
        "<td class='mono'>" +
        (pixel ? fmt(pixel.x) + ", " + fmt(pixel.y) : "—") +
        "</td>";
      tbody.appendChild(tr);
    }
  }

  function renderSnippet(mapName, transform) {
    var pre = document.getElementById("dbg-json-snippet");
    if (!pre || !window.MapCoords) return;
    pre.textContent = MapCoords.transformSnippet(mapName, transform);
  }

  function esc(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderEntityOverlay() {
    var host = document.getElementById("dbg-entity-overlay");
    if (!host) return;
    if (!window.MapSpawns || typeof MapSpawns.debugState !== "function") {
      host.innerHTML =
        "<p class='dbg-meta'>MapSpawns module not loaded — include <code>map-spawns.js</code>.</p>";
      return;
    }
    var state = MapSpawns.debugState();
    var gt = state.gametype_normalized || "—";
    var gtRaw = state.gametype_raw != null ? state.gametype_raw : "—";
    var html = [];
    html.push(
      "<div><b>gametype</b> raw <span class='mono'>" +
        esc(gtRaw) +
        "</span> · normalized <span class='mono'>" +
        esc(gt) +
        "</span>" +
        (state.gametype_override
          ? " · override <span class='mono'>" + esc(state.gametype_override) + "</span>"
          : "") +
        "</div>"
    );
    html.push(
      "<div><b>anchor</b> " +
        esc(state.anchor) +
        " · <b>middle_val</b> " +
        esc(state.middle_val_effective) +
        (state.reference_world
          ? " · ref (" +
            esc(state.reference_world.x) +
            ", " +
            esc(state.reference_world.y) +
            ")"
          : "") +
        "</div>"
    );
    if (state.overlay && state.overlay.last_ws_snippet) {
      var ws = state.overlay.last_ws_snippet;
      html.push(
        "<div><b>WS last</b> <span class='mono'>" +
          esc(ws.event) +
          "</span> · players " +
          esc(ws.player_count) +
          " · gametype <span class='mono'>" +
          esc(ws.gametype) +
          "</span></div>"
      );
    }
    var gf = state.gametype_filter || {};
    html.push(
      "<div><b>filter</b> shown " +
        esc(gf.shown) +
        " / hidden " +
        esc(gf.hidden) +
        " · duel-tagged " +
        esc(gf.duelTagged) +
        " · not_duel " +
        esc(gf.notDuelTagged) +
        " · universal " +
        esc(gf.universal) +
        "</div>"
    );
    if (state.layers && state.layers.length) {
      html.push("<div><b>layers</b></div><ul class='dbg-list'>");
      for (var i = 0; i < state.layers.length; i++) {
        var layer = state.layers[i];
        html.push(
          "<li><span class='mono'>" +
            esc(layer.id) +
            "</span> " +
            (layer.enabled ? "on" : "off") +
            " · " +
            esc(layer.count) +
            " ents" +
            (layer.gametype_filter ? " · gt-filter" : "") +
            "</li>"
        );
      }
      html.push("</ul>");
    }
    if (state.players && state.players.length) {
      html.push(
        "<div><b>payload players</b> (" + state.players.length + ")</div>" +
          "<table class='dbg-table dbg-table-compact'><thead><tr><th>id</th><th>nick</th><th>world</th><th>motion</th></tr></thead><tbody>"
      );
      for (var p = 0; p < state.players.length; p++) {
        var row = state.players[p];
        var motionCls = row.inMapMotion ? "" : " class='dbg-warn'";
        html.push(
          "<tr" +
            motionCls +
            "><td class='mono'>" +
            esc(row.id) +
            "</td><td>" +
            esc(row.nick) +
            "</td><td class='mono'>" +
            esc(row.x) +
            ", " +
            esc(row.y) +
            "</td><td>" +
            (row.inMapMotion ? "yes" : "no") +
            "</td></tr>"
        );
      }
      html.push("</tbody></table>");
    } else {
      html.push("<div><b>payload players</b> —</div>");
    }
    if (state.orphan_motion_keys && state.orphan_motion_keys.length) {
      html.push(
        "<div class='dbg-warn'><b>orphan mapMotion</b> <span class='mono'>" +
          esc(state.orphan_motion_keys.join(", ")) +
          "</span></div>"
      );
    } else {
      html.push("<div><b>orphan mapMotion</b> none</div>");
    }
    if (state.teleport_pairs && state.teleport_pairs.length) {
      html.push("<div><b>teleport pairs</b></div><ul class='dbg-list'>");
      for (var t = 0; t < state.teleport_pairs.length; t++) {
        var pair = state.teleport_pairs[t];
        html.push(
          "<li><span class='mono'>#" +
            esc(pair.entrance_id) +
            " → #" +
            esc(pair.exit_id) +
            "</span> (" +
            esc(pair.exit_classname) +
            ")</li>"
        );
      }
      html.push("</ul>");
    } else {
      html.push("<div><b>teleport pairs</b> none</div>");
    }
    host.innerHTML = html.join("");
  }

  function refreshFromPayload(payload) {
    lastPayload = payload;
    var base = payload.transform;
    if (!base) return;
    if (!boundsDirty) {
      syncEditorsFromTransform(base);
    }
    var transform = activeTransform(base);
    renderMeta(payload, transform);
    renderPlayers(payload, transform);
    renderSnippet(payload.map_name, transform);
    renderGrid(transform);
    layoutCalibGizmo();
    renderEntityOverlay();
  }

  function onMapClick(ev) {
    if (ev.target.closest(".map-calib-move")) return;
    var wrap = document.getElementById("map-wrap");
    var base = lastPayload && lastPayload.transform;
    if (!wrap || !base || !window.MapCoords) return;

    var wrapRect = wrap.getBoundingClientRect();
    var displayX = ev.clientX - wrapRect.left;
    var displayY = ev.clientY - wrapRect.top;
    var transform = activeTransform(base);
    var disp = MapCoords.imageDisplayRect(wrap, transform.image_width, transform.image_height);
    var pixel = MapCoords.displayToPixel(disp, displayX, displayY);
    var world = MapCoords.pixelToWorld(transform, pixel.x, pixel.y);

    var clickBox = document.getElementById("dbg-click");
    if (clickBox) {
      clickBox.innerHTML =
        "<div><b>world</b> <span class='mono'>x=" +
        fmt(world.x) +
        " y=" +
        fmt(world.y) +
        "</span></div>" +
        "<div><b>pixel</b> <span class='mono'>" +
        fmt(pixel.x) +
        ", " +
        fmt(pixel.y) +
        "</span></div>";
    }

    if (!clickMarker) {
      clickMarker = document.createElement("div");
      clickMarker.className = "map-debug-click";
      wrap.appendChild(clickMarker);
    }
    clickMarker.style.left = displayX + "px";
    clickMarker.style.top = displayY + "px";
  }

  function controlRowHtml(field) {
    return (
      '<div class="dbg-bound-row">' +
      '<div class="dbg-bound-top">' +
      '<span class="dbg-bound-label">' +
      field.label +
      "</span>" +
      '<input type="number" id="' +
      field.id +
      '" class="dbg-num" step="' +
      field.step +
      '" />' +
      "</div>" +
      '<input type="range" id="' +
      field.id +
      '-range" class="dbg-range" min="' +
      field.min +
      '" max="' +
      field.max +
      '" step="' +
      field.step +
      '" />' +
      "</div>"
    );
  }

  function initCalibGizmo() {
    var wrap = document.getElementById("map-wrap");
    var move = document.querySelector(".map-calib-move");
    if (!wrap || !move) return;

    move.addEventListener("pointerdown", function (ev) {
      if (!lastPayload || !lastPayload.transform) return;
      ev.preventDefault();
      ev.stopPropagation();
      var transform = activeTransform(lastPayload.transform);
      dragState = {
        startX: ev.clientX,
        startY: ev.clientY,
        center_x: num("dbg-center-x", MapCoords.toCenter(transform).center_x),
        center_y: num("dbg-center-y", MapCoords.toCenter(transform).center_y),
        transform: transform,
      };
      move.setPointerCapture(ev.pointerId);
    });

    move.addEventListener("pointermove", function (ev) {
      if (!dragState || !window.MapCoords) return;
      var disp = MapCoords.imageDisplayRect(
        wrap,
        dragState.transform.image_width,
        dragState.transform.image_height
      );
      var dpx = (ev.clientX - dragState.startX) / disp.scale;
      var dpy = (ev.clientY - dragState.startY) / disp.scale;
      var iw = dragState.transform.image_width;
      var ih = dragState.transform.image_height;
      var spanX = dragState.transform.world_max_x - dragState.transform.world_min_x;
      var spanY = dragState.transform.world_max_y - dragState.transform.world_min_y;
      var cx = dragState.center_x - (dpx / iw) * spanX;
      var cy = dragState.center_y + (dpy / ih) * spanY;
      setInput("dbg-center-x", cx);
      setInput("dbg-center-y", cy);
      markBoundsDirty();
      applyBoundsPreview();
    });

    function endDrag(ev) {
      if (!dragState) return;
      try {
        move.releasePointerCapture(ev.pointerId);
      } catch (_err) {
        /* ignore */
      }
      dragState = null;
    }
    move.addEventListener("pointerup", endDrag);
    move.addEventListener("pointercancel", endDrag);

    wrap.addEventListener(
      "wheel",
      function (ev) {
        if (!lastPayload || !lastPayload.transform) return;
        ev.preventDefault();
        var transform = activeTransform(lastPayload.transform);
        var c = MapCoords.toCenter(transform);
        var factor = ev.deltaY < 0 ? 0.96 : 1.04;
        var spanX = Math.max(200, Math.min(24000, c.span_x * factor));
        setInput("dbg-span-x", spanX);
        if (linkSpanEnabled()) {
          setInput("dbg-span-y", spanX);
        }
        markBoundsDirty();
        applyBoundsPreview();
      },
      { passive: false }
    );

    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        layoutCalibGizmo();
      });
      ro.observe(wrap);
    }
    window.addEventListener("resize", layoutCalibGizmo);
  }

  function buildPanel() {
    document.body.classList.add("map-debug-mode");
    var panel = document.getElementById("map-debug");
    if (!panel) return;
    panel.classList.remove("hidden");
    var showCalib = calibrationDebugEnabled();
    var showEntities = showCalib || entitiesDebugEnabled();
    var html = [];
    html.push(
      '<header class="map-debug-head"><h2>' +
        (showCalib ? "Map calibration" : "Map debug") +
        "</h2>"
    );
    if (showCalib) {
      html.push(
        '<p class="map-debug-hint">1) Match <span class="dbg-accent">grid</span> to map · 2) drag map to offset · 3) wheel = scale</p>'
      );
    }
    html.push("</header>");
    html.push(
      '<section class="map-debug-section"><h3>Session</h3><div id="dbg-meta" class="dbg-meta"></div></section>'
    );
    if (showEntities) {
      html.push(
        '<section class="map-debug-section" id="dbg-entity-section"><h3>Entity overlay</h3><div id="dbg-entity-overlay" class="dbg-meta"></div></section>'
      );
    }
    if (showCalib) {
      html.push(
        '<section class="map-debug-section"><h3>Scale &amp; offset</h3>' +
          '<label class="dbg-toggle"><input type="checkbox" id="dbg-link-span" checked /> Uniform scale (square world units)</label>' +
          '<label class="dbg-toggle"><input type="checkbox" id="dbg-lock-edits" /> Lock edits (don\'t reset from JSON)</label>' +
          '<div class="dbg-bounds">' +
          editFields
            .filter(function (f) {
              return f.id !== "dbg-span-y" && f.id !== "dbg-grid-cell";
            })
            .map(controlRowHtml)
            .join("") +
          '<div id="dbg-span-y-row" class="dbg-span-y-row hidden">' +
          controlRowHtml({ id: "dbg-span-y", label: "Scale — world height", min: 400, max: 16000, step: 16 }) +
          "</div></div></section>" +
          '<section class="map-debug-section"><h3>Grid</h3>' +
          '<label class="dbg-toggle"><input type="checkbox" id="dbg-show-grid" checked /> Show world grid on map</label>' +
          controlRowHtml({ id: "dbg-grid-cell", label: "Cell size (world units)", min: 32, max: 2048, step: 32 }) +
          '<div class="dbg-slider-presets">' +
          '<button type="button" class="overlay-btn dbg-preset" data-grid="128">grid 128</button>' +
          '<button type="button" class="overlay-btn dbg-preset" data-grid="256">grid 256</button>' +
          '<button type="button" class="overlay-btn dbg-preset" data-grid="512">grid 512</button>' +
          '<button type="button" class="overlay-btn" id="dbg-fit-players">Fit players</button>' +
          "</div></section>" +
          '<section class="map-debug-section"><h3>Click sampler</h3><div id="dbg-click" class="dbg-click">Click map (outside drag layer)</div></section>'
      );
    }
    html.push(
      '<section class="map-debug-section"><h3>Players</h3>' +
        '<table class="dbg-table"><thead><tr><th>nick</th><th>world</th><th>pixel</th></tr></thead><tbody id="dbg-players-body"></tbody></table>' +
        "</section>"
    );
    if (showCalib) {
      html.push(
        '<section class="map-debug-section"><h3>map_transforms.json</h3>' +
          '<pre id="dbg-json-snippet" class="dbg-pre"></pre>' +
          '<button type="button" class="overlay-btn" id="dbg-copy-json">Copy JSON entry</button></section>'
      );
    }
    panel.innerHTML = html.join("");

    setInput("dbg-grid-cell", 256);

    if (showCalib) {
      document.getElementById("dbg-lock-edits").addEventListener("change", function (ev) {
        boundsDirty = !!ev.target.checked;
        if (!boundsDirty && lastPayload) refreshFromPayload(lastPayload);
      });

      function toggleSpanYRow() {
        var row = document.getElementById("dbg-span-y-row");
        if (row) row.classList.toggle("hidden", linkSpanEnabled());
      }

      document.getElementById("dbg-link-span").addEventListener("change", function () {
        toggleSpanYRow();
        if (linkSpanEnabled()) {
          setInput("dbg-span-y", num("dbg-span-x", 4096));
          applyBoundsPreview();
        }
      });
      toggleSpanYRow();

      document.getElementById("dbg-show-grid").addEventListener("change", function () {
        applyBoundsPreview();
      });

      editFields.forEach(function (field) {
        var input = document.getElementById(field.id);
        var slider = document.getElementById(field.id + "-range");
        if (input) {
          input.addEventListener("input", function () {
            onEditChange(false, field.id);
          });
        }
        if (slider) {
          slider.addEventListener("input", function () {
            onEditChange(true, field.id);
          });
        }
      });

      document.querySelectorAll(".dbg-preset[data-grid]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          setInput("dbg-grid-cell", Number(btn.getAttribute("data-grid")) || 256);
          markBoundsDirty();
          applyBoundsPreview();
        });
      });

      document.getElementById("dbg-fit-players").addEventListener("click", function () {
        if (!lastPayload || !window.MapCoords) return;
        var xs = [];
        var ys = [];
        var players = lastPayload.players || [];
        for (var i = 0; i < players.length; i++) {
          if (players[i].x != null) xs.push(Number(players[i].x));
          if (players[i].y != null) ys.push(Number(players[i].y));
        }
        if (!xs.length && !ys.length) return;
        var pad = 400;
        var cx = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2;
        var cy = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
        var spanX = Math.max(800, Math.max.apply(null, xs) - Math.min.apply(null, xs) + pad * 2);
        var spanY = Math.max(800, Math.max.apply(null, ys) - Math.min.apply(null, ys) + pad * 2);
        setInput("dbg-center-x", cx);
        setInput("dbg-center-y", cy);
        setInput("dbg-span-x", spanX);
        setInput("dbg-span-y", linkSpanEnabled() ? spanX : spanY);
        markBoundsDirty();
        applyBoundsPreview();
      });

      document.getElementById("dbg-copy-json").addEventListener("click", function () {
        var btn = document.getElementById("dbg-copy-json");
        copyText(document.getElementById("dbg-json-snippet").textContent).then(function () {
          btn.textContent = "Copied";
          setTimeout(function () {
            btn.textContent = "Copy JSON entry";
          }, 1200);
        });
      });

      var wrap = document.getElementById("map-wrap");
      if (wrap) wrap.addEventListener("click", onMapClick);
      initCalibGizmo();
    }

    renderEntityOverlay();
  }

  function init() {
    buildPanel();
    window.MapDebug = {
      applyTransform: function (base) {
        return activeTransform(base);
      },
      renderEntityOverlay: renderEntityOverlay,
    };
    if (window.OverlayApp && OverlayApp.onMapPayload) {
      OverlayApp.onMapPayload(refreshFromPayload);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
