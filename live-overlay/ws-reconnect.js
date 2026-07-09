(function (global) {
  "use strict";

  function connectLiveWs(urlOrFn, opts) {
    opts = opts || {};
    var backoffMs = opts.backoffMs || 2500;
    var state = { ws: null, timer: null, closed: false };

    function resolveUrl() {
      return typeof urlOrFn === "function" ? urlOrFn() : urlOrFn;
    }

    function scheduleReconnect() {
      if (state.closed || opts.autoReconnect === false) return;
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(connect, backoffMs);
    }

    function connect() {
      if (state.ws) {
        state.ws.onclose = null;
        state.ws.close();
        state.ws = null;
      }
      var ws = new WebSocket(resolveUrl());
      state.ws = ws;
      ws.onopen = function (ev) {
        if (opts.onOpen) opts.onOpen(ev);
      };
      ws.onmessage = function (ev) {
        if (opts.onMessage) opts.onMessage(ev);
      };
      ws.onclose = function (ev) {
        if (opts.onClose) opts.onClose(ev);
        scheduleReconnect();
      };
      ws.onerror = function () {
        if (ws) ws.close();
      };
    }

    connect();

    return {
      close: function () {
        state.closed = true;
        if (state.timer) clearTimeout(state.timer);
        if (state.ws) {
          state.ws.onclose = null;
          state.ws.close();
          state.ws = null;
        }
      },
      reconnectNow: function () {
        if (state.timer) clearTimeout(state.timer);
        connect();
      },
    };
  }

  global.QLLiveWs = { connect: connectLiveWs };
})(typeof window !== "undefined" ? window : globalThis);
