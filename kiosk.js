// Self-print certificates.
// Kiosk (public): badge ID -> confirm the name and email with big buttons -> the certificate prints by itself.
// Station (team login): a laptop with a printer. It takes the next job from the queue and prints it with no dialog
// (Chrome started with --kiosk-printing). Three stations share one queue; each job goes to whichever is free.
import {SB, $, $$, esc, dateRange, icon, toast, armed, qrSvg, store, state, loadConf, initials, dayShort, hm} from "./core.js";
import {printDocs, printFonts} from "./print.js";

const base = () => location.href.split("#")[0];
export const kioskUrl = id => `${base()}#/printcert/${id}`;
export const stationUrl = id => `${base()}#/station/${id}`;
const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const clean = s => String(s || "").replace(/[​-‏‪-‮⁠-⁩﻿ ]/g, "").trim();
const L = (en, ar) => `${en} <span dir="rtl" class="ks-ar">${ar}</span>`;

/* ---------- kiosk ---------- */
export async function renderKiosk(app, confId){
  const { data: f } = await SB.rpc("c_reg_info", {p_conf: confId});
  app.innerHTML = `<main class="ks"><header class="ks-bar"><img src="assets/jv-mark.svg" alt="" width="14" height="24"><b>${esc(f?.name || "Certificates")}</b>
    ${f ? `<span>${esc(dateRange(f.start_date, f.end_date))}</span>` : ""}</header><div class="ks-stage" id="ks"></div></main>`;
  const ks = $("#ks");
  let resetT = null; const later = (fn, ms) => { clearTimeout(resetT); resetT = setTimeout(fn, ms); };
  const closed = () => { ks.innerHTML = `<div class="ks-card ks-center">${icon("clock", "ic lg")}<h1>${L("Self-print isn't open right now", "الطباعة الذاتية غير متاحة الآن")}</h1><p>Please ask at the registration desk.</p></div>`; };

  // 1. Badge ID, with a big keypad so it works on a touch screen with no keyboard.
  const askId = (msg = "") => {
    clearTimeout(resetT);
    ks.innerHTML = `<form class="ks-card" id="ksId" novalidate><div class="ks-step">1 / 3</div><h1>${L("Print your certificate", "اطبع شهادتك")}</h1>
      <p class="ks-sub">${L("Type the ID on your badge", "اكتب الرقم المطبوع على بطاقتك")}</p>
      <input name="code" class="ks-code" inputmode="numeric" autocomplete="off" maxlength="12" aria-label="Badge ID" placeholder="0000">
      <div class="ks-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, "⌫", 0, "→"].map(k => `<button type="${k === "→" ? "submit" : "button"}" data-k="${k}" class="${k === "→" ? "go" : ""}" aria-label="${k === "⌫" ? "Delete" : k === "→" ? "Continue" : k}">${k === "→" ? icon("chevron") : k}</button>`).join("")}</div>
      <p class="ks-err" role="status">${esc(msg)}</p></form>`;
    const form = $("#ksId"), inp = form.code; inp.focus();
    $$("[data-k]", form).forEach(b => b.type === "button" && (b.onclick = () => { inp.value = b.dataset.k === "⌫" ? inp.value.slice(0, -1) : (inp.value + b.dataset.k).slice(0, 12); inp.focus(); }));
    form.onsubmit = async e => { e.preventDefault(); const v = clean(inp.value); if (!v) return $(".ks-err", form).textContent = "Type your badge ID.";
      $$("button", form).forEach(b => b.disabled = true);
      const { data: p, error } = await SB.rpc("c_kiosk_lookup", {p_conf: confId, p_code: v});
      if (error) return askId("No connection. Try again.");
      if (p.closed) return closed();
      if (!p.found) return askId("No attendee has that ID. Check the number on your badge.");
      confirm(p); };
  };

  // 2. Name and email, each confirmed with one tap; "Edit" opens a field only when something is wrong.
  const confirm = (p, st = {name: p.name, nameOk: false, editName: false, email: "", mailOk: false, editMail: !p.email_hint}) => {
    later(() => askId(), 90000); // walked away: back to the start
    const ready = st.nameOk && (st.mailOk || st.editMail);
    ks.innerHTML = `<div class="ks-card"><div class="ks-step">2 / 3</div><div class="ks-who"><span class="ks-av">${esc(initials(p.name))}</span><span>ID <b class="num">${esc(p.code)}</b>${p.category ? ` · ${esc(p.category)}` : ""}</span>
        <button type="button" class="ks-link" id="ksBack">Not you?</button></div>
      ${p.prints ? `<p class="ks-note">${icon("alert", "ic sm")}Already printed${p.printed_at ? ` ${esc(dayShort(p.printed_at.slice(0, 10)))} ${hm(p.printed_at)}` : ""}. You can print it again.</p>` : ""}
      <section class="ks-q ${st.nameOk ? "ok" : ""}"><span class="ks-ql">${L("Name on the certificate", "الاسم على الشهادة")}</span>
        ${st.editName ? `<input id="ksName" class="ks-in" dir="auto" maxlength="120" value="${esc(st.name)}"><div class="ks-btns"><button type="button" class="ks-b go" id="ksNameSave">${icon("check")}Use this name</button></div>`
          : `<div class="ks-big" dir="auto">${esc(st.name)}</div>
            <div class="ks-btns"><button type="button" class="ks-b ${st.nameOk ? "go on" : "go"}" id="ksNameOk">${icon("check")}${st.nameOk ? "Correct" : "Yes, correct"}</button><button type="button" class="ks-b" id="ksNameEdit">Edit the name</button></div>`}</section>
      <section class="ks-q ${st.mailOk ? "ok" : ""}"><span class="ks-ql">${L("Email", "البريد الإلكتروني")}</span>
        ${st.editMail ? `<input id="ksMail" class="ks-in" type="email" inputmode="email" maxlength="200" value="${esc(st.email)}" placeholder="${p.email_hint ? "New email" : "Add your email (optional)"}">
            <p class="ks-hint">${p.email_hint ? "The desk checks a new email before it replaces the old one." : "Optional. We use it to send you a copy."}</p>`
          : `<div class="ks-big small">${esc(p.email_hint)}</div>
            <div class="ks-btns"><button type="button" class="ks-b ${st.mailOk ? "go on" : "go"}" id="ksMailOk">${icon("check")}${st.mailOk ? "Correct" : "Yes, correct"}</button><button type="button" class="ks-b" id="ksMailEdit">Change</button></div>`}</section>
      <button type="button" class="ks-print" id="ksPrint" ${ready ? "" : "disabled"}>${icon("print")}${L("Print my certificate", "اطبع شهادتي")}</button>
      <p class="ks-err" role="status"></p></div>`;
    const set = patch => confirm(p, {...st, ...patch});
    $("#ksBack").onclick = () => askId();
    $("#ksNameOk") && ($("#ksNameOk").onclick = () => set({nameOk: true}));
    $("#ksNameEdit") && ($("#ksNameEdit").onclick = () => set({editName: true, nameOk: false}));
    $("#ksNameSave") && ($("#ksNameSave").onclick = () => { const v = clean($("#ksName").value).replace(/\s+/g, " "); if (v.length < 2) return $(".ks-err").textContent = "Type your full name."; set({name: v, editName: false, nameOk: true}); });
    $("#ksMailOk") && ($("#ksMailOk").onclick = () => set({mailOk: true}));
    $("#ksMailEdit") && ($("#ksMailEdit").onclick = () => set({editMail: true, mailOk: false}));
    $("#ksName")?.focus();
    $("#ksPrint").onclick = async () => {
      const email = $("#ksMail") ? clean($("#ksMail").value).toLowerCase() : "";
      if (email && !EMAIL.test(email)) return $(".ks-err").textContent = "That email doesn't look right.";
      $("#ksPrint").disabled = true;
      const { data, error } = await SB.rpc("c_kiosk_print", {p_conf: confId, p_code: p.code, p_name: st.name, p_email: email});
      const s = error ? "net" : data?.status;
      if (s === "ok") return track(p, st.name, data.job);
      if (s === "closed") return closed();
      $("#ksPrint").disabled = false;
      $(".ks-err").textContent = {limit: "This certificate was printed 3 times already. Please ask at the desk.", busy: "The printers are busy. Try again in a minute.",
        name: "Type your full name.", email: "That email doesn't look right.", code: "That ID wasn't found.", net: "No connection. Try again."}[s] || "Not sent. Try again.";
    };
  };

  // 3. Live: waiting -> printing at Printer 2 -> ready to collect. Then back to the start for the next person.
  const track = (p, name, job) => {
    clearTimeout(resetT);
    const draw = j => {
      const done = j.status === "printed", printing = j.status === "printing";
      ks.innerHTML = `<div class="ks-card ks-center ks-track ${done ? "done" : ""}"><div class="ks-step">3 / 3</div>
        <div class="ks-printer ${printing ? "busy" : ""} ${done ? "done" : ""}"><span class="ks-paper"></span>${icon(done ? "check" : "print", "ic lg")}</div>
        <h1 dir="auto">${esc(name)}</h1>
        <p class="ks-status">${done ? L(`Ready at ${esc(j.station || "the printer")}`, "شهادتك جاهزة") : printing ? L(`Printing at ${esc(j.station)}…`, "جاري الطباعة") : j.status === "failed" ? "Something went wrong. Please ask at the desk."
          : L(j.ahead ? `${j.ahead} ahead of you` : "Next in line", "بانتظار الطابعة")}</p>
        ${done ? `<p class="ks-sub">Collect it from ${esc(j.station || "the printer")}. Thank you for coming.</p>` : ""}
        <button type="button" class="ks-b" id="ksNext">${done ? "Done" : "Start again"}</button></div>`;
      $("#ksNext").onclick = () => { clearInterval(poll); askId(); };
      if (done || j.status === "failed") { clearInterval(poll); later(() => askId(), 15000); }
    };
    draw({status: "queued", ahead: null});
    const poll = setInterval(async () => {
      if (!document.contains(ks)) return clearInterval(poll);
      const { data } = await SB.rpc("c_kiosk_job", {p_job: job}); if (data) draw(data);
    }, 1500);
  };
  if (!f) return closed();
  askId();
}

/* ---------- station ---------- */
export async function renderStation(app, confId){
  let name = store.get(`station:${confId}`) || "";
  const pick = () => {
    app.innerHTML = `<main class="st"><div class="st-pick"><h1>Which printer is this?</h1><p>Each laptop with a printer is one station. Certificates go to whichever is free.</p>
      <div class="st-names">${["Printer 1", "Printer 2", "Printer 3", "Printer 4"].map(n => `<button type="button" data-n="${n}">${icon("print", "ic lg")}${n}</button>`).join("")}</div></div></main>`;
    $$("[data-n]", app).forEach(b => b.onclick = () => { name = b.dataset.n; store.set(`station:${confId}`, name); run(); });
  };
  const run = async () => {
    let c = await loadConf(confId, {force: true}), fresh = Date.now(), busy = false, count = 0, last = [], stop = false;
    await printFonts();
    app.innerHTML = `<main class="st"><header class="st-top"><b>${esc(name)}</b><span>${esc(c.conf.name)}</span><button type="button" id="stName">Change</button></header>
      <div class="st-body"><div class="st-ring" id="stRing"><span id="stState">Ready</span><small id="stSub">Waiting for the next certificate</small></div>
        <div class="st-stats"><div><b id="stCount">0</b><span>printed here</span></div><div><b id="stQueue">0</b><span>waiting</span></div></div>
        <ul class="st-last" id="stLast"></ul>
        <div class="st-help">For printing with no dialog, open this page in Chrome started with <code>--kiosk-printing</code>, and set the certificate paper size on the printer.
          <button type="button" id="stTest">Test print</button></div></div></main>`;
    $("#stName").onclick = () => { stop = true; store.set(`station:${confId}`, ""); name = ""; pick(); };
    $("#stTest").onclick = () => printDocs(c, "certificate", [c.attendees[0] || {code: "0000", full_name: "Test Name"}], {test: true});
    const ui = (state, sub, cls = "") => { $("#stState").textContent = state; $("#stSub").textContent = sub; $("#stRing").className = "st-ring " + cls; };
    const tick = async () => {
      if (stop || !document.contains(app.querySelector(".st-body"))) return;
      if (!busy) {
        busy = true;
        try {
          const [{ data: jobs, error }, { count: q }] = await Promise.all([SB.rpc("c_station_claim", {p_conf: confId, p_station: name}),
            SB.from("print_jobs").select("id", {count: "exact", head: true}).eq("conference_id", confId).eq("status", "queued")]);
          $("#stQueue").textContent = q ?? 0;
          if (error) ui("Offline", error.message, "bad");
          else if (jobs?.length) {
            const j = jobs[0];
            if (Date.now() - fresh > 60000 || !c.attendees.some(a => a.id === j.attendee_id)) { c = await loadConf(confId, {force: true}); fresh = Date.now(); }
            const a = c.attendees.find(x => x.id === j.attendee_id);
            ui("Printing", j.name, "busy");
            const full = c.conf.print_kiosk?.full !== false;
            const done = new Promise(res => { addEventListener("afterprint", res, {once: true}); setTimeout(res, 45000); });
            await printDocs(c, "certificate", [{...(a || {code: j.code, full_name: j.name}), cert_name: j.name}], {full});
            await done;
            await SB.from("print_jobs").update({status: "printed", printed_at: new Date().toISOString()}).eq("id", j.id);
            count++; last = [{n: j.name, code: j.code, at: new Date()}, ...last].slice(0, 6);
            await SB.from("print_stations").update({printed: count}).eq("conference_id", confId).eq("name", name);
            $("#stCount").textContent = count;
            $("#stLast").innerHTML = last.map(x => `<li><span class="num">${esc(x.code)}</span>${esc(x.n)}<time>${x.at.toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit"})}</time></li>`).join("");
            ui("Printed", j.name, "done");
          } else ui("Ready", "Waiting for the next certificate");
        } catch (err) { ui("Error", err.message || "Something went wrong", "bad"); }
        busy = false;
      }
      setTimeout(tick, 2000);
    };
    tick();
  };
  if (!name) pick(); else run();
}

/* ---------- team panel (Certificates page) ---------- */
export function kioskPanel(c){
  const k = {open: false, full: true, ...(c.conf.print_kiosk || {})};
  return `<section class="panel form ksp" id="ksPanel"><div class="panel-head" style="margin:0"><h2>Self-print certificates</h2><span class="pill ${k.open ? "ok live" : ""}">${k.open ? "Open" : "Closed"}</span></div>
    <p class="note" style="margin:0">Attendees type their badge ID, confirm name and email, and the certificate prints by itself on whichever printer is free.</p>
    <div class="ksp-live" id="ksLive"><span class="note">Loading the printers…</span></div>
    <label>Prints<select id="ksFull"><option value="1" ${k.full !== false ? "selected" : ""}>Full design, on blank paper</option><option value="" ${k.full === false ? "selected" : ""}>Text only, on paper with the design already printed</option></select></label>
    <div class="codes" style="justify-content:center"><div style="width:140px;height:140px">${qrSvg(kioskUrl(c.conf.id))}</div></div>
    <div class="row"><button type="button" id="ksToggle" class="${k.open ? "ghost" : ""}">${k.open ? "Close self-print" : "Open self-print"}</button>
      <button type="button" class="ghost" id="ksCopy">${icon("link")}Kiosk link</button><button type="button" class="ghost" id="ksStation">${icon("print")}Station link</button></div>
    <p class="note" style="margin:0">On each printer laptop: sign in, open the station link in Chrome started with <code>--kiosk-printing</code>, and pick its printer name.</p></section>`;
}
export function wireKiosk(el, c, ctx){
  const k = {open: false, full: true, ...(c.conf.print_kiosk || {})};
  const save = async patch => { const { error } = await SB.from("conferences").update({print_kiosk: {...k, ...patch}}).eq("id", c.conf.id); if (error) return toast(error.message, "bad"); ctx.reload(); };
  $("#ksToggle", el).onclick = () => save({open: !k.open}).then(() => toast(k.open ? "Self-print closed" : "Self-print open"));
  $("#ksFull", el).onchange = e => save({full: !!e.target.value});
  $("#ksCopy", el).onclick = () => navigator.clipboard.writeText(kioskUrl(c.conf.id)).then(() => toast("Kiosk link copied"));
  $("#ksStation", el).onclick = () => navigator.clipboard.writeText(stationUrl(c.conf.id)).then(() => toast("Station link copied. Open it on each printer laptop."));
  const live = async () => {
    const box = $("#ksLive", el); if (!box || !document.contains(box)) return;
    const [{ data: st }, { data: jobs }] = await Promise.all([SB.from("print_stations").select("*").eq("conference_id", c.conf.id).order("name"),
      SB.from("print_jobs").select("code,name,status,station,created_at,printed_at").eq("conference_id", c.conf.id).order("created_at", {ascending: false}).limit(6)]);
    if (!document.contains(box)) return;
    const on = s => Date.now() - Date.parse(s.seen_at) < 15000, q = (jobs || []).filter(j => j.status === "queued").length;
    box.innerHTML = `<div class="ksp-st">${(st || []).map(s => `<span class="ksp-s ${on(s) ? "on" : ""}">${icon("print", "ic sm")}${esc(s.name)}<small>${on(s) ? `${s.printed} printed` : "offline"}</small></span>`).join("")
        || `<span class="note">No printer stations yet. Open the station link on a printer laptop.</span>`}</div>
      ${(jobs || []).length ? `<ul class="ksp-jobs">${jobs.map(j => `<li class="${j.status}"><span class="num">${esc(j.code)}</span><span dir="auto">${esc(j.name)}</span><small>${j.status === "printed" ? `${esc(j.station || "")} ✓` : j.status === "printing" ? `printing at ${esc(j.station || "")}` : esc(j.status)}</small></li>`).join("")}</ul>` : ""}
      ${q ? `<p class="note" style="margin:0">${q} waiting for a printer</p>` : ""}`;
    setTimeout(live, 4000);
  };
  live();
}
