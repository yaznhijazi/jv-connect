// Scanners: session check-in at the doors, and dinner vouchers (each one works once). Admin pages for both.
import {SB, $, $$, esc, t5, hm, today, dayShort, startOf, endOf, store, state, toast, dialog, armed, formData, loadScript, flash, soundState, hallColor, downloadCsv, slug, categoriesOf, icon, can, playSound} from "./core.js";

const H5Q = "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js";
const publicBar = `<header class="topbar"><div class="wrap"><span class="brand"><img class="brand-mark" src="assets/jv-mark.svg" alt="" width="14" height="24">JV Connect</span></div></header>`;
let cam = null, lastCode = "", lastAt = 0, onScan = null, camWake = null;
addEventListener("hashchange", () => { closeCam(); stopOcr(); onScan = null; });

/* ---------- full-screen camera scanner: the camera stays on between badges, results show in place ---------- */
function camShell(){
  if ($("#camMode")) return $("#camMode");
  document.body.insertAdjacentHTML("beforeend", `<div id="camMode" class="cam-mode" hidden role="dialog" aria-modal="true" aria-label="Camera scanner">
    <div class="cam-top"><button type="button" class="cam-close" id="camClose" aria-label="Stop scanning">${icon("x")}</button>
      <div class="cam-session"><b id="camTitle"></b><small id="camSub"></small></div><div class="cam-count"><b id="camCount">0</b><small id="camCountL">checked in</small></div></div>
    <div class="cam-stage"><div id="camReader"></div><div class="cam-frame" aria-hidden="true"><i></i></div></div>
    <div class="cam-bottom"><div class="cam-result" id="camResult" aria-live="polite"><b>Point at a badge</b><span>Hold it 15 to 20 cm away, flat inside the frame.</span></div>
      <div class="cam-tools" id="camTools" hidden><label id="zoomWrap" hidden>Zoom<input id="camZoom" type="range" min="1" max="1" step="0.1" value="1"></label>
        <button type="button" class="cam-btn" id="torchBtn" aria-pressed="false" hidden>Flashlight</button></div></div></div>`);
  $("#camClose").onclick = () => closeCam();
  return $("#camMode");
}
// opts: {title, sub, count, countLabel, color}
async function openCam(opts = {}){
  const m = camShell();
  if (cam) return;
  $("#camTitle").textContent = opts.title || "Scanner"; $("#camSub").textContent = opts.sub || "";
  $("#camCount").textContent = opts.count ?? "0"; $("#camCountL").textContent = opts.countLabel || "checked in";
  m.style.setProperty("--hc", opts.color || "var(--sky)");
  $("#camResult").className = "cam-result"; $("#camResult").innerHTML = "<b>Point at a badge</b><span>Hold it 15 to 20 cm away, flat inside the frame.</span>";
  m.hidden = false; document.body.style.overflow = "hidden";
  try { await loadScript(H5Q); } catch (e) { closeCam(); return toast(e.message, "bad"); }
  const F = Html5QrcodeSupportedFormats;
  cam = new Html5Qrcode("camReader", {verbose: false, useBarCodeDetectorIfSupported: true, experimentalFeatures: {useBarCodeDetectorIfSupported: true},
    formatsToSupport: [F.QR_CODE, F.CODE_128, F.CODE_39, F.CODE_93, F.EAN_13, F.ITF]});
  try {
    await cam.start({facingMode: "environment"}, {fps: 20, disableFlip: true,
      // A wide box suits barcodes and QR codes alike; the drawn frame matches it.
      qrbox: (w, h) => { const b = {width: Math.floor(w * .84), height: Math.max(120, Math.floor(Math.min(h, w) * .5))};
        m.style.setProperty("--qw", b.width + "px"); m.style.setProperty("--qh", b.height + "px"); return b; },
      videoConstraints: {facingMode: "environment", width: {ideal: 1280}, height: {ideal: 720}, focusMode: "continuous"}},
      code => { const now = Date.now(); if (code === lastCode && now - lastAt < 3000) return; lastCode = code; lastAt = now; onScan?.(code); }, () => {});
    navigator.wakeLock?.request("screen").then(w => camWake = w, () => {});
    await tuneCam();
  } catch { cam = null; closeCam(); toast("Camera not available. Allow camera access for this site, then try again.", "bad"); }
}
// Keep autofocus on, and offer zoom and flashlight where the phone has them (zooming from further away gives a sharper barcode).
async function tuneCam(){
  let caps = {}; try { caps = cam.getRunningTrackCapabilities() || {}; } catch {}
  const apply = c => cam.applyVideoConstraints({advanced: [c]}).catch(() => {});
  if (caps.focusMode?.includes("continuous")) await apply({focusMode: "continuous"});
  const z = $("#camZoom");
  if (caps.zoom && caps.zoom.max > caps.zoom.min) {
    const start = Math.min(caps.zoom.max, Math.max(caps.zoom.min, 2)); // ponytail: 2x suits badges at ~20 cm; tune if needed
    Object.assign(z, {min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || .1, value: start}); await apply({zoom: start});
    $("#zoomWrap").hidden = false; z.oninput = () => apply({zoom: Number(z.value)});
  } else $("#zoomWrap").hidden = true;
  const t = $("#torchBtn"); let on = false; t.hidden = !caps.torch;
  t.onclick = () => { on = !on; t.setAttribute("aria-pressed", on); apply({torch: on}); };
  $("#camTools").hidden = $("#zoomWrap").hidden && t.hidden;
}
async function closeCam(){
  const m = $("#camMode"); if (!m) return;
  const c = cam; cam = null;
  if (c) { try { await c.stop(); } catch {} }
  m.hidden = true; document.body.style.overflow = ""; camWake?.release().catch(() => {}); camWake = null;
}
addEventListener("keydown", e => { if (e.key === "Escape" && $("#camMode") && !$("#camMode").hidden) closeCam(); });

// Bluetooth / USB scanners type the code and press Enter: catch it anywhere on a scanner page.
let kb = "", kbAt = 0;
document.addEventListener("keydown", e => {
  if (!onScan || e.target.closest?.("input, textarea, select") || $("#dlg").open) return;
  if (e.key === "Enter") { if (kb.length >= 2) { e.preventDefault(); onScan(kb); } kb = ""; return; }
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { const n = Date.now(); if (n - kbAt > 400) kb = ""; kb += e.key; kbAt = n; }
});
const typedField = id => `<label class="ci-type">${icon("search", "ic sm")}<span class="sr">Badge ID</span><input class="scan-input" id="${id}Input" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" inputmode="text" placeholder="Badge ID"></label>`;
const soundToggle = id => `<label class="ci-sound"><input type="checkbox" id="${id}Sound" ${soundState.on ? "checked" : ""}><span>Sound</span></label>`;
function wireTyped(id){
  $(`#${id}Input`).onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); const v = e.target.value.trim(); e.target.value = ""; if (v) onScan?.(v); } };
  $(`#${id}Sound`).onchange = e => { soundState.on = e.target.checked; store.set("sound", e.target.checked ? "on" : "off"); };
}

/* ---------- Collect IDs: read numbers live with the camera (a notebook page, a printed list) into a list to save ----------
   Two readers on the same live view:
   1. On the phone (Tesseract, free): digits only, draws a box on every number it sees, adds a number once it's read the same way twice.
   2. AI help (the read-ids photo reader, team only): when the phone is held still, the frame is read by AI, which reads handwriting far better. */
const ocr = {stream: null, worker: null, timer: null, busy: false, seen: new Map(), handled: new Set(), added: 0, wake: null,
  ai: store.get("ocrAi") !== "off", aiBusy: false, aiAt: 0, still: 0, prev: null, raw: null, proc: null, thumb: null, onId: null, onSave: null};
const AI_EVERY_MS = 4000; // ponytail: at most one AI read per 4 s; raise if the AI limit bites
const TESS = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
function ocrShell(){
  if ($("#ocrMode")) return $("#ocrMode");
  document.body.insertAdjacentHTML("beforeend", `<div id="ocrMode" class="cam-mode ocr" hidden role="dialog" aria-modal="true" aria-label="Collect IDs with the camera">
    <div class="cam-top"><button type="button" class="cam-close" id="ocrClose" aria-label="Stop collecting">${icon("x")}</button>
      <div class="cam-session"><b id="ocrTitle"></b><small>Hold still over the numbers. Boxes show what it sees.</small></div><div class="cam-count"><b id="ocrCount">0</b><small>collected</small></div></div>
    <div class="cam-stage"><div class="ocr-box"><video id="ocrVideo" playsinline muted></video><canvas id="ocrBoxes" aria-hidden="true"></canvas><div class="cam-frame" aria-hidden="true"><i></i></div><div class="ocr-snap" id="ocrSnap" hidden>AI reading…</div></div></div>
    <div class="cam-bottom"><div class="ocr-tools"><button type="button" class="cam-btn" id="ocrAi" aria-pressed="true">AI help: on</button><span class="ocr-seeing" id="ocrSeeing"></span></div>
      <div class="cam-result" id="ocrResult" aria-live="polite"></div><div class="ocr-recent" id="ocrRecent"></div>
      <div class="ocr-actions"><button type="button" class="cam-btn" id="ocrDone">Review the list</button><button type="button" id="ocrSave">Save to session</button></div></div></div>`);
  $("#ocrClose").onclick = stopOcr; $("#ocrDone").onclick = stopOcr;
  $("#ocrSave").onclick = () => { stopOcr(); ocr.onSave?.(); };
  $("#ocrAi").onclick = () => { ocr.ai = !ocr.ai; store.set("ocrAi", ocr.ai ? "on" : "off"); ocrAiUi(); };
  return $("#ocrMode");
}
const ocrMsg = (kind, title, sub) => { $("#ocrResult").className = "cam-result " + kind; $("#ocrResult").innerHTML = `<b>${esc(title)}</b><span>${esc(sub)}</span>`; };
const ocrAiUi = () => { $("#ocrAi").setAttribute("aria-pressed", ocr.ai); $("#ocrAi").textContent = ocr.ai ? "AI help: on" : "AI help: off"; };
// opts: {title, color, onId(id) -> "new" | "dup" | "in", name(id)}
async function startOcr(opts){
  const m = ocrShell();
  Object.assign(ocr, {added: 0, still: 0, prev: null, aiAt: 0, onId: opts.onId, onSave: opts.onSave, name: opts.name}); ocr.seen.clear(); ocr.handled.clear();
  $("#ocrTitle").textContent = opts.title || "Collect IDs"; $("#ocrCount").textContent = "0"; $("#ocrRecent").innerHTML = ""; $("#ocrSeeing").textContent = "";
  m.style.setProperty("--hc", opts.color || "var(--sky)"); ocrAiUi();
  m.hidden = false; document.body.style.overflow = "hidden";
  ocrMsg("", "Starting the camera…", "The number reader loads the first time, which takes a few seconds.");
  try {
    ocr.stream = await navigator.mediaDevices.getUserMedia({audio: false, video: {facingMode: "environment", width: {ideal: 1920}, height: {ideal: 1080}}});
    const v = $("#ocrVideo"); v.srcObject = ocr.stream; await v.play();
    const track = ocr.stream.getVideoTracks()[0], caps = track.getCapabilities?.() || {};
    if (caps.focusMode?.includes("continuous")) track.applyConstraints({advanced: [{focusMode: "continuous"}]}).catch(() => {});
    navigator.wakeLock?.request("screen").then(w => ocr.wake = w, () => {});
    await loadScript(TESS);
    ocr.worker = ocr.worker || await Tesseract.createWorker("eng");
    // Digits only, "sparse text": numbers anywhere in the frame, not one tidy block.
    await ocr.worker.setParameters({tessedit_char_whitelist: "0123456789", tessedit_pageseg_mode: "11"});
    if (!ocr.stream) return; // closed while loading
    ocrMsg("", "Point at the numbers", "Hold the phone about 20 cm over the page and keep it still for a second.");
    ocrTick();
  } catch (e) {
    ocrMsg("bad", "Camera or reader not available", e?.name === "NotAllowedError" ? "Allow camera access for this site, then try again." : (e?.message || "Try again."));
  }
}
function stopOcr(){
  const m = $("#ocrMode"); if (!m || m.hidden) return;
  clearTimeout(ocr.timer); ocr.timer = null;
  ocr.stream?.getTracks().forEach(t => t.stop()); ocr.stream = null;
  ocr.wake?.release().catch(() => {}); ocr.wake = null;
  m.hidden = true; document.body.style.overflow = ""; $("#ocrSnap").hidden = true;
  if (ocr.added) toast(`Collected ${ocr.added} ID${ocr.added > 1 ? "s" : ""}. Compare them with the notebook, then save.`);
}
addEventListener("keydown", e => { if (e.key === "Escape" && ocr.stream) stopOcr(); });
// The part of the video inside the drawn frame, in video pixels.
function frameCrop(v){
  const vr = v.getBoundingClientRect(), fr = $("#ocrMode .cam-frame").getBoundingClientRect();
  const sx = v.videoWidth / vr.width, sy = v.videoHeight / vr.height;
  const x = Math.max(0, (fr.left - vr.left) * sx), y = Math.max(0, (fr.top - vr.top) * sy);
  return {x, y, w: Math.min(v.videoWidth - x, fr.width * sx), h: Math.min(v.videoHeight - y, fr.height * sy), sx, sy, ox: fr.left - vr.left, oy: fr.top - vr.top};
}
// How much the picture moved since the last tick (0 = perfectly still), from a tiny grey thumbnail.
function motion(v){
  const t = ocr.thumb ||= Object.assign(document.createElement("canvas"), {width: 48, height: 27}), g = t.getContext("2d", {willReadFrequently: true});
  g.drawImage(v, 0, 0, 48, 27);
  const d = g.getImageData(0, 0, 48, 27).data, cur = new Uint8Array(48 * 27);
  for (let i = 0; i < cur.length; i++) cur[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;
  let diff = 255; if (ocr.prev) { diff = 0; for (let i = 0; i < cur.length; i++) diff += Math.abs(cur[i] - ocr.prev[i]); diff /= cur.length; }
  ocr.prev = cur; return diff;
}
const looksLikeId = t => /^\d{3,6}$/.test(t); // ponytail: this event's IDs are 4 digits; 3–6 keeps other events' IDs
function drawBoxes(words, crop, k){
  const c = $("#ocrBoxes"), v = $("#ocrVideo"), r = v.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
  const g = c.getContext("2d"); g.scale(dpr, dpr); g.lineWidth = 3; g.font = "800 15px Instrument Sans, system-ui, sans-serif";
  for (const wd of words) {
    const ok = looksLikeId(wd.text) && wd.confidence >= 45, bb = wd.bbox;
    const x = crop.ox + bb.x0 / k / crop.sx, y = crop.oy + bb.y0 / k / crop.sy, w = (bb.x1 - bb.x0) / k / crop.sx, h = (bb.y1 - bb.y0) / k / crop.sy;
    g.strokeStyle = ok ? "#47cd89" : "#fdb022"; g.fillStyle = ok ? "rgba(71,205,137,.18)" : "rgba(253,176,34,.12)";
    g.beginPath(); if (g.roundRect) g.roundRect(x - 4, y - 4, w + 8, h + 8, 6); else g.rect(x - 4, y - 4, w + 8, h + 8); g.fill(); g.stroke();
    g.fillStyle = ok ? "#47cd89" : "#fdb022"; const tw = g.measureText(wd.text).width; g.fillRect(x - 4, y - 26, tw + 12, 20);
    g.fillStyle = "#071620"; g.fillText(wd.text, x + 2, y - 11);
  }
}
async function ocrTick(){
  if (!ocr.stream) return;
  const v = $("#ocrVideo");
  if (v.readyState >= 2 && !ocr.busy) {
    ocr.busy = true;
    try {
      const crop = frameCrop(v), k = Math.min(2, 1600 / crop.w);
      // raw: colour crop for the AI; proc: grey with stretched contrast for the phone reader.
      const raw = ocr.raw ||= document.createElement("canvas"), proc = ocr.proc ||= document.createElement("canvas");
      raw.width = proc.width = Math.round(crop.w * k); raw.height = proc.height = Math.round(crop.h * k);
      raw.getContext("2d").drawImage(v, crop.x, crop.y, crop.w, crop.h, 0, 0, raw.width, raw.height);
      const g = proc.getContext("2d", {willReadFrequently: true}); g.drawImage(raw, 0, 0);
      const im = g.getImageData(0, 0, proc.width, proc.height), d = im.data; let lo = 255, hi = 0;
      for (let i = 0; i < d.length; i += 4) { const L = .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]; d[i] = L; if (L < lo) lo = L; if (L > hi) hi = L; }
      const span = Math.max(1, hi - lo);
      for (let i = 0; i < d.length; i += 4) { const L = (d[i] - lo) * 255 / span; d[i] = d[i + 1] = d[i + 2] = L; }
      g.putImageData(im, 0, 0);
      const still = motion(v) < 6; ocr.still = still ? ocr.still + 1 : 0;
      const { data } = await ocr.worker.recognize(proc);
      const words = (data.words || []).filter(wd => /\d/.test(wd.text));
      drawBoxes(words, crop, k);
      $("#ocrSeeing").textContent = words.length ? "Seeing: " + words.map(wd => wd.text).slice(0, 8).join("  ") : "Seeing: nothing yet";
      const now = Date.now();
      for (const wd of words) {
        if (!looksLikeId(wd.text) || wd.confidence < 45) continue;
        const st = ocr.seen.get(wd.text) || {n: 0, at: 0};
        st.n = now - st.at < 6000 ? st.n + 1 : 1; st.at = now; ocr.seen.set(wd.text, st);
        if (st.n >= 2 && !ocr.handled.has(wd.text)) ocrAccept(wd.text);
      }
      if (ocr.ai && ocr.still >= 3 && !ocr.aiBusy && now - ocr.aiAt > AI_EVERY_MS) aiSnap(raw);
    } catch { /* one bad frame: keep going */ }
    ocr.busy = false;
  }
  ocr.timer = setTimeout(ocrTick, 250);
}
async function aiSnap(raw){
  ocr.aiBusy = true; ocr.aiAt = Date.now(); $("#ocrSnap").hidden = false;
  try {
    const { data, error } = await SB.functions.invoke("read-ids", {body: {image: raw.toDataURL("image/jpeg", .85).split(",")[1], mime: "image/jpeg"}});
    if (error) {
      let body = {}; try { body = await error.context.json(); } catch {}
      if (body.limit || [401, 403].includes(error.context?.status)) { ocr.ai = false; ocrAiUi(); ocrMsg("warn", "AI help paused", (body.error || "The AI reader isn't available.") + " Reading with the phone only."); }
    } else (data.ids || []).forEach(id => { if (!ocr.handled.has(id)) ocrAccept(id); });
  } catch { /* network blip: the next still moment tries again */ }
  ocr.aiBusy = false; $("#ocrSnap").hidden = true; ocr.still = 0;
}
function ocrAccept(id){
  ocr.handled.add(id);
  const res = ocr.onId?.(id) || "new", name = ocr.name?.(id);
  if (res === "new") { ocr.added++; ocrMsg("ok", `✓ ${id}`, name || "Added to the list, not on the attendee list"); playSound("ok"); navigator.vibrate?.(50); }
  else { ocrMsg("warn", `! ${id}`, res === "in" ? "Already checked in to this session, skipped" : "Already in the list"); playSound("warn"); }
  $("#ocrCount").textContent = ocr.added;
  $("#ocrRecent").insertAdjacentHTML("afterbegin", `<span class="idchip ${res !== "new" ? "already" : name ? "known" : "unknown"}"><b>${esc(id)}</b></span>`);
  while ($("#ocrRecent").children.length > 10) $("#ocrRecent").lastElementChild.remove();
}

/* ---------- session check-in (ushers: public link; team: inside the conference) ---------- */
// The session to show by default in a hall: live now, else the next one, else the last one.
function pickDefault(list, hall){
  const now = new Date(), l = list.filter(s => !hall || s.hall_id === hall);
  const live = l.filter(s => now >= startOf(s) && now <= endOf(s));
  return (live.at(-1) || l.find(s => startOf(s) > now) || l.at(-1))?.id || "";
}
// Phone photos are big: 2400 px on the long side is enough for handwriting.
async function shrink(file){
  const img = await createImageBitmap(file), k = Math.min(1, 2400 / Math.max(img.width, img.height)), cv = document.createElement("canvas");
  cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
  return {image: cv.toDataURL("image/jpeg", .85).split(",")[1], mime: "image/jpeg"};
}
const shortHall = n => String(n || "").replace(/^(Main Hall|Breakout \d+)\s*[–-]\s*/, "");
// "Live now, until 12:00" / "Starts in 20 min" / "Ended at 10:30"
function sessionState(s){
  if (!s) return ["", ""];
  const now = new Date(), a = startOf(s), b = endOf(s), mins = Math.round((a - now) / 6e4);
  if (now >= a && now <= b) return ["live", `Live now, until ${t5(s.end_time)}`];
  if (now < a) return ["soon", s.day !== today() ? `${dayShort(s.day)}, ${t5(s.start_time)}` : mins <= 90 ? `Starts in ${mins} min` : `Starts at ${t5(s.start_time)}`];
  return ["done", s.day !== today() ? `${dayShort(s.day)}, ended` : `Ended at ${t5(s.end_time)}`];
}
const ring = (n, cap) => { const r = 54, C = 2 * Math.PI * r, p = cap ? Math.min(1, n / cap) : 0;
  return `<svg viewBox="0 0 128 128" aria-hidden="true"><circle cx="64" cy="64" r="${r}" class="ring-bg"/><circle cx="64" cy="64" r="${r}" class="ring-fg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p)}"/></svg>`; };

async function sessionScanner(el, {confId, title, sessions, admin, dayPicker = ""}){
  const key = `hall:${confId}`; let hall = store.get(key) || "", picked = "", touched = false, lastData = [];
  const halls = [...new Map(sessions.filter(s => s.hall_id).map(s => [s.hall_id, {id: s.hall_id, name: s.hall_name, sort: s.hall_sort ?? 0}])).values()].sort((a, b) => a.sort - b.sort);
  if (hall && !halls.some(h => h.id === hall)) hall = "";
  const colorOf = id => { const i = halls.findIndex(h => h.id === id); return i < 0 ? "var(--sky)" : `var(--h${i % 6 + 1})`; };
  const cur = () => sessions.find(x => x.id === picked);
  el.innerHTML = `<div class="ci">
    <section class="ci-hero" id="ciHero">
      ${title ? `<div class="ci-title">${title === "Door scanner" ? "" : `<span class="ci-kicker">${icon("scan", "ic sm")}Door scanner</span>`}<h1>${esc(title)}</h1></div>` : ""}
      ${dayPicker}
      ${halls.length > 1 ? `<div class="ci-halls" role="group" aria-label="Hall">${[{id: "", name: "All halls"}, ...halls].map(h => `<button type="button" data-h="${h.id}" aria-pressed="${h.id === hall}">${h.id ? `<i class="hdot" style="--hc:${colorOf(h.id)}"></i>` : ""}${esc(shortHall(h.name))}</button>`).join("")}</div>` : ""}
      <label class="ci-sess"><span>Session</span><select id="sessSel"></select></label>
      <div class="ci-now">
        <div class="ci-ring" id="ciRing">${ring(0, 0)}<div class="ci-ring-c"><b id="cnt">0</b><small id="cntSub">checked in</small></div></div>
        <div class="ci-meta"><span class="ci-state" id="ciState"></span><b class="ci-stitle" id="ciTitle"></b><span class="ci-hall" id="ciHall"></span><span class="ci-late" id="ciLate"></span></div>
      </div>
      <div class="ci-modes">
        <button type="button" class="ci-mode go" id="ciScan">${icon("scan")}<span><b>Scan badges</b><small>Full-screen camera that keeps scanning</small></span></button>
        ${admin && can("edit") ? `<button type="button" class="ci-mode" id="ciCollect">${icon("camera")}<span><b>Collect IDs</b><small>Read numbers from a notebook or a list</small></span></button>` : ""}
      </div>
      <div class="ci-typerow">${typedField("sc")}${soundToggle("sc")}</div>
    </section>
    <section class="panel ci-feed"><div class="panel-head"><h2>Latest at the door</h2><span class="note" id="feedNote"></span></div><ul class="roster" id="roster"><li class="note">Nobody yet.</li></ul></section>
    ${admin && can("edit") ? `<section class="panel ci-bulk"><div class="panel-head"><div><h2>Add many at once</h2><span class="note">IDs from a notebook: collect them with the camera, read them from photos, or paste them. They're saved to the session above; nobody is marked late; duplicates are skipped.</span></div></div>
      <div class="row"><button type="button" class="ghost" id="bulkCollect">${icon("camera")}Collect with the camera</button><button type="button" class="ghost" id="bulkPhotoBtn">${icon("upload")}Read from photos</button></div>
      <input id="bulkPhoto" type="file" accept="image/*" multiple hidden>
      <textarea id="bulkIds" inputmode="numeric" placeholder="0427 3815 1200" aria-label="Badge IDs to save"></textarea>
      <div id="bulkInfo" class="note" role="status" aria-live="polite"></div>
      <div class="row"><button type="button" id="bulkGo">Save to session</button><button type="button" class="ghost" id="bulkClear">Clear</button></div></section>` : ""}
  </div>`;
  const sel = $("#sessSel", el);
  const fill = () => {
    const l = sessions.filter(s => !hall || s.hall_id === hall);
    if (!touched || !l.some(s => s.id === picked)) picked = pickDefault(sessions, hall);
    sel.innerHTML = l.map(s => `<option value="${s.id}" ${s.id === picked ? "selected" : ""}>${t5(s.start_time)}  ${esc(s.title)}${hall ? "" : `, ${esc(shortHall(s.hall_name))}`}</option>`).join("") || `<option value="">No sessions today</option>`;
    paintHero();
  };
  const paintHero = () => {
    const s = cur(), [st, label] = sessionState(s);
    $("#ciHero").style.setProperty("--hc", s ? colorOf(s.hall_id) : "var(--sky)");
    $("#ciState").className = "ci-state " + st; $("#ciState").textContent = label;
    $("#ciTitle").textContent = s?.title || (sessions.length ? "Pick a session" : "No sessions today"); $("#ciHall").textContent = s ? shortHall(s.hall_name) : "";
  };
  // Counts: the team gets exact numbers; the public usher link sees the latest 50.
  const exactCount = async (late) => { let q = SB.from("conf_checkins").select("id", {count: "exact", head: true}).eq("session_id", picked); if (late) q = q.eq("late", true); const r = await q; return r.error ? null : r.count; };
  const roster = async () => {
    if (!picked) { $("#cnt").textContent = "0"; return; }
    const [{ data }, n, nLate] = await Promise.all([SB.rpc("c_roster", {p_session: picked}), admin ? exactCount(false) : null, admin ? exactCount(true) : null]);
    if (!document.contains(sel)) return; // the user left the scanner while this was loading
    lastData = data || [];
    const s = cur(), count = n ?? lastData.length, shown = n == null && lastData.length >= 50 ? "50+" : String(count), cap = s?.capacity || 0;
    $("#cnt").textContent = shown; $("#cntSub").textContent = cap ? `of ${cap} seats` : "checked in";
    $("#ciRing svg").outerHTML = ring(count, cap);
    $("#ciRing").classList.toggle("full", cap && count >= cap);
    const late = nLate ?? lastData.filter(r => r.late).length;
    $("#ciLate").textContent = late ? `${late} came late` : "";
    $("#feedNote").textContent = lastData.length ? `last at ${hm(lastData[0].at)}` : "";
    if ($("#camCount")) $("#camCount").textContent = shown;
    $("#roster").innerHTML = lastData.slice(0, 8).map((r, i) => `<li class="${i === 0 ? "fresh" : ""}"><span class="av">${esc((r.name || "?").split(/\s+/).map(w => w[0]).slice(0, 2).join(""))}</span><span class="who"><b>${esc(r.name || "Not on the list")}</b><small>${esc(r.code)}${r.late ? ' <span class="pill warn">late</span>' : ""}</small></span><small class="num">${hm(r.at)}</small></li>`).join("")
      || '<li class="note ci-empty">Nobody yet. Scan the first badge to start the count.</li>';
  };
  fill(); roster();
  $$("[data-h]", el).forEach(b => b.onclick = () => { hall = b.dataset.h; store.set(key, hall); touched = false; $$("[data-h]", el).forEach(x => x.setAttribute("aria-pressed", x === b)); fill(); roster(); });
  sel.onchange = () => { picked = sel.value; touched = true; paintHero(); roster(); };
  wireTyped("sc");
  $("#ciScan").onclick = () => { if (!picked) return toast("Pick a session first.", "bad"); const s = cur();
    openCam({title: s.title, sub: `${shortHall(s.hall_name)}, ${t5(s.start_time)} to ${t5(s.end_time)}`, count: $("#cnt").textContent, color: colorOf(s.hall_id)}); };
  onScan = async code => {
    if (!picked) return flash("bad", "Not checked in", "Pick a session first", "");
    const { data: r, error } = await SB.rpc("c_check_in", {p_session: picked, p_code: code.trim()});
    if (error) return flash("bad", "Not checked in", "Can't reach the server", "Scan again.");
    if (r.status === "ok") flash(r.known ? "ok" : "warn", r.known ? "Checked in" : "Checked in, not on the list", r.name || `Badge ${code}`, r.late ? `Late, at ${hm(r.at)}` : `At ${hm(r.at)}${r.category ? ", " + r.category : ""}`);
    else if (r.status === "already") flash("warn", "Already checked in", r.name || `Badge ${code}`, `Since ${hm(r.at)}`);
    else if (r.status === "closed") flash("bad", "Not checked in", "Scanning is closed", "It opens 60 minutes before the start and closes 30 minutes after the end.");
    else flash("bad", "Not checked in", "Couldn't read that badge", "Scan it again.");
    roster();
  };
  const tick = setInterval(() => { if (!document.contains(sel)) return clearInterval(tick); if (!touched) { const before = picked; fill(); if (picked !== before) roster(); } else { paintHero(); roster(); } }, 30000);
  if (!(admin && can("edit"))) return;

  // ---- team: many IDs at once (camera collector, photos, paste) ----
  const idsIn = () => [...new Set($("#bulkIds").value.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean))];
  const nameOf = id => state.c?.byCode.get(id)?.full_name || "";
  const bulkInfo = (extra = "") => { const ids = idsIn(), off = state.c ? ids.filter(id => !state.c.byCode.has(id)) : [];
    $("#bulkInfo").innerHTML = (ids.length ? `<b>${ids.length}</b> ID${ids.length > 1 ? "s" : ""} ready` + (off.length ? `, <span style="color:var(--warn)">${off.length} not on the attendee list (${esc(off.slice(0, 6).join(", "))}${off.length > 6 ? "…" : ""})</span>` : "") + ". " : "") + extra;
    $("#bulkGo").textContent = ids.length ? `Save ${ids.length} to “${cur()?.title || "the session"}”` : "Save to session"; };
  $("#bulkIds").oninput = () => bulkInfo();
  $("#bulkClear").onclick = () => { $("#bulkIds").value = ""; bulkInfo(); };
  // Each number the camera reads: "new" adds it to the list, "in" = already checked in here, "dup" = already in the list.
  const collect = () => { if (!picked) return toast("Pick a session first.", "bad"); const s = cur(), inNow = new Set(lastData.map(r => r.code));
    startOcr({title: `Collecting for ${s.title}`, color: colorOf(s.hall_id), name: nameOf,
      onId: id => { if (inNow.has(id)) return "in"; const have = idsIn(); if (have.includes(id)) return "dup"; $("#bulkIds").value = [...have, id].join("\n"); bulkInfo(); return "new"; },
      onSave: () => $("#bulkGo").click()}); };
  $("#ciCollect").onclick = collect; $("#bulkCollect").onclick = collect;
  $("#bulkPhotoBtn").onclick = () => $("#bulkPhoto").click();
  $("#bulkPhoto").onchange = async e => {
    const files = [...e.target.files]; e.target.value = "";
    if (!files.length) return;
    const btn = $("#bulkPhotoBtn"); btn.disabled = true;
    let added = 0, failed = 0, last = "";
    for (const [i, f] of files.entries()) {
      bulkInfo(`Reading photo ${i + 1} of ${files.length}…`);
      try {
        const { data, error } = await SB.functions.invoke("read-ids", {body: await shrink(f)});
        if (error) { let m = ""; try { m = (await error.context.json()).error; } catch {} throw new Error(m || "The photo reader didn't answer."); }
        const have = new Set(idsIn()), fresh = (data.ids || []).filter(id => !have.has(id));
        if (fresh.length) $("#bulkIds").value = [...have, ...fresh].join("\n");
        added += fresh.length; last = data.last || last;
        if (!(data.ids || []).length) failed++;
      } catch (err) { failed++; toast(err.message, "bad"); }
    }
    btn.disabled = false;
    bulkInfo(`Added ${added} from ${files.length > 1 ? files.length + " photos" : "the photo"}${last ? `, last ID on the page: <b>${esc(last)}</b>` : ""}.`
      + (failed ? ` ${failed} photo${failed > 1 ? "s" : ""} gave nothing: take ${failed > 1 ? "them" : "it"} again closer.` : " Compare with the notebook, then save."));
  };
  $("#bulkGo").onclick = async () => {
    const ids = idsIn();
    if (!picked || !ids.length) return toast("Pick a session and add some IDs.", "bad");
    $("#bulkGo").disabled = true;
    const { data, error } = await SB.rpc("c_bulk_check_in", {p_session: picked, p_codes: ids});
    $("#bulkGo").disabled = false;
    if (error || data?.status !== "ok") return toast(data?.status === "too_many" ? "That's more than 2,000 IDs. Save them in smaller batches." : "Not saved. Try again.", "bad");
    $("#bulkIds").value = ""; bulkInfo(); toast(`${data.added} checked in${data.already ? `, ${data.already} were already in` : ""}. Last ID: ${data.last}`); playSound("ok"); roster();
  };
  bulkInfo();
}
export async function renderPublic(app, confId){
  app.innerHTML = publicBar + `<main><div class="wrap" id="pg"><div class="empty">Loading…</div></div></main>`;
  const { data, error } = await SB.rpc("c_today", {p_conf: confId});
  if (error) throw error;
  await sessionScanner($("#pg"), {confId, title: data[0]?.conf_name || "Door scanner", sessions: data});
}
// Team view: any day of the conference (today by default); the team can record outside the opening times.
let adminDay = "";
export async function renderAdmin(el, c){
  const t = today(), days = [...new Set(c.sessions.map(s => s.day))].sort();
  if (!days.includes(adminDay)) adminDay = days.includes(t) ? t : days.find(d => d > t) || days.at(-1) || "";
  const sessions = c.sessions.filter(s => s.day === adminDay).map(s => ({...s, hall_name: c.hallById.get(s.hall_id)?.name, hall_sort: c.hallRank.get(s.hall_id), capacity: c.hallById.get(s.hall_id)?.capacity}));
  const dayPicker = days.length > 1 ? `<div class="ci-days" role="group" aria-label="Day">${days.map(d => `<button type="button" data-day="${d}" aria-pressed="${d === adminDay}">${d === t ? "Today" : esc(dayShort(d))}</button>`).join("")}</div>` : "";
  await sessionScanner(el, {confId: c.conf.id, title: "", sessions, admin: true, dayPicker});
  $$("[data-day]", el).forEach(b => b.onclick = () => { adminDay = b.dataset.day; renderAdmin(el, c); });
}

/* ---------- vouchers: admin ---------- */
const toLocal = iso => { const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
const when = iso => `${dayShort(iso.slice(0, 10))} ${hm(iso)}`;
export function renderVouchers(el, c, ctx){
  const base = location.href.split("#")[0], cats = categoriesOf(c);
  const eligible = v => c.attendees.filter(a => !v.categories.length || v.categories.includes(a.category));
  el.innerHTML = `<div class="panel"><div class="panel-head"><div><h2>Vouchers</h2><span class="note">A voucher works once per attendee. Staff scan the badge; the second scan shows when and by whom it was used.</span></div>
      <button type="button" id="vAdd">Add voucher</button></div>
      <div class="tbl"><table class="rt"><thead><tr><th>Voucher</th><th>Valid</th><th>For</th><th>Used</th><th></th></tr></thead><tbody>${c.vouchers.map(v => {
        const used = (c.usesByVoucher.get(v.id) || []).length, el2 = eligible(v).length, nowOk = Date.now() >= Date.parse(v.valid_from) && Date.now() <= Date.parse(v.valid_to);
        return `<tr><td class="main" data-l="Voucher">${esc(v.name)} ${nowOk ? '<span class="pill ok live">Open now</span>' : ""}</td><td data-l="Valid">${when(v.valid_from)} to ${hm(v.valid_to)}</td>
          <td data-l="For">${v.categories.length ? esc(v.categories.join(", ")) : "Everyone"}</td>
          <td data-l="Used"><div style="display:flex;align-items:center;gap:8px"><div class="meter" style="flex:1"><i style="width:${el2 ? Math.min(100, 100 * used / el2) : 0}%"></i></div><span class="num">${used} of ${el2}</span></div></td>
          <td class="actions"><button type="button" class="ghost small" data-uses="${v.id}">Who used it</button> <button type="button" class="ghost small" data-v="${v.id}">Edit</button></td></tr>`; }).join("")
        || '<tr><td colspan="5" class="empty">No vouchers yet. Add the gala dinner, for example.</td></tr>'}</tbody></table></div></div>
    <div class="panel"><h2>Voucher scanner for your staff</h2><p class="note">Open on the phone at the dinner entrance. No account needed; staff type their name once so each use shows who scanned it.</p>
      <div class="linkbox"><input readonly value="${esc(base)}#/voucher/${c.conf.id}" onfocus="this.select()" aria-label="Voucher scanner link"><a class="btn ghost small" href="#/voucher/${c.conf.id}">Open</a></div></div>`;
  $("#vAdd").onclick = () => voucherDialog(c, null, cats, ctx);
  $$("[data-v]", el).forEach(b => b.onclick = () => voucherDialog(c, c.vouchers.find(v => v.id === b.dataset.v), cats, ctx));
  $$("[data-uses]", el).forEach(b => b.onclick = () => usesDialog(c, c.vouchers.find(v => v.id === b.dataset.uses), ctx));
}
function voucherDialog(c, v, cats, ctx){
  const day = c.conf.start_date;
  dialog({need: "manage", title: v ? "Edit voucher" : "Add voucher", submit: v ? "Save voucher" : "Add voucher", danger: v ? "Delete voucher" : "",
    body: `<label>Name<input name="name" required maxlength="120" value="${esc(v?.name)}" placeholder="Gala dinner"></label>
      <div class="form-grid"><label>Opens<input name="valid_from" type="datetime-local" required value="${v ? toLocal(v.valid_from) : day + "T19:00"}"></label>
      <label>Closes<input name="valid_to" type="datetime-local" required value="${v ? toLocal(v.valid_to) : day + "T23:30"}"></label></div>
      <fieldset style="border:1px solid var(--line);border-radius:12px;padding:12px"><legend class="note">Who gets it (none ticked = everyone)</legend>
        ${cats.map(k => `<label class="check"><input type="checkbox" name="cat" value="${esc(k)}" ${v?.categories.includes(k) ? "checked" : ""}> ${esc(k)}</label>`).join("") || '<span class="note">No categories yet: everyone gets it.</span>'}</fieldset>
      ${v ? `<p class="note">Deleting removes the ${(c.usesByVoucher.get(v.id) || []).length} recorded uses too.</p>` : ""}`,
    onSubmit: async form => {
      const f = formData(form), row = {conference_id: c.conf.id, name: f.name.trim(), valid_from: new Date(f.valid_from).toISOString(), valid_to: new Date(f.valid_to).toISOString(),
        categories: $$("input[name=cat]:checked", form).map(x => x.value)};
      if (row.valid_to <= row.valid_from) { toast("It has to close after it opens.", "bad"); return false; }
      const { error } = v ? await SB.from("vouchers").update(row).eq("id", v.id) : await SB.from("vouchers").insert(row);
      if (error) throw error; toast(v ? "Voucher saved" : "Voucher added"); await ctx.reload(); },
    onDanger: async () => { const { error } = await SB.from("vouchers").delete().eq("id", v.id); if (error) throw error; toast("Voucher deleted"); await ctx.reload(); }});
}
function usesDialog(c, v, ctx){
  const uses = (c.usesByVoucher.get(v.id) || []).slice().sort((a, b) => b.used_at.localeCompare(a.used_at)), byId = new Map(c.attendees.map(a => [a.id, a]));
  const d = dialog({wide: true, title: `${v.name}: ${uses.length} used`, submit: "",
    body: `<div class="row" style="justify-content:flex-end"><button type="button" class="ghost small" id="usesCsv">Export</button></div>
      <div class="tbl"><table class="rt"><thead><tr><th>Attendee</th><th>ID</th><th>Used</th><th>Scanned by</th><th></th></tr></thead><tbody>${uses.map(u => { const a = byId.get(u.attendee_id);
        return `<tr><td class="main" data-l="Attendee">${esc(a?.full_name || "Deleted")}</td><td data-l="ID">${esc(a?.code)}</td><td data-l="Used">${when(u.used_at)}</td><td data-l="By">${esc(u.used_by) || "—"}</td>
        <td class="actions"><button type="button" class="danger small" data-undo="${u.attendee_id}">Make valid again</button></td></tr>`; }).join("") || '<tr><td colspan="5" class="empty">Not used yet.</td></tr>'}</tbody></table></div>`});
  $("#usesCsv", d).onclick = () => downloadCsv(`voucher-${slug(v.name)}`, ["Name", "ID", "Category", "Used at", "Scanned by"], uses.map(u => { const a = byId.get(u.attendee_id); return [a?.full_name, a?.code, a?.category, new Date(u.used_at).toLocaleString("en-GB"), u.used_by]; }));
  $$("[data-undo]", d).forEach(b => b.onclick = () => armed(b, async () => {
    const { error } = await SB.from("voucher_uses").delete().eq("voucher_id", v.id).eq("attendee_id", b.dataset.undo);
    if (error) return toast(error.message, "bad"); d.close(); toast("Voucher is valid again"); ctx.reload(); }));
}

/* ---------- vouchers: staff scanner (no login) ---------- */
export async function renderVoucherPublic(app, confId){
  app.innerHTML = publicBar + `<main><div class="wrap" id="pg"><div class="empty">Loading…</div></div></main>`;
  const { data: vs, error } = await SB.rpc("c_vouchers_now", {p_conf: confId});
  if (error) throw error;
  const el = $("#pg");
  if (!vs.length) { el.innerHTML = `<div class="scan-wrap"><div class="panel empty"><h2>No voucher is open right now</h2><p>Vouchers appear here up to 12 hours before they open. Ask the event admin for the time.</p></div></div>`; return; }
  let vid = store.get(`voucher:${confId}`); if (!vs.some(v => v.id === vid)) vid = vs[0].id;
  el.innerHTML = `<div class="scan-wrap"><div class="panel" style="display:grid;gap:16px"><div><h1 style="font-size:20px">Voucher scanner</h1><p class="note" style="margin:2px 0 0">Each badge works once. A second scan shows when it was used.</p></div>
      <label>Voucher<select id="vSel">${vs.map(v => `<option value="${v.id}" ${v.id === vid ? "selected" : ""}>${esc(v.name)} (${hm(v.valid_from)} to ${hm(v.valid_to)})</option>`).join("")}</select></label>
      <label>Your name<input id="staff" maxlength="60" value="${esc(store.get("staffName") || "")}" placeholder="So uses show who scanned"></label>
      <div class="scan-count"><b id="vCnt">0</b><span class="note">used on this phone</span></div>
      <button type="button" class="ci-mode go" id="vcScan">${icon("scan")}<span><b>Scan badges</b><small>Full-screen camera that keeps scanning</small></span></button>
      <div class="ci-typerow">${typedField("vc")}${soundToggle("vc")}</div></div></div>`;
  let count = 0;
  $("#vSel").onchange = e => { vid = e.target.value; store.set(`voucher:${confId}`, vid); };
  $("#staff").onchange = e => store.set("staffName", e.target.value.trim());
  wireTyped("vc");
  $("#vcScan").onclick = () => { const v = vs.find(x => x.id === vid); openCam({title: v?.name || "Voucher", sub: "Each badge works once", count: String(count), countLabel: "used here"}); };
  onScan = async code => {
    const { data: r, error } = await SB.rpc("c_redeem", {p_voucher: vid, p_code: code.trim(), p_staff: $("#staff").value.trim()});
    if (error) return flash("bad", "Not accepted", "Can't reach the server", "Scan again.");
    if (r.status === "ok") { count++; $("#vCnt").textContent = count; if ($("#camCount")) $("#camCount").textContent = count; flash("ok", "Voucher accepted, now used", r.name, r.category || ""); }
    else if (r.status === "used") flash("bad", "Already used", r.name, `Used at ${hm(r.used_at)}${r.used_by ? " by " + r.used_by : ""}`);
    else if (r.status === "not_eligible") flash("bad", "Not included", r.name, `This voucher isn't for ${r.category || "this category"}.`);
    else if (r.status === "unknown") flash("bad", "Not accepted", `Badge ${code} not found`, "Check the badge, or send the guest to registration.");
    else if (r.status === "closed") flash("warn", "Not open now", "This voucher isn't valid at this time", `Valid ${hm(r.valid_from)} to ${hm(r.valid_to)}.`);
    else flash("bad", "Not accepted", "Something's off", "Scan again.");
  };
}
