/**
 * P2Less embeddable chat widget. Vanilla JS, no dependencies, self-contained
 * styles (namespaced to avoid colliding with the host page's own CSS).
 *
 * Usage:
 *   <script src="https://<your-p2less-host>/widget.js" data-key="wk_..."></script>
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

  var SESSION_STORAGE_KEY = "p2less_widget_session";
  var sessionId = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!sessionId) {
    sessionId = "w_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  }

  var style = document.createElement("style");
  style.textContent = [
    ".p2l-bubble{position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;background:#0d9488;color:#fff;border:none;box-shadow:0 4px 16px rgba(0,0,0,.2);cursor:pointer;z-index:2147483000;font-size:24px;display:flex;align-items:center;justify-content:center;}",
    ".p2l-panel{position:fixed;bottom:88px;right:20px;width:340px;max-width:calc(100vw - 40px);height:460px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.25);z-index:2147483000;display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,Segoe UI,Roboto,sans-serif;}",
    ".p2l-panel.p2l-open{display:flex;}",
    ".p2l-header{background:#0d9488;color:#fff;padding:12px 16px;font-size:14px;font-weight:600;display:flex;justify-content:space-between;align-items:center;}",
    ".p2l-close{background:none;border:none;color:#fff;font-size:18px;cursor:pointer;line-height:1;}",
    ".p2l-messages{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f5f5fa;}",
    ".p2l-msg{max-width:80%;padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.4;white-space:pre-wrap;word-break:break-word;}",
    ".p2l-msg-out{align-self:flex-end;background:#0d9488;color:#fff;border-bottom-right-radius:4px;}",
    ".p2l-msg-in{align-self:flex-start;background:#fff;color:#12131f;border:1px solid #e6e6f0;border-bottom-left-radius:4px;}",
    ".p2l-msg img{max-width:100%;border-radius:8px;margin-top:4px;display:block;}",
    ".p2l-inputrow{display:flex;gap:6px;padding:10px;border-top:1px solid #e6e6f0;background:#fff;}",
    ".p2l-input{flex:1;border:1px solid #e6e6f0;border-radius:20px;padding:8px 14px;font-size:13px;outline:none;}",
    ".p2l-send{background:#0d9488;color:#fff;border:none;border-radius:50%;width:34px;height:34px;cursor:pointer;font-size:14px;flex-shrink:0;}",
    ".p2l-send:disabled{opacity:.5;cursor:default;}",
    ".p2l-typing{align-self:flex-start;background:#fff;border:1px solid #e6e6f0;border-radius:12px;border-bottom-left-radius:4px;padding:10px 14px;display:flex;gap:4px;}",
    ".p2l-typing span{width:6px;height:6px;border-radius:50%;background:#9395a8;animation:p2l-bounce 1.2s infinite ease-in-out;}",
    ".p2l-typing span:nth-child(2){animation-delay:.15s;}",
    ".p2l-typing span:nth-child(3){animation-delay:.3s;}",
    "@keyframes p2l-bounce{0%,60%,100%{transform:translateY(0);opacity:.5;}30%{transform:translateY(-4px);opacity:1;}}",
  ].join("\n");
  document.head.appendChild(style);

  var bubble = document.createElement("button");
  bubble.className = "p2l-bubble";
  bubble.setAttribute("aria-label", "Open chat");
  bubble.textContent = "💬";

  var panel = document.createElement("div");
  panel.className = "p2l-panel";
  panel.innerHTML =
    '<div class="p2l-header"><span>Chat with us</span><button class="p2l-close" aria-label="Close chat">×</button></div>' +
    '<div class="p2l-messages"></div>' +
    '<div class="p2l-inputrow">' +
    '<input class="p2l-input" type="text" placeholder="Type a message…" />' +
    '<button class="p2l-send" aria-label="Send">➤</button>' +
    "</div>";

  document.body.appendChild(bubble);
  document.body.appendChild(panel);

  var messagesEl = panel.querySelector(".p2l-messages");
  var inputEl = panel.querySelector(".p2l-input");
  var sendBtn = panel.querySelector(".p2l-send");
  var closeBtn = panel.querySelector(".p2l-close");

  function addMessage(text, direction) {
    var el = document.createElement("div");
    el.className = "p2l-msg " + (direction === "out" ? "p2l-msg-out" : "p2l-msg-in");
    el.textContent = text;
    messagesEl.appendChild(el);
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

  var open = false;
  function toggle() {
    open = !open;
    panel.classList.toggle("p2l-open", open);
    if (open) inputEl.focus();
  }
  bubble.addEventListener("click", toggle);
  closeBtn.addEventListener("click", toggle);

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
        (data.replies || []).forEach(function (reply) {
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
