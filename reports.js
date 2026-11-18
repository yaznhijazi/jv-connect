// Reports: every table can be exported to CSV (opens in Excel, keeps Arabic names and leading zeros).
import {$, $$, icon, esc, t5, hm, dayShort, money, downloadCsv, slug, hallColor, hallName, daysBetween, loadScript, toast, dateRange} from "./core.js";
import {printDocs} from "./print.js";
import {formOf} from "./regform.js";

const REPORTS = [["summary", "Summary"], ["sessions", "Sessions"], ["people", "People"], ["money", "Money"], ["certs", "Certificates"], ["log", "Check-in log"]];
const ui = {r: "summary", group: "category", minSessions: 1, day: "", sort: "time", q: "", hall: "", open: ""};

const table = (head, rows, empty = "Nothing to show yet.") => `<div class="tbl"><table class="rt rep"><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${head.length}" class="empty">${empty}</td></tr>`}</tbody></table></div>`;
const bar = (v, max, color) => `<div style="display:flex;align-items:center;gap:8px"><div class="meter" style="flex:1;--hc:${color || "var(--accent)"}"><i style="width:${max ? Math.min(100, 100 * v / max) : 0}%"></i></div></div>`;
const pct = (a, b) => b ? Math.round(100 * a / b) + "%" : "—";

export function render(el, c){
  // People = groups + days + no-shows; Money = fees + vouchers (each part keeps its own export).
  const pages = {summary, sessions, certs, log,
    people: (box, c, rr) => { box.innerHTML = `<div id="rp1"></div><div id="rp2" class="rep-gap"></div><div id="rp3" class="rep-gap"></div>`; groups($("#rp1", box), c, rr); days($("#rp2", box), c); noshow($("#rp3", box), c); },
    money: (box, c) => { box.innerHTML = `<div id="rm1"></div><div id="rm2" class="rep-gap"></div>`; fees($("#rm1", box), c); vouchers($("#rm2", box), c); }};
  if (!pages[ui.r]) ui.r = "summary";
  el.innerHTML = `<div class="rep-top"><div class="report-nav seg" role="tablist">${REPORTS.map(([k, l]) => `<button type="button" role="tab" data-r="${k}" aria-pressed="${k === ui.r}">${l}</button>`).join("")}</div>
      <div class="row rep-acts"><button type="button" class="ghost" id="repPrint">${icon("print")}Print summary</button><button type="button" id="repXlsx">${icon("download")}Download all as Excel</button></div></div><div id="rep"></div>`;
  $$("[data-r]", el).forEach(b => b.onclick = () => { ui.r = b.dataset.r; render(el, c); });
  $("#repXlsx", el).onclick = e => workbook(c, e.currentTarget);
  $("#repPrint", el).onclick = () => printSummary(c);
  pages[ui.r]($("#rep", el), c, () => render(el, c));
}

/* ---------- numbers shared by the summary, the Excel file and the printout ---------- */
function stats(c){
  const rows = c.sessions.map(s => { const k = c.checkinsBySession.get(s.id) || [], cap = c.hallById.get(s.hall_id)?.capacity;
    return {s, n: k.length, cap, fill: cap ? k.length / cap : null, late: k.filter(x => x.late).length, nb: k.filter(x => x.source === "notebook").length}; });
  const came = c.attendees.filter(a => c.checkinsByCode.has(a.code)).length;
  const capped = rows.filter(r => r.cap && r.n), avg = capped.length ? Math.round(100 * capped.reduce((t, r) => t + r.fill, 0) / capped.length) : null;
  const late = rows.reduce((t, r) => t + r.late, 0);
  const dayList = [...new Set(c.sessions.map(s => s.day))].sort();
  const byDay = dayList.map(d => { const ids = new Set(c.sessions.filter(s => s.day === d).map(s => s.id)), k = c.checkins.filter(x => ids.has(x.session_id));
    return {d, n: k.length, people: new Set(k.map(x => x.code)).size}; });
  const byHall = c.halls.map(h => ({h, n: rows.filter(r => r.s.hall_id === h.id).reduce((t, r) => t + r.n, 0)})).filter(x => x.n).sort((a, b) => b.n - a.n);
  return {rows, came, avg, late, byDay, byHall, over: rows.filter(r => r.cap && r.n > r.cap), empty: rows.filter(r => !r.n), top: rows.slice().sort((a, b) => b.n - a.n).filter(r => r.n).slice(0, 6)};
}

function summary(el, c){
  const st = stats(c), reg = c.attendees.length;
  const notes = [];
  if (st.over.length) notes.push(["bad", "alert", `${st.over.length} session${st.over.length > 1 ? "s" : ""} went over the seat count`, st.over.map(r => `${r.s.title} (${r.n} of ${r.cap})`).slice(0, 3).join(", ")]);
  if (st.empty.length) notes.push(["", "clock", `${st.empty.length} session${st.empty.length > 1 ? "s" : ""} had no check-ins`, "Lunch symposia and side rooms often aren't scanned. Add them from a notebook if they were."]);
  const lateP = c.checkins.length ? Math.round(100 * st.late / c.checkins.length) : 0;
  if (lateP >= 20) notes.push(["warn", "clock", `${lateP}% of check-ins were late`, "Consider opening the doors earlier, or moving the late cut-off in Settings."]);
  if (reg && st.came < reg) notes.push(["", "user", `${reg - st.came} registered people never checked in`, "They're listed under People, with their phone and email, to follow up."]);
  el.innerHTML = `<div class="kpis">
      <div class="panel kpi"><span>Came at least once</span><strong>${st.came}</strong><small>${pct(st.came, reg)} of ${reg} registered</small></div>
      <div class="panel kpi"><span>Check-ins</span><strong>${c.checkins.length}</strong><small>across ${c.sessions.length} sessions</small></div>
      <div class="panel kpi"><span>Seats filled</span><strong>${st.avg == null ? "—" : st.avg + "%"}</strong><small>average per session</small></div>
      <div class="panel kpi"><span>Came late</span><strong>${pct(st.late, c.checkins.length)}</strong><small>${st.late} check-ins</small></div></div>
    <div class="rep-charts">
      <div class="panel">${head("Check-ins by day", `${st.byDay.map(d => `${dayShort(d.d)}: ${d.people} people`).join(", ")}`)}${barsV(st.byDay.map(d => ({v: d.n, label: dayShort(d.d), tip: `${dayShort(d.d)}: ${d.n} check-ins, ${d.people} people`})), "Check-ins by day")}</div>
      <div class="panel">${head("Check-ins by hall", "")}${barsH(st.byHall.map(x => ({v: x.n, label: x.h.name.replace(/^(Main Hall|Breakout \d+)\s*[–-]\s*/, ""), tip: `${x.h.name}: ${x.n}`, color: hallColor(c, x.h.id)})), "Check-ins by hall", 420, 120)}</div></div>
    ${notes.length ? `<div class="rep-notes">${notes.map(([tone, ic, t, sub]) => `<div class="rep-note ${tone}">${icon(ic)}<div><b>${esc(t)}</b><span>${esc(sub)}</span></div></div>`).join("")}</div>` : ""}
    <div class="panel">${head("Fullest sessions", "", `<button type="button" class="ghost small" id="toSess">All sessions ${icon("chevron", "ic sm")}</button>`)}
      <div class="rep-list">${st.top.map(r => sessRow(c, r, true)).join("") || '<p class="empty">No check-ins yet.</p>'}</div></div>`;
  $("#toSess", el).onclick = () => { ui.r = "sessions"; ui.sort = "most"; render($("#page"), c); };
  wireRows(el, c);
}
const tone = f => f == null ? "" : f > 1 ? "bad" : f >= .9 ? "warn" : "";
// One session line; tap it to see who came.
function sessRow(c, r, withDay){
  const open = ui.open === r.s.id;
  return `<div class="rep-row${open ? " open" : ""}" style="--hc:${hallColor(c, r.s.hall_id)}" ${r.n ? `data-open="${r.s.id}" tabindex="0" role="button" aria-expanded="${open}"` : ""}>
    <div class="rep-time num"><b>${t5(r.s.start_time)}</b><span>${withDay ? esc(dayShort(r.s.day)) : t5(r.s.end_time)}</span></div>
    <div class="rep-title"><b>${esc(r.s.title)}</b><span class="hall-tag"><i class="hdot"></i>${esc(hallName(c, r.s.hall_id))}</span></div>
    <div class="rep-fill"><div class="rep-n num"><b>${r.n}</b>${r.cap ? `<span>of ${r.cap}</span>` : "<span>checked in</span>"}${r.cap ? `<em class="${tone(r.fill)}">${pct(r.n, r.cap)}</em>` : ""}</div>
      ${r.cap ? `<span class="meter ${tone(r.fill)}"><i style="width:${Math.min(100, 100 * r.fill)}%"></i></span>` : ""}</div>
    <div class="rep-extra">${r.late ? `<span class="pill warn">${r.late} late</span>` : ""}${r.nb ? `<span class="pill acc">${r.nb} from notebook</span>` : ""}</div>
    <div class="rep-act">${r.n ? icon(open ? "down" : "chevron") : ""}</div></div>
    ${open ? `<div class="rep-who">${(c.checkinsBySession.get(r.s.id) || []).slice().sort((a, b) => a.at.localeCompare(b.at)).map(k => { const a = c.byCode.get(k.code);
      return `<span class="who-chip ${k.late ? "late" : ""}" title="${esc(k.source === "notebook" ? "From the notebook" : "In at " + hm(k.at))}"><b class="num">${esc(k.code)}</b> ${esc(a?.full_name || "Not on the list")}</span>`; }).join("")}
      <button type="button" class="ghost small" data-x="${r.s.id}">${icon("download")}Download this list</button></div>` : ""}`;
}
function wireRows(el, c){
  const toggle = id => { ui.open = ui.open === id ? "" : id; render($("#page"), c); };
  $$("[data-open]", el).forEach(n => { n.onclick = () => toggle(n.dataset.open); n.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(n.dataset.open); } }; });
  $$("[data-x]", el).forEach(b => b.onclick = e => { e.stopPropagation(); const s = c.sessionById.get(b.dataset.x); downloadCsv(`attendees-${slug(s.title)}-${s.day}`, ATT_H, attRows(c, s)); });
}
const ATT_H = ["Session", "Day", "Start", "Hall", "Badge ID", "Name", "Category", "Entity", "Country", "Checked in", "Status"];
const attRows = (c, s) => (c.checkinsBySession.get(s.id) || []).slice().sort((a, b) => a.at.localeCompare(b.at)).map(k => { const a = c.byCode.get(k.code);
  return [s.title, s.day, t5(s.start_time), hallName(c, s.hall_id), k.code, a?.full_name, a?.category, a?.entity, a?.country, new Date(k.at).toLocaleString("en-GB"), k.source === "notebook" ? "Notebook" : k.late ? "Late" : "On time"]; });

/* ---------- one Excel file with every report, one sheet each ---------- */
async function workbook(c, btn){
  btn.disabled = true;
  try {
    await loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
    const st = stats(c), wb = XLSX.utils.book_new(), add = (name, rows) => { const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = rows[0].map((_, i) => ({wch: Math.min(48, Math.max(8, ...rows.slice(0, 200).map(r => String(r[i] ?? "").length + 2)))})); XLSX.utils.book_append_sheet(wb, ws, name); };
    add("Summary", [["Report", c.conf.name], ["Dates", dateRange(c.conf.start_date, c.conf.end_date)], ["Venue", c.conf.venue || ""], [],
      ["Registered", c.attendees.length], ["Came at least once", st.came], ["Check-ins", c.checkins.length], ["Sessions", c.sessions.length],
      ["Average seats filled %", st.avg ?? ""], ["Late check-ins", st.late], [], ["Day", "Check-ins", "People"], ...st.byDay.map(d => [d.d, d.n, d.people]), [], ["Hall", "Check-ins"], ...st.byHall.map(x => [x.h.name, x.n])]);
    add("Sessions", [["Day", "Start", "End", "Session", "Hall", "Attended", "Capacity", "Seats filled %", "Late", "From notebook"],
      ...st.rows.map(r => [r.s.day, t5(r.s.start_time), t5(r.s.end_time), r.s.title, hallName(c, r.s.hall_id), r.n, r.cap ?? "", r.cap ? Math.round(100 * r.n / r.cap) : "", r.late, r.nb])]);
    add("Who attended", [ATT_H, ...c.sessions.flatMap(s => attRows(c, s))]);
    const grp = key => { const m = new Map(); for (const a of c.attendees) { const g = a[key] || "Not set", r = m.get(g) || [g, 0, 0, 0]; r[1]++; if (c.checkinsByCode.has(a.code)) r[2]++; if (a.fee_paid) r[3]++; m.set(g, r); }
      return [[key[0].toUpperCase() + key.slice(1), "Registered", "Attended", "Fees paid"], ...[...m.values()].sort((a, b) => b[1] - a[1])]; };
    add("By category", grp("category")); add("By country", grp("country"));
    add("No-shows", [["Name", "ID", "Category", "Entity", "Country", "Phone", "Email"], ...c.attendees.filter(a => !c.checkinsByCode.has(a.code)).map(a => [a.full_name, a.code, a.category, a.entity, a.country, a.phone, a.email])]);
    add("Fees", [["Name", "ID", "Category", "Fee (JOD)", "Paid", "Note"], ...c.attendees.filter(a => Number(a.fee_amount)).map(a => [a.full_name, a.code, a.category, Number(a.fee_amount), a.fee_paid ? "Yes" : "No", a.fee_note || ""])]);
    const qs = formOf(c.conf).questions;
    if (qs.length) add("Registration answers", [["ID", "Name", "Category", ...qs.map(q => q.label)], ...c.attendees.slice().sort((a, b) => a.code.localeCompare(b.code, undefined, {numeric: true})).map(a => [a.code, a.full_name, a.category, ...qs.map(q => (a.answers || {})[q.id] || "")])]);
    const byId = new Map(c.attendees.map(a => [a.id, a]));
    add("Vouchers", [["Voucher", "Name", "ID", "Category", "Used at", "Scanned by"], ...c.uses.map(u => { const a = byId.get(u.attendee_id), v = c.vouchers.find(x => x.id === u.voucher_id); return [v?.name, a?.full_name, a?.code, a?.category, u.used_at ? new Date(u.used_at).toLocaleString("en-GB") : "", u.used_by || ""]; })]);
    XLSX.writeFile(wb, `report-${slug(c.conf.name)}.xlsx`);
    toast("Excel file downloaded");
  } catch (err) { toast(err.message || "The Excel file couldn't be made.", "bad"); }
  btn.disabled = false;
}

/* ---------- one-page printable summary ---------- */
function printSummary(c){
  const st = stats(c), reg = c.attendees.length, mx = Math.max(1, ...st.byDay.map(d => d.n)), hx = Math.max(1, ...st.byHall.map(x => x.n));
  const style = document.getElementById("pageStyle") || document.head.appendChild(Object.assign(document.createElement("style"), {id: "pageStyle"}));
  style.textContent = "@page{size:A4 portrait;margin:14mm}";
  const barRow = (label, v, max, color) => `<tr><td>${esc(label)}</td><td style="width:60%"><div style="height:10px;border-radius:5px;background:#e8eef1"><div style="height:10px;border-radius:5px;width:${Math.round(100 * v / max)}%;background:${color};-webkit-print-color-adjust:exact;print-color-adjust:exact"></div></div></td><td style="text-align:right"><b>${v}</b></td></tr>`;
  $("#printArea").innerHTML = `<div class="rep-print">
    <h1>${esc(c.conf.name)}</h1><p class="sub">${esc(dateRange(c.conf.start_date, c.conf.end_date))}${c.conf.venue ? ", " + esc(c.conf.venue) : ""}. Attendance report, ${esc(new Date().toLocaleDateString("en-GB", {day: "numeric", month: "long", year: "numeric"}))}.</p>
    <div class="k">${[[st.came, `came at least once (${pct(st.came, reg)} of ${reg})`], [c.checkins.length, `check-ins, ${c.sessions.length} sessions`], [st.avg == null ? "—" : st.avg + "%", "seats filled on average"], [pct(st.late, c.checkins.length), "of check-ins were late"]]
      .map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join("")}</div>
    <h2>By day</h2><table>${st.byDay.map(d => barRow(`${dayShort(d.d)} (${d.people} people)`, d.n, mx, "#005072")).join("")}</table>
    <h2>By hall</h2><table>${st.byHall.map(x => barRow(x.h.name, x.n, hx, "#00a6cf")).join("")}</table>
    <h2>Fullest sessions</h2><table class="t"><tr><th>Session</th><th>Hall</th><th>Day</th><th>Came</th><th>Seats</th></tr>${st.top.map(r => `<tr><td>${esc(r.s.title)}</td><td>${esc(hallName(c, r.s.hall_id))}</td><td>${esc(dayShort(r.s.day))} ${t5(r.s.start_time)}</td><td><b>${r.n}</b></td><td>${r.cap ? `${r.cap} (${pct(r.n, r.cap)})` : ""}</td></tr>`).join("")}</table>
    ${st.over.length || st.empty.length ? `<p class="sub">${st.over.length ? `${st.over.length} session(s) went over the seat count. ` : ""}${st.empty.length ? `${st.empty.length} session(s) had no check-ins.` : ""}</p>` : ""}
    <p class="foot">JV Connect</p></div>`;
  setTimeout(() => print(), 150);
}
const head = (title, note, btns = "") => `<div class="panel-head"><div><h2>${title}</h2>${note ? `<span class="note">${note}</span>` : ""}</div><div class="row" style="align-items:center">${btns}</div></div>`;

function sessions(el, c, rerender){
  const all = c.sessions.map(s => { const k = c.checkinsBySession.get(s.id) || [], cap = c.hallById.get(s.hall_id)?.capacity;
    return {s, n: k.length, cap, fill: cap ? k.length / cap : null, late: k.filter(x => x.late).length, nb: k.filter(x => x.source === "notebook").length}; });
  const dayList = [...new Set(c.sessions.map(s => s.day))];
  if (ui.day && !dayList.includes(ui.day)) ui.day = "";
  const order = {time: () => 0, most: (a, b) => b.n - a.n, full: (a, b) => (b.fill ?? -1) - (a.fill ?? -1)}[ui.sort || "time"];
  const q = ui.q.trim().toLowerCase();
  const rows = all.filter(r => (!ui.day || r.s.day === ui.day) && (!ui.hall || r.s.hall_id === ui.hall) && (!q || r.s.title.toLowerCase().includes(q))).sort(order);
  const capped = all.filter(r => r.cap && r.n), avg = capped.length ? Math.round(100 * capped.reduce((t, r) => t + r.fill, 0) / capped.length) : null;
  const top = all.slice().sort((a, b) => b.n - a.n)[0], lateN = all.reduce((t, r) => t + r.late, 0);
  const groups = ui.sort && ui.sort !== "time" ? [["", rows]] : dayList.filter(d => !ui.day || d === ui.day).map(d => [d, rows.filter(r => r.s.day === d)]);
  el.innerHTML = `<div class="kpis">
      <div class="panel kpi"><span>Check-ins</span><strong>${c.checkins.length}</strong><small>across ${c.sessions.length} sessions</small></div>
      <div class="panel kpi"><span>Average seats filled</span><strong>${avg == null ? "—" : avg + "%"}</strong><small>sessions with check-ins and a seat count</small></div>
      <div class="panel kpi"><span>Busiest session</span><strong>${top?.n || 0}</strong><small>${top?.n ? esc(top.s.title) : "No check-ins yet"}</small></div>
      <div class="panel kpi"><span>Came in late</span><strong>${pct(lateN, c.checkins.length)}</strong><small>${lateN} check-in${lateN === 1 ? "" : "s"}</small></div></div>
    <div class="panel">${head("Attendance by session", "", `<button type="button" class="ghost small" id="x1">${icon("download")}Summary</button><button type="button" class="small" id="x2">${icon("download")}With attendee IDs</button>`)}
      <div class="toolbar" style="margin-bottom:6px"><div class="seg">${[["", "All days"], ...dayList.map(d => [d, dayShort(d)])].map(([k, l]) => `<button type="button" data-day="${k}" aria-pressed="${(ui.day || "") === k}">${l}</button>`).join("")}</div>
        <label class="search-field" style="flex:1 1 180px">${icon("search")}<input type="search" id="rQ" value="${esc(ui.q)}" placeholder="Find a session" aria-label="Find a session"></label>
        <select id="rHall" aria-label="Hall"><option value="">All halls</option>${c.halls.map(h => `<option value="${h.id}" ${ui.hall === h.id ? "selected" : ""}>${esc(h.name)}</option>`).join("")}</select>
        <select id="rSort" aria-label="Sort"><option value="time">In program order</option><option value="most" ${ui.sort === "most" ? "selected" : ""}>Most attended first</option><option value="full" ${ui.sort === "full" ? "selected" : ""}>Fullest first</option></select></div>
      ${groups.map(([d, list]) => `${d ? `<h3 class="rep-day">${esc(dayShort(d))}<span>${list.reduce((t, r) => t + r.n, 0)} check-ins</span></h3>` : ""}
        <div class="rep-list">${list.map(r => sessRow(c, r, !d)).join("") || '<p class="empty">No sessions match.</p>'}</div>`).join("") || '<p class="empty">No sessions yet.</p>'}
      <p class="note" style="margin:10px 0 0">Tap a session to see who came.</p></div>`;
  $$("[data-day]", el).forEach(b => b.onclick = () => { ui.day = b.dataset.day; rerender(); });
  $("#rSort").onchange = e => { ui.sort = e.target.value; rerender(); };
  $("#rHall").onchange = e => { ui.hall = e.target.value; rerender(); };
  let qT; $("#rQ").oninput = e => { clearTimeout(qT); qT = setTimeout(() => { ui.q = e.target.value; rerender(); const i = $("#rQ"); i.focus(); i.setSelectionRange(9999, 9999); }, 200); };
  wireRows(el, c);
  const attRowsS = s => attRows(c, s), H = ATT_H;
  $("#x1").onclick = () => downloadCsv(`sessions-${slug(c.conf.name)}`, ["Day", "Start", "End", "Session", "Hall", "Attended", "Capacity", "Seats filled %", "Late", "From notebook"],
    all.map(r => [r.s.day, t5(r.s.start_time), t5(r.s.end_time), r.s.title, hallName(c, r.s.hall_id), r.n, r.cap ?? "", r.cap ? Math.round(100 * r.n / r.cap) : "", r.late, r.nb]));
  $("#x2").onclick = () => downloadCsv(`attendees-all-sessions-${slug(c.conf.name)}`, H, c.sessions.flatMap(attRowsS));
}

function days(el, c){
  const list = daysBetween(c.conf.start_date, c.conf.end_date).map(d => { const ids = new Set(c.sessions.filter(s => s.day === d).map(s => s.id));
    const k = c.checkins.filter(x => ids.has(x.session_id)); return {d, sessions: ids.size, checkins: k.length, people: new Set(k.map(x => x.code)).size}; });
  const max = Math.max(1, ...list.map(x => x.people));
  el.innerHTML = `<div class="panel">${head("Attendance by day", "Different people who checked in to at least one session that day", `<button type="button" id="x1">Export</button>`)}
    ${table(["Day", "Sessions", "Check-ins", "People", ""], list.map(x => `<tr><td class="main" data-l="Day">${dayShort(x.d)}</td><td data-l="Sessions" class="num">${x.sessions}</td><td data-l="Check-ins" class="num">${x.checkins}</td><td data-l="People" class="num"><b>${x.people}</b></td><td data-l="">${bar(x.people, max)}</td></tr>`))}</div>`;
  $("#x1").onclick = () => downloadCsv(`days-${slug(c.conf.name)}`, ["Day", "Sessions", "Check-ins", "People"], list.map(x => [x.d, x.sessions, x.checkins, x.people]));
}

function groups(el, c, rerender){
  const key = ui.group, map = new Map();
  for (const a of c.attendees) { const g = a[key] || "Not set", r = map.get(g) || {g, n: 0, came: 0, paid: 0}; r.n++; if (c.checkinsByCode.has(a.code)) r.came++; if (a.fee_paid) r.paid++; map.set(g, r); }
  const rows = [...map.values()].sort((a, b) => b.n - a.n), max = Math.max(1, ...rows.map(r => r.n));
  el.innerHTML = `<div class="panel">${head("Attendees by group", `${c.attendees.length} registered`, `<div class="seg">${[["category", "Category"], ["country", "Country"], ["entity", "Entity"]].map(([k, l]) => `<button type="button" data-g="${k}" aria-pressed="${k === key}">${l}</button>`).join("")}</div><button type="button" id="x1">Export</button>`)}
    ${table([key[0].toUpperCase() + key.slice(1), "Registered", "Attended", "Attendance", "Fees paid", ""], rows.map(r => `<tr><td class="main" data-l="${key}">${esc(r.g)}</td><td data-l="Registered" class="num"><b>${r.n}</b></td><td data-l="Attended" class="num">${r.came}</td><td data-l="Attendance" class="num">${pct(r.came, r.n)}</td><td data-l="Fees paid" class="num">${r.paid}</td><td data-l="">${bar(r.n, max)}</td></tr>`))}</div>`;
  $$("[data-g]", el).forEach(b => b.onclick = () => { ui.group = b.dataset.g; rerender(); });
  $("#x1").onclick = () => downloadCsv(`by-${key}-${slug(c.conf.name)}`, [key, "Registered", "Attended", "Attendance %", "Fees paid"], rows.map(r => [r.g, r.n, r.came, r.n ? Math.round(100 * r.came / r.n) : 0, r.paid]));
}

function fees(el, c){
  const map = new Map();
  for (const a of c.attendees) { const g = a.category || "Not set", r = map.get(g) || {g, n: 0, total: 0, paid: 0}; r.n++; r.total += Number(a.fee_amount); if (a.fee_paid) r.paid += Number(a.fee_amount); map.set(g, r); }
  const rows = [...map.values()].sort((a, b) => b.total - a.total), tot = rows.reduce((s, r) => ({total: s.total + r.total, paid: s.paid + r.paid}), {total: 0, paid: 0});
  const unpaid = c.attendees.filter(a => !a.fee_paid && Number(a.fee_amount) > 0).sort((a, b) => a.full_name.localeCompare(b.full_name));
  el.innerHTML = `<div class="kpis"><div class="panel kpi"><span>Fees due in total</span><strong>${money(tot.total)}</strong><small>JOD</small></div>
      <div class="panel kpi"><span>Collected</span><strong>${money(tot.paid)}</strong><small>${pct(tot.paid, tot.total)} of the total</small></div>
      <div class="panel kpi"><span>Outstanding</span><strong>${money(tot.total - tot.paid)}</strong><small>${unpaid.length} people haven't paid</small></div></div>
    <div class="panel">${head("Fees by category", "", `<button type="button" id="x1">Export</button>`)}
      ${table(["Category", "People", "Due (JOD)", "Collected", "Outstanding", ""], rows.map(r => `<tr><td class="main" data-l="Category">${esc(r.g)}</td><td data-l="People" class="num">${r.n}</td><td data-l="Due" class="num">${money(r.total)}</td><td data-l="Collected" class="num">${money(r.paid)}</td><td data-l="Outstanding" class="num"><b>${money(r.total - r.paid)}</b></td><td data-l="">${bar(r.paid, r.total, "var(--ok)")}</td></tr>`))}</div>
    <div class="panel">${head("Not paid yet", `${unpaid.length} people`, `<button type="button" id="x2">Export</button>`)}
      ${table(["Name", "ID", "Category", "Phone", "Email", "Fee (JOD)"], unpaid.slice(0, 300).map(a => `<tr><td class="main" data-l="Name">${esc(a.full_name)}</td><td data-l="ID">${esc(a.code)}</td><td data-l="Category">${esc(a.category)}</td><td data-l="Phone">${esc(a.phone)}</td><td data-l="Email">${esc(a.email)}</td><td data-l="Fee" class="num">${money(a.fee_amount)}</td></tr>`), "Everyone has paid.")}</div>`;
  $("#x1").onclick = () => downloadCsv(`fees-${slug(c.conf.name)}`, ["Category", "People", "Due", "Collected", "Outstanding"], rows.map(r => [r.g, r.n, r.total, r.paid, r.total - r.paid]));
  $("#x2").onclick = () => downloadCsv(`unpaid-${slug(c.conf.name)}`, ["Name", "ID", "Category", "Entity", "Phone", "Email", "Fee", "Note"], unpaid.map(a => [a.full_name, a.code, a.category, a.entity, a.phone, a.email, a.fee_amount, a.fee_note]));
}

function vouchers(el, c){
  const byId = new Map(c.attendees.map(a => [a.id, a]));
  const rows = c.vouchers.map(v => { const elig = c.attendees.filter(a => !v.categories.length || v.categories.includes(a.category)).length, used = (c.usesByVoucher.get(v.id) || []).length; return {v, elig, used}; });
  el.innerHTML = `<div class="panel">${head("Vouchers", "Used vouchers can't be used again", `<button type="button" id="x1">Export uses</button>`)}
    ${table(["Voucher", "For", "Eligible", "Used", "Not used", ""], rows.map(r => `<tr><td class="main" data-l="Voucher">${esc(r.v.name)}</td><td data-l="For">${r.v.categories.length ? esc(r.v.categories.join(", ")) : "Everyone"}</td><td data-l="Eligible" class="num">${r.elig}</td><td data-l="Used" class="num"><b>${r.used}</b></td><td data-l="Not used" class="num">${r.elig - r.used}</td><td data-l="">${bar(r.used, r.elig)}</td></tr>`), "No vouchers set up.")}</div>`;
  $("#x1").onclick = () => downloadCsv(`voucher-uses-${slug(c.conf.name)}`, ["Voucher", "Name", "ID", "Category", "Used at", "Scanned by"],
    c.uses.map(u => { const a = byId.get(u.attendee_id), v = c.vouchers.find(x => x.id === u.voucher_id); return [v?.name, a?.full_name, a?.code, a?.category, new Date(u.used_at).toLocaleString("en-GB"), u.used_by]; }));
}

function noshow(el, c){
  const list = c.attendees.filter(a => !c.checkinsByCode.has(a.code)).sort((a, b) => a.full_name.localeCompare(b.full_name));
  el.innerHTML = `<div class="panel">${head("No-shows", `${list.length} of ${c.attendees.length} registered never checked in to a session`, `<button type="button" id="x1">Export</button>`)}
    ${table(["Name", "ID", "Category", "Entity", "Country", "Phone", "Email"], list.slice(0, 500).map(a => `<tr><td class="main" data-l="Name">${esc(a.full_name)}</td><td data-l="ID">${esc(a.code)}</td><td data-l="Category">${esc(a.category)}</td><td data-l="Entity">${esc(a.entity)}</td><td data-l="Country">${esc(a.country)}</td><td data-l="Phone">${esc(a.phone)}</td><td data-l="Email">${esc(a.email)}</td></tr>`), "Everyone registered has attended at least once.")}</div>`;
  $("#x1").onclick = () => downloadCsv(`no-shows-${slug(c.conf.name)}`, ["Name", "ID", "Category", "Entity", "Country", "Phone", "Email"], list.map(a => [a.full_name, a.code, a.category, a.entity, a.country, a.phone, a.email]));
}

function certs(el, c, rerender){
  const n = ui.minSessions, list = c.attendees.map(a => ({a, k: new Set((c.checkinsByCode.get(a.code) || []).map(x => x.session_id)).size})).filter(x => x.k >= n).sort((x, y) => x.a.full_name.localeCompare(y.a.full_name));
  el.innerHTML = `<div class="panel">${head("Certificates", `${list.length} people qualify`, `<label style="flex-direction:row;display:flex;align-items:center;gap:8px">At least <input type="number" min="1" id="minS" value="${n}" style="width:72px"> sessions</label><button type="button" class="ghost" id="x1">Export</button><button type="button" id="pr">Print certificates</button>`)}
    ${table(["Name on certificate", "ID", "Category", "Sessions attended"], list.slice(0, 500).map(x => `<tr><td class="main" data-l="Name">${esc(x.a.cert_name || x.a.full_name)}${x.a.cert_name ? "" : ' <span class="pill warn">Using full name</span>'}</td><td data-l="ID">${esc(x.a.code)}</td><td data-l="Category">${esc(x.a.category)}</td><td data-l="Sessions" class="num">${x.k}</td></tr>`), "Nobody qualifies yet.")}</div>`;
  $("#minS").onchange = e => { ui.minSessions = Math.max(1, Number(e.target.value) || 1); rerender(); };
  $("#x1").onclick = () => downloadCsv(`certificates-${slug(c.conf.name)}`, ["Name on certificate", "Full name", "ID", "Category", "Email", "Sessions attended"], list.map(x => [x.a.cert_name || x.a.full_name, x.a.full_name, x.a.code, x.a.category, x.a.email, x.k]));
  $("#pr").onclick = () => printDocs(c, "certificate", list.map(x => x.a));
}

/* ---------- charts (plain SVG, shared with the Overview) ---------- */
// Vertical bars, one series; each bar has a hover tooltip.
export function barsV(items, aria, W = 560){
  const H = 200, top = 18, bot = 24, gap = 6, max = Math.max(1, ...items.map(i => i.v)), bw = (W - gap * (items.length - 1)) / items.length;
  const y = v => top + (H - top - bot) * (1 - v / max);
  let s = `<line class="grid" x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}"/><line class="grid" x1="0" x2="${W}" y1="${y(max)}" y2="${y(max)}" stroke-dasharray="2 4"/><text x="0" y="${y(max) - 5}">${max}</text>`;
  items.forEach((it, i) => { const x = i * (bw + gap), h = y(0) - y(it.v), r = Math.min(4, bw / 2, h);
    s += `<g><title>${esc(it.tip)}</title><rect class="hit" x="${x}" y="${top}" width="${bw}" height="${H - top - bot}"/>`
      + (it.v ? `<path class="bar" d="M${x},${y(0)}V${y(it.v) + r}q0,-${r} ${r},-${r}H${x + bw - r}q${r},0 ${r},${r}V${y(0)}Z"/>` : "")
      + (it.label ? `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(it.label)}</text>` : "") + `</g>`; });
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${s}</svg></div>`;
}
// Horizontal bars for a ranked list; the value sits after the bar.
export function barsH(items, aria, W = 560, lab = 150){
  if (!items.length) return '<p class="empty">No check-ins yet.</p>';
  const row = 30, max = Math.max(1, ...items.map(i => i.v)), span = W - lab - 60, chars = Math.floor(lab / 6.6);
  const s = items.map((it, i) => { const w = Math.max(it.v ? 4 : 0, span * it.v / max), yy = i * row + 7, r = Math.min(4, w);
    return `<g><title>${esc(it.tip)}</title><text x="${lab - 8}" y="${yy + 12}" text-anchor="end">${esc(it.label.length > chars ? it.label.slice(0, chars - 1) + "…" : it.label)}</text>`
      + (it.v ? `<path class="bar" style="fill:${it.color || "var(--accent)"}" d="M${lab},${yy}H${lab + w - r}q${r},0 ${r},${r}V${yy + 16 - r}q0,${r} -${r},${r}H${lab}Z"/>` : "")
      + `<text x="${lab + w + 6}" y="${yy + 12}">${it.v}</text></g>`; }).join("");
  return `<div class="chart"><svg viewBox="0 0 ${W} ${items.length * row}" role="img" aria-label="${esc(aria)}">${s}</svg></div>`;
}

/* ---------- check-in log with filters (the "History" of the old app) ---------- */
const lf = {session: "", hall: "", from: "", to: "", status: "", q: ""};
const statusOf = k => k.source === "notebook" ? "Notebook" : k.late ? "Late" : "On time";
function log(el, c){
  const all = c.checkins.slice().sort((a, b) => b.at.localeCompare(a.at)), dayList = [...new Set(c.sessions.map(s => s.day))].sort();
  const filtered = () => { const q = lf.q.trim().toLowerCase();
    return all.filter(k => { const s = c.sessionById.get(k.session_id), d = s?.day || k.at.slice(0, 10);
      return (!lf.session || k.session_id === lf.session) && (!lf.hall || s?.hall_id === lf.hall) && (!lf.from || d >= lf.from) && (!lf.to || d <= lf.to)
        && (!lf.status || statusOf(k) === lf.status) && (!q || k.code.toLowerCase().includes(q) || (c.byCode.get(k.code)?.full_name || "").toLowerCase().includes(q)); }); };
  const dayOpts = sel => `<option value="">Any day</option>` + dayList.map(d => `<option value="${d}" ${sel === d ? "selected" : ""}>${esc(dayShort(d))}</option>`).join("");
  el.innerHTML = `<div class="panel">${head("Check-in log", "Filter by session, hall, day, status or person. Export saves what you see.", `<button type="button" id="x1">${icon("download")}Export</button>`)}
    <div class="log-filters">
      <label>Session<select id="lfS"><option value="">All sessions</option>${c.sessions.map(s => `<option value="${s.id}" ${lf.session === s.id ? "selected" : ""}>${esc(dayShort(s.day))} ${t5(s.start_time)}, ${esc(s.title)}</option>`).join("")}</select></label>
      <label>Hall<select id="lfH"><option value="">All halls</option>${c.halls.map(h => `<option value="${h.id}" ${lf.hall === h.id ? "selected" : ""}>${esc(h.name)}</option>`).join("")}</select></label>
      <label>From<select id="lfF">${dayOpts(lf.from)}</select></label>
      <label>To<select id="lfT">${dayOpts(lf.to)}</select></label>
      <label>Status<select id="lfSt"><option value="">Any</option>${["On time", "Late", "Notebook"].map(x => `<option ${lf.status === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
      <label>Person<input id="lfQ" type="search" value="${esc(lf.q)}" placeholder="Name or badge ID"></label>
      <button type="button" class="ghost small" id="lfX" style="align-self:end">Clear filters</button></div>
    <div class="kpis log-kpis" id="lfK"></div><div id="lfB"></div></div>`;
  const draw = () => { const rows = filtered();
    $("#lfK").innerHTML = [[rows.length, "Check-ins"], [new Set(rows.map(k => k.code)).size, "People"], [new Set(rows.map(k => k.session_id)).size, "Sessions"], [rows.filter(k => statusOf(k) === "Late").length, "Late"]]
      .map(([v, l]) => `<div class="panel kpi"><span>${l}</span><strong>${v}</strong></div>`).join("");
    $("#lfB").innerHTML = table(["When", "Name", "ID", "Session", "Hall", "Status"], rows.slice(0, 300).map(k => { const a = c.byCode.get(k.code), s = c.sessionById.get(k.session_id), st = statusOf(k);
      return `<tr><td data-l="When">${dayShort(k.at.slice(0, 10))} ${hm(k.at)}</td><td class="main" data-l="Name">${esc(a?.full_name || "Not on the list")}</td><td data-l="ID">${esc(k.code)}</td><td data-l="Session">${esc(s?.title)}</td><td data-l="Hall">${esc(hallName(c, s?.hall_id))}</td>
        <td data-l="Status"><span class="pill ${st === "Notebook" ? "acc" : st === "Late" ? "warn" : "ok"}">${st}</span></td></tr>`; }), all.length ? "No check-ins match these filters." : "No check-ins yet.")
      + (rows.length > 300 ? `<p class="note">Showing the latest 300 of ${rows.length}. Export saves all of them.</p>` : ""); };
  const bind = (id, k) => $(id).oninput = e => { lf[k] = e.target.value; draw(); };
  bind("#lfS", "session"); bind("#lfH", "hall"); bind("#lfF", "from"); bind("#lfT", "to"); bind("#lfSt", "status"); bind("#lfQ", "q");
  $("#lfX").onclick = () => { Object.keys(lf).forEach(k => lf[k] = ""); log(el, c); };
  draw();
  $("#x1").onclick = () => downloadCsv(`check-ins-${slug(c.conf.name)}`, ["When", "Name", "ID", "Category", "Session", "Day", "Hall", "Status"],
    filtered().map(k => { const a = c.byCode.get(k.code), s = c.sessionById.get(k.session_id); return [new Date(k.at).toLocaleString("en-GB"), a?.full_name, k.code, a?.category, s?.title, s?.day, hallName(c, s?.hall_id), statusOf(k)]; }));
}
