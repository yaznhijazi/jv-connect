// Voice desk: say (or type) "اطبع باجة محمد", "شهادة رقم 3725", "print badge 4012", "certificate Sama Sari text only".
// The browser turns speech into text (Chrome/Edge/Safari); everything else happens here, nothing is sent anywhere.
// An ID prints straight away; a name prints when only one person matches, otherwise the matches are shown to tap.
import {$, $$, esc, state, toast} from "./core.js";
import {printDocs} from "./print.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const LANG_KEY = "jv-voice-lang";

/* ---------- understanding the sentence ---------- */
const digits = s => String(s).replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x6f0);
export const norm = s => digits(s).toLowerCase().replace(/[ً-ْـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي")
  .replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/[.,،؟?!:;"'()\-_/]+/g, " ").replace(/\s+/g, " ").trim();

// Words that say what to do, or are just filler; whatever is left is the name.
const FILL = new Set(("اطبع اطبعلي اطبعي اطبعو اطبعوا طباعه طبع لو سمحت من فضلك رقم الرقم رقمه ل لل الى الي الو يا ابي بدي اريد ممكن " +
  "باجه باج بادج بادجه البادج الباجه بطاقه البطاقه كرت الكرت شهاده الشهاده شهادات حضور الحضور تقدير نص النص فقط بس بدون تصميم كامل كامله مع التصميم " +
  "دكتور الدكتور دكتوره الدكتوره د استاذ الاستاذ م مهندس " +
  "print please the a an for of to number no id badge badges card certificate cert certificates attendance text only plain full with design dr doctor prof mr mrs ms")
  .split(" "));

export function parse(text){
  const t = norm(text), words = t.split(" ").filter(Boolean);
  const kind = /شهاد|certif|\bcert\b/.test(t) ? "certificate" : /باج|بادج|بطاق|كرت|badge|\bcard\b/.test(t) ? "badge" : "";
  const full = /بدون تصميم|(^| )(ال)?نص( |$)|text|plain/.test(t) ? false : /كامل|مع التصميم|\bfull\b|with design/.test(t) ? true : undefined;
  const code = (t.match(/\d{1,8}/) || [])[0] || "";
  const name = code ? "" : words.filter(w => !FILL.has(w) && !/^\d+$/.test(w)).join(" ");
  return {kind, full, code, name};
}

// Arabic and English spellings of a name reduced to the same consonants: محمد and Mohammad both become "mhmd".
const AR = {"ب": "b", "ت": "t", "ث": "t", "ج": "j", "ح": "h", "خ": "x", "د": "d", "ذ": "z", "ر": "r", "ز": "z", "س": "s", "ش": "c", "ص": "s", "ض": "d",
  "ط": "t", "ظ": "z", "غ": "q", "ف": "f", "ق": "k", "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h"};
export function skel(word){
  let w = norm(word).replace(/\s/g, "");
  if (/[؀-ۿ]/.test(w)) { if (w.length > 3 && w.startsWith("ال")) w = w.slice(2); w = [...w].map(ch => AR[ch] ?? "").join(""); }
  else {
    if (w.length > 4 && /^(al|el)/.test(w)) w = w.slice(2);
    w = w.replace(/kh/g, "X").replace(/sh|ch/g, "C").replace(/gh/g, "Q").replace(/th|dh/g, "t").replace(/ph/g, "f").replace(/[qc]/g, "k").replace(/g/g, "j")
      .replace(/v/g, "f").replace(/p/g, "b").replace(/[^a-zXCQ]/g, "").replace(/[aeiouyw]/g, "").toLowerCase();
  }
  return w.replace(/(.)\1+/g, "$1").replace(/(.)h$/, "$1");
}
const lev = (a, b) => { const d = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) { let p = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; } }
  return d[b.length]; };
const tokenScore = (q, t) => q === t ? 3 : q.length >= 3 && t.startsWith(q) ? 2 : q.length >= 5 && t.length >= 5 && lev(q, t) <= 1 ? 1 : 0;

// People whose name has every spoken word, best first.
export function findPeople(people, name){
  const qs = name.split(" ").filter(Boolean).map(w => [w, skel(w), w.startsWith("ل") && w.length > 3 ? skel(w.slice(1)) : ""]).filter(x => x[1] || x[2]);
  if (!qs.length) return [];
  return people.map(a => {
    const toks = norm(`${a.full_name} ${a.cert_name || ""}`).split(" ").filter(w => !FILL.has(w)).map(skel).filter(Boolean);
    let score = 0;
    for (const [, s1, s2] of qs) { const best = Math.max(0, ...toks.map(t => Math.max(tokenScore(s1, t), s2 ? tokenScore(s2, t) : 0))); if (!best) return null; score += best; }
    return {a, score: score - toks.length * .01};
  }).filter(Boolean).sort((x, y) => y.score - x.score).map(x => x.a);
}

export function byCode(people, code){
  const n = Number(code);
  return people.find(a => a.code === code) || people.find(a => /^\d+$/.test(a.code) && Number(a.code) === n);
}

/* ---------- the panel ---------- */
const MIC = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`;
let rec = null, listening = false;
const lang = () => { try { return localStorage.getItem(LANG_KEY) || "ar-JO"; } catch { return "ar-JO"; } };

// Jovy, the robot on the button. The picture has a blank face screen; the face is drawn here in SVG so the eyes
// can follow the pointer and the expression can show what's happening (listening, printed, not found).
const FACES = {
  idle: `<g class="jd-eyes"><ellipse cx="30" cy="38" rx="6" ry="10"/><ellipse cx="70" cy="38" rx="6" ry="10"/></g><path d="M41 61 Q50 69 59 61"/>`,
  listen: `<g class="jd-eyes"><ellipse cx="30" cy="37" rx="7.5" ry="12"/><ellipse cx="70" cy="37" rx="7.5" ry="12"/></g><circle cx="50" cy="64" r="3.6"/>`,
  happy: `<path d="M22 42 Q30 28 38 42M62 42 Q70 28 78 42"/><path d="M38 58 Q50 72 62 58"/>`,
  oops: `<g class="jd-eyes"><ellipse cx="31" cy="41" rx="5" ry="7"/><ellipse cx="69" cy="41" rx="5" ry="7"/></g><path d="M42 65 Q50 61 58 65"/>`,
  wink: `<g class="jd-eyes"><ellipse cx="30" cy="38" rx="6" ry="10"/></g><path d="M63 40 Q70 31 77 40"/><path d="M41 61 Q50 69 59 61"/>`,
};
let faceT = 0, held = "idle";
// Show a face for ms, or until another call; a held face (listening) comes back after a short one.
function mood(face, ms = 0){
  const f = $("#vcFace"); if (!f) return;
  clearTimeout(faceT); if (!ms) held = face || "idle";
  f.innerHTML = FACES[face || held]; f.dataset.face = face || held;
  if (ms) faceT = setTimeout(() => mood(held), ms);
}
export const button = () => `<button type="button" class="vc-fab" id="vcFab" aria-label="Jovy, voice printing: print a badge or certificate" title="Jovy: say or type what to print">
  <span class="vc-bot" id="vcBot"><img src="assets/mascots/jovy.webp" alt="" draggable="false">
  <svg class="jd-face" id="vcFace" viewBox="0 0 100 80" aria-hidden="true">${FACES.idle}</svg></span></button>`;

let watching = false;
export function wire(){
  const fab = $("#vcFab"); if (!fab) return;
  held = "idle";
  fab.onclick = () => { if (!matchMedia("(prefers-reduced-motion: reduce)").matches) $("#vcBot")?.animate(
      [{transform: "scale(1,1)"}, {transform: "scale(1.1,.86)", offset: .18}, {transform: "scale(.95,1.08)", offset: .45}, {transform: "scale(1,1)"}], {duration: 420});
    $("#vc") ? close() : open(true); };
  if (watching) return;
  watching = true;
  // The eyes lean toward the pointer, a few units at most, so the face stays on its screen.
  addEventListener("pointermove", e => {
    const f = $("#vcFace"), b = $("#vcFab"); if (!f || !b) return;
    const r = b.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 260);
    f.style.setProperty("--jx", (dx / d * 6 * k).toFixed(2)); f.style.setProperty("--jy", (dy / d * 4 * k).toFixed(2));
  }, {passive: true});
  // Blink now and then.
  setInterval(() => { const f = $("#vcFace"); if (!f || document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    f.classList.add("blink"); setTimeout(() => f.classList.remove("blink"), 140); }, 4200);
}

function open(listen){
  close();
  document.body.insertAdjacentHTML("beforeend", `<div class="vc" id="vc" role="dialog" aria-label="Voice printing">
    <div class="vc-top"><span class="vc-t">Jovy · say or type what to print</span>
      ${SR ? `<button type="button" class="vc-lang" id="vcLang" title="Language you speak">${lang() === "ar-JO" ? "عربي" : "EN"}</button>` : ""}
      <button type="button" class="vc-x" id="vcX" aria-label="Close">✕</button></div>
    <div class="vc-say" id="vcSay" dir="auto"><span class="vc-hint">"اطبع باجة محمد"<br>"شهادة رقم 3725"<br>"print badge 4012 text only"</span></div>
    <div class="vc-out" id="vcOut" role="status"></div>
    <form class="vc-row" id="vcForm"><input id="vcIn" dir="auto" autocomplete="off" placeholder="badge 3725, شهادة سما ساري" aria-label="Command">
      ${SR ? `<button type="button" class="vc-mic" id="vcMic" aria-label="Speak">${MIC}</button>` : ""}<button class="vc-go" aria-label="Run">↵</button></form></div>`);
  $("#vcX").onclick = close;
  $("#vcForm").onsubmit = e => { e.preventDefault(); const v = $("#vcIn").value.trim(); if (v) { $("#vcSay").textContent = v; run([v]); $("#vcIn").value = ""; } };
  $("#vcMic") && ($("#vcMic").onclick = () => listening ? rec?.stop() : hear());
  $("#vcLang") && ($("#vcLang").onclick = () => { const n = lang() === "ar-JO" ? "en-US" : "ar-JO"; try { localStorage.setItem(LANG_KEY, n); } catch {} $("#vcLang").textContent = n === "ar-JO" ? "عربي" : "EN"; });
  document.addEventListener("keydown", esc_, true);
  if (listen && SR) hear(); else $("#vcIn").focus();
}
const esc_ = e => { if (e.key === "Escape" && $("#vc")) { e.stopPropagation(); close(); } };
function close(){ rec?.abort(); listening = false; $("#vc")?.remove(); $("#vcFab")?.classList.remove("on"); mood("idle"); document.removeEventListener("keydown", esc_, true); }

function hear(){
  rec?.abort(); rec = new SR(); rec.lang = lang(); rec.interimResults = true; rec.maxAlternatives = 5;
  const box = $("#vc"); listening = true; box?.classList.add("listening"); $("#vcFab")?.classList.add("on"); mood("listen"); say("", "");
  $("#vcSay").innerHTML = `<span class="vc-hint">${lang() === "ar-JO" ? "أسمعك…" : "Listening…"}</span>`;
  rec.onresult = e => { const r = e.results[e.results.length - 1]; $("#vcSay").textContent = r[0].transcript;
    if (r.isFinal) run([...r].map(x => x.transcript)); };
  rec.onerror = e => { if (e.error === "no-speech") say("I didn't hear anything. Tap the mic and speak.", "bad");
    else if (e.error === "not-allowed") say("The microphone is blocked. Allow it from the lock icon in the address bar, or type the command.", "bad");
    else if (e.error !== "aborted") say("Voice isn't working here. Type the command instead.", "bad"); };
  rec.onend = () => { listening = false; $("#vc")?.classList.remove("listening"); $("#vcFab")?.classList.remove("on"); held = "idle"; if ($("#vcFace")?.dataset.face === "listen") mood("idle"); };
  rec.start();
}

function say(html, tone){ const o = $("#vcOut"); if (o) { o.className = `vc-out ${tone || ""}`; o.innerHTML = html; }
  if (tone === "ok") mood("happy", 2000); else if (tone === "bad") mood("oops", 2000); }

// Try each way the browser heard it until one finds somebody.
function run(heard){
  const c = state.c; if (!c) return;
  for (const text of heard) {
    const p = parse(text), kind = p.kind || "badge";
    if (p.code) { const a = byCode(c.attendees, p.code); if (a) return go(c, kind, a, p.full); continue; }
    if (!p.name) continue;
    const found = findPeople(c.attendees, p.name);
    if (found.length === 1) return go(c, kind, found[0], p.full);
    if (found.length) return choose(c, kind, found.slice(0, 6), p.full, found.length);
  }
  const p = parse(heard[0] || "");
  say(`<p style="margin:0">${p.code ? `Nobody has ID <b>${esc(p.code)}</b>.` : p.name ? `Nobody called <b dir="auto">${esc(p.name)}</b>. Try the ID instead.` : "Say a name or an ID, for example “باجة 3725”."}</p>`, "bad");
}

function choose(c, kind, list, full, total){
  say(`<p class="vc-q">${total > list.length ? `${total} people match. The closest:` : "Which one?"}</p>${list.map(a => `<button type="button" class="vc-p" data-vp="${a.id}">
      <span class="vc-id num">${esc(a.code)}</span><span dir="auto"><b>${esc(a.full_name)}</b>${a.category ? `<small>${esc(a.category)}</small>` : ""}</span></button>`).join("")}`);
  mood("wink", 1400);
  $$("[data-vp]").forEach(b => b.onclick = () => go(c, kind, c.attendees.find(a => a.id === b.dataset.vp), full));
}

function go(c, kind, a, full){
  say(`<p style="margin:0"><span class="vc-ok">✓</span> Printing the ${kind === "certificate" ? "certificate" : "badge"}${full === false ? ", text only" : full ? ", full design" : ""} for <b dir="auto">${esc(a.full_name)}</b> <span class="num">(${esc(a.code)})</span></p>`, "ok");
  printDocs(c, kind, [a], full === undefined ? {} : {full}).catch(e => toast(e.message, "bad"));
}
