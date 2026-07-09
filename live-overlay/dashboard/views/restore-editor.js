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

  function clampScore(value) {
    var n = parseInt(String(value), 10);
    if (isNaN(n)) return 0;
    return Math.max(-128, Math.min(127, n));
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

  function fmtCfgNum(n) {
    var x = Number(n);
    if (isNaN(x)) return "0";
    if (x === Math.floor(x)) return String(Math.floor(x));
    return String(x);
  }

  function fmtPlayerVit(row) {
    var h = clampInt(row.h, 0, 999);
    var a = clampInt(row.a, 0, 999);
    var w = clampInt(row.w, 0, 255);
    var lo =
      row.loadoutKeys && row.loadoutKeys.length
        ? loadoutMaskFromKeys(row.loadoutKeys)
        : clampInt(row.lo, 0, 65535);
    var sc = row.sc;
    if (sc != null && sc !== "") {
      return h + " " + a + " " + w + " " + lo + " " + clampScore(sc);
    }
    if (lo) return h + " " + a + " " + w + " " + lo;
    if (w) return h + " " + a + " " + w;
    return h + " " + a;
  }

  function itemCfgIdentity(item) {
    if (!item || typeof item !== "object") return "";
    var cn = String(item.cn || item.classname || "").trim();
    if (cn && (cn.indexOf("item_") === 0 || cn.indexOf("weapon_") === 0)) {
      if (item.x != null && item.y != null && item.z != null) {
        return (
          cn +
          " pos " +
          fmtCfgNum(item.x) +
          " " +
          fmtCfgNum(item.y) +
          " " +
          fmtCfgNum(item.z)
        );
      }
      return cn;
    }
    var k = String(item.k || item.key || item.alias || "").trim().toLowerCase();
    if (k) return k;
    if (item.eid != null) {
      var eid = parseInt(item.eid, 10);
      if (!isNaN(eid)) return "e" + eid;
    }
    return "";
  }

  function cloneCheckpointItem(item) {
    if (!item || typeof item !== "object") return item;
    return {
      eid: item.eid,
      k: item.k,
      cn: item.cn,
      s: item.s,
      in: item.in,
      at_ms: item.at_ms,
      x: item.x,
      y: item.y,
      z: item.z,
    };
  }

  function cfgCommandPrefix() {
    return "!restorecp ";
  }

  function cfgLine(sub) {
    return cfgCommandPrefix() + sub;
  }

  function parseCfgSubcommand(sub) {
    return String(sub || "")
      .trim()
      .split(/\s+/)
      .filter(function (t) {
        return t !== "";
      });
  }

  function parseCfgTextToDraft(cfgText, defaultTMs) {
    var draft = { t_ms: defaultTMs || 0, map: "", players: {}, items: [] };
    var lines = String(cfgText || "").split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.indexOf("//") === 0) continue;
      var sub = null;
      var m1 = line.match(/^(?:say\s+)?!restorecp\s+(.+)$/i);
      var m2 = line.match(/^qlx\s+restorecp\s+(.+)$/i);
      if (m1) sub = m1[1];
      else if (m2) sub = m2[1];
      if (!sub) continue;
      var tok = parseCfgSubcommand(sub);
      if (!tok.length) continue;
      var head = tok[0].toLowerCase();
      if (head === "time" && tok[1] != null) {
        draft.t_ms = clampInt(tok[1], 0, 86400000);
      } else if (head === "map" && tok[1]) {
        draft.map = normalizeMapKey(tok[1]);
      } else if (head === "player" && tok.length >= 3) {
        var slot = clampInt(tok[1], 0, 255);
        var field = tok[2].toLowerCase();
        var row = draft.players[slot] || { cid: slot };
        draft.players[slot] = row;
        if (field === "sid" && tok[3]) row.sid = String(tok[3]).trim();
        else if (field === "pos" && tok.length >= 6) {
          row.x = clampFloat(tok[3]);
          row.y = clampFloat(tok[4]);
          row.z = clampFloat(tok[5]);
        } else if (field === "vel" && tok.length >= 6) {
          row.vx = clampInt(tok[3], -9999, 9999);
          row.vy = clampInt(tok[4], -9999, 9999);
          row.vz = clampInt(tok[5], -9999, 9999);
        } else if (field === "vit") {
          row.h = clampInt(tok[3], 0, 999);
          row.a = clampInt(tok[4], 0, 999);
          if (tok[5] != null) row.w = clampInt(tok[5], 0, 255);
          if (tok[6] != null) row.lo = clampInt(tok[6], 0, 65535);
          if (tok[7] != null) row.sc = clampScore(tok[7]);
        } else if (field === "dead") {
          row.dead = tok[3] != null && tok[3] !== "0" ? 1 : 0;
        } else if (field === "w" && tok[3] != null) row.w = clampInt(tok[3], 0, 255);
        else if (field === "lo" && tok[3] != null) row.lo = clampInt(tok[3], 0, 65535);
        else if (field === "sc" && tok[3] != null) row.sc = clampScore(tok[3]);
        else if (field === "ammo" && tok.length >= 5) {
          row.am = row.am || {};
          row.am[String(tok[3]).toLowerCase()] = clampInt(tok[4], 0, 255);
        }
      } else if (head === "item" && tok.length >= 2) {
        var item = {};
        var idx = 1;
        var cn = String(tok[idx] || "");
        if (cn.indexOf("item_") === 0 || cn.indexOf("weapon_") === 0) {
          item.cn = cn;
          idx += 1;
          if (tok[idx] && tok[idx].toLowerCase() === "pos" && tok.length >= idx + 4) {
            idx += 1;
            item.x = clampFloat(tok[idx++]);
            item.y = clampFloat(tok[idx++]);
            item.z = clampFloat(tok[idx++]);
          }
        } else if (cn.indexOf("e") === 0 && /^e\d+$/i.test(cn)) {
          item.k = cn.toLowerCase();
          item.eid = parseInt(cn.slice(1), 10);
          idx += 1;
        } else {
          item.k = cn.toLowerCase();
          idx += 1;
        }
        var stateTok = String(tok[idx] || "").toLowerCase();
        if (stateTok === "hidden" || stateTok === "hide" || stateTok === "0") {
          item.s = 0;
          draft.items.push(item);
        } else if (stateTok === "pending") {
          item.s = 2;
          if (tok[idx + 1] && tok[idx + 1].toLowerCase() === "at" && tok[idx + 2] != null) {
            item.at_ms = clampInt(tok[idx + 2], 0, 86400000);
          } else if (tok[idx + 1] && tok[idx + 1].toLowerCase() === "in" && tok[idx + 2] != null) {
            item.in = parseFloat(tok[idx + 2]);
            item.at_ms = clampInt(draft.t_ms + item.in * 1000, 0, 86400000);
          }
          draft.items.push(item);
        }
      }
    }
    return draft;
  }

  function editorStateFromCfgText(cfgText, fallback) {
    fallback = fallback || { t_ms: 0, map: "", players: [], items: [] };
    var draft = parseCfgTextToDraft(cfgText, fallback.t_ms);
    var slots = Object.keys(draft.players)
      .map(function (k) {
        return parseInt(k, 10);
      })
      .sort(function (a, b) {
        return a - b;
      });
    var players = slots.map(function (slot) {
      return playerRowFromCheckpoint(draft.players[slot], slot);
    });
    return {
      v: 2,
      t_ms: draft.t_ms || fallback.t_ms,
      map: draft.map || fallback.map,
      players: players.length ? players : (fallback.players || []).map(clonePlayerRow),
      items: draft.items.length
        ? draft.items.map(cloneCheckpointItem)
        : (fallback.items || []).map(cloneCheckpointItem),
    };
  }

  function resolveCfgText(host, state, opts) {
    opts = opts || {};
    if (!host || !host._qlRestoreCfgDirty) {
      var fromPayload = opts.payload ? pickCfgText(opts.payload) : "";
      if (fromPayload) return fromPayload;
    }
    return buildCfgTextFromState(state);
  }

  function buildCfgTextFromState(state) {
    var t = clampInt(state.t_ms, 0, 86400000);
    var map = normalizeMapKey(state.map);
    var lines = [
      "// Match restore cfg — t_ms=" + t + " map=" + map,
      "// Client exec: !restorecp … (perm 5). Do not prefix with say.",
      cfgLine("quiet"),
      "",
      cfgLine("clear"),
      cfgLine("time " + t),
      cfgLine("map " + map),
      "",
    ];
    var players = (state.players || []).slice().sort(function (a, b) {
      return clampInt(a.cid, 0, 255) - clampInt(b.cid, 0, 255);
    });
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      var slot = p.cid != null ? clampInt(p.cid, 0, 255) : i;
      var sid = String(p.sid || "").trim();
      if (sid) lines.push(cfgLine("player " + slot + " sid " + sid));
      lines.push(
        cfgLine(
          "player " +
            slot +
            " pos " +
            fmtCfgNum(p.x) +
            " " +
            fmtCfgNum(p.y) +
            " " +
            fmtCfgNum(p.z),
        ),
      );
      if (p.vx != null && p.vy != null && p.vz != null) {
        lines.push(
          cfgLine(
            "player " +
              slot +
              " vel " +
              clampInt(p.vx, -9999, 9999) +
              " " +
              clampInt(p.vy, -9999, 9999) +
              " " +
              clampInt(p.vz, -9999, 9999),
          ),
        );
      }
      lines.push(cfgLine("player " + slot + " vit " + fmtPlayerVit(p)));
      if (p.dead) lines.push(cfgLine("player " + slot + " dead 1"));
      AMMO_KEYS.forEach(function (key) {
        if (p.am && p.am[key] != null && String(p.am[key]) !== "") {
          var val = clampInt(p.am[key], 0, 255);
          if (val > 0) lines.push(cfgLine("player " + slot + " ammo " + key + " " + val));
        }
      });
      lines.push("");
    }
    if (players.length && lines[lines.length - 1] === "") lines.pop();

    var items = state.items || [];
    if (items.length) lines.push("");
    for (var j = 0; j < items.length; j++) {
      var item = items[j];
      var identity = itemCfgIdentity(item);
      if (!identity) continue;
      var st = parseInt(item.s, 10);
      if (st === 0) {
        lines.push(cfgLine("item " + identity + " hidden"));
      } else if (st === 2) {
        if (item.at_ms != null) {
          lines.push(cfgLine("item " + identity + " pending at " + parseInt(item.at_ms, 10)));
        } else if (item.in != null) {
          lines.push(cfgLine("item " + identity + " pending in " + item.in));
        }
      }
    }
    lines.push("", cfgLine("apply"));
    return lines.join("\n") + "\n";
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
    var sc = row.sc != null ? row.sc : row.score;
    var dead = row.dead != null ? row.dead : row.alive === false ? 1 : 0;
    var out = {
      cid: row.cid != null ? clampInt(row.cid, 0, 255) : idx,
      sid: String(row.sid || row.steam_id64 || "").trim(),
      label: String(row.label || row.nickname || "").trim(),
      x: row.x != null ? clampFloat(row.x) : 0,
      y: row.y != null ? clampFloat(row.y) : 0,
      z: row.z != null ? clampFloat(row.z) : 0,
      vx: row.vx != null ? clampInt(row.vx, -9999, 9999) : null,
      vy: row.vy != null ? clampInt(row.vy, -9999, 9999) : null,
      vz: row.vz != null ? clampInt(row.vz, -9999, 9999) : null,
      h: clampInt(row.h != null ? row.h : row.health, 0, 999),
      a: clampInt(row.a != null ? row.a : row.armor, 0, 999),
      w: clampInt(row.w != null ? row.w : row.weapon, 0, 255),
      lo: clampInt(row.lo != null ? row.lo : row.loadout, 0, 65535),
      loadoutKeys: loadoutKeysFromMask(row.lo != null ? row.lo : row.loadout),
      sc: sc != null && sc !== "" ? clampScore(sc) : null,
      dead: dead ? 1 : 0,
      am: am,
    };
    if (out.dead) {
      out.w = 0;
      out.lo = 1 << 1;
      out.loadoutKeys = loadoutKeysFromMask(out.lo);
      out.am = {};
    }
    return out;
  }

  function stripColors(text) {
    return String(text || "").replace(/\^[0-9a-zA-Z]/g, "");
  }

  function fillMissingSteamIds(archive, roster) {
    var rows = (roster || []).map(function (p) {
      return Object.assign({}, p);
    });
    if (!archive || !rows.length) return rows;
    var nickBySteam = {};
    var A = analytics();
    if (A && A.buildNicknameBySteam) nickBySteam = A.buildNicknameBySteam(archive, null);
    rows.forEach(function (p) {
      if (String(p.steam_id64 || "").trim()) return;
      var nick = stripColors(p.nickname || p.name || "");
      if (!nick) return;
      (archive.deaths || []).forEach(function (d) {
        if (p.steam_id64) return;
        if (stripColors(d.killer || "") === nick && d.killer_steam_id64) {
          p.steam_id64 = String(d.killer_steam_id64).trim();
        }
        if (stripColors(d.victim || "") === nick && d.victim_steam_id64) {
          p.steam_id64 = String(d.victim_steam_id64).trim();
        }
      });
      if (!p.steam_id64 && A) {
        Object.keys(nickBySteam).some(function (steam) {
          if (stripColors(nickBySteam[steam]) === nick) {
            p.steam_id64 = steam;
            return true;
          }
          return false;
        });
      }
    });
    return rows;
  }

  function uniqueRosterRows(archive, roster) {
    var A = analytics();
    var nickBySteam = A && A.buildNicknameBySteam ? A.buildNicknameBySteam(archive, null) : {};
    var seen = {};
    var out = [];
    (roster || []).forEach(function (p) {
      var steam = String(p.steam_id64 || "").trim();
      var nick = A ? A.displayNickname(p, nickBySteam) : stripColors(p.nickname || "");
      var key = steam ? "s:" + steam : "n:" + nick;
      if (!steam && (!nick || nick === "—")) return;
      if (seen[key]) return;
      seen[key] = true;
      out.push(p);
    });
    return out;
  }

  function duelLikeArchive(archive) {
    if (!archive) return false;
    var gt = String(archive.gametype || "").trim().toLowerCase();
    if (gt === "duel" || gt === "1") return true;
    var A = analytics();
    if (!A) return false;
    var final = A.resolveFinalPlayers(archive) || [];
    var steams = {};
    final.forEach(function (p) {
      var s = String(p.steam_id64 || "").trim();
      if (s) steams[s] = true;
    });
    return Object.keys(steams).length === 2;
  }

  function uniqueArchivePlayers(archive) {
    var seen = {};
    var out = [];
    (archive.players || []).forEach(function (p) {
      if (!p || typeof p !== "object") return;
      var steam = String(p.steam_id64 || "").trim();
      if (!steam || seen[steam]) return;
      seen[steam] = true;
      out.push(p);
    });
    return out.sort(function (a, b) {
      return String(a.steam_id64 || "").localeCompare(String(b.steam_id64 || ""));
    });
  }

  function archiveRosterForRestore(archive, tMs) {
    var A = analytics();
    if (!archive || !A) return [];
    var roster = fillMissingSteamIds(archive, A.resolvePlayersAtScrub(archive, tMs != null ? tMs : null));
    roster = uniqueRosterRows(archive, roster);
    if (duelLikeArchive(archive)) {
      if (roster.length < 2) {
        var extra = uniqueRosterRows(
          archive,
          fillMissingSteamIds(archive, A.resolveFinalPlayers(archive) || []),
        );
        var seen = {};
        roster.forEach(function (p) {
          var s = String(p.steam_id64 || "").trim();
          if (s) seen["s:" + s] = true;
        });
        extra.forEach(function (p) {
          var s = String(p.steam_id64 || "").trim();
          var nick = A.displayNickname(p, A.buildNicknameBySteam(archive, null));
          var key = s ? "s:" + s : "n:" + nick;
          if (seen[key]) return;
          seen[key] = true;
          roster.push(p);
        });
      }
      if (roster.length < 2) {
        uniqueArchivePlayers(archive).forEach(function (p) {
          var s = String(p.steam_id64 || "").trim();
          if (!s) return;
          if (
            roster.some(function (row) {
              return String(row.steam_id64 || "").trim() === s;
            })
          ) {
            return;
          }
          roster.push(p);
        });
      }
      roster = uniqueRosterRows(archive, fillMissingSteamIds(archive, roster));
      roster.sort(function (a, b) {
        return String(a.steam_id64 || "").localeCompare(String(b.steam_id64 || ""));
      });
      if (roster.length >= 2) return roster.slice(0, 2);
    }
    return roster;
  }

  function mergePlayersWithArchive(checkpointPlayers, archive, tMs) {
    var A = analytics();
    var roster = archiveRosterForRestore(archive, tMs);
    var cpRows = (checkpointPlayers || []).map(function (row, idx) {
      return playerRowFromCheckpoint(row, idx);
    });
    if (!roster.length) return cpRows;
    var duelLike = duelLikeArchive(archive);
    var nickBySteam = A && A.buildNicknameBySteam ? A.buildNicknameBySteam(archive, null) : {};
    var cpBySteam = {};
    var cpPool = [];
    cpRows.forEach(function (p) {
      var steam = String(p.sid || "").trim();
      if (steam && !cpBySteam[steam]) {
        cpBySteam[steam] = p;
      } else {
        cpPool.push(p);
      }
    });
    var merged = [];
    var usedSteam = {};
    for (var i = 0; i < roster.length; i++) {
      var arch = roster[i];
      var steam = String(arch.steam_id64 || "").trim();
      var p = steam && cpBySteam[steam] ? Object.assign({}, cpBySteam[steam]) : null;
      if (!p && cpPool.length) p = Object.assign({}, cpPool.shift());
      if (!p) {
        var stats = A.scoreboardStats(arch, duelLike);
        p = playerRowFromCheckpoint(
          {
            cid: i,
            sid: steam,
            nickname: A.displayNickname(arch, nickBySteam),
            x: 0,
            y: 0,
            z: 0,
            h: 100,
            a: 0,
            w: 0,
            lo: 0,
            sc: stats && stats.score != null ? stats.score : null,
          },
          i,
        );
      } else {
        p = Object.assign({}, p);
        p.cid = i;
      }
      if (steam) p.sid = steam;
      p.label = A.displayNickname(arch, nickBySteam);
      var archStats = A.scoreboardStats(arch, duelLike);
      if (archStats && archStats.score != null && !isNaN(archStats.score)) {
        var archSc = clampScore(archStats.score);
        var cpSc = p.sc != null && p.sc !== "" && !isNaN(p.sc) ? clampScore(p.sc) : null;
        if (cpSc != null && duelLike && cpSc < 0 && archSc >= 0) {
          p.sc = cpSc;
        } else {
          p.sc = archSc;
        }
      }
      merged.push(p);
      if (steam) usedSteam[steam] = true;
    }
    cpRows.forEach(function (p) {
      var steam = String(p.sid || "").trim();
      if (steam && usedSteam[steam]) return;
      var copy = Object.assign({}, p, { cid: merged.length });
      merged.push(copy);
      if (steam) usedSteam[steam] = true;
    });
    return merged;
  }

  function playersFromArchive(archive, tMs) {
    var A = analytics();
    if (!A || !archive) return [];
    var roster = archiveRosterForRestore(archive, tMs);
    var duelLike = duelLikeArchive(archive);
    return roster.map(function (p, idx) {
      var stats = A.scoreboardStats(p, duelLike);
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
          sc: stats && stats.score != null ? stats.score : null,
        },
        idx,
      );
    });
  }

  function playersLayoutKey(players) {
    return (
      String((players || []).length) +
      "|" +
      (players || [])
        .map(function (p, i) {
          return i + ":" + String(p.sid || "").trim();
        })
        .join(",")
    );
  }

  function setInputValue(el, value) {
    if (!el) return;
    var next = String(value);
    if (el.value !== next) {
      el.value = next;
      return;
    }
    el.value = "";
    el.value = next;
  }

  function patchPlayersFromState(host, state) {
    var cards = host.querySelectorAll("[data-ql-restore-player]");
    var players = state.players || [];
    for (var i = 0; i < players.length && i < cards.length; i++) {
      var p = players[i];
      var card = cards[i];
      var sidEl = card.querySelector("[data-ql-restore-sid]");
      if (sidEl && p.sid != null) setInputValue(sidEl, p.sid);
      var hEl = card.querySelector("[data-ql-restore-h]");
      if (hEl) setInputValue(hEl, p.h != null ? p.h : 100);
      var aEl = card.querySelector("[data-ql-restore-a]");
      if (aEl) setInputValue(aEl, p.a != null ? p.a : 0);
      var wEl = card.querySelector("[data-ql-restore-w]");
      if (wEl) wEl.value = String(p.w != null ? p.w : 0);
      var scEl = card.querySelector("[data-ql-restore-sc]");
      if (scEl) setInputValue(scEl, p.sc != null && p.sc !== "" ? p.sc : "");
      ["x", "y", "z"].forEach(function (axis) {
        var el = card.querySelector('[data-ql-restore-pos="' + axis + '"]');
        if (el && p[axis] != null) setInputValue(el, p[axis]);
      });
      ["vx", "vy", "vz"].forEach(function (axis) {
        var el = card.querySelector('[data-ql-restore-vel="' + axis + '"]');
        if (el) {
          el.value = p[axis] != null && p[axis] !== "" ? String(p[axis]) : "";
        }
      });
      var loadoutSet = {};
      (p.loadoutKeys || []).forEach(function (k) {
        loadoutSet[k] = true;
      });
      var loChecks = card.querySelectorAll("[data-ql-restore-lo]");
      for (var j = 0; j < loChecks.length; j++) {
        var key = loChecks[j].getAttribute("data-ql-restore-lo");
        loChecks[j].checked = !!loadoutSet[key];
      }
      AMMO_KEYS.forEach(function (k) {
        var amEl = card.querySelector('[data-ql-restore-ammo="' + k + '"]');
        if (amEl) amEl.value = p.am && p.am[k] != null ? String(p.am[k]) : "";
      });
      var head = card.querySelector(".ql-restore-player-head h4");
      if (head && p.label) head.textContent = p.label;
    }
  }

  function applyCfgFromState(host, state, opts) {
    var cfgEl = host.querySelector("[data-ql-restore-cfg]");
    if (!cfgEl || !state) return;
    var cfg = resolveCfgText(host, state, opts || currentBindOpts(host));
    cfgEl.value = cfg;
    host._qlRestoreLastCfg = cfg;
    host._qlRestoreCfgDirty = false;
  }

  function buildEditorState(opts, host) {
    opts = opts || {};
    var scrubT = resolveEditorScrubTMs(host, opts);
    var payload = opts.payload;
    var fullCp = (payload && payload.checkpoint) || opts.checkpoint || null;
    var cpPlayers = fullCp && fullCp.players ? fullCp.players : [];
    var rawItems =
      host && host._qlRestoreCheckpointItemsRaw
        ? host._qlRestoreCheckpointItemsRaw.slice()
        : fullCp && Array.isArray(fullCp.items)
          ? fullCp.items.slice()
          : [];
    var sourceT =
      host && host._qlRestoreCheckpointSourceTMs != null
        ? host._qlRestoreCheckpointSourceTMs
        : fullCp && fullCp.t_ms != null
          ? fullCp.t_ms
          : null;
    var archive = opts.archive;
    var players;
    if (!cpPlayers.length && archive) {
      players = playersFromArchive(archive, scrubT);
    } else if (archive) {
      players = mergePlayersWithArchive(cpPlayers, archive, scrubT);
    } else {
      players = cpPlayers.map(playerRowFromCheckpoint);
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
      t_ms: scrubT,
      map: normalizeMapKey(
        (fullCp && (fullCp.map || fullCp.map_name)) ||
          (archive && archive.map_name) ||
          (host && host._qlRestoreMapFallback) ||
          "",
      ),
      players: players,
      items: filterCheckpointItemsForScrub(rawItems, scrubT, sourceT),
    };
  }

  function clonePlayerRow(p) {
    return {
      cid: p.cid,
      sid: p.sid,
      label: p.label,
      x: p.x,
      y: p.y,
      z: p.z,
      vx: p.vx,
      vy: p.vy,
      vz: p.vz,
      h: p.h,
      a: p.a,
      w: p.w,
      sc: p.sc,
      dead: p.dead ? 1 : 0,
      lo: p.lo,
      loadoutKeys: (p.loadoutKeys || []).slice(),
      am: Object.assign({}, p.am || {}),
    };
  }

  function cloneEditorState(state) {
    return {
      v: state.v,
      t_ms: state.t_ms,
      map: state.map,
      players: (state.players || []).map(clonePlayerRow),
      items: (state.items || []).map(cloneCheckpointItem),
    };
  }

  function snapshotFromState(host, state) {
    return {
      state: cloneEditorState(state),
      rawItems: host._qlRestoreCheckpointItemsRaw
        ? host._qlRestoreCheckpointItemsRaw.slice()
        : (state.items || []).slice(),
      sourceTMs: host._qlRestoreCheckpointSourceTMs,
      layoutKey: playersLayoutKey(state.players),
    };
  }

  function effectiveEditorState(host, previewTMs) {
    var snap = host._qlRestoreSnapshot;
    if (!snap) return null;
    var opts = currentBindOpts(host);
    var base = cloneEditorState(snap.state);
    var t =
      previewTMs != null ? clampInt(previewTMs, 0, 86400000) : clampInt(base.t_ms, 0, 86400000);
    base.t_ms = t;
    base.items = filterCheckpointItemsForScrub(snap.rawItems, t, snap.sourceTMs);
    if (
      opts.status === "ready" &&
      opts.payload &&
      scrubPayloadRelation(opts.payload, t) === "exact"
    ) {
      var live = buildEditorState(Object.assign({}, opts, { tMs: t }), host);
      if (live.players && live.players.length) {
        base.players = live.players.map(clonePlayerRow);
        if (live.map) base.map = live.map;
      }
    }
    if (host._qlRestoreEditMode && host._qlRestoreOverrides) {
      var ov = host._qlRestoreOverrides;
      if (ov.map) base.map = ov.map;
      (ov.players || []).forEach(function (row, i) {
        if (!row || !base.players[i]) return;
        base.players[i] = Object.assign({}, base.players[i], row, {
          loadoutKeys: row.loadoutKeys ? row.loadoutKeys.slice() : base.players[i].loadoutKeys,
          am: row.am ? Object.assign({}, row.am) : base.players[i].am,
        });
      });
    }
    return base;
  }

  function readOverridesFromForm(host) {
    var cards = host.querySelectorAll("[data-ql-restore-player]");
    var players = [];
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var p = {
        cid: clampInt(card.getAttribute("data-ql-restore-player"), 0, 255),
        sid: "",
        x: 0,
        y: 0,
        z: 0,
        h: 100,
        a: 0,
        w: 0,
        loadoutKeys: [],
        am: {},
        vx: null,
        vy: null,
        vz: null,
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
      ["vx", "vy", "vz"].forEach(function (axis) {
        var el = card.querySelector('[data-ql-restore-vel="' + axis + '"]');
        if (el && String(el.value).trim() !== "") {
          p[axis] = clampInt(el.value, -9999, 9999);
        }
      });
      var loadoutChecks = card.querySelectorAll("[data-ql-restore-lo]:checked");
      for (var j = 0; j < loadoutChecks.length; j++) {
        p.loadoutKeys.push(loadoutChecks[j].getAttribute("data-ql-restore-lo"));
      }
      AMMO_KEYS.forEach(function (k) {
        var amEl = card.querySelector('[data-ql-restore-ammo="' + k + '"]');
        if (amEl && amEl.value !== "") p.am[k] = clampInt(amEl.value, 0, 255);
      });
      players.push(p);
    }
    var mapEl = host.querySelector("[data-ql-restore-map]");
    return {
      map: mapEl ? normalizeMapKey(mapEl.value) : "",
      players: players,
    };
  }

  function setFormEditMode(host, enabled) {
    var body = host.querySelector(".ql-restore-editor-body");
    if (!body) return;
    body.classList.toggle("ql-restore-readonly", !enabled);
    body.classList.toggle("ql-restore-editing", !!enabled);
    var textInputs = body.querySelectorAll(
      'input[type="text"], input[type="number"], textarea',
    );
    for (var i = 0; i < textInputs.length; i++) {
      if (enabled) textInputs[i].removeAttribute("readonly");
      else textInputs[i].setAttribute("readonly", "readonly");
    }
    var selects = body.querySelectorAll("select");
    for (var j = 0; j < selects.length; j++) {
      selects[j].disabled = !enabled;
    }
    var checks = body.querySelectorAll('input[type="checkbox"], input[type="radio"]');
    for (var k = 0; k < checks.length; k++) {
      checks[k].disabled = !enabled;
    }
    var btn = host.querySelector("[data-ql-restore-edit-toggle]");
    if (btn) {
      btn.textContent = enabled ? t("restoreEditorCancelEdit") : t("restoreEditorEdit");
      btn.setAttribute("aria-pressed", enabled ? "true" : "false");
    }
  }

  function playersDomNeedsRebuild(host, state) {
    if (!host || !state) return false;
    if (host.querySelector("[data-ql-restore-pending]")) return true;
    var domCards = host.querySelectorAll("[data-ql-restore-player]").length;
    return domCards !== (state.players || []).length;
  }

  function currentBindOpts(host) {
    return (host && host._qlRestoreBindOpts) || {};
  }

  function ensureSnapshot(host) {
    if (!host) return false;
    if (host._qlRestoreSnapshot) return true;
    var opts = currentBindOpts(host);
    if (opts.status !== "ready" || !opts.payload) return false;
    var scrubT = resolveEditorScrubTMs(host, opts);
    if (scrubPayloadRelation(opts.payload, scrubT) !== "exact") return false;
    commitSnapshot(host, opts);
    return !!host._qlRestoreSnapshot;
  }

  function syncUiFromModel(host, previewTMs, options) {
    options = options || {};
    if (!host) return null;
    var state = effectiveEditorState(host, previewTMs);
    if (!state) return null;
    if (host._qlRestoreEditMode && options.editPreview) {
      var scrubT = clampInt(previewTMs != null ? previewTMs : state.t_ms, 0, 86400000);
      var tEl = host.querySelector("[data-ql-restore-t-ms]");
      if (tEl) tEl.value = String(scrubT);
      var hintEl = host.querySelector(".ql-restore-field-hint");
      if (hintEl && analytics()) hintEl.textContent = analytics().formatGameTime(scrubT);
      applyCfgFromState(host, state);
      return state;
    }
    var layoutKey = playersLayoutKey(state.players);
    var applyOpts = {
      fullRender:
        !!options.fullRender ||
        playersDomNeedsRebuild(host, state) ||
        layoutKey !== host._qlRestoreLayoutKey,
    };
    applyStateToHost(host, state, applyOpts);
    if (state.players) host._qlRestoreLayoutKey = layoutKey;
    setFormEditMode(host, !!host._qlRestoreEditMode);
    return state;
  }

  function renderFromModel(host) {
    return syncUiFromModel(host, resolveEditorScrubTMs(host, currentBindOpts(host)));
  }

  function commitSnapshot(host, opts) {
    if (!host) return;
    opts = opts || {};
    var state = buildEditorState(opts, host);
    host._qlRestoreSnapshot = snapshotFromState(host, state);
    host._qlRestoreEditMode = false;
    host._qlRestoreOverrides = null;
    setRestoreItemsCache(host, state.items, host._qlRestoreCheckpointSourceTMs, host._qlRestoreCheckpointItemsRaw);
    return renderFromModel(host);
  }

  function previewTimelineMs(host, tMs, opts) {
    if (!host || !host._qlRestoreSnapshot) return;
    syncUiFromModel(host, clampInt(tMs, 0, 86400000), {
      editPreview: !!host._qlRestoreEditMode,
    });
  }

  function showSnapshotPending(host, scrubT) {
    if (!host) return;
    var t = clampInt(scrubT, 0, 86400000);
    var tEl = host.querySelector("[data-ql-restore-t-ms]");
    if (tEl) tEl.value = String(t);
    var hintEl = host.querySelector(".ql-restore-field-hint");
    if (hintEl && analytics()) hintEl.textContent = analytics().formatGameTime(t);
    var wrap = host.querySelector(".ql-restore-players");
    if (wrap) {
      wrap.innerHTML =
        '<p class="control-status" data-ql-restore-pending>' +
        esc(t("restoreCheckpointLoading")) +
        "</p>";
    }
    host._qlRestoreLayoutKey = null;
    var cfgEl = host.querySelector("[data-ql-restore-cfg]");
    if (cfgEl) cfgEl.value = "";
    host._qlRestoreLastCfg = "";
    setFormEditMode(host, false);
  }

  function toggleEditMode(host) {
    if (!host) return;
    if (!host._qlRestoreSnapshot && !ensureSnapshot(host)) return;
    if (!host.querySelector("[data-ql-restore-player]")) return;
    if (!host._qlRestoreEditMode) {
      host._qlRestoreEditMode = true;
      host._qlRestoreOverrides = readOverridesFromForm(host);
      setFormEditMode(host, true);
      return;
    }
    host._qlRestoreEditMode = false;
    host._qlRestoreOverrides = null;
    renderFromModel(host);
  }

  function syncFormFromCfg(host) {
    if (!host || !host._qlRestoreSnapshot) return;
    var cfgEl = host.querySelector("[data-ql-restore-cfg]");
    if (!cfgEl) return;
    var parsed = editorStateFromCfgText(cfgEl.value, host._qlRestoreSnapshot);
    host._qlRestoreSnapshot = snapshotFromState(host, parsed);
    host._qlRestoreOverrides = null;
    host._qlRestoreCfgDirty = false;
    if (parsed.items && parsed.items.length) {
      setRestoreItemsCache(host, parsed.items, parsed.t_ms, parsed.items);
    }
    renderFromModel(host);
  }

  function bindRestoreActions(host) {
    if (!host) return;
    var editBtn = host.querySelector("[data-ql-restore-edit-toggle]");
    if (editBtn && !editBtn.dataset.qlRestoreActionBound) {
      editBtn.dataset.qlRestoreActionBound = "1";
      editBtn.addEventListener("click", function (ev) {
        ev.preventDefault();
        toggleEditMode(host);
      });
    }
    var copyBtn = host.querySelector("[data-ql-restore-copy-cfg]");
    if (copyBtn && !copyBtn.dataset.qlRestoreActionBound) {
      copyBtn.dataset.qlRestoreActionBound = "1";
      copyBtn.addEventListener("click", function (ev) {
        ev.preventDefault();
        var ta = host.querySelector("[data-ql-restore-cfg]");
        var text = ta ? ta.value : "";
        if (!text) return;
        global.QLDashboard.copyText(text).catch(function () {
          window.prompt("Restore cfg:", text);
        });
      });
    }
    var regenBtn = host.querySelector("[data-ql-restore-reencode]");
    if (regenBtn && !regenBtn.dataset.qlRestoreActionBound) {
      regenBtn.dataset.qlRestoreActionBound = "1";
      regenBtn.addEventListener("click", function (ev) {
        ev.preventDefault();
        if (!ensureSnapshot(host)) return;
        syncUiFromModel(host, resolveEditorScrubTMs(host, currentBindOpts(host)));
        encodeFromRoot(host, currentBindOpts(host));
      });
    }
    var syncCfgBtn = host.querySelector("[data-ql-restore-sync-cfg]");
    if (syncCfgBtn && !syncCfgBtn.dataset.qlRestoreActionBound) {
      syncCfgBtn.dataset.qlRestoreActionBound = "1";
      syncCfgBtn.addEventListener("click", function (ev) {
        ev.preventDefault();
        syncFormFromCfg(host);
      });
    }
    var addBtn = host.querySelector("[data-ql-restore-add-player]");
    if (addBtn && !addBtn.dataset.qlRestoreActionBound) {
      addBtn.dataset.qlRestoreActionBound = "1";
      addBtn.addEventListener("click", function (ev) {
        ev.preventDefault();
        var playersWrap = host.querySelector(".ql-restore-players");
        if (!playersWrap) return;
        var idx = playersWrap.querySelectorAll("[data-ql-restore-player]").length;
        var empty = playersWrap.querySelector(".match-analytics-empty");
        if (empty) empty.remove();
        var pending = playersWrap.querySelector("[data-ql-restore-pending]");
        if (pending) pending.remove();
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
        encodeFromRoot(host, currentBindOpts(host));
      });
    }
  }

  function stateFromCheckpoint(cp, archive, tMs) {
    return buildEditorState(
      {
        checkpoint: cp,
        archive: archive,
        tMs: tMs,
        payload: cp ? { checkpoint: cp } : null,
      },
      null,
    );
  }

  function applyStateToHost(host, state, options) {
    options = options || {};
    if (!host || !state) return;
    var tEl = host.querySelector("[data-ql-restore-t-ms]");
    if (tEl) tEl.value = String(state.t_ms || 0);
    var mapEl = host.querySelector("[data-ql-restore-map]");
    if (mapEl && state.map) mapEl.value = state.map;
    var hintEl = host.querySelector(".ql-restore-field-hint");
    if (hintEl && analytics()) hintEl.textContent = analytics().formatGameTime(state.t_ms);
    var layoutKey = playersLayoutKey(state.players);
    var domCards = host.querySelectorAll("[data-ql-restore-player]").length;
    if (
      options.fullRender ||
      layoutKey !== host._qlRestoreLayoutKey ||
      domCards !== (state.players || []).length
    ) {
      host._qlRestoreLayoutKey = layoutKey;
      renderPlayersSection(host, state);
    }
    if (!options.skipPlayers) {
      patchPlayersFromState(host, state);
    }
    if (!options.skipCfg) applyCfgFromState(host, state, currentBindOpts(host));
  }

  function renderPlayersSection(host, state) {
    var wrap = host.querySelector(".ql-restore-players");
    if (!wrap) return;
    var html = "";
    if (state.players && state.players.length) {
      for (var i = 0; i < state.players.length; i++) {
        html += renderPlayerCard(state.players[i], i);
      }
    } else {
      html = '<p class="match-analytics-empty">' + esc(t("restoreEditorNoPlayers")) + "</p>";
    }
    wrap.innerHTML = html;
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
      if (p.sc != null && String(p.sc) !== "") row.sc = clampInt(p.sc, 0, 255);
      var am = {};
      AMMO_KEYS.forEach(function (k) {
        if (p.am && p.am[k] != null && String(p.am[k]) !== "") {
          var val = clampInt(p.am[k], 0, 255);
          if (val > 0) am[k] = val;
        }
      });
      if (Object.keys(am).length) row.am = am;
      if (p.vx != null && p.vy != null && p.vz != null) {
        row.vx = clampInt(p.vx, -9999, 9999);
        row.vy = clampInt(p.vy, -9999, 9999);
        row.vz = clampInt(p.vz, -9999, 9999);
      }
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

  function scrubMsValue(value) {
    var n = parseInt(String(value), 10);
    return isNaN(n) ? null : n;
  }

  function itemAppearsAtMs(row, checkpointTMs) {
    if (!row) return null;
    var at = Number(row.at_ms);
    if (!isNaN(at)) return at;
    var remain = Number(row.in);
    var sourceT = scrubMsValue(checkpointTMs);
    if (!isNaN(remain) && sourceT != null) return sourceT + remain * 1000;
    return null;
  }

  function filterCheckpointItemsForScrub(items, scrubTMs, checkpointTMs) {
    var t = scrubMsValue(scrubTMs);
    if (t == null) return [];
    return (items || []).filter(function (row) {
      if (!row || Number(row.s) !== 2) return false;
      var at = itemAppearsAtMs(row, checkpointTMs);
      return at != null && at > t;
    });
  }

  function filterCfgTextForScrub(cfgText, scrubTMs, checkpointTMs) {
    var t = scrubMsValue(scrubTMs);
    if (t == null || !cfgText) return cfgText || "";
    var sourceT = scrubMsValue(checkpointTMs);
    return String(cfgText)
      .split("\n")
      .filter(function (line) {
        var atMatch = line.match(/\bpending\s+at\s+(\d+)\b/i);
        if (atMatch) {
          var at = parseInt(atMatch[1], 10);
          return !isNaN(at) && at > t;
        }
        var inMatch = line.match(/\bpending\s+in\s+([\d.]+)\b/i);
        if (inMatch && sourceT != null) {
          var atFromIn = sourceT + parseFloat(inMatch[1]) * 1000;
          return !isNaN(atFromIn) && atFromIn > t;
        }
        return true;
      })
      .join("\n");
  }

  function payloadCheckpointTMs(payload) {
    if (!payload) return null;
    var cp = payload.checkpoint;
    return scrubMsValue(cp && cp.t_ms != null ? cp.t_ms : payload.t_ms);
  }

  function scrubPayloadRelation(payload, scrubTMs) {
    var pt = payloadCheckpointTMs(payload);
    var requested = scrubMsValue(payload && payload.t_ms);
    var t = scrubMsValue(scrubTMs);
    if (t == null || !payload) return "none";
    if (pt != null && Math.abs(pt - t) <= 500) return "exact";
    if (requested != null && Math.abs(requested - t) <= 500) return "exact";
    if (pt == null) return "none";
    if (t < pt) return "backward";
    return "forward";
  }

  function canClientFilterPayload(payload, scrubTMs) {
    var rel = scrubPayloadRelation(payload, scrubTMs);
    return rel === "exact" || rel === "forward";
  }

  function checkpointItemsForScrub(payload, scrubTMs) {
    if (!payload || !canClientFilterPayload(payload, scrubTMs)) return [];
    var cp = payload.checkpoint || {};
    return filterCheckpointItemsForScrub(cp.items, scrubTMs, cp.t_ms);
  }

  function cfgTextForScrub(payload, scrubTMs) {
    if (!payload || !canClientFilterPayload(payload, scrubTMs)) return "";
    var cp = payload.checkpoint || {};
    return filterCfgTextForScrub(pickCfgText(payload), scrubTMs, cp.t_ms);
  }

  function cfgTextForDisplay(payload, scrubTMs, mapName, previousCfg, displayOpts) {
    displayOpts = displayOpts || {};
    var map = normalizeMapKey(mapName || "");
    var prev = previousCfg ? String(previousCfg) : "";
    if (prev) {
      return patchCfgScrubTime(prev, scrubTMs, map);
    }
    return "";
  }

  function applyCfgToTextarea(host, payload, scrubT, mapName, displayOpts) {
    if (host._qlRestoreSnapshot) {
      previewTimelineMs(host, scrubT, displayOpts);
      return;
    }
    var cfgEl = host.querySelector("[data-ql-restore-cfg]");
    if (!cfgEl) return;
    var previous = cfgEl.value || host._qlRestoreLastCfg || "";
    var next = cfgTextForDisplay(payload, scrubT, mapName, previous, displayOpts);
    if (next) {
      host._qlRestoreLastCfg = next;
      cfgEl.value = next;
    }
  }

  function payloadAlignedWithScrub(payload, tMs) {
    return scrubPayloadRelation(payload, tMs) === "exact";
  }

  function resolveEditorScrubTMs(host, opts) {
    opts = opts || {};
    if (opts.tMs != null && !isNaN(Number(opts.tMs))) {
      return clampInt(opts.tMs, 0, 86400000);
    }
    if (host) {
      var tEl = host.querySelector("[data-ql-restore-t-ms]");
      if (tEl && String(tEl.value).trim() !== "") {
        return clampInt(tEl.value, 0, 86400000);
      }
    }
    if (typeof document !== "undefined") {
      var scrub = document.getElementById("match-timeline-scrub");
      if (scrub && String(scrub.value).trim() !== "") {
        return clampInt(scrub.value, 0, 86400000);
      }
    }
    var cp = opts.payload && opts.payload.checkpoint;
    if (cp && cp.t_ms != null) return clampInt(cp.t_ms, 0, 86400000);
    return 0;
  }

  function patchCfgScrubTime(cfgText, tMs, mapName) {
    var t = clampInt(tMs, 0, 86400000);
    var map = normalizeMapKey(mapName || "");
    var header = "// Match restore cfg — t_ms=" + t + " map=" + map;
    if (!cfgText) return "";
    var out = String(cfgText).split("\n");
    for (var i = 0; i < out.length; i++) {
      if (out[i].indexOf("// Match restore cfg —") === 0) out[i] = header;
      else if (/^!?restorecp time \d+/i.test(out[i]) || /^say !restorecp time \d+/i.test(out[i]))
        out[i] = cfgLine("time " + t);
      else if (/^!?restorecp map /i.test(out[i]) || /^say !restorecp map /i.test(out[i]))
        out[i] = cfgLine("map " + map);
    }
    return out.join("\n");
  }

  function updateScrubLight(host, opts) {
    opts = Object.assign({}, currentBindOpts(host), opts || {});
    host._qlRestoreBindOpts = opts;
    previewTimelineMs(
      host,
      opts.tMs != null ? opts.tMs : resolveEditorScrubTMs(host, opts),
      opts,
    );
  }

  function updateScrub(host, opts) {
    if (!host) return;
    opts = opts || {};
    host._qlRestoreBindOpts = opts;
    if (opts.refreshPayloadItems && opts.payload && opts.payload.checkpoint && opts.payload.checkpoint.items) {
      host._qlRestoreCheckpointItemsRaw = opts.payload.checkpoint.items.slice();
      host._qlRestoreCheckpointSourceTMs = payloadCheckpointTMs(opts.payload);
    }
    if (opts.status === "ready" && opts.payload) {
      var scrubT = resolveEditorScrubTMs(host, opts);
      var rel = scrubPayloadRelation(opts.payload, scrubT);
      if (rel === "exact") {
        commitSnapshot(host, opts);
      } else if (host._qlRestoreSnapshot) {
        previewTimelineMs(host, scrubT, opts);
      } else {
        showSnapshotPending(host, scrubT);
      }
    } else if (host._qlRestoreSnapshot) {
      previewTimelineMs(host, resolveEditorScrubTMs(host, opts), opts);
    } else {
      showSnapshotPending(host, resolveEditorScrubTMs(host, opts));
    }
    var statusEl = host.querySelector("[data-ql-restore-encode-status]");
    if (statusEl) {
      var scrubT = resolveEditorScrubTMs(host, opts);
      var rel = scrubPayloadRelation(opts.payload, scrubT);
      statusEl.textContent =
        rel === "backward" || (opts.status === "loading" && rel !== "exact")
          ? t("restoreCheckpointLoading")
          : opts.payload
            ? t("restoreEditorReady")
            : t("restoreEditorEncoding");
    }
  }

  function setRestoreItemsCache(host, items, checkpointTMs, rawItems) {
    if (!host) return;
    host._qlRestoreCheckpointItems = Array.isArray(items) ? items.slice() : [];
    host._qlRestoreCheckpointItemsRaw = Array.isArray(rawItems)
      ? rawItems.slice()
      : host._qlRestoreCheckpointItems.slice();
    host._qlRestoreCheckpointSourceTMs = scrubMsValue(checkpointTMs);
  }

  function restoreItemsForScrub(host, scrubTMs) {
    if (!host) return [];
    var sourceT = host._qlRestoreCheckpointSourceTMs;
    var t = scrubMsValue(scrubTMs);
    var pt = scrubMsValue(sourceT);
    if (pt != null && t != null && t < pt - 500) {
      return host._qlRestoreCheckpointItems || [];
    }
    var raw = host._qlRestoreCheckpointItemsRaw || host._qlRestoreCheckpointItems || [];
    return filterCheckpointItemsForScrub(raw, scrubTMs, sourceT);
  }

  function readStateFromRoot(root) {
    var tEl = root.querySelector("[data-ql-restore-t-ms]");
    var mapEl = root.querySelector("[data-ql-restore-map]");
    var state = {
      t_ms: tEl ? clampInt(tEl.value, 0, 86400000) : 0,
      map: mapEl ? normalizeMapKey(mapEl.value) : "",
      players: [],
      items: [],
    };
    if (!state.map && root._qlRestoreMapFallback) state.map = root._qlRestoreMapFallback;
    state.items = restoreItemsForScrub(root, state.t_ms);

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
        vx: null,
        vy: null,
        vz: null,
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
      ["vx", "vy", "vz"].forEach(function (axis) {
        var el = card.querySelector('[data-ql-restore-vel="' + axis + '"]');
        if (el && String(el.value).trim() !== "") {
          p[axis] = clampInt(el.value, -9999, 9999);
        }
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
    opts = opts || currentBindOpts(root);
    if (!ensureSnapshot(root)) return Promise.resolve(null);
    var statusEl = root.querySelector("[data-ql-restore-encode-status]");
    var state = syncUiFromModel(root, resolveEditorScrubTMs(root, opts));
    if (!state) return Promise.resolve(null);
    if (statusEl) {
      statusEl.textContent = t("restoreEditorEncoding");
      statusEl.classList.remove("error");
    }
    var checkpoint = checkpointFromState(state);
    return global.QLDashboard.postStatsJson("/api/checkpoint/encode", {
      checkpoint: checkpoint,
    })
      .then(function (payload) {
        if (statusEl) {
          statusEl.textContent = t("restoreEditorReady");
          statusEl.classList.remove("error");
        }
        var cfgEl = root.querySelector("[data-ql-restore-cfg]");
        var cfgText = pickCfgText(payload) || buildCfgTextFromState(state);
        if (cfgEl && cfgText) {
          cfgEl.value = cfgText;
          root._qlRestoreLastCfg = cfgText;
          root._qlRestoreCfgDirty = false;
        }
        if (typeof opts.onPayload === "function") opts.onPayload(payload, checkpoint);
        return payload;
      })
      .catch(function (err) {
        if (statusEl) {
          statusEl.textContent = t("restoreEditorReady") + " (" + String(err.message || err) + ")";
          statusEl.classList.add("error");
        }
        return null;
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
      '</span><input type="text" data-ql-restore-sid value="' +
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
      '<div class="ql-restore-vel-row">' +
      '<span class="ql-restore-pos-label">' +
      esc(t("restoreEditorVelocity") || "Velocity") +
      "</span>" +
      ["vx", "vy", "vz"]
        .map(function (axis) {
          var val = player[axis];
          return (
            '<label class="ql-restore-pos-field"><span>' +
            esc(axis.toUpperCase()) +
            '</span><input type="number" step="1" data-ql-restore-vel="' +
            axis +
            '" value="' +
            esc(val != null && val !== "" ? String(val) : "") +
            '" placeholder="0" /></label>'
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

  function renderEditorBody(payload, opts) {
    opts = opts || {};
    var scrubT = resolveEditorScrubTMs(null, opts);
    var map = normalizeMapKey(
      (payload && payload.checkpoint && (payload.checkpoint.map || payload.checkpoint.map_name)) ||
        (opts.archive && opts.archive.map_name) ||
        "",
    );
    var rel = scrubPayloadRelation(payload, scrubT);
    var encodeStatus =
      rel === "backward" || (opts.status === "loading" && rel !== "exact")
        ? t("restoreCheckpointLoading")
        : payload
          ? t("restoreEditorReady")
          : t("restoreEditorEncoding");
    var timeLabel =
      scrubT != null && analytics() ? analytics().formatGameTime(scrubT) : "—";

    return (
      '<div class="ql-restore-shell">' +
      '<div class="ql-restore-editor-body ql-restore-readonly">' +
      '<div class="ql-restore-global">' +
      '<label class="ql-restore-field"><span>' +
      esc(t("restoreEditorMatchTime")) +
      '</span><input type="number" min="0" step="1000" data-ql-restore-t-ms value="' +
      esc(String(scrubT || 0)) +
      '" /><span class="ql-restore-field-hint">' +
      esc(timeLabel) +
      "</span></label>" +
      '<label class="ql-restore-field"><span>' +
      esc(t("restoreCheckpointMap")) +
      '</span><input type="text" data-ql-restore-map value="' +
      esc(map) +
      '" spellcheck="false" /></label>' +
      "</div>" +
      '<div class="ql-restore-players">' +
      '<p class="control-status" data-ql-restore-pending>' +
      esc(t("restoreCheckpointLoading")) +
      "</p>" +
      "</div>" +
      "</div>" +
      '<div class="ql-restore-output">' +
      '<div class="ql-restore-output-head">' +
      "<h4>" +
      esc(t("restoreEditorCfgTitle")) +
      '</h4><span class="ql-restore-cfg-prefix">' +
      esc(t("restoreEditorCfgPrefix")) +
      "</span>" +
      '<span class="control-status ql-restore-encode-status" data-ql-restore-encode-status">' +
      esc(encodeStatus) +
      "</span></div>" +
      '<textarea class="restore-checkpoint-json" data-ql-restore-cfg spellcheck="false" readonly></textarea>' +
      "</div>" +
      '<div class="control-actions restore-checkpoint-actions ql-restore-actions">' +
      '<button type="button" class="control-btn control-btn-sm" data-ql-restore-edit-toggle aria-pressed="false">' +
      esc(t("restoreEditorEdit")) +
      "</button>" +
      '<button type="button" class="control-btn control-btn-sm" data-ql-restore-sync-cfg">' +
      esc(t("restoreEditorSyncFromCfg") || "Sync form from cfg") +
      "</button>" +
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
      "</div></div>"
    );
  }

  function render(opts) {
    opts = opts || {};
    var status = opts.status || "idle";
    var payload = opts.payload;
    var err = opts.error || "";

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
      html += renderEditorBody(payload, opts);
    }
    html += "</section>";
    return html;
  }

  function bindHost(host, opts) {
    if (!host || host.dataset.qlRestoreBound) return;
    host.dataset.qlRestoreBound = "1";
    host._qlRestoreBindOpts = opts;

    function onEdit() {
      if (!host._qlRestoreEditMode) return;
      host._qlRestoreOverrides = readOverridesFromForm(host);
      syncUiFromModel(host, resolveEditorScrubTMs(host, currentBindOpts(host)), {
        editPreview: true,
      });
    }

    host.addEventListener("input", function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      if (t.closest(".ql-restore-editor-body")) onEdit();
    });
    host.addEventListener("change", function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      if (t.closest(".ql-restore-editor-body")) onEdit();
    });
    var cfgEl = host.querySelector("[data-ql-restore-cfg]");
    if (cfgEl && !cfgEl.dataset.qlRestoreCfgBound) {
      cfgEl.dataset.qlRestoreCfgBound = "1";
      cfgEl.addEventListener("input", function () {
        host._qlRestoreCfgDirty = true;
      });
    }

    bindRestoreActions(host);

    if (host.querySelector(".ql-restore-shell") || host.querySelector(".ql-restore-editor-body")) {
      updateScrub(host, opts);
      bindRestoreActions(host);
    }
  }

  function mount(hostEl, opts) {
    if (!hostEl) return;
    delete hostEl.dataset.qlRestoreBound;
    hostEl._qlRestoreSnapshot = null;
    hostEl._qlRestoreEditMode = false;
    hostEl._qlRestoreOverrides = null;
    hostEl._qlRestoreLayoutKey = null;
    hostEl._qlRestoreLastCfg = null;
    opts = opts || {};
    opts = Object.assign({}, opts, { tMs: resolveEditorScrubTMs(hostEl, opts) });
    var cp =
      (opts.payload && opts.payload.checkpoint) || opts.checkpoint || null;
    var tMs = opts.tMs;
    var checkpointT = cp && cp.t_ms != null ? cp.t_ms : null;
    var rawItems =
      opts.refreshPayloadItems && cp && Array.isArray(cp.items)
        ? cp.items.slice()
        : cp && Array.isArray(cp.items) && canClientFilterPayload(opts.payload, tMs)
          ? cp.items.slice()
          : hostEl._qlRestoreCheckpointItemsRaw || [];
    if (opts.refreshPayloadItems && checkpointT != null) {
      hostEl._qlRestoreCheckpointSourceTMs = scrubMsValue(checkpointT);
    }
    hostEl._qlRestoreMapFallback =
      (cp && cp.map) ||
      (opts.archive && opts.archive.map_name) ||
      hostEl._qlRestoreMapFallback ||
      "";
    if (hostEl._qlRestoreMapFallback) {
      hostEl._qlRestoreMapFallback = normalizeMapKey(hostEl._qlRestoreMapFallback);
    }
    setRestoreItemsCache(
      hostEl,
      checkpointItemsForScrub(opts.payload, tMs),
      checkpointT,
      rawItems,
    );
    hostEl.innerHTML = render(opts);
    bindHost(hostEl, opts);
  }

  function remount(hostEl, opts) {
    mount(hostEl, opts);
  }

  global.QLRestoreEditor = {
    render: render,
    mount: mount,
    remount: remount,
    updateScrub: updateScrub,
    updateScrubLight: updateScrubLight,
    commitSnapshot: commitSnapshot,
    previewTimelineMs: previewTimelineMs,
    toggleEditMode: toggleEditMode,
    bindRestoreActions: bindRestoreActions,
    buildEditorState: buildEditorState,
    effectiveEditorState: effectiveEditorState,
    bindHost: bindHost,
    stateFromCheckpoint: stateFromCheckpoint,
    checkpointFromState: checkpointFromState,
    buildCfgTextFromState: buildCfgTextFromState,
    parseCfgTextToDraft: parseCfgTextToDraft,
    editorStateFromCfgText: editorStateFromCfgText,
    syncFormFromCfg: syncFormFromCfg,
    pickCfgText: pickCfgText,
    LOADOUT_WEAPONS: LOADOUT_WEAPONS,
    AMMO_KEYS: AMMO_KEYS,
  };
})(typeof window !== "undefined" ? window : globalThis);
