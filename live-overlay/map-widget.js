(function (global) {
  "use strict";

  // Inner markup of the map widget. Mounted either by the standalone OBS page
  // (map.html) or embedded in the dashboard match-analytics page. Phase 1 is a
  // single-instance widget: element ids match what overlay.js / map-spawns.js
  // look up via getElementById, so only one mounted widget per document.
  var MARKUP =
    '<div class="map-layout">' +
    '<div class="map-main">' +
    '<div class="map-stage">' +
    '<div id="map-stage-frame" class="map-stage-frame">' +
    '<div id="map-match-timer" class="map-match-timer hidden" aria-live="polite"></div>' +
    '<div id="map-lifecycle-banner" class="map-lifecycle-banner hidden" aria-live="polite"></div>' +
    '<div id="map-zoom-host" class="map-zoom-host">' +
    '<div id="map-wrap" class="map-wrap hidden">' +
    '<img id="map-image" alt="map" />' +
    '<div id="map-calib" class="map-calib hidden" aria-hidden="true">' +
    '<div class="map-calib-box">' +
    '<svg id="map-calib-grid" class="map-calib-grid" aria-hidden="true"></svg>' +
    '<div class="map-calib-move" title="Drag = offset \u00b7 Wheel = scale"></div>' +
    "</div>" +
    "</div>" +
    '<div id="map-spawn-threshold" class="map-spawn-layer" aria-hidden="true"></div>' +
    '<div id="map-spawns" class="map-spawn-layer" aria-hidden="true"></div>' +
    '<div id="map-item-respawns" class="map-item-respawn-layer" aria-hidden="true"></div>' +
    '<div id="map-spawn-ref" class="map-spawn-ref" aria-hidden="true"></div>' +
    '<div id="map-deaths" class="map-death-layer" aria-hidden="true"></div>' +
    '<svg id="map-beams" class="map-beam-layer" aria-hidden="true"></svg>' +
    '<div id="map-impacts" class="map-impact-layer" aria-hidden="true"></div>' +
    '<div id="map-projectiles" class="map-projectile-layer" aria-hidden="true"></div>' +
    '<canvas id="map-contour-trail" class="map-contour-layer hidden" aria-hidden="true"></canvas>' +
    '<canvas id="map-heatmap" class="map-heatmap-layer hidden" aria-hidden="true"></canvas>' +
    '<div id="map-spawn-cursor" class="map-spawn-cursor hidden" aria-hidden="true"></div>' +
    '<div id="map-players"></div>' +
    '<div id="map-pickups" class="map-pickups" aria-live="polite"></div>' +
    "</div>" +
    "</div>" +
    '<div id="map-score" class="map-score hidden" aria-live="polite"></div>' +
    "</div>" +
    "</div>" +
    '<div id="map-meta" class="map-meta"></div>' +
    '<div id="map-replay-bar" class="map-replay-bar hidden" aria-label="Match replay and recording">' +
    '<div id="map-record-controls" class="map-record-controls hidden">' +
    '<button type="button" id="map-record-start" class="map-record-btn">Rec</button>' +
    '<button type="button" id="map-record-stop" class="map-record-btn" disabled>Stop</button>' +
    '<button type="button" id="map-record-save" class="map-record-btn" disabled>Save</button>' +
    '<span id="map-record-status" class="map-record-status">0 events</span>' +
    "</div>" +
    '<label id="map-replay-segment-wrap" class="map-replay-select-wrap hidden">' +
    '<span class="sr-only">Game segment</span>' +
    '<select id="map-replay-segment-select" class="map-replay-select" aria-label="Game segment"></select>' +
    "</label>" +
    '<div id="map-replay-playback" class="map-replay-playback hidden">' +
    '<button type="button" id="map-replay-play" class="map-replay-play">Play</button>' +
    '<div class="map-replay-scrub-wrap">' +
    '<div id="map-replay-lifecycle" class="map-replay-lifecycle hidden" aria-hidden="true"></div>' +
    '<input id="map-replay-scrub" class="map-replay-scrub" type="range" min="0" max="0" value="0" aria-label="Replay timeline" />' +
    "</div>" +
    '<span id="map-replay-time" class="map-replay-time">0:00 / 0:00</span>' +
    '<label class="map-replay-speed-label">' +
    '<span class="sr-only">Playback speed</span>' +
    '<select id="map-replay-speed" class="map-replay-speed" aria-label="Playback speed">' +
    '<option value="0.25">0.25\u00d7</option>' +
    '<option value="0.5">0.5\u00d7</option>' +
    '<option value="1" selected>1\u00d7</option>' +
    '<option value="1.5">1.5\u00d7</option>' +
    '<option value="2">2\u00d7</option>' +
    '<option value="4">4\u00d7</option>' +
    "</select>" +
    "</label>" +
    "</div>" +
    '<label id="map-replay-load-wrap" class="map-replay-load-wrap hidden">' +
    '<span class="map-replay-load-btn">Load file</span>' +
    '<input type="file" id="map-replay-file" accept=".json,.jsonl,application/json" hidden />' +
    "</label>" +
    "</div>" +
    '<div id="status" class="status"></div>' +
    "</div>" +
    '<aside id="map-debug" class="map-debug hidden" aria-label="Map calibration debug"></aside>' +
    "</div>" +
    '<div id="map-page-overlays" class="map-page-overlays">' +
    '<aside id="map-chrome" class="map-chrome" aria-label="Map overlay chrome">' +
    '<div class="map-chrome-stack">' +
    '<div id="map-toolbar" class="map-toolbar" role="toolbar" aria-label="Map overlay toolbar"></div>' +
    '<div id="map-killfeed" class="map-killfeed" aria-live="polite"></div>' +
    "</div>" +
    "</aside>" +
    '<div id="map-spawns-backdrop" class="map-spawns-backdrop hidden"></div>' +
    '<aside id="map-spawns-panel" class="map-spawns-panel map-spawns-modal hidden" role="dialog" aria-modal="true" aria-label="Map overlay settings"></aside>' +
    '<button type="button" id="map-fullscreen-btn" class="map-fullscreen-btn" aria-label="Fullscreen" title="Fullscreen">' +
    '<svg class="map-fullscreen-icon-enter" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    '<svg class="map-fullscreen-icon-exit" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    "</button>" +
    "</div>";

  var mountedContainer = null;
  var fitObserver = null;
  var fsIdleTimer = null;
  var FS_IDLE_MS = 2000;
  // Map render space is a fixed square (MAP_BASE_PX in map-spawns.js). When the
  // widget is embedded in a narrower/wider dashboard column we scale the whole
  // map layer to fit the column width via CSS zoom (zoom changes layout box, so
  // the column height follows). Toolbar/modal live in #map-page-overlays (a
  // sibling of .map-layout) and stay crisp at native size.
  var MAP_FIT_BASE_PX = 512;
  var lastFitContainerWidth = 0;
  var lastFitNaturalWidth = MAP_FIT_BASE_PX;

  function applyFit() {
    if (!mountedContainer) return;
    var layout = mountedContainer.querySelector(".map-layout");
    if (!layout) return;
    var w = mountedContainer.clientWidth;
    if (!w) return;
    // The 512px map square is not the only thing in .map-layout: the replay bar
    // (play/scrub/speed/segment/load) and other controls can make the natural
    // content WIDER than 512. Dividing by a hardcoded 512 then over-scales and
    // the container's overflow:hidden crops the right/bottom of the map.
    // Measure the real natural width at zoom 1 and fit to that (never below the
    // 512 map base, so the square fills the column when controls are narrower).
    // Only remeasure when the container width changes — resetting zoom to 1 on
    // every ResizeObserver tick (e.g. from map DOM updates) flashes the overlay.
    var natural = lastFitNaturalWidth;
    if (w !== lastFitContainerWidth) {
      layout.style.zoom = "1";
      natural = Math.max(MAP_FIT_BASE_PX, layout.scrollWidth);
      lastFitNaturalWidth = natural;
      lastFitContainerWidth = w;
    }
    var scale = w / natural;
    var nextZoom = scale > 0 ? String(scale) : "1";
    if (layout.style.zoom !== nextZoom) {
      layout.style.zoom = nextZoom;
    }
  }

  function isFullscreen() {
    return !!mountedContainer && document.fullscreenElement === mountedContainer;
  }

  function updateFullscreenBtnState() {
    if (!mountedContainer) return;
    var btn = mountedContainer.querySelector("#map-fullscreen-btn");
    if (!btn) return;
    var active = isFullscreen();
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    btn.setAttribute("aria-label", active ? "Exit fullscreen" : "Fullscreen");
    btn.title = active ? "Exit fullscreen" : "Fullscreen";
  }

  function showFullscreenBtn() {
    if (!mountedContainer) return;
    var btn = mountedContainer.querySelector("#map-fullscreen-btn");
    if (!btn) return;
    btn.classList.add("is-visible");
    if (fsIdleTimer) clearTimeout(fsIdleTimer);
    fsIdleTimer = setTimeout(function () {
      fsIdleTimer = null;
      btn.classList.remove("is-visible");
    }, FS_IDLE_MS);
  }

  function onContainerMouseMove() {
    showFullscreenBtn();
  }

  function onFullscreenBtnClick() {
    if (!mountedContainer) return;
    if (isFullscreen()) {
      if (document.exitFullscreen) document.exitFullscreen();
    } else if (mountedContainer.requestFullscreen) {
      mountedContainer.requestFullscreen();
    }
  }

  function onFullscreenChange() {
    updateFullscreenBtnState();
    if (!mountedContainer) return;
    if (isFullscreen() || MapWidget.embedded) {
      lastFitContainerWidth = 0;
      applyFit();
      return;
    }
    // Standalone (non-embedded) view leaving fullscreen: applyFit()'s
    // container-width fit is an embedded-only concept, so just drop the
    // zoom back to the natural unscaled layout instead of fitting to the
    // (much wider) window.
    var layout = mountedContainer.querySelector(".map-layout");
    if (layout) layout.style.zoom = "";
    lastFitContainerWidth = 0;
    lastFitNaturalWidth = MAP_FIT_BASE_PX;
  }

  function mount(container, opts) {
    if (!container) throw new Error("MapWidget.mount: container required");
    opts = opts || {};
    destroy();
    var embedded = !!opts.embedded;
    MapWidget.embedded = embedded;
    container.classList.add("map-widget-root", "overlay-body", "map-body");
    if (embedded) container.classList.add("map-widget-embedded");
    container.innerHTML = MARKUP;
    mountedContainer = container;

    if (global.OverlayApp && typeof OverlayApp._setConfig === "function") {
      OverlayApp._setConfig(opts);
    }
    if (global.MapSpawns && typeof MapSpawns.init === "function") {
      MapSpawns.init();
    }
    if (global.OverlayApp && typeof OverlayApp.initMap === "function") {
      OverlayApp.initMap();
    }

    if (embedded) {
      applyFit();
      if (global.addEventListener) {
        global.addEventListener("resize", applyFit);
      }
    }

    container.addEventListener("mousemove", onContainerMouseMove);
    var fsBtn = container.querySelector("#map-fullscreen-btn");
    if (fsBtn) fsBtn.addEventListener("click", onFullscreenBtnClick);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    updateFullscreenBtnState();

    return { destroy: destroy };
  }

  function destroy() {
    if (fitObserver) {
      try {
        fitObserver.disconnect();
      } catch (_e) {
        /* ignore */
      }
      fitObserver = null;
    }
    if (global.removeEventListener) {
      global.removeEventListener("resize", applyFit);
    }
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    if (fsIdleTimer) {
      clearTimeout(fsIdleTimer);
      fsIdleTimer = null;
    }
    if (mountedContainer) {
      mountedContainer.removeEventListener("mousemove", onContainerMouseMove);
      var fsBtn = mountedContainer.querySelector("#map-fullscreen-btn");
      if (fsBtn) fsBtn.removeEventListener("click", onFullscreenBtnClick);
    }
    if (global.OverlayApp && typeof OverlayApp._teardownMap === "function") {
      OverlayApp._teardownMap();
    }
    if (global.OverlayApp && typeof OverlayApp._setConfig === "function") {
      OverlayApp._setConfig(null);
    }
    if (mountedContainer) {
      mountedContainer.innerHTML = "";
      mountedContainer.classList.remove(
        "map-widget-root",
        "overlay-body",
        "map-body",
        "map-widget-embedded",
      );
      mountedContainer = null;
    }
    lastFitContainerWidth = 0;
    lastFitNaturalWidth = MAP_FIT_BASE_PX;
    MapWidget.embedded = false;
  }

  global.MapWidget = {
    mount: mount,
    destroy: destroy,
    MARKUP: MARKUP,
    embedded: false,
  };
})(typeof window !== "undefined" ? window : globalThis);
