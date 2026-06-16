(function (global) {
  "use strict";

  var transformsPromise = null;
  var transformsCache = null;

  function assetUrl(relative) {
    return new URL(relative, window.location.href).href;
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
    prepareMapPayload: prepareMapPayload,
    resolveImageUrl: resolveImageUrl,
    assetUrl: assetUrl,
  };
})(window);
