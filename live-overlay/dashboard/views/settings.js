(function () {
  "use strict";

  function mount(root) {
    root.innerHTML =
      '<section class="control-section">' +
      "<h2>" +
      QLDashboard.t("sectionConnection") +
      "</h2>" +
      '<form id="settings-form">' +
      '<label class="control-field"><span>' +
      QLDashboard.t("publicDataBase") +
      '</span><input id="set-public-data" type="url" required value="' +
      QLDashboard.escapeHtml(QLDashboard.settings.publicDataBase) +
      '" /><span class="control-field-hint">' +
      QLDashboard.t("publicDataHint") +
      "</span></label>" +
      '<label class="control-field"><span>' +
      QLDashboard.t("tournament") +
      '</span><select id="set-tournament"></select><span class="control-field-hint">' +
      QLDashboard.t("tournamentHint") +
      "</span></label>" +
      '<label class="control-field"><span>' +
      QLDashboard.t("statsHubBase") +
      '</span><input id="set-stats-hub" type="url" required placeholder="http://host:8090" value="' +
      QLDashboard.escapeHtml(QLDashboard.settings.statsHubBase) +
      '" /><span class="control-field-hint">' +
      QLDashboard.t("statsHubHint") +
      "</span></label>" +
      '<label class="control-field"><span>' +
      QLDashboard.t("assetsBase") +
      '</span><input id="set-assets" type="url" placeholder="http://127.0.0.1:8787/live-overlay/" value="' +
      QLDashboard.escapeHtml(QLDashboard.settings.assetsBase) +
      '" /><span class="control-field-hint">' +
      QLDashboard.t("assetsHint") +
      "</span></label>" +
      '<label class="control-field"><span>' +
      QLDashboard.t("defaultBg") +
      '</span><select id="set-default-bg">' +
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
      '<div class="control-actions">' +
      '<button type="submit" class="control-btn control-btn-primary">' +
      QLDashboard.t("saveConnect") +
      "</button>" +
      "</div></form>" +
      '<p id="settings-status" class="control-status" role="status"></p>' +
      "</section>";

    renderTournamentSelect();
    var bgSel = document.getElementById("set-default-bg");
    if (bgSel) bgSel.value = QLDashboard.settings.defaultBg || "transparent";

    document.getElementById("settings-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var next = {
        publicDataBase: document.getElementById("set-public-data").value,
        statsHubBase: document.getElementById("set-stats-hub").value,
        assetsBase: document.getElementById("set-assets").value,
        tournamentSlug: document.getElementById("set-tournament").value,
        defaultBg: document.getElementById("set-default-bg").value,
        lang: QLDashboard.settings.lang,
        defaultMatchId: QLDashboard.settings.defaultMatchId,
      };
      QLDashboard.saveSettings(next);
      var st = document.getElementById("settings-status");
      if (st) {
        st.textContent = QLDashboard.t("settingsSaved");
        st.classList.add("ok");
      }
      QLDashboard.refreshAll();
    });
  }

  function renderTournamentSelect() {
    var sel = document.getElementById("set-tournament");
    if (!sel) return;
    sel.innerHTML = "";
    var empty = document.createElement("option");
    empty.value = "";
    empty.textContent = QLDashboard.tournaments.length
      ? "—"
      : QLDashboard.t("tournamentEmpty");
    sel.appendChild(empty);
    for (var i = 0; i < QLDashboard.tournaments.length; i++) {
      var row = QLDashboard.tournaments[i];
      var opt = document.createElement("option");
      opt.value = row.slug;
      opt.textContent = (row.name || row.slug) + " (" + row.slug + ")";
      sel.appendChild(opt);
    }
    if (QLDashboard.settings.tournamentSlug) {
      sel.value = QLDashboard.settings.tournamentSlug;
    }
  }

  QLDashboard.registerView("settings", {
    mount: mount,
    onDataUpdated: renderTournamentSelect,
    onLangChanged: function () {
      var root = document.getElementById("app-main");
      if (root) mount(root);
    },
  });
})();
