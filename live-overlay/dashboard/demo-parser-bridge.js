async function loadModules() {
  const v = "20260712b";
  const qldemo = await import(`../lib/qldemo/index.js?v=${v}`);
  const overlayHelpers = await import(`../lib/qldemo/replay-for-overlay.js?v=${v}`);
  const mapResolve = await import(`../lib/qldemo/map-item-resolve.js?v=${v}`);
  return {
    parseDemoBuffer: qldemo.parseDemoBuffer,
    demoToReplay: qldemo.demoToReplay,
    replaySummary: qldemo.replaySummary,
    replayForOverlay: overlayHelpers.replayForOverlay,
    archiveFromDemoReplay: overlayHelpers.archiveFromDemoReplay,
    filterPickupEntities: mapResolve.filterPickupEntities,
    normalizeMapKey: mapResolve.normalizeMapKey,
  };
}

loadModules()
  .then(function (api) {
    window.QLDemo = api;
    window.dispatchEvent(new CustomEvent("qldemo-ready"));
  })
  .catch(function (err) {
    window.QLDemoLoadError = err;
    window.dispatchEvent(new CustomEvent("qldemo-error", { detail: err }));
    console.error("QLDemo module load failed:", err);
  });
