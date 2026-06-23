(function () {
  "use strict";

  function hubOrigin() {
    var base = new URLSearchParams(window.location.search).get("base") || "";
    if (!base) return "";
    try {
      return new URL(base).origin;
    } catch (_e) {
      return "";
    }
  }

  function pageAssetsRoot() {
    var loc = window.location;
    if (loc.protocol === "file:") return "";
    var path = loc.pathname || "";
    if (path.indexOf("/live-overlay/") >= 0) {
      return (
        loc.origin +
        path.slice(0, path.indexOf("/live-overlay/") + "/live-overlay".length)
      );
    }
    if (loc.port === "8787") {
      return loc.origin + "/live-overlay";
    }
    return "";
  }

  var params = new URLSearchParams(window.location.search);
  var hub = hubOrigin();
  var assets = (params.get("assets") || "").trim();
  if (assets && hub) {
    try {
      if (new URL(assets).origin === hub) {
        params.delete("assets");
        assets = "";
      }
    } catch (_e2) {
      params.delete("assets");
      assets = "";
    }
  }

  var pageRoot = pageAssetsRoot();
  if (!assets && pageRoot) {
    params.set("assets", pageRoot);
  }

  var nextQuery = params.toString();
  var next =
    window.location.pathname + (nextQuery ? "?" + nextQuery : "") + window.location.hash;
  if (next !== window.location.pathname + window.location.search + window.location.hash) {
    window.history.replaceState(null, "", next);
  }
})();
