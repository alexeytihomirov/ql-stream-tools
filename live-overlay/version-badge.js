(function () {
  "use strict";

  function qs(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function debugEnabled() {
    var v = (qs("debug") || "").toLowerCase();
    return v === "1" || v === "true" || v === "yes";
  }

  if (!debugEnabled()) {
    return;
  }

  function render(info) {
    var el = document.createElement("div");
    el.id = "version-badge";
    el.style.cssText =
      "position:fixed;right:4px;bottom:4px;z-index:99999;" +
      "font:11px monospace;color:#bbb;background:rgba(0,0,0,0.5);" +
      "padding:2px 6px;border-radius:3px;pointer-events:none;";
    el.textContent = "ov " + (info.sha || "dev");
    if (info.deployed_at) {
      el.title = info.deployed_at;
    }
    document.body.appendChild(el);
  }

  fetch("version.json?t=" + Date.now())
    .then(function (r) {
      return r.ok ? r.json() : { sha: null, deployed_at: null };
    })
    .then(render)
    .catch(function () {
      render({ sha: null, deployed_at: null });
    });
})();
