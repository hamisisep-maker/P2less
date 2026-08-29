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
    ".p2l-inputrow{display:flex;gap:4px;padding:10px;border-top:1px solid #e6e6f0;background:#fff;align-items:flex-end;position:relative;}",
    ".p2l-input{flex:1;border:1px solid #e6e6f0;border-radius:20px;padding:8px 14px;font-size:13px;outline:none;min-width:0;}",
    ".p2l-send{background:" + brandColor + ";color:#fff;border:none;border-radius:50%;width:34px;height:34px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;}",
    ".p2l-send:disabled{opacity:.5;cursor:default;}",
    ".p2l-icon-btn{background:none;border:none;color:#6b6b80;width:30px;height:30px;flex-shrink:0;cursor:pointer;font-size:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;}",
    ".p2l-icon-btn:hover{background:#f0f0f6;}",
    ".p2l-icon-btn.p2l-recording{color:#fff;background:#e11d48;animation:p2l-rec-pulse 1.2s infinite;}",
    "@keyframes p2l-rec-pulse{0%,100%{box-shadow:0 0 0 0 rgba(225,29,72,.5);}50%{box-shadow:0 0 0 6px rgba(225,29,72,0);}}",
    ".p2l-emoji-panel{position:absolute;bottom:52px;left:10px;width:236px;max-height:160px;overflow-y:auto;background:#fff;border:1px solid #e6e6f0;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.15);padding:8px;display:none;flex-wrap:wrap;gap:2px;z-index:1;}",
    ".p2l-emoji-panel.p2l-open{display:flex;}",
    ".p2l-emoji-panel button{background:none;border:none;font-size:18px;cursor:pointer;width:28px;height:28px;border-radius:6px;padding:0;}",
    ".p2l-emoji-panel button:hover{background:#f0f0f6;}",
    ".p2l-attach-chip{display:flex;align-items:center;gap:6px;background:#fff;border:1px solid #e6e6f0;border-radius:12px;padding:6px 10px;margin:0 10px;font-size:12px;color:#12131f;}",
    ".p2l-attach-chip img{width:32px;height:32px;object-fit:cover;border-radius:6px;}",
    ".p2l-attach-chip .p2l-attach-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".p2l-attach-chip button{background:none;border:none;cursor:pointer;color:#9395a8;font-size:14px;}",
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
  // Real line-icon SVGs (Feather-style: thin stroke, currentColor so they
  // pick up each button's own CSS color/hover state) instead of emoji
  // characters — an emoji glyph renders differently per OS/browser and
  // doesn't resemble WhatsApp's actual icon set at all. stroke-width kept at
  // 2 to read clearly at the small 16-18px size these buttons use.
  var ICON_SMILE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>';
  var ICON_CLIP = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a5 5 0 01-7.07-7.07l9.19-9.19a3 3 0 014.24 4.24l-9.19 9.19a1 1 0 01-1.41-1.41l8.48-8.48"/></svg>';
  var ICON_MIC = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
  var ICON_STOP = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>';

  panel.innerHTML =
    '<div class="p2l-header"><span></span><button class="p2l-close" aria-label="Close chat">×</button></div>' +
    '<div class="p2l-messages"></div>' +
    '<div class="p2l-attach-preview"></div>' +
    '<div class="p2l-inputrow">' +
    '<div class="p2l-emoji-panel" aria-hidden="true"></div>' +
    '<button class="p2l-icon-btn p2l-emoji-btn" aria-label="Insert emoji" type="button">' + ICON_SMILE + '</button>' +
    '<input class="p2l-input" type="text" placeholder="Type a message…" />' +
    '<button class="p2l-icon-btn p2l-attach-btn" aria-label="Attach a file" type="button">' + ICON_CLIP + '</button>' +
    '<input class="p2l-file-input" type="file" accept="image/*,video/*,.pdf,.doc,.docx" style="display:none" />' +
    '<button class="p2l-icon-btn p2l-mic-btn" aria-label="Record a voice note" type="button">' + ICON_MIC + '</button>' +
    '<button class="p2l-send" aria-label="Send">' + ICON_SEND + '</button>' +
    "</div>";
  panel.querySelector(".p2l-header span").textContent = headerLabel; // textContent, not innerHTML — orgName is untrusted page data

  document.body.appendChild(bubble);
  document.body.appendChild(panel);

  var messagesEl = panel.querySelector(".p2l-messages");
  var inputEl = panel.querySelector(".p2l-input");
  var sendBtn = panel.querySelector(".p2l-send");
  var closeBtn = panel.querySelector(".p2l-close");
  var emojiBtn = panel.querySelector(".p2l-emoji-btn");
  var emojiPanel = panel.querySelector(".p2l-emoji-panel");
  var attachBtn = panel.querySelector(".p2l-attach-btn");
  var fileInput = panel.querySelector(".p2l-file-input");
  var micBtn = panel.querySelector(".p2l-mic-btn");
  var attachPreviewEl = panel.querySelector(".p2l-attach-preview");

  // Emoji picker — a fixed curated set (no external emoji-data dependency,
  // matches the "single dependency-free script" design the rest of this
  // widget already follows). Click an emoji to insert it at the cursor,
  // panel stays open so several can be picked in a row (closes on send or
  // clicking elsewhere).
  var EMOJIS = ["😀","😂","🥰","😍","😊","🙂","😉","😢","😮","🙏","👍","👎","👏","🙌","💪","🔥","✨","🎉","❤️","💬","✅","❌","⏰","📅","📍","💡","👋","🤝","😅","🤔"];
  EMOJIS.forEach(function (e) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = e;
    b.addEventListener("click", function () {
      var start = inputEl.selectionStart == null ? inputEl.value.length : inputEl.selectionStart;
      var end = inputEl.selectionEnd == null ? inputEl.value.length : inputEl.selectionEnd;
      inputEl.value = inputEl.value.slice(0, start) + e + inputEl.value.slice(end);
      inputEl.focus();
      inputEl.selectionStart = inputEl.selectionEnd = start + e.length;
    });
    emojiPanel.appendChild(b);
  });
  emojiBtn.addEventListener("click", function (ev) {
    ev.stopPropagation();
    emojiPanel.classList.toggle("p2l-open");
  });
  document.addEventListener("click", function (ev) {
    if (!emojiPanel.contains(ev.target) && ev.target !== emojiBtn) emojiPanel.classList.remove("p2l-open");
  });

  // Pending attachment — set by either the file picker or a finished voice
  // recording, cleared once actually sent (or removed via the chip's ✕).
  // Base64-encoded and sent inline over the same JSON POST every other
  // message uses — no separate multipart upload endpoint needed at the
  // widget's real scale.
  var pendingFile = null; // { base64, filename, mimeType }

  function readFileAsBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = String(reader.result || "");
        var comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  function renderAttachPreview() {
    attachPreviewEl.innerHTML = "";
    if (!pendingFile) return;
    var chip = document.createElement("div");
    chip.className = "p2l-attach-chip";
    if (/^image\//i.test(pendingFile.mimeType)) {
      var img = document.createElement("img");
      img.src = "data:" + pendingFile.mimeType + ";base64," + pendingFile.base64;
      chip.appendChild(img);
    } else {
      var icon = document.createElement("span");
      icon.textContent = /^audio\//i.test(pendingFile.mimeType) ? "🎤" : /^video\//i.test(pendingFile.mimeType) ? "🎬" : "📎";
      chip.appendChild(icon);
    }
    var name = document.createElement("span");
    name.className = "p2l-attach-name";
    name.textContent = pendingFile.filename;
    chip.appendChild(name);
    var remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", "Remove attachment");
    remove.textContent = "✕";
    remove.addEventListener("click", function () { pendingFile = null; renderAttachPreview(); });
    chip.appendChild(remove);
    attachPreviewEl.appendChild(chip);
  }

  attachBtn.addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function () {
    var f = fileInput.files && fileInput.files[0];
    fileInput.value = ""; // allow picking the same file again later
    if (!f) return;
    readFileAsBase64(f).then(function (base64) {
      pendingFile = { base64: base64, filename: f.name, mimeType: f.type || "application/octet-stream" };
      renderAttachPreview();
      inputEl.focus();
    });
  });

  // Voice notes — MediaRecorder straight to a Blob, no server-side
  // transcoding needed: Gemini (the same model already transcribing
  // WhatsApp voice notes) accepts the browser's native webm/opus output
  // directly. First click asks for mic permission and starts recording
  // (button turns red/pulsing); second click stops and sends immediately —
  // no separate "attach then send" step for voice, since holding onto a
  // half-recorded note to edit later isn't a real use case the way a
  // photo/document attachment is.
  var mediaRecorder = null;
  var recordedChunks = [];
  function startRecording() {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      addMessage("Voice notes aren't supported in this browser. Please type your message instead.", "in");
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      recordedChunks = [];
      var mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType: mimeType }) : new MediaRecorder(stream);
      mediaRecorder.addEventListener("dataavailable", function (e) { if (e.data && e.data.size > 0) recordedChunks.push(e.data); });
      mediaRecorder.addEventListener("stop", function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        var blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        readFileAsBase64(blob).then(function (base64) {
          pendingFile = { base64: base64, filename: "voice-note.webm", mimeType: blob.type || "audio/webm" };
          send();
        });
      });
      mediaRecorder.start();
      micBtn.classList.add("p2l-recording");
      micBtn.innerHTML = ICON_STOP;
    }).catch(function () {
      addMessage("Microphone access was blocked. You can still type your message.", "in");
    });
  }
  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    micBtn.classList.remove("p2l-recording");
    micBtn.innerHTML = ICON_MIC;
  }
  micBtn.addEventListener("click", function () {
    if (mediaRecorder && mediaRecorder.state === "recording") stopRecording();
    else startRecording();
  });

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
    var file = pendingFile;
    if ((!text && !file) || sending) return;
    if (file && /^image\//i.test(file.mimeType)) addImage("data:" + file.mimeType + ";base64," + file.base64);
    else if (file) addMessage((/^audio\//i.test(file.mimeType) ? "🎤 " : /^video\//i.test(file.mimeType) ? "🎬 " : "📎 ") + file.filename, "out");
    if (text) addMessage(text, "out");
    inputEl.value = "";
    pendingFile = null;
    renderAttachPreview();
    emojiPanel.classList.remove("p2l-open");
    sending = true;
    sendBtn.disabled = true;
    showTyping();

    var payload = { widgetKey: key, sessionId: sessionId, text: text };
    if (file) payload.file = file;
    fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
