(function (global) {
  "use strict";

  var transformsPromise = null;
  var transformsCache = null;
  var DEFAULT_CDN_ASSETS =
    "https://cdn.jsdelivr.net/gh/alexeytihomirov/ql-stream-tools@main/live-overlay/";

  function trimSlash(url) {
    return String(url || "").replace(/\/+$/, "");
  }

  function withTrailingSlash(url) {
    var t = trimSlash(url);
    return t ? t + "/" : "";
  }

  function statsHubOriginFromQuery() {
    var params = new URLSearchParams(window.location.search);
    var base = (params.get("base") || "").trim();
    if (!base) return "";
    try {
      return new URL(base).origin;
    } catch (_e) {
      return "";
    }
  }

  function urlOrigin(value) {
    try {
      return new URL(value).origin;
    } catch (_e2) {
      return "";
    }
  }

  function sanitizeAssetsRoot(raw, hubOrigin) {
    if (!raw) return "";
    var root = withTrailingSlash(raw);
    var origin = urlOrigin(root);
    if (!origin) return "";
    if (hubOrigin && origin === hubOrigin) return "";
    return root;
  }

  function assetsFromControlSettings() {
    try {
      var raw = localStorage.getItem("ql-control-settings");
      if (!raw) return "";
      var parsed = JSON.parse(raw);
      if (parsed && parsed.assetsBase) {
        return sanitizeAssetsRoot(parsed.assetsBase, statsHubOriginFromQuery());
      }
    } catch (_e3) {
      /* ignore */
    }
    return "";
  }

  function pageOverlayAssetsRoot() {
    if (window.location.protocol === "file:") {
      return "";
    }
    var path = window.location.pathname || "";
    var marker = "/live-overlay/";
    var idx = path.indexOf(marker);
    if (idx >= 0) {
      // Always resolve to the live-overlay root, not the current subdirectory,
      // so the embedded dashboard (/live-overlay/dashboard/) finds map assets.
      return window.location.origin + path.slice(0, idx + marker.length);
    }
    if (window.location.port === "8787") {
      return window.location.origin + "/live-overlay/";
    }
    return "";
  }

  function overlayAssetsRoot() {
    var hubOrigin = statsHubOriginFromQuery();
    var params = new URLSearchParams(window.location.search);
    var pageRoot = pageOverlayAssetsRoot();

    if (pageRoot) {
      var explicitOnPage = sanitizeAssetsRoot(params.get("assets"), hubOrigin);
      if (explicitOnPage && explicitOnPage !== pageRoot) {
        return explicitOnPage;
      }
      return pageRoot;
    }

    var explicit = sanitizeAssetsRoot(params.get("assets"), hubOrigin);
    if (explicit) {
      return explicit;
    }

    var fromControl = assetsFromControlSettings();
    if (fromControl) {
      return fromControl;
    }

    if (window.location.protocol === "file:") {
      return DEFAULT_CDN_ASSETS;
    }

    if (hubOrigin && window.location.origin === hubOrigin) {
      return DEFAULT_CDN_ASSETS;
    }

    return DEFAULT_CDN_ASSETS;
  }

  function assetUrl(relative) {
    return new URL(relative, overlayAssetsRoot()).href;
  }

  function loadTransforms() {
    if (transformsCache) {
      return Promise.resolve(transformsCache);
    }
    if (!transformsPromise) {
      transformsPromise = fetch(assetUrl("maps/map_transforms.json"), { cache: "no-store" })
        .then(function (res) {
          if (!res.ok) {
            throw new Error("map transforms HTTP " + res.status);
          }
          return res.json();
        })
        .then(function (data) {
          transformsCache = (data && data.maps) || {};
          return transformsCache;
        });
    }
    return transformsPromise;
  }

  function getTransform(maps, mapName) {
    if (!maps) {
      return null;
    }
    var key = (mapName || "").trim().toLowerCase();
    var row = maps[key] || maps._default;
    if (!row) {
      return null;
    }
    return {
      map_name: key || "_default",
      image_url: row.image_url || "maps/placeholder.png",
      world_min_x: Number(row.world_min_x),
      world_max_x: Number(row.world_max_x),
      world_min_y: Number(row.world_min_y),
      world_max_y: Number(row.world_max_y),
      world_z_span: row.world_z_span != null ? Number(row.world_z_span) : null,
      image_width: Number(row.image_width || 512),
      image_height: Number(row.image_height || 512),
    };
  }

  function worldToPixel(transform, x, y) {
    var spanX = transform.world_max_x - transform.world_min_x;
    var spanY = transform.world_max_y - transform.world_min_y;
    if (spanX <= 0 || spanY <= 0) {
      return { x: transform.image_width / 2, y: transform.image_height / 2 };
    }
    return {
      x: Math.round(((x - transform.world_min_x) / spanX) * transform.image_width * 100) / 100,
      y:
        Math.round(
          (transform.image_height -
            ((y - transform.world_min_y) / spanY) * transform.image_height) *
            100
        ) / 100,
    };
  }

  function pixelToWorld(transform, px, py) {
    var spanX = transform.world_max_x - transform.world_min_x;
    var spanY = transform.world_max_y - transform.world_min_y;
    if (spanX <= 0 || spanY <= 0) {
      return { x: transform.world_min_x, y: transform.world_min_y };
    }
    return {
      x: Math.round((transform.world_min_x + (px / transform.image_width) * spanX) * 100) / 100,
      y:
        Math.round(
          (transform.world_min_y +
            ((transform.image_height - py) / transform.image_height) * spanY) *
            100
        ) / 100,
    };
  }

  function transformSnippet(mapName, transform) {
    if (!transform) {
      return "";
    }
    var key = (mapName || "_default").trim().toLowerCase() || "_default";
    return (
      '    "' +
      key +
      '": {\n' +
      '      "image_url": "' +
      (transform.image_url || "maps/placeholder.png") +
      '",\n' +
      '      "world_min_x": ' +
      transform.world_min_x +
      ",\n" +
      '      "world_max_x": ' +
      transform.world_max_x +
      ",\n" +
      '      "world_min_y": ' +
      transform.world_min_y +
      ",\n" +
      '      "world_max_y": ' +
      transform.world_max_y +
      ",\n" +
      '      "image_width": ' +
      transform.image_width +
      ",\n" +
      '      "image_height": ' +
      transform.image_height +
      "\n" +
      "    }"
    );
  }

  function imageDisplayRect(container, imageWidth, imageHeight) {
    var cw = container.clientWidth || 512;
    var ch = container.clientHeight || 512;
    var iw = imageWidth || 512;
    var ih = imageHeight || 512;
    var scale = Math.min(cw / iw, ch / ih);
    var dw = iw * scale;
    var dh = ih * scale;
    return {
      offsetX: (cw - dw) / 2,
      offsetY: (ch - dh) / 2,
      scale: scale,
      width: dw,
      height: dh,
      imageWidth: iw,
      imageHeight: ih,
    };
  }

  function pixelToDisplay(rect, pixel) {
    return {
      x: rect.offsetX + pixel.x * rect.scale,
      y: rect.offsetY + pixel.y * rect.scale,
    };
  }

  function displayToPixel(rect, displayX, displayY) {
    return {
      x: (displayX - rect.offsetX) / rect.scale,
      y: (displayY - rect.offsetY) / rect.scale,
    };
  }

  function fromCenter(centerX, centerY, spanX, spanY, imageWidth, imageHeight, imageUrl, mapName) {
    return {
      map_name: mapName,
      image_url: imageUrl || "maps/placeholder.png",
      world_min_x: centerX - spanX / 2,
      world_max_x: centerX + spanX / 2,
      world_min_y: centerY - spanY / 2,
      world_max_y: centerY + spanY / 2,
      image_width: imageWidth || 512,
      image_height: imageHeight || 512,
    };
  }

  function toCenter(transform) {
    if (!transform) {
      return { center_x: 0, center_y: 0, span_x: 8192, span_y: 8192 };
    }
    return {
      center_x: (transform.world_min_x + transform.world_max_x) / 2,
      center_y: (transform.world_min_y + transform.world_max_y) / 2,
      span_x: transform.world_max_x - transform.world_min_x,
      span_y: transform.world_max_y - transform.world_min_y,
    };
  }

  function resolveImageUrl(transform) {
    if (!transform || !transform.image_url) {
      return "";
    }
    var url = transform.image_url;
    if (url.indexOf("http://") === 0 || url.indexOf("https://") === 0) {
      return url;
    }
    return assetUrl(url);
  }

  function prepareMapPayload(mapName, players) {
    return loadTransforms().then(function (maps) {
      var transform = getTransform(maps, mapName);
      var rows = [];
      for (var i = 0; i < (players || []).length; i++) {
        var p = Object.assign({}, players[i]);
        if (transform && p.x != null && p.y != null) {
          p.pixel = worldToPixel(transform, Number(p.x), Number(p.y));
          if (p.yaw != null) {
            var rad = (Number(p.yaw) * Math.PI) / 180;
            p.view_dx = Math.round(Math.cos(rad) * 10000) / 10000;
            p.view_dy = Math.round(Math.sin(rad) * 10000) / 10000;
          }
        }
        rows.push(p);
      }
      return {
        map_name: mapName,
        transform: transform,
        players: rows,
      };
    });
  }

  global.MapCoords = {
    loadTransforms: loadTransforms,
    getTransform: getTransform,
    worldToPixel: worldToPixel,
    pixelToWorld: pixelToWorld,
    transformSnippet: transformSnippet,
    fromCenter: fromCenter,
    toCenter: toCenter,
    imageDisplayRect: imageDisplayRect,
    pixelToDisplay: pixelToDisplay,
    displayToPixel: displayToPixel,
    prepareMapPayload: prepareMapPayload,
    resolveImageUrl: resolveImageUrl,
    assetUrl: assetUrl,
    overlayAssetsRoot: overlayAssetsRoot,
    defaultCdnAssets: function () {
      return DEFAULT_CDN_ASSETS;
    },
  };
})(window);
