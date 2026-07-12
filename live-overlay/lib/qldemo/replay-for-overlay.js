/** Steam IDs for overlay replay (filters by steam_id64). Prefer roster `st` from demo configstrings. */

const DEMO_STEAM_BASE = 76561197960265700n;

export function demoSteamId(clientNum) {
  return String(DEMO_STEAM_BASE + BigInt(clientNum == null ? 0 : clientNum));
}

export function rosterSteamId(row, clientNum) {
  const st = row?.steam_id64 ?? row?.st;
  if (st != null && String(st).trim().length >= 16) {
    return String(st).trim().split(".", 1)[0];
  }
  return demoSteamId(clientNum);
}

/** Overlay replay player uses wall `t` for seek; demo replay-v2 uses game_time_ms as canonical clock. */
function overlayEvent(ev, cnToSteam, povClientNum, nickByCn) {
  const out = Object.assign({}, ev, { match_id: "demo-local" });
  const gameMs = out.game_time_ms != null ? out.game_time_ms : out.t;
  if (gameMs != null && out.t == null) out.t = gameMs;
  if (gameMs != null && out.game_time_ms == null) out.game_time_ms = gameMs;

  if (ev.event === "positions") {
    out.players = (ev.players || []).map((p) => {
      const isPov = povClientNum != null && p.clientNum === povClientNum;
      return Object.assign({}, p, {
        steam_id64: cnToSteam.get(p.clientNum) ?? demoSteamId(p.clientNum),
        nickname: p.nickname || "player" + p.clientNum,
        team: isPov ? "1" : "2",
      });
    });
    return out;
  }

  if (ev.event === "pickup") {
    const pickerCn = ev.clientNum ?? povClientNum;
    const sid = pickerCn != null ? cnToSteam.get(pickerCn) ?? demoSteamId(pickerCn) : null;
    out.steam_id64 = ev.steam_id64 || sid;
    out.nickname = ev.nickname || nickByCn.get(pickerCn) || undefined;
    out.time = gameMs;
    out.respawn_sec = ev.respawn_sec;
    return out;
  }

  return out;
}

export function replayForOverlay(replay) {
  const cnToSteam = new Map();
  const nickByCn = new Map();
  const povClientNum = replay.meta?.pov_client_num ?? null;
  for (const row of replay.meta?.roster || []) {
    cnToSteam.set(row.clientNum, rosterSteamId(row, row.clientNum));
    if (row.name) nickByCn.set(row.clientNum, row.name);
  }
  const events = (replay.events || []).map((ev) => overlayEvent(ev, cnToSteam, povClientNum, nickByCn));
  const pos = events.filter((e) => e.event === "positions");
  const lastT = pos.length ? pos[pos.length - 1].t : 0;
  const lastGame = pos.length ? pos[pos.length - 1].game_time_ms : 0;
  const durationMs = Math.max(
    Number(replay.meta?.duration_wall_ms) || 0,
    Number(lastT) || 0,
    Number(lastGame) || 0,
  );
  const meta = Object.assign({}, replay.meta || {}, {
    started_at: 0,
    duration_ms: durationMs,
    source: "demo",
    pov_steam_id64: povClientNum != null ? cnToSteam.get(povClientNum) : null,
  });
  return {
    meta,
    events,
    match_id: "demo-local",
    source: "qldemo",
  };
}

export function archiveFromDemoReplay(replay) {
  const meta = replay.meta || {};
  const povClientNum = meta.pov_client_num ?? null;
  const countdownLeadMs = Number(meta.countdown_lead_ms) || 0;
  const pos = (replay.events || []).filter((e) => e.event === "positions");
  const maxGame = pos.length ? pos[pos.length - 1].game_time_ms : 0;
  const pickups = (replay.events || [])
    .filter((e) => e.event === "pickup" && Number(e.game_time_ms) >= 0)
    .map((p) => ({
      game_time_ms: p.game_time_ms,
      item: p.item,
      x: p.x,
      y: p.y,
      z: p.z,
      nickname: p.nickname,
      steam_id64:
        p.steam_id64 ||
        (p.clientNum != null && meta.roster
          ? rosterSteamId(
              meta.roster.find((r) => r.clientNum === p.clientNum),
              p.clientNum,
            )
          : null),
    }));
  const deaths = (replay.events || [])
    .filter((e) => e.event === "death" && Number(e.game_time_ms) >= 0)
    .map((d) => ({
      game_time_ms: d.game_time_ms,
      victim: d.victim_name,
      victim_steam_id64: d.victim_steam_id64,
      killer: d.killer_name,
      killer_steam_id64: d.killer_steam_id64,
      weapon: d.weapon,
      x: d.x,
      y: d.y,
      z: d.z,
    }));
  const deathCountBySteamId = new Map();
  for (const d of deaths) {
    if (!d.victim_steam_id64) continue;
    deathCountBySteamId.set(d.victim_steam_id64, (deathCountBySteamId.get(d.victim_steam_id64) || 0) + 1);
  }
  const scoreUpdates = meta.score_updates || [];
  const finalScore = scoreUpdates.length ? scoreUpdates[scoreUpdates.length - 1] : null;
  const players = (meta.roster || []).map((r) => {
    const score =
      finalScore?.byClient?.[r.clientNum] != null ? Number(finalScore.byClient[r.clientNum]) : 0;
    const steamId = rosterSteamId(r, r.clientNum);
    return {
      nickname: r.name,
      steam_id64: steamId,
      clientNum: r.clientNum,
      team: r.clientNum === povClientNum ? "1" : "2",
      score,
      kills: score,
      deaths: deathCountBySteamId.get(steamId) || 0,
    };
  });
  const markers = [];
  if (countdownLeadMs > 0) {
    markers.push({ kind: "countdown_start", ts: 0, game_time_ms: -countdownLeadMs });
  }
  markers.push({ kind: "match_start", ts: countdownLeadMs, game_time_ms: 0 });
  return {
    map_name: meta.map_name,
    gametype: meta.gametype,
    status: "ended",
    players,
    pickups,
    deaths,
    accuracy_summary: [],
    accuracy_timeline: [],
    timeline_max_ms: maxGame,
    duration_ms: meta.duration_wall_ms ?? maxGame,
    markers,
    demo_summary: {
      snapshots: meta.snapshot_count,
      pickups: pickups.length,
      projectile_frames: meta.projectile_frames,
      impact_frames: meta.impact_frames,
      beam_frames: meta.beam_frames,
      deaths: deaths.length,
      countdown_lead_ms: countdownLeadMs,
      score_updates: scoreUpdates.length,
      obituary_available: true,
      errors: meta.errors || [],
    },
  };
}
