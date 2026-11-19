// Badge and certificate designer + printing. Positions are in millimetres from the top-left of the page,
// so a layout lines up the same on screen and on paper. A printer offset fixes printers that shift the page.
import {SB, $, $$, esc, dateRange, dayLong, toast, upload, qrSvg, barcodeSvg, loadScript, categoriesOf, icon, can, tagsUsed, dialog} from "./core.js";

const PX_PER_MM = 96 / 25.4;
export const FONTS = ["Plus Jakarta Sans", "Arial", "Georgia", "Times New Roman", "Playfair Display", "Cormorant Garamond", "Great Vibes", "Cairo", "Amiri"];
export const KEYS = [["full_name", "Full name"], ["cert_name", "Name on certificate"], ["code", "Main ID"], ["category", "Category"], ["entity", "Entity"],
  ["country", "Country"], ["phone", "Phone"], ["email", "Email"], ["conf_name", "Conference name"], ["conf_dates", "Conference dates"], ["venue", "Venue"],
  ["session_title", "Workshop / session"], ["session_date", "Workshop date"], ["custom", "Fixed text"]];
const SIZES = {"A6 portrait": [105, 148], "A6 landscape": [148, 105], "A5 portrait": [148, 210], "A4 landscape": [297, 210], "A4 portrait": [210, 297], "Card 86×54": [86, 54], "Card 54×86": [54, 86]};

const T = (id, key, x, y, w, size, more = {}) => ({id, type: "text", key, x, y, w, size, font: "Plus Jakarta Sans", weight: 600, align: "center", color: "#15152a", upper: false, show: true, text: "", ...more});
export const DEFAULTS = {
  badge: {w: 105, h: 148, offsetX: 0, offsetY: 0, bg: null, printBg: false, fields: [
    T("conf", "conf_name", 8, 9, 89, 9, {weight: 700, color: "#005072"}),
    T("name", "full_name", 6, 46, 93, 22, {weight: 800, fit: true}),
    T("cat", "category", 8, 66, 89, 12, {weight: 800, upper: true, color: "#005072"}),
    T("ent", "entity", 8, 75, 89, 11, {weight: 600, color: "#333333"}),
    T("ctry", "country", 8, 82, 89, 10, {weight: 500, color: "#666666"}),
    {id: "qr", type: "qr", key: "code", x: 34.5, y: 94, w: 36, h: 36, show: true},
    T("id", "code", 8, 132, 89, 12, {weight: 800}),
    {id: "bar", type: "barcode", key: "code", x: 22, y: 112, w: 61, h: 13, show: false},
  ]},
  certificate: {w: 297, h: 210, offsetX: 0, offsetY: 0, bg: null, printBg: false, fields: [
    T("title", "custom", 30, 40, 237, 30, {font: "Playfair Display", weight: 700, text: "Certificate of Attendance"}),
    T("intro", "custom", 30, 72, 237, 13, {weight: 500, color: "#444444", text: "This is to certify that"}),
    T("name", "cert_name", 20, 88, 257, 32, {font: "Playfair Display", weight: 700, fit: true}),
    T("body", "custom", 40, 118, 217, 13, {weight: 500, color: "#444444", text: "attended"}),
    T("conf", "conf_name", 30, 130, 237, 15, {weight: 700}),
    T("dates", "conf_dates", 30, 142, 237, 12, {weight: 500, color: "#444444"}),
    T("sess", "session_title", 30, 158, 237, 14, {weight: 700, color: "#005072"}),
    T("sdate", "session_date", 30, 168, 237, 11, {weight: 500, color: "#444444"}),
    T("id", "code", 237, 192, 50, 8, {align: "right", color: "#888888", show: false}),
    {id: "qr", type: "qr", key: "code", x: 14, y: 178, w: 20, h: 20, show: false},
  ]},
};
const clone = o => JSON.parse(JSON.stringify(o));
// The appreciation certificate (speakers by default): the attendance one with its own wording.
DEFAULTS.appreciation = {...clone(DEFAULTS.certificate), categories: ["Speaker"], fields: DEFAULTS.certificate.fields.map(f =>
  f.id === "title" ? {...f, text: "Certificate of Appreciation"} : f.id === "body" ? {...f, text: "in recognition of their valuable contribution as a speaker at"} : {...f})};
// Workshop certificates: one design, the workshop name changes per page.
DEFAULTS.workshop = {...clone(DEFAULTS.certificate), fields: DEFAULTS.certificate.fields.map(f => f.id === "body" ? {...f, text: "has attended the workshop entitled"} : {...f})};
export const KINDS = [["badge", "Badge"], ["certificate", "Attendance certificate"], ["appreciation", "Appreciation certificate"], ["workshop", "Workshop certificate"]];
export const workshopsOf = c => c.conf.cert_self?.workshops || [];
// Which certificate someone gets: appreciation if that layout is set up and covers their category, else attendance.
export function certKind(c, a){
  const ap = c.layouts.find(l => l.kind === "appreciation")?.layout;
  // Until the appreciation certificate has a design, everyone gets the attendance one (no blank pages).
  return ap?.bg && (ap.categories || ["Speaker"]).includes(a?.category) ? "appreciation" : "certificate";
}
export const layoutFor = (c, kind) => { const saved = c.layouts.find(l => l.kind === kind)?.layout; return saved ? {...clone(DEFAULTS[kind]), ...saved} : clone(DEFAULTS[kind]); };

function value(f, a, c){
  if (f.key === "custom") return f.text || "";
  if (f.key === "cert_name") return a.cert_name || a.full_name;
  if (f.key === "conf_name") return c.conf.name;
  if (f.key === "conf_dates") return dateRange(c.conf.start_date, c.conf.end_date);
  if (f.key === "venue") return c.conf.venue;
  if (f.key === "session_date") return a.session_day ? dayLong(a.session_day) : "";
  return a[f.key] ?? "";
}
// Does the saved certificate layout show the workshop? Per-workshop certificates need it.
export const certShowsSession = c => layoutFor(c, "certificate").fields.some(f => f.show && f.key === "session_title");

// Badge and certificate faces aren't needed by the rest of the app, so they load the first time something prints.
const PRINT_FONTS = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Amiri:wght@400;700&family=Playfair+Display:wght@500;700&family=Cormorant+Garamond:wght@500;700&family=Great+Vibes&display=swap";
let fontsP = null;
export function printFonts(){
  return fontsP ||= new Promise(res => document.head.appendChild(Object.assign(document.createElement("link"), {rel: "stylesheet", href: PRINT_FONTS, onload: res, onerror: res})))
    .then(() => Promise.all(FONTS.flatMap(f => ["400", "700"].map(w => document.fonts.load(`${w} 16px "${f}"`).catch(() => {})))));
}

/* ---------- certificate as a PDF file (for email): the same layout, rendered with the design behind it ---------- */
const H2C = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js", JSPDF = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
// people: [{...attendee fields, cert_name, session_title, session_day}], one page each.
// Any layout as a PDF file. kind: "badge", "certificate" (workshop emails), "appreciation", or omitted to pick a certificate per person.
export async function certPdf(c, people, {kind = "", onPage = null, onCanvas = null} = {}){
  await Promise.all([loadScript(H2C), loadScript(JSPDF), printFonts()]); await document.fonts.ready;
  const Lof = a => layoutFor(c, kind || certKind(c, a)), L0 = Lof(people[0]);
  const host = Object.assign(document.createElement("div"), {style: "position:fixed;left:-10000px;top:0"}); document.body.appendChild(host);
  const doc = new window.jspdf.jsPDF({orientation: L0.w > L0.h ? "landscape" : "portrait", unit: "mm", format: [L0.w, L0.h]});
  try {
    for (const [i, a] of people.entries()) {
      onPage?.(i + 1, people.length);
      const L = Lof(a), land = L.w > L.h;
      host.innerHTML = `<div class="paper" style="width:${L.w}mm;height:${L.h}mm;${L.bg ? `background:#fff url('${L.bg}') center/100% 100% no-repeat;` : ""}">${L.fields.map(f => fieldHtml(f, a, c)).join("")}</div>`;
      fitText(host);
      const cv = await window.html2canvas(host.firstChild, {scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false});
      onCanvas?.(cv, i);
      if (i) doc.addPage([L.w, L.h], land ? "landscape" : "portrait");
      doc.addImage(cv.toDataURL("image/jpeg", .9), "JPEG", 0, 0, L.w, L.h);
    }
  } finally { host.remove(); }
  return doc.output("blob");
}
// One field as HTML, positioned in mm. dx/dy: printer offset (print only).
function fieldHtml(f, a, c, {dx = 0, dy = 0, editing = false} = {}){
  if (!f.show && !editing) return "";
  const pos = `left:${f.x + dx}mm;top:${f.y + dy}mm;width:${f.w}mm;${f.type !== "text" ? `height:${f.h}mm;` : ""}${!f.show ? "opacity:.25;" : ""}`;
  const data = editing ? ` data-f="${f.id}"` : "";
  if (f.type === "qr") return `<div class="fld"${data} style="${pos}">${qrSvg(value(f, a, c) || "0000")}</div>`;
  if (f.type === "barcode") return `<div class="fld"${data} style="${pos}">${barcodeSvg(value(f, a, c) || "0000")}</div>`;
  const style = `${pos}font-family:'${f.font}',sans-serif;font-size:${f.size}pt;font-weight:${f.weight};text-align:${f.align};color:${f.color};${f.upper ? "text-transform:uppercase;letter-spacing:.04em;" : ""}${f.fit ? "white-space:nowrap;" : ""}`;
  return `<div class="fld"${data}${f.fit ? ` data-fit="${f.size}"` : ""} dir="auto" style="${style}">${esc(value(f, a, c)) || (editing ? `<span style="opacity:.35">${esc(KEYS.find(k => k[0] === f.key)?.[1] || "")}</span>` : "")}</div>`;
}

// Fields marked "fit" stay on one line: the text shrinks until it fits its box (long names on certificates).
export function fitText(root){
  for (const el of $$(".fld[data-fit]", root)) {
    let s = parseFloat(el.dataset.fit); el.style.fontSize = s + "pt";
    while (el.scrollWidth > el.clientWidth + 1 && s > 6) { s -= .5; el.style.fontSize = s + "pt"; }
  }
}

/* ---------- printing ---------- */
// How many cards fit on one A4 sheet, portrait or landscape (whichever holds more).
export function perSheet(L){
  const fit = (W, H) => ({cols: Math.floor(W / L.w), rows: Math.floor(H / L.h), W, H});
  const [p, l] = [fit(210, 297), fit(297, 210)].map(x => ({...x, n: x.cols * x.rows}));
  return l.n > p.n ? l : p;
}
// "0427 3815, 0001-0100" -> test for a code
export function parseIds(text){
  const singles = new Set(), ranges = [];
  for (const t of String(text).split(/[\s,;]+/).filter(Boolean)) {
    const m = t.match(/^(\d+)-(\d+)$/);
    if (m) ranges.push([Number(m[1]), Number(m[2])]); else singles.add(t);
  }
  return code => singles.has(code) || (/^\d+$/.test(code) && ranges.some(([a, b]) => Number(code) >= a && Number(code) <= b));
}
// kind "certificate" picks attendance or appreciation per person, unless exact (the designer prints exactly what it shows).
// full: true prints the design too, false prints only the text (paper with the design already on it); default: the layout's setting.
export async function printDocs(c, kind, people, {test = false, sheet = false, exact = false, full} = {}){
  if (!people.length) return toast("Nobody to print.", "bad");
  await printFonts();
  const Lof = a => layoutFor(c, kind === "certificate" && !exact ? certKind(c, a) : kind);
  const L = Lof(people[0]), S = perSheet(L), nUp = sheet && S.n > 1;
  const style = document.getElementById("pageStyle") || document.head.appendChild(Object.assign(document.createElement("style"), {id: "pageStyle"}));
  style.textContent = nUp ? `@page{size:${S.W}mm ${S.H}mm;margin:0}` : `@page{size:${L.w}mm ${L.h}mm;margin:0}`;
  // The design is a real image, not a CSS background: browsers leave backgrounds out unless "Background graphics" is ticked.
  const card = a => { const L = Lof(a); return `<div class="print-page" style="width:${L.w}mm;height:${L.h}mm">
    ${(full ?? L.printBg) && L.bg ? `<img class="print-bg" src="${esc(L.bg)}" alt="" style="left:${L.offsetX}mm;top:${L.offsetY}mm;width:${L.w}mm;height:${L.h}mm">` : ""}
    ${test ? `<div style="position:absolute;inset:${L.offsetY}mm ${-L.offsetX}mm ${-L.offsetY}mm ${L.offsetX}mm;outline:.3mm dashed #999"></div>` : ""}
    ${L.fields.map(f => fieldHtml(f, a, c, {dx: L.offsetX, dy: L.offsetY})).join("")}</div>`; };
  if (nUp) {
    const sheets = []; for (let i = 0; i < people.length; i += S.n) sheets.push(people.slice(i, i + S.n));
    // Cards are centred on the sheet so the printer's unprintable edge falls in the margin.
    $("#printArea").innerHTML = sheets.map(g => `<div class="print-sheet cut" style="width:${S.W}mm;height:${S.H}mm;grid-template-columns:repeat(${S.cols},${L.w}mm);
      padding:${(S.H - S.rows * L.h) / 2}mm ${(S.W - S.cols * L.w) / 2}mm">${g.map(card).join("")}</div>`).join("");
  } else $("#printArea").innerHTML = people.map(card).join("");
  // The print area is hidden on screen, so show it off-screen while long names are measured and shrunk.
  await document.fonts.ready; const pa = $("#printArea"); pa.style.cssText = "display:block;position:fixed;left:-20000px;top:0"; fitText(pa); pa.style.cssText = "";
  await Promise.all($$("#printArea img").map(i => i.complete ? 0 : new Promise(r => i.onload = i.onerror = r)));
  setTimeout(() => { print(); }, 100);
  // Remember who has a badge, so "not printed yet" picks up only latecomers next time.
  if (kind === "badge" && !test) {
    const at = new Date().toISOString(), ids = people.map(a => a.id);
    for (let i = 0; i < ids.length; i += 300) await SB.from("attendees").update({badge_printed_at: at}).in("id", ids.slice(i, i + 300));
    people.forEach(a => { a.badge_printed_at = at; });
  }
}
addEventListener("afterprint", () => { $("#printArea").innerHTML = ""; });

// Browsers only print without the print window when Chrome is started with --kiosk-printing. This hands the team a ready shortcut.
export function noWindowHelp(){
  const cmd = `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk-printing "${location.href.split("#")[0]}"`;
  const d = dialog({title: "Print with no print window", submit: "",
    body: `<p style="margin:0">Badges and certificates print straight away on this laptop's default printer, with no window to click. It works for every Print button.</p>
      <ol class="nw-steps"><li>Close every Chrome window on this laptop.</li>
        <li>Right-click the desktop, choose <b>New</b> then <b>Shortcut</b>, paste this and press Next:<div class="linkbox"><input readonly value="${esc(cmd)}" aria-label="Shortcut" onfocus="this.select()"><button type="button" class="ghost small" id="nwCopy">Copy</button></div></li>
        <li>Name it <b>JV Connect printing</b> and open the system from it.</li>
        <li>In Windows, set the badge or certificate printer as the <b>default printer</b>, with the right paper size.</li></ol>
      <p class="note" style="margin:0">Run <b>Printer check</b> once after this to confirm the size. A Mac uses the same option: <code>open -a "Google Chrome" --args --kiosk-printing</code></p>`});
  $("#nwCopy", d).onclick = () => navigator.clipboard.writeText(cmd).then(() => toast("Shortcut copied"));
}
// Printer check: one page at the card's exact size. A frame on the edge, a 50 mm square and the word ONCE in the middle
// show at a glance whether the printer shrinks the page (square under 50 mm), cuts it (frame missing) or doubles it (two per card).
export function printCheck(L){
  const style = document.getElementById("pageStyle") || document.head.appendChild(Object.assign(document.createElement("style"), {id: "pageStyle"}));
  style.textContent = `@page{size:${L.w}mm ${L.h}mm;margin:0}`;
  const tick = (n, axis) => Array.from({length: Math.floor(n / 10) + 1}, (_, i) => axis === "x"
    ? `<i style="position:absolute;left:${i * 10}mm;top:0;width:.2mm;height:${i % 5 ? 2.5 : 5}mm;background:#000"></i>`
    : `<i style="position:absolute;top:${i * 10}mm;left:0;height:.2mm;width:${i % 5 ? 2.5 : 5}mm;background:#000"></i>`).join("");
  const sq = Math.min(50, L.w - 16, L.h - 40), t = (y, s, w, txt) => `<div style="position:absolute;left:0;right:0;top:${y}mm;text-align:center;font:${w} ${s}pt/1.25 'Instrument Sans',Arial,sans-serif">${txt}</div>`;
  $("#printArea").innerHTML = `<div class="print-page" style="width:${L.w}mm;height:${L.h}mm;color:#000">
    <div style="position:absolute;inset:0;border:.5mm solid #000"></div>${tick(L.w, "x")}${tick(L.h, "y")}
    ${t(7, 9, 700, "TOP")}${t(L.h - 9, 9, 700, "BOTTOM")}
    ${t(14, 7.5, 400, `This page is ${L.w} × ${L.h} mm. It should come out once, full size, on one card.`)}
    <div style="position:absolute;left:${(L.w - sq) / 2}mm;top:${(L.h - sq) / 2 - 6}mm;width:${sq}mm;height:${sq}mm;border:.4mm solid #000;display:grid;place-items:center;text-align:center;font:400 7pt/1.3 Arial,sans-serif">
      <div><b style="font:800 22pt/1 'Instrument Sans',Arial,sans-serif;letter-spacing:.06em">ONCE</b><br>Square: ${sq} mm each side</div></div>
    ${t((L.h + sq) / 2 - 2, 7, 400, "Two pages on one card, or ONCE twice: set Pages per sheet to 1 and turn off two-sided.<br>Square smaller than " + sq + " mm: set Scale to 100% (not Fit).<br>Frame or TOP/BOTTOM missing: set Paper to " + L.w + " × " + L.h + " mm and Margins to None.")}</div>`;
  setTimeout(() => print(), 150);
}

/* ---------- design files: a print-ready PDF (or image) from the designer becomes the page background ---------- */
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const MM = 25.4 / 72;
// Render page 1 cut at its trim box (print PDFs carry bleed and crop marks around it). Returns a JPEG file and the size in mm.
async function pdfDesign(file){
  await loadScript(PDFJS);
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc ||= URL.createObjectURL(new Blob([`importScripts("${PDFJS_WORKER}")`], {type: "text/javascript"}));
  const bytes = new Uint8Array(await file.arrayBuffer());
  // pdf.js doesn't expose TrimBox: read it from the file (design apps write it as plain text).
  const raw = new TextDecoder("latin1").decode(bytes), m = raw.match(/\/TrimBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/);
  const page = await (await lib.getDocument({data: bytes}).promise).getPage(1);
  const [vx0, vy0, vx1, vy1] = page.view, trim = m ? m.slice(1).map(Number) : [vx0, vy0, vx1, vy1];
  const wPt = trim[2] - trim[0], hPt = trim[3] - trim[1];
  const scale = Math.min(300 / 72, 4000 / Math.max(wPt, hPt)), vp = page.getViewport({scale});
  const full = Object.assign(document.createElement("canvas"), {width: Math.ceil(vp.width), height: Math.ceil(vp.height)});
  const fctx = full.getContext("2d"); fctx.fillStyle = "#fff"; fctx.fillRect(0, 0, full.width, full.height);
  await page.render({canvasContext: fctx, viewport: vp}).promise;
  const cut = Object.assign(document.createElement("canvas"), {width: Math.round(wPt * scale), height: Math.round(hPt * scale)});
  cut.getContext("2d").drawImage(full, (trim[0] - vx0) * scale, (vy1 - trim[3]) * scale, cut.width, cut.height, 0, 0, cut.width, cut.height);
  const blob = await new Promise(r => cut.toBlob(r, "image/jpeg", .9));
  return {file: new File([blob], file.name.replace(/\.pdf$/i, "") + ".jpg", {type: "image/jpeg"}), canvas: cut, w: Math.round(wPt * MM * 2) / 2, h: Math.round(hPt * MM * 2) / 2};
}
// The tallest empty strip across the design, in mm from the top: that's where the name goes.
function blankBand(canvas, hMm){
  const H = Math.round(hMm * 2), W = Math.round(canvas.width / canvas.height * H), sm = Object.assign(document.createElement("canvas"), {width: W, height: H});
  const g = sm.getContext("2d"); g.drawImage(canvas, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data, x0 = Math.round(W * .06), x1 = W - x0;
  let best = [0, 0], start = -1;
  for (let y = 0; y <= H; y++) {
    let ink = 0; if (y < H) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; if (d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11 < 225) ink++; }
    if (y < H && ink <= 1) { if (start < 0) start = y; } else if (start >= 0) { if (y - start > best[1] - best[0]) best = [start, y]; start = -1; }
  }
  return {top: best[0] / 2, bottom: best[1] / 2};
}
// Lay the fields out on a design: the design already has the wording, so keep only what changes per person, centred in the empty strip.
function placeOnDesign(L, kind, band){
  const H = band.bottom - band.top, line = pt => pt * 0.3528 * 1.3, get = id => L.fields.find(f => f.id === id);
  if (!get("name")) return; // an older custom layout: leave it as it is
  L.fields.forEach(f => { f.show = false; });
  const text = (f, y, size) => Object.assign(f, {show: true, x: 6, w: L.w - 12, y: Math.round(y * 2) / 2, size, align: "center", fit: true});
  if (kind === "badge") {
    const name = get("name"), cat = get("cat"), id = get("id"), qr = get("qr");
    let y = band.top + 3; text(name, y, 20); y += line(20) + 1.5;
    if (cat) { text(cat, y, 12); y += line(12) + 3; }
    const q = Math.min(32, H - (y - band.top) - line(12) - 6);
    if (qr && q >= 16) { Object.assign(qr, {show: true, w: q, h: q, x: Math.round((L.w - q) / 2 * 2) / 2, y: Math.round(y * 2) / 2}); y += q + 2; }
    if (id) text(id, y, 12);
  } else {
    const name = get("name"), size = Math.max(18, Math.min(34, Math.floor(H / 0.3528 / 1.3 * .75)));
    text(name, band.top + (H - line(size)) / 2, size);
  }
}

/* ---------- designer: a Print tab for everyday use, an Edit layout tab for setting the page up ---------- */
const ui = {kind: "badge", tab: "print", sel: "name", grid: true, sample: null, L: null, dirty: false, full: {}, ws: ""};
export function render(el, c, ctx){
  if (!can("manage")) ui.tab = "print"; // only owners and admins edit layouts
  printFonts(); // the preview uses the real faces; they swap in once loaded
  if (!ui.L || ui.L.__conf !== c.conf.id || ui.L.__kind !== ui.kind) { ui.L = layoutFor(c, ui.kind); ui.L.__conf = c.conf.id; ui.L.__kind = ui.kind; ui.dirty = false; }
  const L = ui.L, edit = ui.tab === "edit", noun = ui.kind === "badge" ? "badge" : "certificate";
  const full = L.bg ? (ui.full[ui.kind] ?? L.printBg ?? true) : false;
  const wsList = workshopsOf(c), ws = ui.kind === "workshop" ? (wsList.find(w => w.id === ui.ws) || wsList[0]) : null;
  const withWs = a => ws ? {...a, session_title: ws.title, session_day: ws.day} : ui.kind === "workshop" ? {...a, session_title: "Workshop title", session_day: ""} : a;
  const sample = withWs(c.attendees.find(a => a.id === ui.sample) || c.attendees[0] || {code: "0427", full_name: "Lina Haddad", cert_name: "Dr. Lina Haddad", category: "Speaker", entity: "Jordan University Hospital", country: "Jordan", phone: "", email: ""});
  if (!L.fields.some(f => f.id === ui.sel)) ui.sel = L.fields[0]?.id;
  const f = L.fields.find(x => x.id === ui.sel);
  const sizeName = Object.entries(SIZES).find(([, [w, h]]) => w === L.w && h === L.h)?.[0] || "Custom";
  const cats = [...new Set(c.attendees.map(a => a.category).filter(Boolean))].sort(), nCat = k => c.attendees.filter(a => a.category === k).length;

  const printTab = `<div class="panel form"><h3>How to print</h3>
      ${L.bg ? `<div class="mode-pick" role="radiogroup" aria-label="What to print">
        <label class="mode"><input type="radio" name="pMode" value="full" ${full ? "checked" : ""}><b>Full design</b><span>The design and the names, on blank paper or card.</span></label>
        <label class="mode"><input type="radio" name="pMode" value="text" ${full ? "" : "checked"}><b>Text only</b><span>Just the names, for ${noun}s that already have the design printed on them.</span></label></div>`
      : `<p class="note" style="margin:0">No design yet, so only the text prints. To print on your designer's artwork, add their PDF in <button type="button" class="linkish" data-tab="edit">Edit layout</button>.</p>`}
      ${ui.kind === "workshop" ? (wsList.length ? `<label>Workshop<select id="pWs">${wsList.map(w => `<option value="${esc(w.id)}" ${w === ws ? "selected" : ""}>${esc(w.title)}</option>`).join("")}</select></label>`
        : `<p class="note" style="margin:0">Add your workshops on the Certificates page (Certificate by badge ID) to print a certificate per workshop.</p>`) : ""}
      <label>Who<select id="pWho"><option value="all">Everyone (${c.attendees.length})</option>${cats.map(k => `<option value="cat:${esc(k)}">${esc(k)} (${nCat(k)})</option>`).join("")}
        ${tagsUsed(c).map(t => `<option value="tag:${esc(t)}">Tagged “${esc(t)}” (${c.attendees.filter(a => (a.tags || []).includes(t)).length})</option>`).join("")}
        <option value="attended">Attended at least one session (${c.attendees.filter(a => c.checkinsByCode.has(a.code)).length})</option>
        ${ui.kind === "badge" ? `<option value="new">Badge not printed yet (${c.attendees.filter(a => !a.badge_printed_at).length})</option>` : ""}<option value="ids">Only these IDs or ranges…</option></select></label>
      <textarea id="pIds" hidden placeholder="0427 3815 1200, or a range: 0001-0100" aria-label="IDs or ranges to print"></textarea>
      ${perSheet(L).n > 1 ? `<label>Paper<select id="pSheet"><option value="one">One per page (${L.w} × ${L.h} mm)</option><option value="a4">${perSheet(L).n} per A4 sheet, with cut lines</option></select></label>` : ""}
      <button type="button" class="big-btn" id="pPrint">Print</button>
      <div class="row"><button type="button" class="ghost" id="pTest">Test print one</button><button type="button" class="ghost" id="pCheck" title="One page that shows whether the printer shrinks, cuts or doubles the ${noun}">Printer check</button><button type="button" class="ghost" id="pNoWin" title="Print straight away, without the print window">${icon("print")}Print with no window</button><button type="button" class="ghost" id="pPdf">${icon("download")}Download as PDF</button></div>
      <p class="note" style="margin:0" id="pPdfNote">Download makes one PDF with the full design, to send by email or WhatsApp.</p></div>`;

  const editTab = `<div class="panel form"><h3>Design</h3>
      <label class="drop">${icon("upload", "ic lg")}<b>${L.bg ? "Replace the design" : "Add the design"}</b><span>The print PDF from your designer, or an image. A PDF is cut at its crop marks and sets the page size; the name is centred in the empty space.</span>
        <input type="file" id="pBg" accept="application/pdf,image/png,image/jpeg,image/webp"></label>
      ${L.bg ? `<button type="button" class="ghost small" id="pBgOff" style="justify-self:start">Remove the design</button>` : ""}</div>
    ${ui.kind === "appreciation" ? `<div class="panel form"><h3>Given to</h3><p class="note" style="margin:0">People in these categories get this certificate; everyone else gets the attendance certificate.</p>
      <div class="row">${categoriesOf(c).map(k => `<label class="check"><input type="checkbox" data-apcat value="${esc(k)}" ${(L.categories || []).includes(k) ? "checked" : ""}> ${esc(k)}</label>`).join("") || '<span class="note">No categories yet.</span>'}</div></div>` : ""}
    <div class="panel"><h3>Fields</h3><div class="field-list" style="margin-top:8px">${L.fields.filter(x => x.show || !L.bg || x.id === ui.sel).map(x => `<button type="button" data-sel="${x.id}" aria-pressed="${x.id === ui.sel}" class="${x.show ? "" : "off"}">${x.type === "qr" ? "QR code" : x.type === "barcode" ? "Barcode" : esc(KEYS.find(k => k[0] === x.key)?.[1] || x.key)}${x.key === "custom" && x.text ? `: ${esc(x.text.slice(0, 18))}` : ""}</button>`).join("")}</div>
      ${L.bg && L.fields.some(x => !x.show) ? `<label style="margin-top:8px">Show a hidden field<select id="pUnhide"><option value="">Choose…</option>${L.fields.filter(x => !x.show).map(x => `<option value="${x.id}">${x.type === "qr" ? "QR code" : x.type === "barcode" ? "Barcode" : esc(KEYS.find(k => k[0] === x.key)?.[1] || x.key)}${x.key === "custom" && x.text ? `: ${esc(x.text.slice(0, 24))}` : ""}</option>`).join("")}</select></label>` : ""}
      <div class="row" style="margin-top:8px"><button type="button" class="soft small" id="addText">Add text</button><button type="button" class="soft small" id="addQr">Add QR</button><button type="button" class="soft small" id="addBar">Add barcode</button></div></div>
    ${f ? `<div class="panel form"><div class="panel-head" style="margin:0"><h3>${f.type === "text" ? "Text field" : f.type === "qr" ? "QR code" : "Barcode"}</h3><label class="check"><input type="checkbox" data-p="show" ${f.show ? "checked" : ""}> Show</label></div>
      ${f.type === "text" ? `<label>Shows<select data-p="key">${KEYS.map(([k, l]) => `<option value="${k}" ${k === f.key ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        ${f.key === "custom" ? `<label>Text<input data-p="text" value="${esc(f.text)}"></label>` : ""}` : ""}
      <div class="form-grid" style="grid-template-columns:1fr 1fr"><label>Left (mm)<input type="number" step="0.5" data-p="x" value="${f.x}"></label><label>Top (mm)<input type="number" step="0.5" data-p="y" value="${f.y}"></label>
        <label>Width (mm)<input type="number" step="0.5" min="2" data-p="w" value="${f.w}"></label>${f.type !== "text" ? `<label>Height (mm)<input type="number" step="0.5" min="2" data-p="h" value="${f.h}"></label>` : `<label>Size (pt)<input type="number" step="0.5" min="4" data-p="size" value="${f.size}"></label>`}</div>
      ${f.type === "text" ? `<label>Font<select data-p="font">${FONTS.map(x => `<option ${x === f.font ? "selected" : ""} style="font-family:'${x}'">${x}</option>`).join("")}</select></label>
        <div class="form-grid" style="grid-template-columns:1fr 1fr"><label>Weight<select data-p="weight">${[[400, "Regular"], [500, "Medium"], [600, "Semibold"], [700, "Bold"], [800, "Extra bold"]].map(([v, l]) => `<option value="${v}" ${v == f.weight ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label>Colour<input type="color" data-p="color" value="${f.color}"></label></div>
        <div class="seg">${["left", "center", "right"].map(a => `<button type="button" data-align="${a}" aria-pressed="${f.align === a}">${a[0].toUpperCase() + a.slice(1)}</button>`).join("")}</div>
        <label class="check"><input type="checkbox" data-p="upper" ${f.upper ? "checked" : ""}> Capital letters</label>
        <label class="check"><input type="checkbox" data-p="fit" ${f.fit ? "checked" : ""}> Fit on one line (long names get smaller)</label>` : ""}
      <div class="row" style="align-items:center"><div class="nudge">${[["", ""], ["↑", "0,-0.5"], ["", ""], ["←", "-0.5,0"], ["⊕", "center"], ["→", "0.5,0"], ["", ""], ["↓", "0,0.5"], ["", ""]].map(([l, v]) => l ? `<button type="button" class="ghost" data-nudge="${v}" aria-label="${v === "center" ? "Centre on the page" : "Move"}">${l}</button>` : "<span></span>").join("")}</div>
      ${f.id.startsWith("x") ? '<button type="button" class="danger small" id="delFld">Remove field</button>' : ""}</div></div>` : ""}
    <div class="panel form"><h3>Page and printer</h3>
      <label>Page size<select id="pSize">${Object.keys(SIZES).map(k => `<option ${k === sizeName ? "selected" : ""}>${k}</option>`).join("")}<option ${sizeName === "Custom" ? "selected" : ""}>Custom</option></select></label>
      <div class="form-grid" style="grid-template-columns:1fr 1fr"><label>Width (mm)<input type="number" step="1" min="30" data-pg="w" value="${L.w}"></label><label>Height (mm)<input type="number" step="1" min="30" data-pg="h" value="${L.h}"></label>
        <label>Printer shift right (mm)<input type="number" step="0.5" data-pg="offsetX" value="${L.offsetX}"></label><label>Printer shift down (mm)<input type="number" step="0.5" data-pg="offsetY" value="${L.offsetY}"></label></div>
      <p class="note" style="margin:0">If the test print comes out 2 mm too far left, set “shift right” to 2. Negative numbers move left or up.</p></div>`;

  el.innerHTML = `<div class="panel-head print-head"><div class="seg" aria-label="What to work on">${KINDS.map(([k, l]) => `<button type="button" data-kind="${k}" aria-pressed="${k === ui.kind}">${l}</button>`).join("")}</div>
      <div class="row" style="align-items:center">${ui.dirty ? '<span class="pill warn">Not saved</span>' : ""}${edit ? '<button type="button" class="ghost" id="pReset">Reset to default</button>' : ""}${edit || ui.dirty ? '<button type="button" id="pSave">Save layout</button>' : ""}</div></div>
    <div class="designer"><div class="panel stage-panel"><div class="stage" id="stage"></div>
        <div class="row" style="margin-top:12px;align-items:center">${edit ? `<label class="check"><input type="checkbox" id="pGrid" ${ui.grid ? "checked" : ""}> 5 mm grid</label>` : ""}
        <label style="flex:1 1 220px">Preview with<select id="pSample">${c.attendees.slice(0, 500).map(a => `<option value="${a.id}" ${a.id === sample.id ? "selected" : ""}>${esc(a.code)} ${esc(a.full_name)}</option>`).join("") || "<option>Sample attendee</option>"}</select></label></div>
        <p class="note" style="margin-bottom:0">${edit ? "Drag fields on the page, or type exact positions on the right. Arrow keys move the selected field by 0.5 mm (Shift: 5 mm)." : full || !L.bg ? "This is what prints." : "Faded: the design already on the paper. Only the text prints."}</p></div>
      <div class="props"><div class="seg tabs" role="tablist" aria-label="Mode"><button type="button" role="tab" data-tab="print" aria-selected="${!edit}" aria-pressed="${!edit}">${icon("print")}Print</button><button type="button" role="tab" data-tab="edit" aria-selected="${edit}" aria-pressed="${edit}">${icon("settings")}Edit layout</button></div>
        ${edit ? editTab : printTab}</div></div>`;

  // stage: the page, scaled to fit, with fields at their mm positions
  const stage = $("#stage", el), box = stage.parentElement;
  let k = 1, boxW = 0;
  const drawStage = () => {
    boxW = box.clientWidth; k = Math.min(2.2, Math.max(.15, (boxW - 28 - 48) / (L.w * PX_PER_MM))); // panel padding, then stage padding
    stage.innerHTML = `<div style="width:${L.w * PX_PER_MM * k}px;height:${L.h * PX_PER_MM * k}px"><div class="paper${edit ? " editing" : ""}" id="paper" style="width:${L.w}mm;height:${L.h}mm;transform:scale(${k});transform-origin:0 0">
      ${L.bg ? `<img class="paper-bg" src="${esc(L.bg)}" alt="" style="opacity:${edit || full ? 1 : .22}">` : ""}
      ${edit && ui.grid ? `<div class="gridlines" style="background-size:5mm 5mm"></div>` : ""}${L.fields.filter(x => x.show || (edit && !L.bg)).map(x => fieldHtml(x, sample, c, {editing: true})).join("")}</div></div>`;
    if (edit) $$(".fld", stage).forEach(n => n.classList.toggle("sel", n.dataset.f === ui.sel));
    fitText(stage);
  };
  drawStage();
  // Keep the page fitting its space when the window is resized or a tablet turns.
  const ro = new ResizeObserver(() => { if (!document.contains(stage)) return ro.disconnect(); if (Math.abs(box.clientWidth - boxW) > 4) drawStage(); });
  ro.observe(box);
  const changed = () => { ui.dirty = true; };
  const rerender = () => render(el, c, ctx);

  // drag to move (pointer events: mouse, pen and touch). On the Print tab, a click on a field opens it in Edit layout.
  stage.onpointerdown = e => {
    const n = e.target.closest(".fld"); if (!n) return;
    const fld = L.fields.find(x => x.id === n.dataset.f); if (!fld) return;
    if (!edit || ui.sel !== fld.id) { ui.sel = fld.id; ui.tab = "edit"; return rerender(); }
    const sx = e.clientX, sy = e.clientY, ox = fld.x, oy = fld.y; n.setPointerCapture(e.pointerId);
    n.onpointermove = m => { fld.x = Math.round((ox + (m.clientX - sx) / (PX_PER_MM * k)) * 2) / 2; fld.y = Math.round((oy + (m.clientY - sy) / (PX_PER_MM * k)) * 2) / 2;
      n.style.left = fld.x + "mm"; n.style.top = fld.y + "mm"; changed(); };
    n.onpointerup = () => { n.onpointermove = n.onpointerup = null; rerender(); };
  };
  el.onkeydown = e => {
    if (!edit || !f || e.target.closest("input,select,textarea") || !/^Arrow/.test(e.key)) return;
    e.preventDefault(); const s = e.shiftKey ? 5 : .5;
    if (e.key === "ArrowLeft") f.x -= s; if (e.key === "ArrowRight") f.x += s; if (e.key === "ArrowUp") f.y -= s; if (e.key === "ArrowDown") f.y += s;
    changed(); rerender(); $("#stage", el)?.focus();
  };
  stage.tabIndex = 0;

  $$("[data-kind]", el).forEach(b => b.onclick = () => { if (ui.dirty && !confirmLeave()) return; ui.kind = b.dataset.kind; ui.L = null; rerender(); });
  $$("[data-tab]", el).forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; rerender(); });
  $("#pSample").onchange = e => { ui.sample = e.target.value; drawStage(); };
  $("#pSave") && ($("#pSave").onclick = async () => {
    const {__conf, __kind, ...layout} = L;
    const { error } = await SB.from("print_layouts").upsert({conference_id: c.conf.id, kind: ui.kind, layout, updated_at: new Date().toISOString()});
    if (error) return toast(/kind_check/.test(error.message) ? "The database needs a one-time update before the appreciation certificate can be saved." : error.message, "bad");
    const i = c.layouts.findIndex(x => x.kind === ui.kind); const row = {conference_id: c.conf.id, kind: ui.kind, layout};
    i < 0 ? c.layouts.push(row) : (c.layouts[i] = row); ui.dirty = false; toast("Layout saved"); rerender();
  });
  // print and PDF use the layout on screen, saved or not
  const withUnsaved = async fn => { const saved = c.layouts.slice(); const {__conf, __kind, ...layout} = L; const i = c.layouts.findIndex(x => x.kind === ui.kind);
    i < 0 ? c.layouts.push({kind: ui.kind, layout}) : (c.layouts[i] = {...c.layouts[i], layout});
    try { return await fn(); } finally { c.layouts.splice(0, c.layouts.length, ...saved); } };

  if (!edit) {
    $$("[name=pMode]", el).forEach(r => r.onchange = () => { ui.full[ui.kind] = r.value === "full"; rerender(); });
    const pick = () => {
      const who = $("#pWho").value; let people = c.attendees;
      if (who.startsWith("cat:")) people = people.filter(a => a.category === who.slice(4));
      if (who.startsWith("tag:")) people = people.filter(a => (a.tags || []).includes(who.slice(4)));
      if (who === "attended") people = people.filter(a => c.checkinsByCode.has(a.code));
      if (who === "new") people = people.filter(a => !a.badge_printed_at);
      if (who === "ids") { const want = parseIds($("#pIds").value); people = people.filter(a => want(a.code)); }
      return people.slice().sort((a, b) => a.code.localeCompare(b.code, undefined, {numeric: true})).map(withWs);
    };
    const count = () => { const n = pick().length, up = perSheet(L).n, sheet = $("#pSheet")?.value === "a4" && up > 1;
      $("#pPrint").textContent = `Print ${n} ${noun}${n === 1 ? "" : "s"}${L.bg ? (full ? ", full design" : ", text only") : ""}${sheet ? `, ${Math.ceil(n / up)} A4 sheet${Math.ceil(n / up) === 1 ? "" : "s"}` : ""}`;
      $("#pPrint").disabled = !n; $("#pPdf").disabled = !n; };
    $("#pWs") && ($("#pWs").onchange = e => { ui.ws = e.target.value; rerender(); });
    $("#pWho").onchange = e => { $("#pIds").hidden = e.target.value !== "ids"; count(); };
    $("#pIds").oninput = count; $("#pSheet") && ($("#pSheet").onchange = count); count();
    $("#pPrint").onclick = () => withUnsaved(() => printDocs(c, ui.kind, pick(), {sheet: $("#pSheet")?.value === "a4", exact: true, full}));
    $("#pTest").onclick = () => withUnsaved(() => printDocs(c, ui.kind, [sample], {test: true, exact: true, full}));
    $("#pCheck").onclick = () => printCheck(L);
    $("#pNoWin").onclick = noWindowHelp;
    $("#pPdf").onclick = async () => {
      const people = pick(), b = $("#pPdf"), note = $("#pPdfNote"); if (!people.length) return;
      if (people.length > 150) toast(`${people.length} pages take a few minutes. Keep this page open.`);
      b.disabled = true;
      try {
        const blob = await withUnsaved(() => certPdf(c, people.map(a => ({...a, cert_name: a.cert_name || a.full_name})), {kind: ui.kind, onPage: (i, n) => { note.textContent = `Making page ${i} of ${n}…`; }}));
        const url = URL.createObjectURL(blob), name = KINDS.find(x => x[0] === ui.kind)[1];
        Object.assign(document.createElement("a"), {href: url, download: `${people.length === 1 ? `${name} - ${people[0].cert_name || people[0].full_name}` : `${name}s (${people.length})`}.pdf`}).click();
        setTimeout(() => URL.revokeObjectURL(url), 4000); note.textContent = `Downloaded ${people.length} page${people.length === 1 ? "" : "s"}.`;
      } catch (err) { toast(err.message || "The PDF couldn't be made.", "bad"); note.textContent = "Download makes one PDF with the full design, to send by email or WhatsApp."; }
      b.disabled = false;
    };
    return;
  }

  // ---- Edit layout ----
  $$("[data-sel]", el).forEach(b => b.onclick = () => { ui.sel = b.dataset.sel; rerender(); });
  $("#pUnhide") && ($("#pUnhide").onchange = e => { const x = L.fields.find(y => y.id === e.target.value); if (x) { x.show = true; ui.sel = x.id; changed(); rerender(); } });
  $$("[data-p]", el).forEach(inp => inp.oninput = inp.onchange = () => {
    const p = inp.dataset.p, v = inp.type === "checkbox" ? inp.checked : inp.type === "number" ? Number(inp.value) : inp.value;
    f[p] = v; changed();
    if (inp.type === "checkbox" || p === "key" || inp.tagName === "SELECT") rerender(); else drawStage();
  });
  $$("[data-align]", el).forEach(b => b.onclick = () => { f.align = b.dataset.align; changed(); rerender(); });
  $$("[data-nudge]", el).forEach(b => b.onclick = () => { if (b.dataset.nudge === "center") f.x = Math.round((L.w - f.w) / 2 * 2) / 2; else { const [dx, dy] = b.dataset.nudge.split(",").map(Number); f.x += dx; f.y += dy; } changed(); rerender(); });
  $$("[data-pg]", el).forEach(inp => inp.onchange = () => { L[inp.dataset.pg] = Number(inp.value); changed(); rerender(); });
  $("#pSize").onchange = e => { const s = SIZES[e.target.value]; if (s) { [L.w, L.h] = s; changed(); rerender(); } };
  $("#pGrid").onchange = e => { ui.grid = e.target.checked; drawStage(); };
  const add = (type) => { const id = "x" + Date.now().toString(36); L.fields.push(type === "text" ? T(id, "custom", 10, 10, Math.min(80, L.w - 20), 12, {text: "New text"}) : {id, type, key: "code", x: 10, y: 10, w: type === "qr" ? 25 : 50, h: type === "qr" ? 25 : 12, show: true}); ui.sel = id; changed(); rerender(); };
  $("#addText").onclick = () => add("text"); $("#addQr").onclick = () => add("qr"); $("#addBar").onclick = () => add("barcode");
  $("#delFld") && ($("#delFld").onclick = () => { L.fields = L.fields.filter(x => x.id !== f.id); changed(); rerender(); });
  $("#pBg").onchange = async e => {
    const file = e.target.files[0]; if (!file) return; e.target.value = "";
    toast(file.type === "application/pdf" ? "Reading the design…" : "Uploading…");
    try {
      let img = file, canvas;
      if (file.type === "application/pdf") { const d = await pdfDesign(file); img = d.file; canvas = d.canvas; L.w = d.w; L.h = d.h; }
      else { const bmp = await createImageBitmap(file); canvas = Object.assign(document.createElement("canvas"), {width: bmp.width, height: bmp.height}); canvas.getContext("2d").drawImage(bmp, 0, 0); }
      L.bg = await upload(img, `layouts/${c.conf.id}`); L.printBg = true; delete ui.full[ui.kind];
      const band = blankBand(canvas, L.h);
      if (band.bottom - band.top >= 8) placeOnDesign(L, ui.kind, band);
      changed(); rerender(); toast(`Design added, ${L.w} × ${L.h} mm. Check the preview, then save the layout.`);
    } catch (err) { toast(err.message || "That design couldn't be read. Try exporting it again as PDF.", "bad"); }
  };
  $$("[data-apcat]", el).forEach(b => b.onchange = () => { L.categories = $$("[data-apcat]", el).filter(x => x.checked).map(x => x.value); changed(); });
  $("#pBgOff") && ($("#pBgOff").onclick = () => { L.bg = null; L.printBg = false; changed(); rerender(); });
  $("#pReset").onclick = () => { ui.L = Object.assign(clone(DEFAULTS[ui.kind]), {__conf: c.conf.id, __kind: ui.kind}); ui.dirty = true; rerender(); };
}
const confirmLeave = () => { toast("Save or reset this layout first.", "bad"); return false; };
