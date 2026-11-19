import {SB, $, $$, esc, t5, hm, today, dayShort, dateObj, dateRange, daysBetween, startOf, endOf, money, state, loadConf, hallColor, hallName,
  toast, dialog, armed, formData, upload, countriesOf, DEFAULT_COUNTRIES, icon, flag, can, LEVELS, levelName} from "./core.js";
import * as attendeesPage from "./attendees.js";
import * as scanPage from "./scan.js";
import * as printPage from "./print.js";
import * as reportsPage from "./reports.js";
import * as registerPage from "./register.js";
import * as certsPage from "./certs.js";
import * as island from "./island.js";

const app = $("#app");
// [route, label, icon, one-line purpose shown under the page title]
const TABS = [["overview", "Overview", "overview", ""], ["program", "Program", "program", "Halls, days and sessions"],
  ["attendees", "Attendees", "attendees", "Everyone registered, their fees and their badges"],
  ["register", "Registrations", "tag", "Visitors register from a QR code on the desk; you approve them"], ["scan", "Check-in", "scan", "Record attendance at the hall doors"],
  ["vouchers", "Vouchers", "vouchers", "Dinner and one-time passes"], ["print", "Badges & certificates", "print", "Print them, or download PDFs to send"],
  ["certs", "Certificates", "award", "Requests from the table QR, approvals and email"],
  ["reports", "Reports", "reports", "Attendance, fees and certificates, ready for Excel"], ["settings", "Settings", "settings", "Details, categories and countries"]];
const MOBILE = ["overview", "attendees", "scan", "program"];
// Sections a level can open: viewers don't get the door scanner, only admins and the owner get Settings.
const TAB_NEED = {scan: "edit", settings: "manage"};
const tabsFor = () => TABS.filter(([k]) => can(TAB_NEED[k] || "view"));
const MIN = 6e4;
let refreshT = null, curCtx = null, pending = null;
const shortHall = n => String(n).replace(/^(Main Hall|Breakout \d+)\s*[–-]\s*/, "");
const kbd = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";

/* ---------- app shell: sidebar on desktop, bottom bar on phones ---------- */
function shell({conf = null, page = "", title, sub = "", actions = ""}){
  const nav = conf ? tabsFor().map(([k, l, ic]) => `<a class="nav-item" href="#/c/${conf.id}/${k}" ${k === page ? 'aria-current="page"' : ""}>${icon(ic)}<span>${l}</span>${k === "register" && state.c?.regs?.length ? `<span class="badge">${state.c.regs.length}</span>` : ""}</a>`).join("")
    : `<a class="nav-item" href="#/" aria-current="page">${icon("home")}<span>Conferences</span></a>`;
  const thumb = conf ? `<span class="cthumb" style="${conf.cover_url ? `background-image:url('${esc(conf.cover_url)}')` : ""}">${conf.cover_url ? "" : esc(conf.name.slice(0, 1))}</span>` : "";
  return `<div class="shell">
    <aside class="side" aria-label="Main">
      <a class="side-brand" href="#/"><img src="assets/jv-mark.svg" alt="" width="14" height="24"><span>JV Connect</span></a>
      ${conf ? `<a class="side-conf" href="#/" title="Switch conference">${thumb}<span class="side-conf-txt"><b>${esc(conf.name)}</b><small>${esc(dateRange(conf.start_date, conf.end_date))}</small></span>${icon("down", "ic sm")}</a>` : ""}
      <button type="button" class="side-search" data-cmdk>${icon("search")}<span>Search</span><kbd>${kbd}</kbd></button>
      <nav class="side-nav">${nav}</nav>
      <div class="side-foot"><span class="side-user" title="${esc(state.session?.user?.email)}">${icon("user")}<span>${esc(state.session?.user?.email || "")}</span></span>
        <button type="button" class="side-out" id="signOut" title="Sign out" aria-label="Sign out">${icon("logout")}</button></div>
    </aside>
    <div class="main">
      <header class="pagebar"><a class="m-brand" href="#/" aria-label="All conferences"><img src="assets/jv-mark.svg" alt="" width="12" height="20"></a>
        <div class="pagebar-txt"><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ""}</div>
        <div class="pagebar-act">${actions}<button type="button" class="icon-btn" data-cmdk aria-label="Search" title="Search (${kbd})">${icon("search")}</button></div></header>
      <div class="content" id="page"></div>
    </div>
    ${conf ? `<nav class="bottomnav" aria-label="Sections">${MOBILE.filter(k => tabsFor().some(t => t[0] === k)).map(k => { const t = TABS.find(x => x[0] === k);
      return `<a href="#/c/${conf.id}/${k}" ${k === page ? 'aria-current="page"' : ""}>${icon(t[2])}<span>${t[1]}</span></a>`; }).join("")}
      <button type="button" id="moreNav" ${MOBILE.includes(page) ? "" : 'aria-current="page"'}>${icon("more")}<span>More</span></button></nav>` : ""}
  </div>`;
}
document.addEventListener("click", e => {
  if (e.target.closest("#signOut")) SB.auth.signOut();
  if (e.target.closest("[data-cmdk]")) openCmdk();
  if (e.target.closest("#moreNav") && state.c) {
    const d = dialog({title: "All sections", submit: "", body: `<div class="more-grid">${tabsFor().map(([k, l, ic]) => `<a href="#/c/${state.c.conf.id}/${k}">${icon(ic)}<span>${l}</span></a>`).join("")}</div>`});
    $$("a", d).forEach(a => a.addEventListener("click", () => d.close()));
  }
});
addEventListener("keydown", e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing && !$("dialog[open]"))) { e.preventDefault(); if (state.admin) openCmdk(); }
});

/* ---------- command palette: jump to any attendee, session, page or action ---------- */
function openCmdk(){
  let d = $("#cmdk");
  if (!d) { d = document.body.appendChild(Object.assign(document.createElement("dialog"), {id: "cmdk", className: "cmdk"})); d.addEventListener("click", e => { if (e.target === d) d.close(); }); }
  d.innerHTML = `<div class="cmdk-in">${icon("search")}<input id="cmdkQ" placeholder="Search attendees, IDs, sessions or pages" autocomplete="off" spellcheck="false" aria-label="Search"><kbd>Esc</kbd></div>
    <div class="cmdk-list" id="cmdkList" role="listbox"></div>`;
  const c = state.c && location.hash.includes(state.c.conf.id) ? state.c : null;
  let items = [], at = 0;
  const draw = () => {
    const q = $("#cmdkQ", d).value.trim().toLowerCase(), has = v => String(v ?? "").toLowerCase().includes(q), groups = [];
    if (c && q) {
      const people = c.attendees.filter(a => [a.code, a.full_name, a.cert_name, a.phone, a.email, a.entity].some(has))
        .sort((a, b) => (b.code === q) - (a.code === q) || a.full_name.localeCompare(b.full_name)).slice(0, 8);
      groups.push(["Attendees", people.map(a => ({ic: "user", label: a.full_name, hint: [a.code, a.category, a.entity].filter(Boolean).join(", "),
        run: () => later(`#/c/${c.conf.id}/attendees`, () => attendeesPage.openPerson(state.c, state.c.attendees.find(x => x.id === a.id), curCtx))}))]);
      groups.push(["Sessions", c.sessions.filter(s => has(s.title) || has(hallName(c, s.hall_id))).slice(0, 6).map(s => ({ic: "program", label: s.title,
        hint: `${dayShort(s.day)} ${t5(s.start_time)}, ${shortHall(hallName(c, s.hall_id))}`, run: () => later(`#/c/${c.conf.id}/program`, () => sessionDialog(state.c, state.c.sessionById.get(s.id), curCtx, s.day))}))]);
    }
    const acts = c ? [["plus", "Add attendee", () => later(`#/c/${c.conf.id}/attendees`, () => attendeesPage.openPerson(state.c, null, curCtx))],
      ["upload", "Import attendees from Excel", () => later(`#/c/${c.conf.id}/attendees`, () => $("#aImport")?.click())],
      ["scan", "Open the door scanner", () => { location.hash = `#/scan/${c.conf.id}`; }], ["vouchers", "Open the voucher scanner", () => { location.hash = `#/voucher/${c.conf.id}`; }],
      ...tabsFor().map(([k, l, ic]) => [ic, `Go to ${l}`, () => { location.hash = `#/c/${c.conf.id}/${k}`; }])] : [];
    acts.push(["plus", "New conference", () => confDialog()], ["home", "All conferences", () => { location.hash = "#/"; }]);
    groups.push(["Actions", acts.filter(([, l]) => has(l)).slice(0, q ? 6 : 14).map(([ic, label, run]) => ({ic, label, run}))]);
    groups.push(["Conferences", (q ? state.confs.filter(x => has(x.name)) : []).slice(0, 4).map(x => ({ic: "home", label: x.name, hint: dateRange(x.start_date, x.end_date), run: () => { location.hash = `#/c/${x.id}`; }}))]);
    items = groups.flatMap(g => g[1]); at = Math.min(at, Math.max(0, items.length - 1));
    let i = 0;
    $("#cmdkList", d).innerHTML = groups.filter(g => g[1].length).map(([name, list]) => `<div class="cmdk-group">${name}</div>${list.map(it =>
      `<button type="button" class="cmdk-item" role="option" data-i="${i}" aria-selected="${i++ === at}">${icon(it.ic)}<span class="cmdk-lbl">${esc(it.label)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ""}</button>`).join("")}`).join("")
      || `<p class="cmdk-empty">Nothing matches “${esc(q)}”. Try a name, an ID like 0427, a phone number or a session title.</p>`;
    $$(".cmdk-item", d).forEach(b => { b.onclick = () => pick(Number(b.dataset.i)); b.onmousemove = () => { if (at !== Number(b.dataset.i)) { at = Number(b.dataset.i); mark(); } }; });
  };
  const mark = () => $$(".cmdk-item", d).forEach(b => { const on = Number(b.dataset.i) === at; b.setAttribute("aria-selected", on); if (on) b.scrollIntoView({block: "nearest"}); });
  const pick = i => { const it = items[i]; if (!it) return; d.close(); it.run(); };
  const q = $("#cmdkQ", d);
  q.oninput = () => { at = 0; draw(); };
  q.onkeydown = e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); at = (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(1, items.length); mark(); }
    if (e.key === "Enter") { e.preventDefault(); pick(at); }
  };
  draw(); d.showModal(); q.focus();
}
// Go to a page, then do something once it has rendered (open a person, start an import…).
function later(hash, fn){ if (location.hash === hash && state.c) return fn(); pending = fn; location.hash = hash; }

/* ---------- routing ---------- */
let routeN = 0; // bumps on every navigation, so a slow page that finishes late doesn't draw over a newer one
async function route(){
  clearInterval(refreshT); refreshT = null; const my = ++routeN;
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] !== "c") island.stop(); // the new-registration island lives only inside a conference
  try {
    if (parts[0] === "scan" && parts[1]) return await scanPage.renderPublic(app, parts[1]);       // ushers, no login
    if (parts[0] === "voucher" && parts[1]) return await scanPage.renderVoucherPublic(app, parts[1]); // dinner staff, no login
    if (parts[0] === "register" && parts[1]) return await registerPage.renderPublic(app, parts[1]);   // visitors, no login
    if (parts[0] === "cert" && parts[1]) return await certsPage.renderPublic(app, parts[1]);          // certificate requests, no login
    if (parts[0] === "mycert" && parts[1]) return await certsPage.renderSelf(app, parts[1], decodeURIComponent(parts[2] || ""));          // workshop certificate by badge ID, no login
    if (parts[0] === "edit" && parts[1]) return await certsPage.renderEdit(app, parts[1], decodeURIComponent(parts[2] || ""));          // fix certificate name or email by badge ID, no login
    if (parts[0] === "badge" && parts[1]) return await registerPage.renderBadge(app, parts[1], parts[2]); // attendee's phone badge, no login
    if (!state.admin) return renderLogin();
    if (!parts.length) return await renderHome();
    if (parts[0] === "c" && parts[1]) return await renderConf(parts[1], parts[2] || "overview");
    location.hash = "#/";
  } catch (err) {
    if (my !== routeN) return;
    app.innerHTML = shell({title: "Something went wrong"});
    $("#page").innerHTML = `<div class="panel empty-state">${icon("alert", "ic lg")}<h2>This page didn't load</h2><p>${esc(err.message || err)}</p><a class="btn" href="#/">Back to conferences</a></div>`;
  }
}
addEventListener("hashchange", route);
export const go = hash => { if (location.hash === hash) route(); else location.hash = hash; };

/* ---------- sign in ---------- */
function renderLogin(){
  app.innerHTML = `<div class="auth">
    <section class="auth-art" aria-hidden="true"><div class="auth-brand"><img src="assets/jv-mark.svg" alt="" width="16" height="28"><span>JV Connect</span></div>
      <div class="auth-copy"><h1>Run every Jordan Valley conference from one place.</h1>
        <p>Program, attendees, door check-in, dinner vouchers, badges and certificates.</p></div>
      <div class="auth-rings"><i></i><i></i><i></i></div></section>
    <section class="auth-side"><form class="auth-form form" id="login">
      <img class="auth-mark" src="assets/jv-mark.svg" alt="" width="16" height="28">
      <div><h2>Sign in</h2><p class="note">For the event team. Ushers and dinner staff open the scanner links and don't need an account.</p></div>
      <label>Email<input name="email" type="email" required autocomplete="username"></label>
      <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
      <button type="submit" class="big-btn">Sign in</button><p class="note" id="lgMsg" role="status" style="margin:0;min-height:1.5em"></p></form></section></div>`;
  $("#login").onsubmit = async e => {
    e.preventDefault(); $("#lgMsg").textContent = "Signing in…";
    const { error } = await SB.auth.signInWithPassword(formData(e.target));
    $("#lgMsg").textContent = error ? "Wrong email or password." : "";
  };
}
SB.auth.onAuthStateChange((_e, session) => setTimeout(async () => {
  state.session = session;
  const was = state.admin;
  // The level; if the database hasn't been updated for levels yet, fall back to the old admin check.
  if (session) { const r = await SB.rpc("team_role"); state.role = r.error ? ((await SB.rpc("is_admin")).data === true ? "admin" : null) : r.data; }
  else state.role = null;
  state.admin = !!state.role; document.body.dataset.role = state.role || "";
  if (session && !state.admin && $("#lgMsg")) $("#lgMsg").textContent = "This account doesn't have admin access.";
  if (was !== state.admin || !app.innerHTML) { state.c = null; route(); }
}, 0));

/* ---------- home: all conferences ---------- */
const daysTo = d => Math.round((dateObj(d) - dateObj(today())) / 864e5);
const confStatus = c => { const t = today(); return t < c.start_date ? "upcoming" : t > c.end_date ? "ended" : "live"; };
const statusPill = (c) => { const s = confStatus(c), n = daysTo(c.start_date), len = daysTo(c.end_date) - n + 1;
  return s === "live" ? `<span class="pill ok live">On now, day ${1 - n} of ${len}</span>` : s === "upcoming" ? `<span class="pill acc">${n === 1 ? "Tomorrow" : `In ${n} days`}</span>` : `<span class="pill">Ended</span>`; };
let homeView = {f: "", q: ""}; // f empty: "On now" when a conference is running, else All
async function renderHome(){
  const h = new Date().getHours(), hello = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  app.innerHTML = shell({title: "Conferences", sub: `${hello}. ${new Date().toLocaleDateString("en-GB", {weekday: "long", day: "numeric", month: "long"})}`,
    actions: `<button type="button" id="newConf">${icon("plus")}<span>New conference</span></button>`});
  $("#newConf").onclick = () => confDialog();
  $("#page").innerHTML = `<div class="skel-grid">${'<div class="skel"></div>'.repeat(3)}</div>`;
  const my = routeN, { data: confs, error } = await SB.from("conferences").select("*").order("start_date", {ascending: false});
  if (error) throw error;
  state.confs = confs;
  const counts = new Map(await Promise.all(confs.map(async c => {
    const [a, s] = await Promise.all([SB.from("attendees").select("id", {count: "exact", head: true}).eq("conference_id", c.id),
      SB.from("conf_sessions").select("id", {count: "exact", head: true}).eq("conference_id", c.id)]);
    return [c.id, [a.count ?? 0, s.count ?? 0]];
  })));
  if (my !== routeN) return;
  drawHome(confs, counts);
}
function drawHome(confs, counts){
  if (!homeView.f) homeView.f = confs.some(c => confStatus(c) === "live") ? "live" : "all";
  const by = k => confs.filter(c => confStatus(c) === k).length;
  const list = confs.filter(c => (homeView.f === "all" || confStatus(c) === homeView.f) && (!homeView.q || `${c.name} ${c.venue}`.toLowerCase().includes(homeView.q.toLowerCase())));
  const live = confs.find(c => confStatus(c) === "live");
  $("#page").innerHTML = `${live ? `<a class="now-card" href="#/c/${live.id}"><span class="pill live">On now</span><div><b>${esc(live.name)}</b><span>${esc(dateRange(live.start_date, live.end_date))}${live.venue ? ", " + esc(live.venue) : ""}</span></div>
      <span class="now-go">Open the live overview ${icon("chevron", "ic sm")}</span></a>` : ""}
    <div class="toolbar"><div class="seg" role="group" aria-label="Show">${[["all", "All", confs.length], ["live", "On now", by("live")], ["upcoming", "Upcoming", by("upcoming")], ["ended", "Ended", by("ended")]]
      .map(([k, l, n]) => `<button type="button" aria-pressed="${homeView.f === k}" data-f="${k}">${l} <span class="count">${n}</span></button>`).join("")}</div>
      <label class="search-field">${icon("search")}<input type="search" id="confQ" placeholder="Find a conference" value="${esc(homeView.q)}" aria-label="Find a conference"></label></div>
    <div class="conf-grid">${list.map(c => { const [na, ns] = counts.get(c.id) || [0, 0];
      return `<a class="conf-card" href="#/c/${c.id}"><div class="conf-cover" style="${c.cover_url ? `background-image:url('${esc(c.cover_url)}')` : ""}">${statusPill(c)}</div>
        <div class="conf-body"><b>${esc(c.name)}</b><span class="note">${esc(dateRange(c.start_date, c.end_date))}${c.venue ? ", " + esc(c.venue) : ""}</span>
        <div class="conf-stats"><span><b>${na}</b> attendees</span><span><b>${ns}</b> sessions</span></div></div></a>`; }).join("")}
      <button type="button" class="new-card" id="newConf2">${icon("plus", "ic lg")}<b>New conference</b><span class="note">Name, dates and venue. Add the program next.</span></button></div>
    ${!list.length && confs.length ? `<p class="empty">No conferences match. <button type="button" class="ghost small" id="clrHome">Show all</button></p>` : ""}`;
  $("#newConf2").onclick = () => confDialog();
  $$("[data-f]").forEach(b => b.onclick = () => { homeView.f = b.dataset.f; drawHome(confs, counts); });
  $("#clrHome") && ($("#clrHome").onclick = () => { homeView = {f: "all", q: ""}; drawHome(confs, counts); });
  let qT; $("#confQ").oninput = e => { clearTimeout(qT); qT = setTimeout(() => { homeView.q = e.target.value; drawHome(confs, counts); $("#confQ").focus(); $("#confQ").setSelectionRange(9999, 9999); }, 150); };
}

// Create or edit a conference (name, dates, venue, cover, late rule).
export function confDialog(conf = null){
  dialog({need: "manage",
    title: conf ? "Conference details" : "New conference", submit: conf ? "Save changes" : "Create conference",
    body: `<label>Name<input name="name" required maxlength="200" value="${esc(conf?.name)}" placeholder="16th International Conference of …"></label>
      <div class="form-grid"><label>First day<input name="start_date" type="date" required value="${esc(conf?.start_date)}"></label>
      <label>Last day<input name="end_date" type="date" required value="${esc(conf?.end_date)}"></label></div>
      <label>Venue<input name="venue" maxlength="200" value="${esc(conf?.venue)}" placeholder="St. Regis Hotel, Amman"></label>
      <label>Hotel location (map link)<input name="location_url" type="url" maxlength="500" value="${esc(conf?.location_url)}" placeholder="https://maps.app.goo.gl/…"></label>
      <p class="note" style="margin:-6px 0 0">In Google Maps, open the hotel, tap Share, copy the link and paste it here. It shows on the registration form.</p>
      <label>Late after (minutes from a session's start)<input name="late_after_min" type="number" min="0" max="240" value="${conf?.late_after_min ?? 10}"></label>
      <label>First badge ID<input name="id_start" type="number" min="1" max="99999999" step="1" value="${conf?.id_start ?? ""}" placeholder="1" class="num"></label>
      <p class="note" style="margin:-6px 0 0">New people get IDs from here up, for example 5000, 5001, 5002. IDs already given don't change. Empty starts at 0001.</p>
      <label>Cover image<input name="cover" type="file" accept="image/png,image/jpeg,image/webp"></label>
      ${conf?.cover_url ? `<label class="check"><input type="checkbox" name="remove_cover"> Remove the current cover</label>` : ""}`,
    onSubmit: async form => {
      const f = formData(form);
      if (f.end_date < f.start_date) { toast("The last day can't be before the first day.", "bad"); return false; }
      const row = {name: f.name.trim(), start_date: f.start_date, end_date: f.end_date, venue: f.venue.trim(), location_url: f.location_url.trim() || null, late_after_min: Number(f.late_after_min || 10), id_start: f.id_start ? Math.max(1, Math.floor(Number(f.id_start))) : null};
      if (f.remove_cover) row.cover_url = null;
      let id = conf?.id;
      if (conf) { const { error } = await SB.from("conferences").update(row).eq("id", id); if (error) throw error; }
      else { const { data, error } = await SB.from("conferences").insert(row).select("id").single(); if (error) throw error; id = data.id; }
      const file = form.cover.files[0];
      if (file) { const url = await upload(file, `covers/${id}`); await SB.from("conferences").update({cover_url: url}).eq("id", id); }
      toast(conf ? "Saved" : "Conference created");
      state.c = null; go(`#/c/${id}/${conf ? "settings" : "program"}`);
    },
  });
}

/* ---------- inside a conference ---------- */
async function renderConf(id, page){
  if (!tabsFor().some(t => t[0] === page)) page = "overview";
  if (state.c?.conf.id !== id) { app.innerHTML = shell({title: "Loading the conference…"}); $("#page").innerHTML = `<div class="skel-grid">${'<div class="skel"></div>'.repeat(4)}</div>`; }
  const my = routeN, c = await loadConf(id);
  if (my !== routeN) return;
  const { conf } = c, tab = TABS.find(t => t[0] === page);
  app.innerHTML = shell({conf, page, title: page === "overview" ? conf.name : tab[1],
    sub: page === "overview" ? `${esc(dateRange(conf.start_date, conf.end_date))}${conf.venue ? ", " + esc(conf.venue) : ""}${conf.location_url ? ` <a href="${esc(conf.location_url)}" target="_blank" rel="noopener">Map</a>` : ""}` : tab[3]});
  const el = $("#page");
  const pages = {overview: renderOverview, program: renderProgram, settings: renderSettings,
    attendees: attendeesPage.render, register: registerPage.render, certs: certsPage.render, scan: scanPage.renderAdmin, vouchers: scanPage.renderVouchers, print: printPage.render, reports: reportsPage.render};
  curCtx = {reload: async () => { await loadConf(id, {force: true}); return route(); }};
  await pages[page](el, c, curCtx);
  // A decision on the island refreshes the data; the page redraws unless a form is open on it.
  island.watch(id, {reload: async () => { await loadConf(id, {force: true}); setTimeout(() => { if (!$("dialog[open]")) route(); }, 400); }});
  if (my !== routeN) return;
  if (pending) { const fn = pending; pending = null; fn(); }
  // Live pages refresh quietly so counts follow the doors.
  if (page === "overview") refreshT = setInterval(async () => { if (document.visibilityState !== "visible" || $("dialog[open]")) return; await loadConf(id, {force: true}).catch(() => {}); if (my === routeN && $("#page")) renderOverview($("#page"), state.c); }, 20000);
}

/* ---------- overview: what's happening now and what needs a look ---------- */
function insights(c, now){
  const out = [], id = c.conf.id, t = today(), started = t >= c.conf.start_date;
  const add = (tone, ic, title, sub, href = "", filter = null) => out.push({tone, ic, title, sub, href, filter});
  const soon = new Map(); // start time -> sessions starting within 30 minutes, so one slot is one line
  for (const s of c.sessions) {
    const cap = c.hallById.get(s.hall_id)?.capacity, n = (c.checkinsBySession.get(s.id) || []).length;
    if (now >= startOf(s) && now <= endOf(s) && cap && n / cap >= .9)
      add(n >= cap ? "bad" : "warn", "alert", `${shortHall(hallName(c, s.hall_id))} is ${n >= cap ? "full" : Math.round(100 * n / cap) + "% full"}`, `${n} of ${cap} seats taken for “${s.title}”.`, `#/c/${id}/scan`);
    const mins = Math.round((startOf(s) - now) / MIN);
    if (mins > 0 && mins <= 30) (soon.get(mins) || soon.set(mins, []).get(mins)).push(s);
  }
  for (const [mins, list] of soon) add("acc", "clock", list.length === 1 ? `“${list[0].title}” starts in ${mins} min` : `${list.length} sessions start in ${mins} min`,
    `${list.map(s => shortHall(hallName(c, s.hall_id))).join(", ")}. Ushers can start scanning now.`, `#/c/${id}/scan`);
  const waiting = (c.regs || []).length;
  if (waiting) add("warn", "tag", `${waiting} registration${waiting === 1 ? "" : "s"} waiting for approval`, "Visitors who scanned the desk sign. Approve them to give them a badge ID.", `#/c/${id}/register`);
  const unpaid = c.attendees.filter(a => !a.fee_paid && Number(a.fee_amount) > 0);
  if (unpaid.length) add("warn", "money", `${unpaid.length} ${unpaid.length === 1 ? "fee is" : "fees are"} not paid`, `${money(unpaid.reduce((n, a) => n + Number(a.fee_amount), 0))} JOD outstanding.`, `#/c/${id}/attendees`, {pay: "unpaid", category: "", country: "", q: ""});
  for (const v of c.vouchers) {
    const from = Date.parse(v.valid_from), to = Date.parse(v.valid_to), used = (c.usesByVoucher.get(v.id) || []).length;
    if (now >= from && now <= to) add("ok", "vouchers", `${v.name} is open`, `${used} used so far, until ${hm(v.valid_to)}.`, `#/c/${id}/vouchers`);
    else if (from > now && v.valid_from.slice(0, 10) === t) add("acc", "vouchers", `${v.name} opens at ${hm(v.valid_from)}`, "Send the voucher scanner link to the dinner staff.", `#/c/${id}/vouchers`);
  }
  const noCert = c.attendees.filter(a => !String(a.cert_name || "").trim()).length;
  if (noCert && c.attendees.length) add("", "tag", `${noCert} ${noCert === 1 ? "attendee has" : "attendees have"} no certificate name`, "Their full name prints instead. Check spelling before printing certificates.", `#/c/${id}/attendees`);
  const noCat = c.attendees.filter(a => !a.category).length;
  if (noCat) add("", "attendees", `${noCat} without a category`, "Vouchers and badges use the category. Pick one in each attendee's details.", `#/c/${id}/attendees`, {category: "", pay: "nocat", country: "", q: ""});
  if (started) { const inSet = new Set(c.checkins.map(k => k.code)), none = c.attendees.filter(a => !inSet.has(a.code)).length;
    if (none && c.checkins.length) add("", "user", `${none} registered but not seen yet`, "No check-in at any session so far.", `#/c/${id}/reports`); }
  if (!c.halls.length) add("acc", "program", "Add the halls", "Each hall gets its own colour and seat count.", `#/c/${id}/program`);
  else if (!c.sessions.length) add("acc", "program", "Add the sessions", "Ushers pick a session before scanning.", `#/c/${id}/program`);
  if (!c.attendees.length) add("acc", "upload", "Add or import attendees", "Import the registration sheet from Excel; the columns are matched for you.", `#/c/${id}/attendees`);
  else if (!c.layouts.some(l => l.kind === "badge")) add("acc", "print", "Line up the badge layout", "Do one test print on the badge paper before printing them all.", `#/c/${id}/print`);
  const rank = {bad: 0, warn: 1, acc: 2, ok: 3, "": 4};
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}
function renderOverview(el, c){
  const now = new Date(), t = today(), id = c.conf.id;
  const codesIn = new Set(c.checkins.map(k => k.code)), todayIn = c.checkins.filter(k => c.sessionById.get(k.session_id)?.day === t);
  const live = c.sessions.filter(s => now >= startOf(s) && now <= endOf(s));
  const upcoming = c.sessions.filter(s => startOf(s) > now).sort((a, b) => startOf(a) - startOf(b));
  const nextUp = upcoming.filter(s => startOf(s) - startOf(upcoming[0]) < 1 * MIN).slice(0, 4); // everything in the next time slot
  const paid = c.attendees.filter(a => a.fee_paid).reduce((n, a) => n + Number(a.fee_amount), 0);
  const due = c.attendees.filter(a => !a.fee_paid).reduce((n, a) => n + Number(a.fee_amount), 0);
  const rate = c.attendees.length ? Math.round(100 * codesIn.size / c.attendees.length) : 0;
  const base = location.href.split("#")[0], tips = insights(c, now);
  const row = s => { const n = (c.checkinsBySession.get(s.id) || []).length, cap = c.hallById.get(s.hall_id)?.capacity;
    return `<a class="now-row" href="#/c/${id}/scan" style="--hc:${hallColor(c, s.hall_id)}"><i class="hdot"></i><span class="now-t"><b>${esc(s.title)}</b><small>${esc(shortHall(hallName(c, s.hall_id)))}, ${t5(s.start_time)}–${t5(s.end_time)}</small></span>
      <span class="now-n"><b>${n}</b><small>${cap ? `of ${cap}` : "in"}</small></span>${cap ? `<span class="meter"><i style="width:${Math.min(100, 100 * n / cap)}%"></i></span>` : ""}</a>`; };
  const nextLabel = nextUp[0] ? (nextUp[0].day === t ? `Next, at ${t5(nextUp[0].start_time)}` : `Next, ${dayShort(nextUp[0].day)} at ${t5(nextUp[0].start_time)}`) : "";
  el.innerHTML = `<section class="now">
      <div class="now-main"><div class="now-head">${live.length ? `<span class="pill live">Live now</span><span>${live.length} session${live.length === 1 ? "" : "s"} running</span>` : nextUp.length ? `<span class="pill">Nothing live</span><span>${esc(nextLabel)}</span>` : `<span class="pill">Nothing scheduled</span>`}</div>
        <div class="now-list">${(live.length ? live : nextUp).map(row).join("") || `<p class="now-empty">${c.sessions.length ? "All sessions have ended." : "No sessions yet."} <a href="#/c/${id}/program">Open the program</a></p>`}</div></div>
      <div class="now-stats"><div><b>${todayIn.length}</b><span>check-ins today</span></div><div><b>${new Set(todayIn.map(k => k.code)).size}</b><span>people in today</span></div>
        <a class="now-scan" href="#/c/${id}/scan">${icon("scan")}<span>Start checking in</span></a></div></section>
    <div class="kpis">
      ${kpi("Registered", c.attendees.length, `${c.halls.length} halls, ${c.sessions.length} sessions`)}
      ${kpi("Attended at least once", codesIn.size, `${rate}% of registered`, rate)}
      ${kpi("Fees collected", money(paid), `JOD, ${money(due)} still due`, paid + due ? Math.round(100 * paid / (paid + due)) : null)}
      ${kpi("Vouchers used", c.uses.length, c.vouchers.length ? `across ${c.vouchers.length} voucher${c.vouchers.length === 1 ? "" : "s"}` : "No vouchers set up")}</div>
    <div class="ov-grid">
      <section class="panel"><div class="panel-head"><h2>Needs a look</h2><span class="note">${tips.length ? `${tips.length} item${tips.length === 1 ? "" : "s"}` : ""}</span></div>
        <div class="tips">${tips.map((x, i) => `<a class="tip ${x.tone}" href="${x.href || "#"}" data-tip="${i}"><span class="tip-ic">${icon(x.ic)}</span><span><b>${esc(x.title)}</b><small>${esc(x.sub)}</small></span>${x.href ? icon("chevron", "ic sm") : ""}</a>`).join("")
          || `<div class="tip ok"><span class="tip-ic">${icon("check")}</span><span><b>All clear</b><small>Nothing needs attention right now.</small></span></div>`}</div></section>
      <section class="panel"><h2>Quick actions</h2><div class="quick">
          <button type="button" class="qa" data-qa="add">${icon("plus")}<span>Add attendee</span></button><button type="button" class="qa" data-qa="import">${icon("upload")}<span>Import Excel</span></button>
          <a class="qa" href="#/c/${id}/print">${icon("print")}<span>Print badges</span></a><a class="qa" href="#/c/${id}/reports">${icon("reports")}<span>Reports</span></a></div>
        <h3 style="margin-top:20px">Links for your team</h3><p class="note" style="margin:2px 0 0">Ushers and dinner staff open these on their phones. No account needed.</p>
        ${linkBox("Door scanner", `${base}#/scan/${id}`)}${linkBox("Dinner voucher scanner", `${base}#/voucher/${id}`)}
        ${linkBox("My badge (for attendees)", `${base}#/badge/${id}`)}</section></div>
    <section><div class="section-head"><h2>Halls</h2><span class="note">Updates every 20 seconds</span></div>
      <div class="hall-cards">${c.halls.map(h => hallCard(c, h, now)).join("") || `<div class="panel empty">No halls yet. <a href="#/c/${id}/program">Add them in Program</a>.</div>`}</div></section>
    ${c.checkins.length ? attendance(c) : ""}`;
  $$("[data-ovday]", el).forEach(b => b.onclick = () => { ovDay = b.dataset.ovday; renderOverview(el, c); });
  $$("[data-copy]", el).forEach(b => b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => toast("Link copied"), () => toast("Couldn't copy. Select the link and copy it.", "bad")));
  $$("[data-tip]", el).forEach(a => a.addEventListener("click", () => { const x = tips[Number(a.dataset.tip)]; if (x.filter) Object.assign(attendeesPage.view, x.filter, {show: 200}); }));
  $$("[data-qa]", el).forEach(b => b.onclick = () => b.dataset.qa === "add" ? later(`#/c/${id}/attendees`, () => attendeesPage.openPerson(state.c, null, curCtx))
    : later(`#/c/${id}/attendees`, () => $("#aImport")?.click()));
}
// Attendance charts: by hour, by hall, and the fullest sessions, for one day or all days.
let ovDay = "";
function attendance(c){
  const dayOf = k => c.sessionById.get(k.session_id)?.day || k.at.slice(0, 10);
  const days = [...new Set(c.checkins.map(dayOf))].sort();
  if (ovDay && !days.includes(ovDay)) ovDay = "";
  const sc = c.checkins.filter(k => !ovDay || dayOf(k) === ovDay), pad = n => String(n).padStart(2, "0");
  const hours = {}; sc.forEach(k => { const h = new Date(k.at).getHours(); hours[h] = (hours[h] || 0) + 1; });
  const hk = Object.keys(hours).map(Number), hs = []; for (let h = Math.min(7, ...hk); h <= Math.max(19, ...hk); h++) hs.push(h);
  const byHall = new Map(); sc.forEach(k => { const h = c.sessionById.get(k.session_id)?.hall_id || ""; byHall.set(h, (byHall.get(h) || 0) + 1); });
  const top = c.sessions.filter(s => !ovDay || s.day === ovDay).map(s => { const n = (c.checkinsBySession.get(s.id) || []).length, cap = c.hallById.get(s.hall_id)?.capacity;
    return {s, n, cap, fill: cap ? Math.round(100 * n / cap) : null}; }).filter(r => r.n).sort((a, b) => (b.fill ?? 0) - (a.fill ?? 0) || b.n - a.n).slice(0, 6);
  return `<section><div class="section-head"><h2>Attendance</h2>${days.length > 1 ? `<div class="seg">${[["", "All days"], ...days.map(d => [d, dayShort(d)])].map(([d, l]) => `<button type="button" data-ovday="${d}" aria-pressed="${d === ovDay}">${esc(l)}</button>`).join("")}</div>` : ""}</div>
    <div class="ov-charts"><div class="panel"><div class="panel-head"><h2>Check-ins by hour</h2><span class="note">${sc.length} check-ins, ${new Set(sc.map(k => k.code)).size} people</span></div>
        ${reportsPage.barsV(hs.map((h, i) => ({v: hours[h] || 0, label: i % 2 ? "" : pad(h) + ":00", tip: `${pad(h)}:00 to ${pad(h)}:59: ${hours[h] || 0} check-ins`})), "Check-ins by hour")}</div>
      <div class="panel"><div class="panel-head"><h2>By hall</h2></div>
        ${reportsPage.barsH([...byHall].sort((a, b) => b[1] - a[1]).map(([h, v]) => { const n = h ? shortHall(hallName(c, h)) : "Deleted hall"; return {v, label: n, tip: `${n}: ${v} check-ins`, color: h ? hallColor(c, h) : ""}; }), "Check-ins by hall", 340, 110)}</div></div>
    <div class="panel" style="margin-top:20px"><div class="panel-head"><h2>Fullest sessions</h2><a class="note" href="#/c/${c.conf.id}/reports">All sessions in Reports</a></div>
      <ol class="top-list">${top.map(r => `<li style="--hc:${hallColor(c, r.s.hall_id)}"><div class="t">${esc(r.s.title)}<small><i class="hdot"></i>${esc(shortHall(hallName(c, r.s.hall_id)))}, ${esc(dayShort(r.s.day))} ${t5(r.s.start_time)}</small></div>
        <div class="v">${r.fill == null ? r.n : r.fill + "%"}<small>${r.n}${r.cap ? ` of ${r.cap}` : ""} in</small></div><span class="meter"><i style="width:${Math.min(100, r.fill ?? 100)}%"></i></span></li>`).join("")}</ol></div></section>`;
}
const kpi = (label, value, sub, pct = null) => `<div class="panel kpi"><span>${label}</span><strong>${value}</strong><small>${esc(sub)}</small>${pct != null ? `<span class="meter"><i style="width:${pct}%"></i></span>` : ""}</div>`;
const linkBox = (label, url) => `<label style="margin-top:12px">${label}<div class="linkbox"><input readonly value="${esc(url)}" onfocus="this.select()"><button type="button" class="ghost small" data-copy="${esc(url)}">Copy</button></div></label>`;
function hallCard(c, h, now){
  const list = c.sessions.filter(s => s.hall_id === h.id);
  const live = list.find(s => now >= startOf(s) && now <= endOf(s));
  const opening = list.find(s => startOf(s) > now && startOf(s) - now <= 60 * MIN);
  const ended = list.filter(s => endOf(s) < now && now - endOf(s) <= 30 * MIN).pop();
  const next = list.find(s => startOf(s) > now);
  const focus = live || opening || ended || next;
  const n = focus ? (c.checkinsBySession.get(focus.id) || []).length : 0;
  const st = live ? ["ok live", `Live until ${t5(live.end_time)}`] : opening ? ["acc", `Starts ${t5(opening.start_time)}`]
    : ended ? ["", `Ended ${t5(ended.end_time)}`] : next ? ["", `Next ${next.day === today() ? "" : dayShort(next.day) + " "}${t5(next.start_time)}`] : ["", "Done for the conference"];
  const counting = live || opening || ended, todayN = c.checkins.filter(k => c.sessionById.get(k.session_id)?.hall_id === h.id && c.sessionById.get(k.session_id)?.day === today()).length;
  return `<article class="hcard ${live ? "live" : ""}" style="--hc:${hallColor(c, h.id)}"><div class="head"><i class="hdot"></i><span>${esc(h.name)}</span></div>
    <span class="pill ${st[0]}" style="justify-self:start">${esc(st[1])}</span>${focus ? `<div class="title">${esc(focus.title)}</div>` : ""}
    ${counting ? `<div class="big"><b>${n}</b><small>${h.capacity ? `of ${h.capacity} seats` : "checked in"}</small></div>${h.capacity ? `<div class="meter"><i style="width:${Math.min(100, 100 * n / h.capacity)}%"></i></div>` : ""}` : ""}
    <div class="foot">${todayN} check-ins today</div></article>`;
}

/* ---------- program: halls, days, sessions ---------- */
let progDay = null;
export function renderProgram(el, c, ctx){
  const days = daysBetween(c.conf.start_date, c.conf.end_date);
  if (!days.includes(progDay)) progDay = days.includes(today()) ? today() : days[0];
  const list = c.sessions.filter(s => s.day === progDay), slots = {};
  list.forEach(s => (slots[t5(s.start_time)] ||= []).push(s));
  el.innerHTML = `<div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))">
    <div class="panel" style="grid-column:1/-1"><div class="panel-head"><h2>Sessions</h2>
      <div class="row" style="align-items:center"><div class="seg" role="tablist">${days.map(d => `<button type="button" role="tab" aria-pressed="${d === progDay}" data-day="${d}">${dayShort(d)} <span class="note">${c.sessions.filter(s => s.day === d).length}</span></button>`).join("")}</div>
      <button type="button" id="addSess">Add session</button></div></div>
      <div class="timeline">${Object.entries(slots).map(([t, items]) => `<div class="slot"><div class="slot-time">${t}</div><div class="slot-items">${items.map(s => {
        const n = (c.checkinsBySession.get(s.id) || []).length, cap = c.hallById.get(s.hall_id)?.capacity, now = new Date(), live = now >= startOf(s) && now <= endOf(s);
        return `<button type="button" class="scard${live ? " live" : ""}" style="--hc:${hallColor(c, s.hall_id)}" data-sess="${s.id}" title="${esc(s.title)}">
          <span class="top"><span class="hall-tag"><i class="hdot"></i><span>${esc(hallName(c, s.hall_id).replace(/^(Main Hall|Breakout \d+)\s*[–-]\s*/, ""))}</span></span>
            ${live ? '<span class="pill ok live">Live</span>' : s.kind !== "session" ? `<span class="kind">${esc(s.kind)}</span>` : ""}</span>
          <b>${esc(s.title)}</b>
          <span class="foot"><span>${t5(s.start_time)}–${t5(s.end_time)}</span>${cap ? `<span class="meter"><i style="width:${Math.min(100, 100 * n / cap)}%"></i></span><span>${n} of ${cap}</span>` : `<span></span><span>${n} in</span>`}</span></button>`; }).join("")}</div></div>`).join("")
        || `<div class="empty">No sessions on ${dayShort(progDay)} yet. Add the first one.</div>`}</div></div>
    <div class="panel"><div class="panel-head"><h2>Halls</h2><button type="button" class="soft small" id="addHall">Add hall</button></div>
      <div class="tbl"><table><thead><tr><th>Hall</th><th>Seats</th><th>Sessions</th><th></th></tr></thead><tbody>${c.halls.map(h => `<tr>
        <td><span class="hall-tag" style="--hc:${hallColor(c, h.id)}"><i class="hdot"></i>${esc(h.name)}</span></td><td class="num">${h.capacity ?? "—"}</td>
        <td class="num">${c.sessions.filter(s => s.hall_id === h.id).length}</td><td class="actions"><button type="button" class="ghost small" data-hall="${h.id}">Edit</button></td></tr>`).join("")
        || '<tr><td colspan="4" class="empty">No halls yet.</td></tr>'}</tbody></table></div><p class="note">Hall colours follow this order (biggest first unless you change the order number).</p></div></div>`;
  $$("[data-day]", el).forEach(b => b.onclick = () => { progDay = b.dataset.day; renderProgram(el, c, ctx); });
  $("#addSess").onclick = () => sessionDialog(c, null, ctx);
  $("#addHall").onclick = () => hallDialog(c, null, ctx);
  $$("[data-sess]", el).forEach(b => b.onclick = () => sessionDialog(c, c.sessionById.get(b.dataset.sess), ctx));
  $$("[data-hall]", el).forEach(b => b.onclick = () => hallDialog(c, c.hallById.get(b.dataset.hall), ctx));
}
function hallDialog(c, h, ctx){
  dialog({need: "manage", title: h ? "Edit hall" : "Add hall", submit: h ? "Save hall" : "Add hall", danger: h ? "Delete hall" : "",
    body: `<label>Name<input name="name" required maxlength="120" value="${esc(h?.name)}" placeholder="Main Hall – Astor A"></label>
      <div class="form-grid"><label>Seats<input name="capacity" type="number" min="1" value="${h?.capacity ?? ""}" placeholder="250"></label>
      <label>Order (colour)<input name="sort" type="number" value="${h?.sort ?? c.halls.length + 1}"></label></div>
      ${h ? `<p class="note">Deleting a hall keeps its sessions, without a hall.</p>` : ""}`,
    onSubmit: async form => { const f = formData(form), row = {name: f.name.trim(), capacity: f.capacity ? Number(f.capacity) : null, sort: Number(f.sort || 0), conference_id: c.conf.id};
      const { error } = h ? await SB.from("conf_halls").update(row).eq("id", h.id) : await SB.from("conf_halls").insert(row);
      if (error) throw error; toast(h ? "Hall saved" : "Hall added"); await ctx.reload(); },
    onDanger: async () => { const { error } = await SB.from("conf_halls").delete().eq("id", h.id); if (error) throw error; toast("Hall deleted"); await ctx.reload(); }});
}
function sessionDialog(c, s, ctx){
  const days = daysBetween(c.conf.start_date, c.conf.end_date), n = s ? (c.checkinsBySession.get(s.id) || []).length : 0;
  dialog({need: "manage", title: s ? "Edit session" : "Add session", submit: s ? "Save session" : "Add session", danger: s ? "Delete session" : "",
    body: `<label>Title<input name="title" required maxlength="200" value="${esc(s?.title)}" placeholder="Arthroplasty – Knee Recon. I"></label>
      <div class="form-grid"><label>Hall<select name="hall_id"><option value="">No hall</option>${c.halls.map(h => `<option value="${h.id}" ${h.id === s?.hall_id ? "selected" : ""}>${esc(h.name)}</option>`).join("")}</select></label>
      <label>Type<select name="kind">${["session", "workshop", "symposium", "ceremony"].map(k => `<option ${k === (s?.kind || "session") ? "selected" : ""}>${k}</option>`).join("")}</select></label></div>
      <div class="form-grid"><label>Day<select name="day">${days.map(d => `<option value="${d}" ${d === (s?.day || progDay) ? "selected" : ""}>${dayShort(d)}</option>`).join("")}</select></label>
      <label>Starts<input name="start_time" type="time" required value="${t5(s?.start_time) || "09:00"}"></label><label>Ends<input name="end_time" type="time" required value="${t5(s?.end_time) || "10:30"}"></label></div>
      ${s && n ? `<p class="note">${n} people are checked in to this session. Deleting it deletes their check-ins too.</p>` : ""}`,
    onSubmit: async form => { const f = formData(form);
      if (f.end_time <= f.start_time) { toast("The session has to end after it starts.", "bad"); return false; }
      const row = {conference_id: c.conf.id, title: f.title.trim(), hall_id: f.hall_id || null, kind: f.kind, day: f.day, start_time: f.start_time, end_time: f.end_time};
      const { error } = s ? await SB.from("conf_sessions").update(row).eq("id", s.id) : await SB.from("conf_sessions").insert(row);
      if (error) throw error; progDay = f.day; toast(s ? "Session saved" : "Session added"); await ctx.reload(); },
    onDanger: async () => { const { error } = await SB.from("conf_sessions").delete().eq("id", s.id); if (error) throw error; toast("Session deleted"); await ctx.reload(); }});
}

/* ---------- settings ---------- */
export function renderSettings(el, c, ctx){
  const conf = c.conf;
  el.innerHTML = `<div class="grid2"><div class="panel"><div class="panel-head"><h2>Conference details</h2><button type="button" id="editConf">Edit details</button></div>
      <dl style="display:grid;grid-template-columns:auto 1fr;gap:8px 18px;margin:0">
      <dt class="note">Name</dt><dd style="margin:0;font-weight:700">${esc(conf.name)}</dd><dt class="note">Dates</dt><dd style="margin:0">${esc(dateRange(conf.start_date, conf.end_date))}</dd>
      <dt class="note">Venue</dt><dd style="margin:0">${esc(conf.venue) || "—"}</dd>
      <dt class="note">Location</dt><dd style="margin:0">${conf.location_url ? `<a href="${esc(conf.location_url)}" target="_blank" rel="noopener">Open in maps</a>` : "No map link yet"}</dd><dt class="note">Late after</dt><dd style="margin:0">${conf.late_after_min} minutes</dd></dl>
      ${conf.cover_url ? `<img src="${esc(conf.cover_url)}" alt="Cover" style="margin-top:14px;border-radius:14px;max-height:180px;object-fit:cover;width:100%">` : ""}</div>
    ${can("owner") ? `<div class="panel"><h2>Delete this conference</h2><p class="note">Removes its program, ${c.attendees.length} attendees, all check-ins, vouchers and print layouts. This can't be undone.</p>
      <label>Type the word DELETE to confirm<input id="delWord" autocomplete="off"></label><button type="button" class="danger" id="delConf" style="margin-top:12px">Delete conference</button></div>` : ""}</div>`;
  el.insertAdjacentHTML("beforeend", listsPanel(c));
  wireLists(el, c, ctx);
  if (can("owner")) teamPanel(el);
  $("#editConf").onclick = () => confDialog(conf);
  if ($("#delConf")) $("#delConf").onclick = async () => {
    if ($("#delWord").value.trim() !== "DELETE") return toast("Type DELETE to confirm.", "bad");
    const { error } = await SB.from("conferences").delete().eq("id", conf.id);
    if (error) return toast(error.message, "bad");
    state.c = null; toast("Conference deleted"); go("#/");
  };
}

/* ---------- team: who can sign in and at what level (owner only; the database checks this too) ---------- */
async function teamPanel(el){
  el.insertAdjacentHTML("beforeend", `<div class="panel team" id="team"><div class="panel-head"><div><h2>Team</h2><span class="note">Everyone here signs in with their own email and password. The level applies to every conference.</span></div></div><div id="teamBody"><div class="skel" style="height:120px"></div></div></div>`);
  const box = $("#teamBody", el);
  const draw = async () => {
    const { data, error } = await SB.rpc("team_list");
    if (error) { box.innerHTML = `<p class="note">The team list isn't available yet: the database update for access levels hasn't been applied.</p>`; return; }
    const me = (state.session?.user?.email || "").toLowerCase();
    const status = m => !m.has_login ? `<span class="pill warn">No login yet</span>` : !m.confirmed ? `<span class="pill warn">Email not confirmed</span>`
      : `<span class="pill ok">Can sign in</span>${m.last_sign_in ? `<small class="note">Last in ${esc(dayShort(m.last_sign_in.slice(0, 10)))}</small>` : ""}`;
    const levelSel = m => `<select data-trole="${esc(m.email)}" aria-label="Level for ${esc(m.email)}">${LEVELS.map(([k, l]) => `<option value="${k}" ${k === m.role ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    box.innerHTML = `<div class="tbl"><table class="rt team-t"><thead><tr><th>Email</th><th>Level</th><th>Login</th><th></th></tr></thead><tbody>${data.map(m => `<tr>
        <td class="main" data-l="Email">${esc(m.email)}${m.email.toLowerCase() === me ? ' <span class="pill acc">You</span>' : ""}</td>
        <td data-l="Level">${levelSel(m)}</td><td data-l="Login"><div class="team-st">${status(m)}</div></td>
        <td class="actions">${m.email.toLowerCase() === me ? "" : `<button type="button" class="danger small" data-tdel="${esc(m.email)}">Remove</button>`}</td></tr>`).join("")}</tbody></table></div>
      <div class="team-add"><label>Email<input id="tEmail" type="email" placeholder="name@jovalley.com" autocomplete="off"></label>
        <label>Level<select id="tRole">${LEVELS.map(([k, l]) => `<option value="${k}" ${k === "staff" ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <button type="button" id="tAdd">${icon("plus")}Add to the team</button></div>
      <details class="team-help"><summary>What each level can do</summary><dl>${LEVELS.map(([, l, d]) => `<dt>${l}</dt><dd>${esc(d)}</dd>`).join("")}</dl></details>
      <p class="note" style="margin:0">New people need a login first: in Supabase go to <b>Authentication → Users → Add user</b>, enter their email and a password, and tick <b>Auto Confirm User</b>. Then add the same email here. Removing someone here takes away their access straight away; their login stays in Supabase.</p>`;
    const run = fn => async () => { try { await fn(); } catch (err) { toast(err.message || String(err), "bad"); } };
    $$("[data-trole]", box).forEach(sel => sel.onchange = run(async () => {
      const { error } = await SB.rpc("team_set", {p_email: sel.dataset.trole, p_role: sel.value});
      if (error) { toast(error.message, "bad"); return draw(); }
      toast(`${sel.dataset.trole} is now ${levelName(sel.value)}`); draw();
    }));
    $$("[data-tdel]", box).forEach(b => b.onclick = () => armed(b, run(async () => {
      const { error } = await SB.rpc("team_remove", {p_email: b.dataset.tdel}); if (error) throw error;
      toast(`${b.dataset.tdel} removed from the team`); draw();
    })));
    const add = run(async () => {
      const email = $("#tEmail", box).value.trim(); if (!email) return $("#tEmail", box).focus();
      const { error } = await SB.rpc("team_set", {p_email: email, p_role: $("#tRole", box).value}); if (error) throw error;
      toast(`${email} added as ${levelName($("#tRole", box).value)}`); draw();
    });
    $("#tAdd", box).onclick = add; $("#tEmail", box).onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); add(); } };
  };
  draw();
}

/* ---------- lists: categories and countries ---------- */
function listsPanel(c){
  const cats = c.conf.categories || [], used = k => c.attendees.filter(a => a.category === k).length;
  const extra = [...new Set(c.attendees.map(a => a.category).filter(k => k && !cats.includes(k)))];
  const countries = countriesOf(c.conf), custom = c.conf.countries?.length > 0;
  const perCountry = new Map(); for (const a of c.attendees) if (a.country) perCountry.set(a.country, (perCountry.get(a.country) || 0) + 1);
  const usedC = k => { const n = perCountry.get(k); return n ? `${n} ${n === 1 ? "person" : "people"}` : ""; };
  return `<div class="grid2"><div class="panel"><div class="panel-head"><div><h2>Categories</h2><span class="note">Shown in the attendee form, filters, vouchers and badges. Renaming updates every attendee and voucher.</span></div></div>
      <div class="form" id="catList">${cats.map((k, i) => `<div class="row" style="align-items:center;flex-wrap:nowrap" data-cat="${i}">
        <input value="${esc(k)}" data-rename="${i}" maxlength="80" aria-label="Category name">
        <span class="note num" style="white-space:nowrap;min-width:64px">${used(k)} ${used(k) === 1 ? "person" : "people"}</span>
        <button type="button" class="ghost small" data-move="${i},-1" aria-label="Move up" ${i ? "" : "disabled"}>↑</button>
        <button type="button" class="ghost small" data-move="${i},1" aria-label="Move down" ${i < cats.length - 1 ? "" : "disabled"}>↓</button>
        <button type="button" class="danger small" data-delcat="${i}">Remove</button></div>`).join("") || '<p class="note">No categories yet.</p>'}</div>
      ${extra.length ? `<p class="note">Used by attendees but not on the list: ${extra.map(k => `<button type="button" class="soft small" data-addextra="${esc(k)}">Add “${esc(k)}”</button>`).join(" ")}</p>` : ""}
      <div class="row" style="margin-top:12px"><label>New category<input id="newCat" maxlength="80" placeholder="Sponsor"></label><button type="button" id="addCat">Add category</button></div></div>
    <div class="panel"><div class="panel-head"><div><h2>Countries</h2><span class="note">${countries.length} countries${custom ? ", edited for this conference" : ", the default list"}. The order here is the order in the dropdown.</span></div></div>
      <label class="search-field">${icon("search")}<input type="search" id="ctryQ" placeholder="Find a country" aria-label="Find a country"></label>
      <ul class="ctry-list" id="ctryList">${countries.map((k, i) => `<li data-ctry="${esc(k)}">${flag(k)}<span>${esc(k)}</span><span class="note num">${usedC(k) || ""}</span>
        <button type="button" class="ghost small" data-ctop="${i}" ${i ? "" : "disabled"} aria-label="Move ${esc(k)} to the top" title="Move to the top">↑</button>
        <button type="button" class="ghost small" data-cdel="${i}" aria-label="Remove ${esc(k)}" title="Remove">${icon("x", "ic sm")}</button></li>`).join("")}</ul>
      <div class="row" style="margin-top:12px"><label>Add a country<input id="newCtry" list="ctryAll" maxlength="80" placeholder="Start typing…"></label><button type="button" id="addCtry">Add country</button>
        ${custom ? '<button type="button" class="ghost" id="resetCtry">Back to the default list</button>' : ""}</div>
      <datalist id="ctryAll">${DEFAULT_COUNTRIES.filter(k => !countries.includes(k)).map(k => `<option value="${esc(k)}">`).join("")}</datalist>
      <p class="note">Attendees keep the country they already have. To change it for many people at once, use Attendees, filter by country, then edit.</p></div></div>`;
}
function wireLists(el, c, ctx){
  const id = c.conf.id, cats = () => [...(c.conf.categories || [])];
  const saveCats = async list => { const { error } = await SB.from("conferences").update({categories: list}).eq("id", id); if (error) throw error; };
  const run = fn => async (...a) => { try { await fn(...a); } catch (err) { toast(err.message || String(err), "bad"); } };
  $$("[data-rename]", el).forEach(inp => inp.onchange = run(async () => {
    const i = Number(inp.dataset.rename), old = cats()[i], nu = inp.value.trim();
    if (!nu || nu === old) { inp.value = old; return; }
    if (cats().includes(nu)) { inp.value = old; return toast(`“${nu}” is already on the list.`, "bad"); }
    const list = cats(); list[i] = nu; await saveCats(list);
    const { error } = await SB.from("attendees").update({category: nu}).eq("conference_id", id).eq("category", old); if (error) throw error;
    for (const v of c.vouchers.filter(v => v.categories.includes(old)))
      await SB.from("vouchers").update({categories: v.categories.map(k => k === old ? nu : k)}).eq("id", v.id);
    toast(`Renamed to “${nu}”`); await ctx.reload();
  }));
  $$("[data-move]", el).forEach(b => b.onclick = run(async () => {
    const [i, d] = b.dataset.move.split(",").map(Number), list = cats(); [list[i], list[i + d]] = [list[i + d], list[i]];
    await saveCats(list); await ctx.reload();
  }));
  $$("[data-delcat]", el).forEach(b => b.onclick = () => armed(b, run(async () => {
    const list = cats(), [k] = list.splice(Number(b.dataset.delcat), 1); await saveCats(list);
    const n = c.attendees.filter(a => a.category === k).length;
    toast(n ? `Removed from the list. ${n} attendees still have “${k}”; change them in Attendees.` : "Removed"); await ctx.reload();
  })));
  const add = run(async name => { const k = String(name || "").trim(); if (!k) return; if (cats().includes(k)) return toast(`“${k}” is already on the list.`, "bad");
    await saveCats([...cats(), k]); toast(`Added “${k}”`); await ctx.reload(); });
  $("#addCat").onclick = () => add($("#newCat").value);
  $("#newCat").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); add(e.target.value); } };
  $$("[data-addextra]", el).forEach(b => b.onclick = () => add(b.dataset.addextra));
  const ctries = () => [...countriesOf(c.conf)];
  const saveCtries = async (list, msg) => {
    if (!list.length) return toast("Keep at least one country, or go back to the default list.", "bad");
    const same = list.join("\n") === DEFAULT_COUNTRIES.join("\n");
    const { error } = await SB.from("conferences").update({countries: same ? [] : list}).eq("id", id); if (error) throw error;
    toast(msg); await ctx.reload();
  };
  $("#ctryQ").oninput = e => { const q = e.target.value.trim().toLowerCase(); $$("#ctryList li", el).forEach(li => li.hidden = q && !li.dataset.ctry.toLowerCase().includes(q)); };
  $$("[data-ctop]", el).forEach(b => b.onclick = run(async () => { const list = ctries(), [k] = list.splice(Number(b.dataset.ctop), 1); await saveCtries([k, ...list], `${k} moved to the top`); }));
  $$("[data-cdel]", el).forEach(b => b.onclick = () => armed(b, run(async () => { const list = ctries(), [k] = list.splice(Number(b.dataset.cdel), 1); await saveCtries(list, `Removed ${k}`); })));
  const addC = run(async () => { const k = $("#newCtry").value.trim(); if (!k) return;
    if (ctries().some(x => x.toLowerCase() === k.toLowerCase())) return toast(`${k} is already on the list.`, "bad");
    await saveCtries([...ctries(), k], `Added ${k}`); });
  $("#addCtry").onclick = addC;
  $("#newCtry").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); addC(); } };
  $("#resetCtry") && ($("#resetCtry").onclick = run(async () => { await SB.from("conferences").update({countries: []}).eq("id", id); toast("Using the default country list"); await ctx.reload(); }));
}

// First paint before auth answers: show the right page for public links.
if (/^#\/(scan|voucher|register|cert|mycert|badge)\//.test(location.hash)) route();
