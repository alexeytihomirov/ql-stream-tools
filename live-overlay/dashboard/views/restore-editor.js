(function (global) {
  "use strict";

  var AMMO_KEYS = ["rl", "lg", "rg", "pg", "gl", "sg", "mg", "cg"];

  // Bit layout mirrors stats_hub/checkpoint_codec.loadout_to_mask weapon_order.
  var LOADOUT_WEAPONS = [
    { key: "g", bit: 1 << 1, abbr: "G", cls: "weapon_gauntlet", w: 1 },
    { key: "mg", bit: 1 << 2, abbr: "MG", cls: "weapon_machinegun", w: 2 },
    { key: "sg", bit: 1 << 3, abbr: "SG", cls: "weapon_shotgun", w: 3 },
    { key: "gl", bit: 1 << 4, abbr: "GL", cls: "weapon_grenadelauncher", w: 4 },
    { key: "rl", bit: 1 << 5, abbr: "RL", cls: "weapon_rocketlauncher", w: 5 },
    { key: "lg", bit: 1 << 6, abbr: "LG", cls: "weapon_lightning", w: 6 },
    { key: "rg", bit: 1 << 7, abbr: "RG", cls: "weapon_railgun", w: 7 },
    { key: "pg", bit: 1 << 8, abbr: "PG", cls: "weapon_plasmagun", w: 8 },
    { key: "bfg", bit: 1 << 9, abbr: "BFG", cls: "weapon_bfg", w: 9 },
    { key: "gh", bit: 1 << 10, abbr: "GH", cls: "weapon_grapple", w: 10 },
    { key: "ng", bit: 1 << 11, abbr: "NG", cls: "weapon_nailgun", w: 11 },
    { key: "pl", bit: 1 << 12, abbr: "PL", cls: "weapon_plasmagun", w: 12 },
    { key: "cg", bit: 1 << 13, abbr: "CG", cls: "weapon_chaingun", w: 13 },
    { key: "hmg", bit: 1 << 14, abbr: "HMG", cls: "weapon_machinegun", w: 14 },
  ];

  var WEAPON_BY_W = {};
  LOADOUT_WEAPONS.forEach(function (row) {
    if (row.w != null && WEAPON_BY_W[row.w] == null) WEAPON_BY_W[row.w] = row;
  });

  var encodeTimer = 0;
  var ENCODE_DEBOUNCE_MS = 380;

  function analytics() {
    return global.QLDashboardAnalytics;
  }

  function t(key, vars) {
    return global.QLDashboard.t(key, vars);
  }

  function esc(s) {
    return global.QLDashboard.escapeHtml(s);
  }

  function clampInt(value, min, max) {
    var n = parseInt(String(value), 10);
    if (isNaN(n)) n = 0;
    return Math.max(min, Math.min(max, n));
  }

  function clampFloat(value) {
    var n = parseFloat(String(value));
    if (isNaN(n)) n = 0;
    return Math.round(n * 10) / 10;
  }

  function normalizeMapKey(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/^map-/, "")
      .replace(/[^a-z0-9]/g, "");
  }

  function loadoutKeysFromMask(lo) {
    var mask = clampInt(lo, 0, 65535);
    var keys = [];
    for (var i = 0; i < LOADOUT_WEAPONS.length; i++) {
      if (mask & LOADOUT_WEAPONS[i].bit) keys.push(LOADOUT_WEAPONS[i].key);
    }
    return keys;
  }

  function loadoutMaskFromKeys(keys) {
    var mask = 0;
    var set = {};
    (keys || []).forEach(function (k) {
      set[String(k)] = true;
    });
    for (var i = 0; i < LOADOUT_WEAPONS.length; i++) {
      if (set[LOADOUT_WEAPONS[i].key]) mask |= LOADOUT_WEAPONS[i].bit;
    }
    return mask;
  }

  var SPRITE_INTERNAL = {
    weapon_gauntlet: "iconw_gauntlet.png",
    weapon_machinegun: "iconw_machinegun.png",
    weapon_shotgun: "iconw_shotgun.png",
    weapon_grenadelauncher: "iconw_grenade.png",
    weapon_rocketlauncher: "iconw_rocket.png",
    weapon_lightning: "iconw_lightning.png",
    weapon_railgun: "iconw_railgun.png",
    weapon_plasmagun: "iconw_plasma.png",
    weapon_bfg: "iconw_bfg.png",
    weapon_grapple: "iconw_grapple.png",
    weapon_nailgun: "iconw_nailgun.png",
    weapon_chaingun: "iconw_chaingun.png",
  };

  function weaponIcon(cls, abbr, extraClass) {
    var A = analytics();
    var file = cls ? SPRITE_INTERNAL[cls] : null;
    if (A && A.iconImg && file) {
      return A.iconImg(file, abbr || "?", "ql-restore-wpn-icon " + (extraClass || ""));
    }
    if (A && A.weaponInfo) {
      var info = A.weaponInfo(abbr);
      if (info && info.sprite && A.iconImg) {
        return A.iconImg(info.sprite, info.abbr || abbr, "ql-restore-wpn-icon " + (extraClass || ""));
      }
      if (info && info.abbr) {
        return '<span class="ql-restore-wpn-abbr">' + esc(info.abbr) + "</span>";
      }
    }
    return '<span class="ql-restore-wpn-abbr">' + esc(abbr || "?") + "</span>";
  }

  function pickCfgText(payload) {
    var A = analytics();
    if (A && A.pickCfgText) return A.pickCfgText(payload);
    if (!payload) return "";
    if (payload.cfg_client_text) return String(payload.cfg_client_text);
    if (Array.isArray(payload.cfg_client_lines) && payload.cfg_client_lines.length) {
      return payload.cfg_client_lines.join("\n") + "\n";
    }
    if (payload.cfg_text) return String(payload.cfg_text);
    if (Array.isArray(payload.cfg_lines) && payload.cfg_lines.length) {
      return payload.cfg_lines.join("\n") + "\n";
    }
    return "";
  }

  function playerRowFromCheckpoint(row, idx) {
    var am = {};
    if (row.am && typeof row.am === "object") {
      AMMO_KEYS.forEach(function (k) {
        if (row.am[k] != null) am[k] = clampInt(row.am[k], 0, 255);
      });
    }
    return {
      cid: row.cid != null ? clampInt(row.cid, 0, 255) : idx,
      sid: String(row.sid || row.steam_id64 || "").trim(),
      label: String(row.label || row.nickname || "").trim(),
      x: row.x != null ? clampFloat(row.x) : 0,
      y: row.y != null ? clampFloat(row.y) : 0,
      z: row.z != null ? clampFloat(row.z) : 0,
      h: clampInt(row.h != null ? row.h : row.health, 0, 999),
      a: clampInt(row.a != null ? row.a : row.armor, 0, 999),
      w: clampInt(row.w != null ? row.w : row.weapon, 0, 255),
      lo: clampInt(row.lo != null ? row.lo : row.loadout, 0, 65535),
      loadoutKeys: loadoutKeysFromMask(row.lo != null ? row.lo : row.loadout),
      sc: row.sc != null ? clampInt(row.sc, 0, 255) : null,
      am: am,
    };
  }

  function playersFromArchive(archive, tMs) {
    var A = analytics();
    if (!A || !archive) return [];
    var roster = A.resolvePlayersAtScrub(archive, tMs);
    return roster.map(function (p, idx) {
      return playerRowFromCheckpoint(
        {
          cid: idx,
          sid: p.steam_id64,
          nickname: A.displayNickname(p),
          x: p.x != null ? p.x : 0,
          y: p.y != null ? p.y : 0,
          z: p.z != null ? p.z : 0,
          h: p.health != null ? p.health : 100,
          a: p.armor != null ? p.armor : 0,
          w: 0,
          lo: 0,
        },
        idx,
      );
    });
  }

  function stateFromCheckpoint(cp, archive, tMs) {
    cp = cp || {};
    var players = (cp.players || []).map(playerRowFromCheckpoint);
    if (!players.length && archive) {
      players = playersFromArchive(archive, tMs != null ? tMs : cp.t_ms);
    }
    var A = analytics();
    if (archive && A && players.length) {
      var nickBySteam = A.buildNicknameBySteam(archive, null);
      players.forEach(function (p) {
        if (!p.label && p.sid) {
          p.label = A.displayNickname({ steam_id64: p.sid }, nickBySteam);
        }
      });
    }
    return {
      v: 2,
      t_ms:
        tMs != null
          ? clampInt(tMs, 0, 86400000)
          : cp.t_ms != null
            ? clampInt(cp.t_ms, 0, 86400000)
            : 0,
      map: normalizeMapKey(cp.map || cp.map_name || (archive && archive.map_name) || ""),
      players: players,
      items: Array.isArray(cp.items) ? cp.items.slice() : [],
    };
  }

  function checkpointFromState(state) {
    var players = (state.players || []).map(function (p, idx) {
      var lo = loadoutMaskFromKeys(p.loadoutKeys);
      var row = {
        cid: p.cid != null ? clampInt(p.cid, 0, 255) : idx,
        x: clampFloat(p.x),
        y: clampFloat(p.y),
        z: clampFloat(p.z),
        h: clampInt(p.h, 0, 999),
        a: clampInt(p.a, 0, 999),
        w: clampInt(p.w, 0, 255),
        lo: lo,
      };
      if (p.sid) row.sid = String(p.sid).trim();
      if (p.sc != null && p.sc !== "") row.sc = clampInt(p.sc, 0, 255);
      var am = {};
      AMMO_KEYS.forEach(function (k) {
        if (p.am && p.am[k] != null && String(p.am[k]) !== "") {
          var val = clampInt(p.am[k], 0, 255);
          if (val > 0) am[k] = val;
        }
      });
      if (Object.keys(am).length) row.am = am;
      return row;
    });
    return {
      v: 2,
      t_ms: clampInt(state.t_ms, 0, 86400000),
      map: normalizeMapKey(state.map),
      players: players,
      items: state.items || [],
    };
  }

  function readStateFromRoot(root) {
    var state = {
      t_ms: 0,
      map: "",
      players: [],
      items: [],
    };
    var tEl = root.querySelector("[data-ql-restore-t-ms]");
    var mapEl = root.querySelector("[data-ql-restore-map]");
    if (tEl) state.t_ms = clampInt(tEl.value, 0, 86400000);
    if (mapEl) state.map = normalizeMapKey(mapEl.value);

    var cards = root.querySelectorAll("[data-ql-restore-player]");
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var p = {
        cid: clampInt(card.getAttribute("data-ql-restore-player"), 0, 255),
        sid: "",
        label: "",
        x: 0,
        y: 0,
        z: 0,
        h: 100,
        a: 0,
        w: 0,
        loadoutKeys: [],
        am: {},
      };
      var sidEl = card.querySelector("[data-ql-restore-sid]");
      if (sidEl) p.sid = String(sidEl.value || "").trim();
      var hEl = card.querySelector("[data-ql-restore-h]");
      var aEl = card.querySelector("[data-ql-restore-a]");
      var wEl = card.querySelector("[data-ql-restore-w]");
      var scEl = card.querySelector("[data-ql-restore-sc]");
      if (hEl) p.h = clampInt(hEl.value, 0, 999);
      if (aEl) p.a = clampInt(aEl.value, 0, 999);
      if (wEl) p.w = clampInt(wEl.value, 0, 255);
      if (scEl && scEl.value !== "") p.sc = clampInt(scEl.value, 0, 255);
      ["x", "y", "z"].forEach(function (axis) {
        var el = card.querySelector('[data-ql-restore-pos="' + axis + '"]');
        if (el) p[axis] = clampFloat(el.value);
      });
      var loadoutChecks = card.querySelectorAll("[data-ql-restore-lo]:checked");
      for (var j = 0; j < loadoutChecks.length; j++) {
        p.loadoutKeys.push(loadoutChecks[j].getAttribute("data-ql-restore-lo"));
      }
      AMMO_KEYS.forEach(function (k) {
        var amEl = card.querySelector('[data-ql-restore-ammo="' + k + '"]');
        if (amEl && amEl.value !== "") p.am[k] = clampInt(amEl.value, 0, 255);
      });
      state.players.push(p);
    }
    return state;
  }

  function scheduleEncode(root, opts) {
    if (encodeTimer) clearTimeout(encodeTimer);
    encodeTimer = setTimeout(function () {
      encodeTimer = 0;
      encodeFromRoot(root, opts);
    }, ENCODE_DEBOUNCE_MS);
  }

  function encodeFromRoot(root, opts) {
    opts = opts || {};
    var statusEl = root.querySelector("[data-ql-restore-encode-status]");
    var cfgEl = root.querySelector("[data-ql-restore-cfg]");
    var checkpoint = checkpointFromState(readStateFromRoot(root));
    if (statusEl) {
      statusEl.textContent = t("restoreEditorEncoding");
      statusEl.classList.remove("error");
    }
    return global.QLDashboard.postStatsJson("/api/checkpoint/encode", {
      checkpoint: checkpoint,
    })
      .then(function (payload) {
        if (cfgEl) cfgEl.value = pickCfgText(payload);
        if (statusEl) {
          statusEl.textContent = t("restoreEditorReady");
          statusEl.classList.remove("error");
        }
        if (typeof opts.onPayload === "function") opts.onPayload(payload, checkpoint);
        return payload;
      })
      .catch(function (err) {
        if (statusEl) {
          statusEl.textContent = t("restoreCheckpointError") + ": " + String(err.message || err);
          statusEl.classList.add("error");
        }
        throw err;
      });
  }

  function renderWeaponCheckbox(playerIdx, weapon, checked) {
    var id = "restore-lo-" + playerIdx + "-" + weapon.key;
    return (
      '<label class="ql-restore-lo-item" title="' +
      esc(weapon.abbr) +
      '">' +
      '<input type="checkbox" id="' +
      esc(id) +
      '" data-ql-restore-lo="' +
      esc(weapon.key) +
      '"' +
      (checked ? " checked" : "") +
      " />" +
      weaponIcon(weapon.cls, weapon.abbr, "ql-restore-lo-icon") +
      '<span class="ql-restore-lo-label">' +
      esc(weapon.abbr) +
      "</span></label>"
    );
  }

  function renderAmmoGrid(playerIdx, am) {
    var html = '<div class="ql-restore-ammo-grid">';
    for (var i = 0; i < AMMO_KEYS.length; i++) {
      var key = AMMO_KEYS[i];
      var wpn = LOADOUT_WEAPONS.filter(function (row) {
        return row.key === key;
      })[0];
      var val = am && am[key] != null ? am[key] : "";
      html +=
        '<label class="ql-restore-ammo-item">' +
        (wpn ? weaponIcon(wpn.cls, wpn.abbr, "ql-restore-ammo-icon") : "") +
        '<span class="ql-restore-ammo-key">' +
        esc(key.toUpperCase()) +
        '</span><input type="number" min="0" max="255" step="1" class="ql-restore-ammo-input" data-ql-restore-ammo="' +
        esc(key) +
        '" value="' +
        esc(val === "" ? "" : String(val)) +
        '" placeholder="0" /></label>';
    }
    html += "</div>";
    return html;
  }

  function renderPlayerCard(player, idx) {
    var label = player.label || player.sid || t("restoreEditorPlayerSlot", { n: idx + 1 });
    var loadoutSet = {};
    (player.loadoutKeys || loadoutKeysFromMask(player.lo)).forEach(function (k) {
      loadoutSet[k] = true;
    });
    var wOpts = LOADOUT_WEAPONS.map(function (w) {
      return (
        '<option value="' +
        w.w +
        '"' +
        (Number(player.w) === w.w ? " selected" : "") +
        ">" +
        esc(w.abbr) +
        "</option>"
      );
    });
    wOpts.unshift('<option value="0"' + (Number(player.w) === 0 ? " selected" : "") + ">—</option>");

    var loHtml = "";
    for (var i = 0; i < LOADOUT_WEAPONS.length; i++) {
      loHtml += renderWeaponCheckbox(idx, LOADOUT_WEAPONS[i], !!loadoutSet[LOADOUT_WEAPONS[i].key]);
    }

    return (
      '<article class="ql-restore-player" data-ql-restore-player="' +
      idx +
      '">' +
      '<header class="ql-restore-player-head">' +
      "<h4>" +
      esc(label) +
      '</h4><span class="ql-restore-player-slot">' +
      esc(t("restoreEditorSlot")) +
      " " +
      idx +
      "</span></header>" +
      '<div class="ql-restore-player-grid">' +
      '<label class="ql-restore-field"><span>' +
      esc(t("restoreEditorSteamId")) +
      '</span><input type="text" data-ql-restore-sid" value="' +
      esc(player.sid || "") +
      '" spellcheck="false" /></label>' +
      '<label class="ql-restore-field"><span>' +
      esc(t("restoreEditorHealth")) +
      '</span><input type="number" min="0" max="999" data-ql-restore-h" value="' +
      esc(String(player.h)) +
      '" /></label>' +
      '<label class="ql-restore-field"><span>' +
      esc(t("restoreEditorArmor")) +
      '</span><input type="number" min="0" max="999" data-ql-restore-a" value="' +
      esc(String(player.a)) +
      '" /></label>' +
      '<label class="ql-restore-field"><span>' +
      esc(t("restoreEditorScore")) +
      '</span><input type="number" min="0" max="255" data-ql-restore-sc" value="' +
      esc(player.sc != null ? String(player.sc) : "") +
      '" placeholder="—" /></label>' +
      '<label class="ql-restore-field ql-restore-field-wpn"><span>' +
      esc(t("restoreEditorActiveWeapon")) +
      '</span><select data-ql-restore-w class="ql-restore-w-select">' +
      wOpts.join("") +
      "</select></label>" +
      "</div>" +
      '<div class="ql-restore-pos-row">' +
      '<span class="ql-restore-pos-label">' +
      esc(t("restoreEditorPosition")) +
      "</span>" +
      ["x", "y", "z"]
        .map(function (axis) {
          return (
            '<label class="ql-restore-pos-field"><span>' +
            esc(axis.toUpperCase()) +
            '</span><input type="number" step="0.1" data-ql-restore-pos="' +
            axis +
            '" value="' +
            esc(String(player[axis] != null ? player[axis] : 0)) +
            '" /></label>'
          );
        })
        .join("") +
      "</div>" +
      '<div class="ql-restore-lo-wrap"><span class="ql-restore-section-label">' +
      esc(t("restoreEditorLoadout")) +
      '</span><div class="ql-restore-lo-grid">' +
      loHtml +
      "</div></div>" +
      '<div class="ql-restore-ammo-wrap"><span class="ql-restore-section-label">' +
      esc(t("restoreEditorAmmo")) +
      '</span><p class="control-field-hint">' +
      esc(t("restoreEditorAmmoHint")) +
      "</p>" +
      renderAmmoGrid(idx, player.am) +
      "</div></article>"
    );
  }

  function renderEditorBody(state, payload, opts) {
    opts = opts || {};
    var cfgText = pickCfgText(payload);
    var playersHtml = "";
    if (state.players.length) {
      for (var i = 0; i < state.players.length; i++) {
        playersHtml += renderPlayerCard(state.players[i], i);
      }
    } else {
      playersHtml =
        '<p class="match-analytics-empty">' + esc(t("restoreEditorNoPlayers")) + "</p>";
    }

    var timeLabel =
      state.t_ms != null && analytics()
        ? analytics().formatGameTime(state.t_ms)
        : "—";

    return (
      '<div class="ql-restore-editor-body">' +
      '<div class="ql-restore-global">' +
      '<label class="ql-restore-field"><span>' +
      esc(t("restoreEditorMatchTime")) +
      '</span><input type="number" min="0" step="1000" data-ql-restore-t-ms" value="' +
      esc(String(state.t_ms || 0)) +
      '" /><span class="ql-restore-field-hint">' +
      esc(timeLabel) +
      "</span></label>" +
      '<label class="ql-restore-field"><span>' +
      esc(t("restoreCheckpointMap")) +
      '</span><input type="text" data-ql-restore-map" value="' +
      esc(state.map || "") +
      '" spellcheck="false" /></label>' +
      "</div>" +
      '<div class="ql-restore-players">' +
      playersHtml +
      "</div>" +
      '<div class="ql-restore-output">' +
      '<div class="ql-restore-output-head">' +
      "<h4>" +
      esc(t("restoreEditorCfgTitle")) +
      '</h4><span class="ql-restore-cfg-prefix">' +
      esc(t("restoreEditorCfgPrefix")) +
      "</span>" +
      '<span class="control-status ql-restore-encode-status" data-ql-restore-encode-status">' +
      esc(payload ? t("restoreEditorReady") : t("restoreEditorEncoding")) +
      "</span></div>" +
      '<textarea class="restore-checkpoint-json" data-ql-restore-cfg spellcheck="false" readonly>' +
      esc(cfgText) +
      "</textarea>" +
      '<div class="control-actions restore-checkpoint-actions">' +
      '<button type="button" class="control-btn control-btn-sm control-btn-primary" data-ql-restore-copy-cfg">' +
      esc(t("restoreCheckpointCopyCfg")) +
      "</button>" +
      '<button type="button" class="control-btn control-btn-sm" data-ql-restore-reencode">' +
      esc(t("restoreEditorRegenerate")) +
      "</button>" +
      (opts.standalone
        ? '<button type="button" class="control-btn control-btn-sm" data-ql-restore-add-player">' +
          esc(t("restoreEditorAddPlayer")) +
          "</button>"
        : "") +
      "</div></div></div>"
    );
  }

  function render(opts) {
    opts = opts || {};
    var status = opts.status || "idle";
    var payload = opts.payload;
    var err = opts.error || "";
    var cp = payload && payload.checkpoint ? payload.checkpoint : opts.checkpoint || null;
    var state = stateFromCheckpoint(cp, opts.archive, opts.tMs);

    var html =
      '<section class="control-section restore-checkpoint-panel ql-restore-panel" id="restore-checkpoint-panel">' +
      "<h3>" +
      esc(t("restoreCheckpointTitle")) +
      "</h3>" +
      '<p class="control-field-hint">' +
      esc(t("restoreCheckpointHint")) +
      "</p>";

    if (status === "unavailable") {
      html +=
        '<p class="match-analytics-empty">' + esc(t("restoreCheckpointNoReplay")) + "</p>";
    } else if (status === "loading" && !(payload && payload.checkpoint)) {
      html += '<p class="control-status">' + esc(t("restoreCheckpointLoading")) + "</p>";
    } else if (status === "error") {
      html +=
        '<p class="control-status error">' +
        esc(t("restoreCheckpointError")) +
        ": " +
        esc(err) +
        "</p>";
    } else {
      html += renderEditorBody(state, payload, opts);
    }
    html += "</section>";
    return html;
  }

  function bindHost(host, opts) {
    if (!host || host.dataset.qlRestoreBound) return;
    host.dataset.qlRestoreBound = "1";

    function onEdit() {
      scheduleEncode(host, opts);
    }

    host.addEventListener("input", function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      if (t.closest(".ql-restore-editor-body")) onEdit();
    });
    host.addEventListener("change", function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      if (t.matches("[data-ql-restore-lo]") || t.matches("[data-ql-restore-w]")) onEdit();
    });

    host.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      if (t.closest("[data-ql-restore-copy-cfg]")) {
        ev.preventDefault();
        var ta = host.querySelector("[data-ql-restore-cfg]");
        var text = ta ? ta.value : "";
        if (!text) return;
        global.QLDashboard.copyText(text).catch(function () {
          window.prompt("Restore cfg:", text);
        });
        return;
      }
      if (t.closest("[data-ql-restore-reencode]")) {
        ev.preventDefault();
        encodeFromRoot(host, opts);
        return;
      }
      if (t.closest("[data-ql-restore-add-player]")) {
        ev.preventDefault();
        var playersWrap = host.querySelector(".ql-restore-players");
        if (!playersWrap) return;
        var idx = playersWrap.querySelectorAll("[data-ql-restore-player]").length;
        var empty = playersWrap.querySelector(".match-analytics-empty");
        if (empty) empty.remove();
        playersWrap.insertAdjacentHTML(
          "beforeend",
          renderPlayerCard(
            {
              cid: idx,
              sid: "",
              h: 100,
              a: 0,
              w: 0,
              x: 0,
              y: 0,
              z: 0,
              loadoutKeys: [],
              am: {},
            },
            idx,
          ),
        );
        encodeFromRoot(host, opts);
      }
    });

    if (host.querySelector(".ql-restore-editor-body")) {
      encodeFromRoot(host, opts);
    }
  }

  function mount(hostEl, opts) {
    if (!hostEl) return;
    delete hostEl.dataset.qlRestoreBound;
    hostEl.innerHTML = render(opts || {});
    bindHost(hostEl, opts || {});
  }

  function remount(hostEl, opts) {
    mount(hostEl, opts);
  }

  global.QLRestoreEditor = {
    render: render,
    mount: mount,
    remount: remount,
    bindHost: bindHost,
    stateFromCheckpoint: stateFromCheckpoint,
    checkpointFromState: checkpointFromState,
    pickCfgText: pickCfgText,
    LOADOUT_WEAPONS: LOADOUT_WEAPONS,
    AMMO_KEYS: AMMO_KEYS,
  };
})(typeof window !== "undefined" ? window : globalThis);
