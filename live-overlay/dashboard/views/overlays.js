(function () {
  "use strict";

  function mount(root) {
    root.innerHTML =
      '<section class="control-section">' +
      "<h2>" +
      QLDashboard.t("sectionPreview") +
      "</h2>" +
      '<div class="preview-controls">' +
      '<label class="control-field"><span>' +
      QLDashboard.t("previewOverlay") +
      '</span><select id="ov-preview-select">' +
      '<option value="scoreboard">Scoreboard</option>' +
      '<option value="map">Map</option>' +
      '<option value="matches">Matches (cards)</option>' +
      '<option value="matches-compact">Matches (compact)</option>' +
      '<option value="popup">Tournament popup</option>' +
      "</select></label>" +
      '<label class="control-field"><span>' +
      QLDashboard.t("defaultMatch") +
      '</span><select id="ov-default-match"></select></label>' +
      '<label class="control-field"><span>' +
      QLDashboard.t("previewBg") +
      '</span><select id="ov-preview-bg">' +
      '<option value="transparent">' +
      QLDashboard.t("bgTransparent") +
      "</option>" +
      '<option value="chroma">' +
      QLDashboard.t("bgChroma") +
      "</option>" +
      '<option value="checkerboard">' +
      QLDashboard.t("bgChecker") +
      "</option>" +
      "</select></label>" +
      '<label class="control-field"><span>' +
      QLDashboard.t("previewScale") +
      '</span><input id="ov-preview-scale" type="range" min="40" max="100" value="70" /></label>' +
      '<button type="button" id="ov-preview-refresh" class="control-btn">' +
      QLDashboard.t("previewRefresh") +
      "</button>" +
      "</div>" +
      '<div id="ov-preview-frame-wrap" class="preview-frame-wrap preview-bg-checkerboard">' +
      '<div id="ov-preview-frame-inner" class="preview-frame-inner">' +
      '<iframe id="ov-preview-frame" class="preview-frame" title="Overlay preview" loading="lazy"></iframe>' +
      "</div></div>" +
      "</section>" +
      '<section class="control-section">' +
      "<h2>" +
      QLDashboard.t("sectionOverlays") +
      "</h2>" +
      '<div class="overlay-grid">' +
      overlayCardHtml("overlay-popup", "overlayPopup", "overlayPopupHint", false) +
      overlayCardHtml("overlay-scoreboard", "overlayScoreboard", "overlayScoreboardHint", true) +
      overlayCardHtml("overlay-map", "overlayMap", "overlayMapHint", true) +
      overlayCardHtml("overlay-matches", "overlayMatches", "overlayMatchesHint", false) +
      "</div></section>" +
      '<section class="control-section">' +
      "<h2>" +
      QLDashboard.t("sectionLinks") +
      "</h2>" +
      '<div class="links-list">' +
      '<div class="link-row"><div class="link-row-title"><a href="#" id="ov-link-docs">' +
      QLDashboard.t("linkDocs") +
      '</a></div><div class="link-row-hint">' +
      QLDashboard.t("linkDocsHint") +
      "</div></div>" +
      '<div class="link-row"><div class="link-row-title"><a href="#" id="ov-link-guide">' +
      QLDashboard.t("linkPlayerGuide") +
      '</a></div><div class="link-row-hint">' +
      QLDashboard.t("linkPlayerGuideHint") +
      "</div></div></div></section>" +
      '<p class="app-footer">' +
      QLDashboard.t("footerObs") +
      "</p>";

    renderDefaultMatchSelect();
    bindOverlayCards();
    bindPreview();
    bindLinks();
    QLDashboard.refreshMatches({ probeHealth: false, notify: false });
  }

  function unmount() {
    var frame = document.getElementById("ov-preview-frame");
    if (frame) frame.src = "about:blank";
  }

  function overlayCardHtml(id, titleKey, hintKey, hasWindow) {
    var html =
      '<article class="overlay-card" id="' +
      id +
      '"><h3>' +
      QLDashboard.t(titleKey) +
      "</h3><p>" +
      QLDashboard.t(hintKey) +
      '</p><div class="overlay-card-actions">' +
      '<button type="button" class="control-btn control-btn-primary" data-action="open">' +
      QLDashboard.t("openOverlay") +
      "</button>";
    if (hasWindow) {
      html +=
        '<button type="button" class="control-btn" data-action="window">' +
        QLDashboard.t("openNewWindow") +
        "</button>";
    }
    if (id !== "overlay-popup") {
      html +=
        '<button type="button" class="control-btn" data-action="copy">' +
        QLDashboard.t("copyUrl") +
        "</button>";
    } else {
      html +=
        '<button type="button" class="control-btn" data-action="setup">' +
        QLDashboard.t("openSetup") +
        "</button>";
    }
    html += "</div></article>";
    return html;
  }

  function getDefaultMatchId() {
    var sel = document.getElementById("ov-default-match");
    if (sel && sel.value) return sel.value;
    return QLDashboard.settings.defaultMatchId || (QLDashboard.matches[0] && QLDashboard.matches[0].match_id);
  }

  function renderDefaultMatchSelect() {
    var sel = document.getElementById("ov-default-match");
    if (!sel) return;
    var prev = sel.value;
    sel.innerHTML = "";
    var auto = document.createElement("option");
    auto.value = "";
    auto.textContent = QLDashboard.matches.length
      ? QLDashboard.t("defaultMatchAuto")
      : QLDashboard.t("matchesEmpty");
    sel.appendChild(auto);
    for (var i = 0; i < QLDashboard.matches.length; i++) {
      var row = QLDashboard.matches[i];
      var opt = document.createElement("option");
      opt.value = row.match_id;
      opt.textContent =
        (row.score_summary || row.match_id) + (row.map_name ? " · " + row.map_name : "");
      sel.appendChild(opt);
    }
    var preferred = prev || QLDashboard.settings.defaultMatchId;
    if (preferred && sel.querySelector('option[value="' + preferred + '"]')) {
      sel.value = preferred;
    }
  }

  function bindOverlayCards() {
    bindOverlayCard("overlay-scoreboard", "scoreboard", true);
    bindOverlayCard("overlay-map", "map", true);
    bindOverlayCard("overlay-matches", "matches", false);

    var popup = document.getElementById("overlay-popup");
    if (popup) {
      var setupBtn = popup.querySelector("[data-action=setup]");
      var openBtn = popup.querySelector("[data-action=open]");
      if (setupBtn) {
        setupBtn.addEventListener("click", function () {
          QLDashboard.openWindow(QLDashboard.streamOverlayUrl());
        });
      }
      if (openBtn) {
        openBtn.addEventListener("click", function () {
          QLDashboard.openWindow(QLDashboard.streamOverlayUrl());
        });
      }
    }
  }

  function bindOverlayCard(rootId, page, needsMatch) {
    var root = document.getElementById(rootId);
    if (!root) return;
    var openBtn = root.querySelector("[data-action=open]");
    var windowBtn = root.querySelector("[data-action=window]");
    var copyBtn = root.querySelector("[data-action=copy]");

    function urlForMatch() {
      var mid = needsMatch ? getDefaultMatchId() : undefined;
      var extra = null;
      if (page === "matches") extra = { mode: "overlay", layout: "cards" };
      return QLDashboard.liveOverlayUrl(page, mid, extra);
    }

    if (openBtn) {
      openBtn.addEventListener("click", function () {
        QLDashboard.openWindow(urlForMatch());
      });
    }
    if (windowBtn) {
      windowBtn.addEventListener("click", function () {
        QLDashboard.openWindow(urlForMatch());
      });
    }
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        QLDashboard.copyText(urlForMatch());
      });
    }
  }

  function bindPreview() {
    var frame = document.getElementById("ov-preview-frame");
    var kindSel = document.getElementById("ov-preview-select");
    var bgSel = document.getElementById("ov-preview-bg");
    var scaleInput = document.getElementById("ov-preview-scale");
    var refreshBtn = document.getElementById("ov-preview-refresh");
    if (!frame || !kindSel) return;

    function previewBgClass(mode) {
      var wrap = document.getElementById("ov-preview-frame-wrap");
      if (!wrap) return;
      wrap.classList.remove(
        "preview-bg-transparent",
        "preview-bg-chroma",
        "preview-bg-checkerboard",
      );
      if (mode === "chroma") wrap.classList.add("preview-bg-chroma");
      else if (mode === "checkerboard") wrap.classList.add("preview-bg-checkerboard");
      else wrap.classList.add("preview-bg-transparent");
    }

    function updatePreviewScale() {
      var scale = scaleInput ? Number(scaleInput.value) || 70 : 70;
      var inner = document.getElementById("ov-preview-frame-inner");
      if (inner) inner.style.transform = "scale(" + scale / 100 + ")";
    }

    function refreshPreview() {
      var kind = kindSel.value;
      var matchId = getDefaultMatchId();
      var bg = (bgSel && bgSel.value) || QLDashboard.settings.defaultBg || "transparent";
      previewBgClass(bg);
      updatePreviewScale();

      var url;
      if (kind === "scoreboard") {
        url = QLDashboard.liveOverlayPreviewUrl("scoreboard", matchId || undefined, { bg: bg });
      } else if (kind === "map") {
        url = QLDashboard.liveOverlayPreviewUrl("map", matchId || undefined, { bg: bg });
      } else if (kind === "matches") {
        url = QLDashboard.liveOverlayPreviewUrl("matches", undefined, {
          bg: bg,
          mode: "overlay",
          layout: "cards",
        });
      } else if (kind === "matches-compact") {
        url = QLDashboard.liveOverlayPreviewUrl("matches", undefined, {
          bg: bg,
          mode: "overlay",
          layout: "compact",
        });
      } else {
        url = QLDashboard.streamOverlayUrl() + "?bg=" + encodeURIComponent(bg);
      }
      if (frame.getAttribute("data-src") !== url) {
        frame.setAttribute("data-src", url);
        frame.src = url;
      }
    }

    if (kindSel) kindSel.addEventListener("change", refreshPreview);
    if (bgSel) bgSel.addEventListener("change", refreshPreview);
    if (scaleInput) scaleInput.addEventListener("input", updatePreviewScale);
    if (refreshBtn) refreshBtn.addEventListener("click", refreshPreview);
    refreshPreview();
  }

  function bindLinks() {
    var docs = document.getElementById("ov-link-docs");
    var guide = document.getElementById("ov-link-guide");
    if (docs) {
      docs.addEventListener("click", function (ev) {
        ev.preventDefault();
        QLDashboard.openWindow(QLDashboard.docsUrl());
      });
    }
    if (guide) {
      guide.addEventListener("click", function (ev) {
        ev.preventDefault();
        QLDashboard.openWindow(QLDashboard.playerGuideUrl());
      });
    }
  }

  QLDashboard.registerView("overlays", {
    mount: mount,
    unmount: unmount,
    onMatchesUpdated: renderDefaultMatchSelect,
    onLangChanged: function () {
      var root = document.getElementById("app-main");
      if (root) mount(root);
    },
  });
})();
