/**
 * P2Less embeddable chat widget. Vanilla JS, no dependencies, self-contained
 * styles (namespaced to avoid colliding with the host page's own CSS).
 *
 * Usage:
 *   <script src="https://<your-p2less-host>/widget.js" data-key="wk_..."
 *     data-name="Riverside Academy" data-initials="RA" data-color="#1e40af"></script>
 * The three branding attributes are optional but recommended — each org's
 * dashboard generates its own snippet with them pre-filled, so the bubble
 * shows THAT org's mark and color instead of a generic P2Less icon. Falls
 * back to sensible defaults if omitted (a bare `data-key` still works).
 *
 * Universal Platform roadmap Phase 8e (2026-08-20).
 */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;
  var key = script.getAttribute("data-key");
  if (!key) {
    console.warn("[p2less widget] missing data-key attribute — the widget will not start.");
    return;
  }
  var origin = new URL(script.src).origin;
  var apiUrl = origin + "/api/channels/widget";

  var orgName = script.getAttribute("data-name") || "";
  var orgInitials = (script.getAttribute("data-initials") || "").slice(0, 3);
  var orgColor = /^#[0-9a-fA-F]{3,8}$/.test(script.getAttribute("data-color") || "") ? script.getAttribute("data-color") : "";
  var brandColor = orgColor || "#0d9488";

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var SESSION_STORAGE_KEY = "p2less_widget_session";
  var sessionId = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!sessionId) {
    sessionId = "w_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  }

  // Widget's default teal, expressed as r,g,b so the presence-pulse ring can
  // fade the SAME color out via rgba() — an org's own brandColor gets the
  // identical treatment via hexToRgb() below.
  function hexToRgb(hex) {
    var h = hex.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n) || h.length < 6) return "13,148,136";
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(",");
  }
  var brandRgb = hexToRgb(brandColor);

  var style = document.createElement("style");
  style.textContent = [
    ".p2l-bubble{position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;background:" + brandColor + ";color:#fff;border:none;box-shadow:0 4px 16px rgba(0,0,0,.2);cursor:pointer;z-index:2147483000;font-size:22px;font-weight:600;display:flex;align-items:center;justify-content:center;letter-spacing:.02em;}",
    ".p2l-panel{position:fixed;bottom:88px;right:20px;width:340px;max-width:calc(100vw - 40px);height:460px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.25);z-index:2147483000;display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,Segoe UI,Roboto,sans-serif;}",
    ".p2l-panel.p2l-open{display:flex;}",
    ".p2l-header{background:" + brandColor + ";color:#fff;padding:12px 16px;font-size:14px;font-weight:600;display:flex;justify-content:space-between;align-items:center;}",
    ".p2l-close{background:none;border:none;color:#fff;font-size:18px;cursor:pointer;line-height:1;}",
    ".p2l-messages{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f5f5fa;}",
    ".p2l-msg{max-width:80%;padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.4;white-space:pre-wrap;word-break:break-word;}",
    ".p2l-msg-out{align-self:flex-end;background:" + brandColor + ";color:#fff;border-bottom-right-radius:4px;}",
    ".p2l-msg-in{align-self:flex-start;background:#fff;color:#12131f;border:1px solid #e6e6f0;border-bottom-left-radius:4px;animation:p2l-msg-in .25s ease-out;}",
    ".p2l-msg img{max-width:100%;border-radius:8px;margin-top:4px;display:block;}",
    ".p2l-inputrow{display:flex;gap:6px;padding:10px;border-top:1px solid #e6e6f0;background:#fff;}",
    ".p2l-input{flex:1;border:1px solid #e6e6f0;border-radius:20px;padding:8px 14px;font-size:13px;outline:none;}",
    ".p2l-send{background:" + brandColor + ";color:#fff;border:none;border-radius:50%;width:34px;height:34px;cursor:pointer;font-size:14px;flex-shrink:0;}",
    ".p2l-send:disabled{opacity:.5;cursor:default;}",
    ".p2l-typing{align-self:flex-start;background:#fff;border:1px solid #e6e6f0;border-radius:12px;border-bottom-left-radius:4px;padding:10px 14px;display:flex;gap:4px;}",
    ".p2l-typing span{width:6px;height:6px;border-radius:50%;background:#9395a8;animation:p2l-bounce 1.2s infinite ease-in-out;}",
    ".p2l-typing span:nth-child(2){animation-delay:.15s;}",
    ".p2l-typing span:nth-child(3){animation-delay:.3s;}",
    "@keyframes p2l-bounce{0%,60%,100%{transform:translateY(0);opacity:.5;}30%{transform:translateY(-4px);opacity:1;}}",
    "@keyframes p2l-msg-in{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}",
    // Presence pulse — a soft repeating ring while the panel is closed, so the
    // bubble reads as "alive" rather than a static icon sitting on the page.
    ".p2l-bubble.p2l-pulse{animation:p2l-pulse-ring 2.6s infinite;}",
    "@keyframes p2l-pulse-ring{0%{box-shadow:0 4px 16px rgba(0,0,0,.2),0 0 0 0 rgba(" + brandRgb + ",.55);}70%{box-shadow:0 4px 16px rgba(0,0,0,.2),0 0 0 12px rgba(" + brandRgb + ",0);}100%{box-shadow:0 4px 16px rgba(0,0,0,.2),0 0 0 0 rgba(" + brandRgb + ",0);}}",
    // One-time attention nudge shortly after load (if still closed) — the
    // "swing" the widget didn't have before, separate from the constant pulse.
    ".p2l-bubble.p2l-wiggle{animation:p2l-wiggle .8s ease-in-out;}",
    "@keyframes p2l-wiggle{0%,100%{transform:rotate(0deg) scale(1);}20%{transform:rotate(-12deg) scale(1.06);}40%{transform:rotate(10deg) scale(1.06);}60%{transform:rotate(-7deg) scale(1.02);}80%{transform:rotate(4deg) scale(1);}}",
    "@media (prefers-reduced-motion: reduce){.p2l-bubble.p2l-pulse,.p2l-bubble.p2l-wiggle,.p2l-msg-in{animation:none!important;}}",
  ].join("\n");
  document.head.appendChild(style);

  var bubble = document.createElement("button");
  bubble.className = "p2l-bubble" + (reduceMotion ? "" : " p2l-pulse");
  bubble.setAttribute("aria-label", orgName ? "Open chat with " + orgName : "Open chat");
  bubble.textContent = orgInitials || "💬"; // this org's own mark, not a generic icon — the whole point of branding

  var panel = document.createElement("div");
  panel.className = "p2l-panel";
  var headerLabel = orgName ? "Chat with " + orgName : "Chat with us";
  panel.innerHTML =
    '<div class="p2l-header"><span></span><button class="p2l-close" aria-label="Close chat">×</button></div>' +
    '<div class="p2l-messages"></div>' +
    '<div class="p2l-inputrow">' +
    '<input class="p2l-input" type="text" placeholder="Type a message…" />' +
    '<button class="p2l-send" aria-label="Send">➤</button>' +
    "</div>";
  panel.querySelector(".p2l-header span").textContent = headerLabel; // textContent, not innerHTML — orgName is untrusted page data

  document.body.appendChild(bubble);
  document.body.appendChild(panel);

  var messagesEl = panel.querySelector(".p2l-messages");
  var inputEl = panel.querySelector(".p2l-input");
  var sendBtn = panel.querySelector(".p2l-send");
  var closeBtn = panel.querySelector(".p2l-close");

  // Reveals incoming text progressively rather than popping in as one whole
  // block — reads as "being composed" the way the typing dots already imply.
  // Total reveal time is capped regardless of length so a long AI reply never
  // takes noticeably longer to finish appearing than a short one.
  function revealWords(el, text) {
    if (reduceMotion) { el.textContent = text; messagesEl.scrollTop = messagesEl.scrollHeight; return; }
    var tokens = text.split(/(\s+)/); // keep whitespace tokens so spacing is exact
    var i = 0;
    var maxTotalMs = 700;
    var stepMs = Math.max(10, Math.min(45, maxTotalMs / Math.max(1, tokens.length)));
    (function tick() {
      if (i >= tokens.length) return;
      el.textContent += tokens[i];
      i++;
      messagesEl.scrollTop = messagesEl.scrollHeight;
      setTimeout(tick, stepMs);
    })();
  }

  function addMessage(text, direction) {
    var el = document.createElement("div");
    el.className = "p2l-msg " + (direction === "out" ? "p2l-msg-out" : "p2l-msg-in");
    messagesEl.appendChild(el);
    if (direction === "out") {
      el.textContent = text; // the user's own message — no need to animate what they just typed
    } else {
      revealWords(el, text);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function addImage(url) {
    var img = document.createElement("img");
    img.src = url;
    var wrap = document.createElement("div");
    wrap.className = "p2l-msg p2l-msg-in";
    wrap.appendChild(img);
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  var typingEl = null;
  function showTyping() {
    if (typingEl) return;
    typingEl = document.createElement("div");
    typingEl.className = "p2l-typing";
    typingEl.innerHTML = "<span></span><span></span><span></span>";
    messagesEl.appendChild(typingEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function hideTyping() {
    if (!typingEl) return;
    typingEl.remove();
    typingEl = null;
  }

  // A short synthesized "pop" — no audio file to host/fetch, generated with
  // the Web Audio API so the widget stays a single dependency-free script.
  // Lazily created (first real use always follows a user gesture — sending a
  // message — so this never runs into autoplay-blocking).
  var audioCtx = null;
  function playNotifySound() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var ctx = audioCtx;
      var now = ctx.currentTime;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(660, now + 0.12);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.16, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    } catch (e) {
      // Audio blocked/unsupported in this browser — never let a chime failure affect the chat itself.
    }
  }

  var open = false;
  function toggle() {
    open = !open;
    panel.classList.toggle("p2l-open", open);
    bubble.classList.toggle("p2l-pulse", !open && !reduceMotion);
    if (open) { inputEl.focus(); bubble.classList.remove("p2l-wiggle"); }
  }
  bubble.addEventListener("click", toggle);
  closeBtn.addEventListener("click", toggle);

  // One-time "look at me" nudge per browser session (sessionStorage, not
  // localStorage — a fresh visit later still gets one, but it won't replay on
  // every page navigation within the same session) if the visitor hasn't
  // opened the widget within the first few seconds on the page.
  if (!reduceMotion && !sessionStorage.getItem("p2less_widget_greeted_session")) {
    sessionStorage.setItem("p2less_widget_greeted_session", "1");
    setTimeout(function () {
      if (!open) {
        bubble.classList.add("p2l-wiggle");
        setTimeout(function () { bubble.classList.remove("p2l-wiggle"); }, 820);
      }
    }, 2500);
  }

  var sending = false;
  function send() {
    var text = inputEl.value.trim();
    if (!text || sending) return;
    addMessage(text, "out");
    inputEl.value = "";
    sending = true;
    sendBtn.disabled = true;
    showTyping();

    fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ widgetKey: key, sessionId: sessionId, text: text }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        hideTyping();
        if (!data.ok) {
          addMessage("Sorry, something went wrong. Please try again.", "in");
          return;
        }
        var replies = data.replies || [];
        if (replies.length > 0) playNotifySound();
        replies.forEach(function (reply) {
          if (reply.body) addMessage(reply.body, "in");
          if (reply.image && reply.image.url) addImage(reply.image.url);
        });
      })
      .catch(function () {
        hideTyping();
        addMessage("Sorry, we couldn't reach the server. Please check your connection and try again.", "in");
      })
      .finally(function () {
        sending = false;
        sendBtn.disabled = false;
      });
  }
  sendBtn.addEventListener("click", send);
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") send();
  });
})();
