// Certificates: visitors request one from a QR on the table, you check it against real attendance and approve,
// the certificate (your designer layout, one page per workshop) is emailed through the conference Gmail.
// You can also email everyone who attended a session in one go.
import {SB, $, $$, esc, t5, hm, dayShort, dateRange, store, toast, armed, dialog, qrSvg, icon, initials, fetchAll} from "./core.js";
import {certPdf, certShowsSession} from "./print.js";

const formUrl = id => `${location.href.split("#")[0]}#/cert/${id}`;
const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const clean = s => String(s || "").replace(/[​-‏‪-‮⁠-⁩﻿ ]/g, "").trim();
const b64 = blob => new Promise(r => { const f = new FileReader(); f.onload = () => r(String(f.result).split(",")[1]); f.readAsDataURL(blob); });
const fileName = n => "Certificate - " + (clean(n).replace(/^(dr|prof)\.?\s+/i, "").replace(/[\\/:*?"<>|]+/g, "") || "Attendee") + ".pdf";
const publicBar = `<header class="topbar"><div class="wrap"><span class="brand"><img class="brand-mark" src="assets/jv-mark.svg" alt="" width="14" height="24">JV Connect</span></div></header>`;

/* ---------- public form ---------- */
export async function renderPublic(app, confId){
  app.innerHTML = publicBar + `<main><div class="wrap"><div class="scan-wrap" id="pg"><div class="empty">Loading…</div></div></div></main>`;
  const { data: f, error } = await SB.rpc("c_cert_form", {p_conf: confId});
  if (error) throw error;
  const pg = $("#pg"), L = (en, ar) => `${en} <span dir="rtl" style="font-weight:400">${ar}</span>`;
  const head = f ? `<div class="panel" style="display:grid;gap:4px"><h1 style="font-size:24px">${esc(f.name)}</h1><p class="note" style="margin:0">${esc(dateRange(f.start_date, f.end_date))}${f.venue ? ", " + esc(f.venue) : ""}</p></div>` : "";
  if (!f || !f.open || !f.sessions.length) { pg.innerHTML = head + `<div class="panel empty-state">${icon("clock", "ic lg")}<h2>Certificate requests aren't open</h2><p>Please ask at the registration desk. <span dir="rtl">يرجى السؤال في مكتب التسجيل.</span></p></div>`; return; }
  const days = [...new Set(f.sessions.map(s => s.day))];
  pg.innerHTML = head + `<form class="panel form" id="cf" novalidate><div><h2>Get your certificate</h2><p class="note" style="margin:4px 0 0">Your certificate is emailed to you as a PDF once the organisers approve it.
      <span dir="rtl" style="display:block">تصلك الشهادة على بريدك الإلكتروني بعد الموافقة.</span></p></div>
    <label>${L("Name as it should appear on the certificate", "الاسم على الشهادة")}<input name="full_name" required maxlength="200" autocomplete="name" placeholder="Dr. Lina Haddad"></label>
    <label>${L("Email", "البريد الإلكتروني")}<input name="email" type="email" required maxlength="200" autocomplete="email" inputmode="email"></label>
    <label>${L("Badge number (optional)", "رقم البطاقة (اختياري)")}<input name="code" maxlength="32" inputmode="numeric" placeholder="The number under the QR on your badge"></label>
    <fieldset style="border:0;padding:0;margin:0;display:grid;gap:8px"><legend style="font-weight:600;font-size:13px;color:var(--muted);margin-bottom:6px">${L("Workshops you attended", "ورش العمل التي حضرتها")}</legend>
      ${days.map(d => `<div class="note" style="font-weight:600;margin-top:4px">${esc(dayShort(d))}</div>` + f.sessions.filter(s => s.day === d).map(s =>
        `<label class="check cf-ws"><input type="checkbox" name="s" value="${s.id}"><span>${esc(s.title)} <span class="note">${t5(s.start)}</span></span></label>`).join("")).join("")}</fieldset>
    <button type="submit" class="big-btn">Send my request</button><p class="note" id="cfMsg" role="status" style="margin:0;color:var(--bad)"></p></form>`;
  const form = $("#cf");
  form.onsubmit = async e => {
    e.preventDefault(); const msg = $("#cfMsg");
    const p = {full_name: clean(form.full_name.value), email: clean(form.email.value).toLowerCase(), code: clean(form.code.value), sessions: $$("input[name=s]:checked", form).map(x => x.value)};
    if (p.full_name.length < 2) return msg.textContent = "Type your full name.";
    if (!EMAIL.test(p.email)) return msg.textContent = "That email doesn't look right. Check it and try again.";
    if (!p.sessions.length) return msg.textContent = "Tick at least one workshop you attended.";
    const btn = $("button", form); btn.disabled = true; msg.textContent = "";
    const { data, error } = await SB.rpc("c_cert_request", {p_conf: confId, p}); btn.disabled = false;
    if (error || data?.status !== "ok") return msg.textContent = data?.status === "closed" ? "Requests just closed. Please ask at the desk." : "Not sent. Check your details and connection, then try again.";
    pg.innerHTML = head + `<div class="panel reg-done"><span class="pill ok">Request received</span><h2>${esc(p.full_name)}</h2>
      <p style="margin:0">Once approved, your certificate${p.sessions.length > 1 ? "s" : ""} will be emailed to <b>${esc(p.email)}</b>.</p>
      <p class="note" dir="rtl" style="margin:0">شكراً لك، ستصلك الشهادة بعد الموافقة.</p><p class="note" style="margin:0">Not in your inbox later? Check the spam or junk folder.</p>
      <button type="button" class="ghost" id="cfAgain">Request for someone else</button></div>`;
    $("#cfAgain").onclick = () => renderPublic(app, confId);
  };
}

/* ---------- admin ---------- */
const ui = {tab: "pending", q: "", bulk: ""};
let reqs = [], timer = null;
addEventListener("hashchange", () => clearTimeout(timer));
const sessionsOf = (c, ids) => ids.map(id => c.sessionById.get(id)).filter(Boolean);
// Who is this request? Badge ID first, then email, then the exact name.
const match = (c, r) => c.byCode.get(r.code) || c.attendees.find(a => a.email && a.email.toLowerCase() === r.email) || c.attendees.find(a => a.full_name.trim().toLowerCase() === r.full_name.trim().toLowerCase());
const attended = (c, a, sid) => !!a && (c.checkinsBySession.get(sid) || []).some(k => k.code === a.code);
const mailText = () => ({subject: store.get("certSubject") || "Your workshop certificate", body: store.get("certBody") ||
  "Dear {name},\n\nThank you for attending. Your certificate is attached as a PDF.\n\nBest regards,\nThe organising committee"});

async function send(c, person, sessions){
  const t = mailText(), fill = s => s.split("{name}").join(person.cert_name);
  const pages = sessions.map(s => ({...person, session_title: s.title, session_day: s.day}));
  const { data, error } = await SB.functions.invoke("send-certificate", {body: {to: person.email, name: person.cert_name, subject: fill(t.subject), text: fill(t.body),
    workshops: sessions.map(s => `${s.title}, ${dayShort(s.day)}`), filename: fileName(person.cert_name), pdf: await b64(await certPdf(c, pages, {kind: "certificate"}))}});
  if (!error && data?.ok) return "";
  try { return (await error.context.json()).error; } catch { return error?.message || "Not sent."; }
}

export async function render(el, c, ctx){
  clearTimeout(timer);
  reqs = await fetchAll("conf_cert_requests", q => q.eq("conference_id", c.conf.id).order("created_at", {ascending: false}));
  draw(el, c, ctx);
  const tick = async () => { if (!document.contains(el)) return; if (document.visibilityState === "visible" && !$("dialog[open]") && !el.querySelector(".req-card :focus")) {
      const n = await fetchAll("conf_cert_requests", q => q.eq("conference_id", c.conf.id).order("created_at", {ascending: false}));
      if (n.length !== reqs.length || n.some((r, i) => r.status !== reqs[i]?.status)) { reqs = n; draw(el, c, ctx); } }
    timer = setTimeout(tick, 15000); };
  timer = setTimeout(tick, 15000);
}
function draw(el, c, ctx){
  const conf = c.conf, offered = new Set(conf.cert_sessions || []), by = k => reqs.filter(r => r.status === k);
  const today = new Date().toDateString(), sentToday = by("sent").filter(r => r.decided_at && new Date(r.decided_at).toDateString() === today).length;
  const q = ui.q.trim().toLowerCase(), list = by(ui.tab).filter(r => !q || `${r.full_name} ${r.email} ${r.code}`.toLowerCase().includes(q));
  if (ui.tab === "pending") list.reverse(); // oldest first
  const layoutOk = certShowsSession(c);
  el.innerHTML = `<div class="kpis">
      <div class="panel kpi"><span>Waiting for approval</span><strong>${by("pending").length}</strong><small>${by("pending").length ? "Oldest first below" : "All caught up"}</small></div>
      <div class="panel kpi"><span>Sent today</span><strong>${sentToday}</strong><small>${by("sent").length} sent in total</small></div>
      <div class="panel kpi"><span>Request form</span><strong style="font-size:22px">${conf.cert_form_open ? "Open" : "Closed"}</strong><small>${offered.size} workshop${offered.size === 1 ? "" : "s"} offered</small></div></div>
    ${layoutOk ? "" : `<div class="tip warn"><span class="tip-ic">${icon("alert")}</span><span><b>The certificate layout doesn't show the workshop name</b><small>Add the "Workshop / session" field in Badges &amp; certificates so each page says which workshop it is for.</small></span><a class="btn ghost small" href="#/c/${conf.id}/print">Open the designer</a></div>`}
    <div class="ov-grid">
      <section class="panel" style="display:grid;gap:12px">
        <div class="toolbar"><div class="seg" role="group" aria-label="Show">${[["pending", "Waiting"], ["sent", "Sent"], ["rejected", "Rejected"]].map(([k, l]) =>
          `<button type="button" data-tab="${k}" aria-pressed="${ui.tab === k}">${l} <span class="count">${by(k).length}</span></button>`).join("")}</div>
          <label class="search-field">${icon("search")}<input type="search" id="cQ" placeholder="Search name, email or badge" value="${esc(ui.q)}" aria-label="Search requests"></label>
          ${ui.tab === "pending" && list.length > 1 ? `<button type="button" class="small" id="cAll">${icon("check")}Approve all ${list.length}</button>` : ""}</div>
        <div class="tips" id="cList">${list.map(r => card(c, r)).join("") || `<div class="empty-state" style="padding:28px">${icon(ui.tab === "pending" ? "check" : "search", "ic lg")}<p style="margin:0">${q ? "Nobody matches." : ui.tab === "pending" ? (conf.cert_form_open ? "Nobody is waiting. New requests appear here by themselves." : "Nobody is waiting. Open the request form on the right so people can ask.") : "Nothing here yet."}</p></div>`}</div>
      </section>
      <div style="display:grid;gap:20px;align-content:start">
        <section class="panel form"><div class="panel-head" style="margin:0"><h2>Request form</h2><span class="pill ${conf.cert_form_open ? "ok live" : ""}">${conf.cert_form_open ? "Open" : "Closed"}</span></div>
          <div class="codes" style="justify-content:center"><div style="width:150px;height:150px">${qrSvg(formUrl(conf.id))}</div></div>
          <div class="linkbox"><input readonly value="${esc(formUrl(conf.id))}" onfocus="this.select()" aria-label="Certificate request link"><button type="button" class="ghost small" id="cCopy">Copy</button></div>
          <div class="row"><button type="button" id="cToggle" class="${conf.cert_form_open ? "ghost" : ""}">${conf.cert_form_open ? "Close the form" : "Open the form"}</button>
            <button type="button" class="ghost" id="cSign">${icon("print")}Table sign</button><button type="button" class="ghost" id="cPick">Choose workshops</button></div></section>
        <section class="panel form"><h2>Email everyone who attended</h2><p class="note" style="margin:0">Sends each person who checked in to a session, and has an email, their certificate for it.</p>
          <select id="cBulkS" aria-label="Session"><option value="">Choose a session…</option>${c.sessions.map(s => { const n = (c.checkinsBySession.get(s.id) || []).length;
            return n ? `<option value="${s.id}" ${ui.bulk === s.id ? "selected" : ""}>${esc(dayShort(s.day))} ${t5(s.start_time)}, ${esc(s.title)} (${n})</option>` : ""; }).join("")}</select>
          <div id="cBulkInfo" class="note"></div><button type="button" id="cBulkGo" disabled>Email certificates</button></section>
        <details class="panel"><summary style="cursor:pointer;font-weight:600">Email text</summary><div class="form" style="margin-top:12px">
          <label>Subject<input id="cSubj" value="${esc(mailText().subject)}"></label><label>Message<textarea id="cBody" rows="7">${esc(mailText().body)}</textarea></label>
          <span class="note">{name} becomes the name on the certificate. The person's name is added to the start of the subject.</span></div></details>
      </div></div>`;
  wire(el, c, ctx, list);
}
function card(c, r){
  const a = match(c, r), ss = sessionsOf(c, r.session_ids), pending = r.status === "pending";
  return `<article class="req-card${r.error ? " flag" : ""}" data-id="${r.id}">
    <div class="rc-top"><span class="av">${esc(initials(r.full_name))}</span>
      <div class="rc-who"><input data-name value="${esc(r.full_name)}" ${pending ? "" : "readonly"} aria-label="Name on the certificate"><input data-email type="email" value="${esc(r.email)}" ${pending ? "" : "readonly"} aria-label="Email"></div></div>
    <div class="rc-meta">${a ? `<span class="pill acc">Matched: ${esc(a.code)} ${esc(a.full_name)}</span>` : `<span class="pill warn">Not on the attendee list${r.code ? ` (badge ${esc(r.code)} not found)` : ""}</span>`}
      <span>Asked ${dayShort(r.created_at.slice(0, 10))} ${hm(r.created_at)}</span>${r.decided_at ? `<span>${r.status === "sent" ? "Sent" : "Decided"} ${dayShort(r.decided_at.slice(0, 10))} ${hm(r.decided_at)}</span>` : ""}
      ${r.error ? `<span class="pill bad">Last try failed: ${esc(r.error)}</span>` : ""}</div>
    <div class="rc-ws">${ss.map(s => { const ok = attended(c, a, s.id);
      // Smart default: untick workshops with no check-in for a matched attendee.
      return `<label class="${ok ? "" : a ? "no" : ""}"><input type="checkbox" data-s="${s.id}" ${!pending || !a || ok ? "checked" : ""} ${pending ? "" : "disabled"}>
        <span>${esc(s.title)} <small>${esc(dayShort(s.day))} ${t5(s.start_time)}</small></span>${a ? (ok ? `<span class="pill ok">Checked in</span>` : `<span class="pill warn">No check-in</span>`) : ""}</label>`; }).join("")}</div>
    <div class="rc-acts">${pending ? `<button type="button" class="ghost small" data-act="reject">Reject</button><span style="flex:1"></span><button type="button" class="ghost small" data-act="preview">${icon("print")}Preview</button><button type="button" class="small" data-act="approve">${icon("check")}Approve and send</button>`
      : r.status === "sent" ? `<span style="flex:1"></span><button type="button" class="ghost small" data-act="preview">${icon("print")}Preview</button><button type="button" class="ghost small" data-act="resend">Send again</button>`
      : `<span style="flex:1"></span><button type="button" class="ghost small" data-act="restore">Move back to waiting</button>`}</div>
    <p class="note rc-msg" data-msg role="status" style="margin:0"></p></article>`;
}
function readCard(c, r, box){
  const a = match(c, r), name = clean(box.querySelector("[data-name]").value), email = clean(box.querySelector("[data-email]").value).toLowerCase();
  const ids = r.status === "pending" ? $$("[data-s]", box).filter(x => x.checked).map(x => x.dataset.s) : r.session_ids;
  return {person: {...(a || {}), full_name: name, cert_name: name, email}, ids, sessions: sessionsOf(c, ids)};
}
async function approve(c, r, box){
  const v = readCard(c, r, box), msg = box.querySelector("[data-msg]");
  const bad = v.person.cert_name.length < 2 ? "Type the name for the certificate." : !EMAIL.test(v.person.email) ? "That email doesn't look right." : !v.sessions.length ? "Tick at least one workshop, or press Reject." : "";
  if (bad) { msg.style.color = "var(--bad)"; msg.textContent = bad; return bad; }
  $$("button", box).forEach(b => b.disabled = true); msg.style.color = ""; msg.textContent = "Making the certificate and sending…";
  const err = await send(c, v.person, v.sessions), now = new Date().toISOString();
  if (err) { await SB.from("conf_cert_requests").update({error: err}).eq("id", r.id); msg.style.color = "var(--bad)"; msg.textContent = err; $$("button", box).forEach(b => b.disabled = false); return err; }
  const patch = {status: "sent", full_name: v.person.cert_name, email: v.person.email, session_ids: v.ids, error: null, decided_at: now};
  await SB.from("conf_cert_requests").update(patch).eq("id", r.id); Object.assign(r, patch); return "";
}
function wire(el, c, ctx, list){
  const conf = c.conf, redraw = () => draw(el, c, ctx);
  $$("[data-tab]", el).forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; redraw(); });
  let qT; $("#cQ").oninput = e => { clearTimeout(qT); qT = setTimeout(() => { ui.q = e.target.value; redraw(); $("#cQ").focus(); $("#cQ").setSelectionRange(9999, 9999); }, 150); };
  $("#cSubj").oninput = e => store.set("certSubject", e.target.value); $("#cBody").oninput = e => store.set("certBody", e.target.value);
  $("#cCopy").onclick = () => navigator.clipboard.writeText(formUrl(conf.id)).then(() => toast("Link copied"));
  $("#cToggle").onclick = async () => {
    if (!conf.cert_form_open && !(conf.cert_sessions || []).length) return pickDialog(c, ctx, true);
    const { error } = await SB.from("conferences").update({cert_form_open: !conf.cert_form_open}).eq("id", conf.id); if (error) return toast(error.message, "bad");
    toast(conf.cert_form_open ? "Request form closed" : "Request form open"); ctx.reload(); };
  $("#cPick").onclick = () => pickDialog(c, ctx, false);
  $("#cSign").onclick = () => printSign(c);
  $("#cAll") && ($("#cAll").onclick = e => armed(e.currentTarget, async () => {
    let ok = 0; for (const r of list) { const box = el.querySelector(`[data-id="${r.id}"]`); const err = await approve(c, r, box);
      if (err) { toast(`Stopped at ${r.full_name}: ${err}`, "bad"); break; } ok++; await new Promise(x => setTimeout(x, 700)); }
    if (ok) toast(`Sent ${ok} certificate email${ok === 1 ? "" : "s"}`); redraw(); }));
  $("#cList").addEventListener("click", async e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const box = b.closest("[data-id]"), r = reqs.find(x => x.id === box.dataset.id), act = b.dataset.act;
    if (act === "preview") { const v = readCard(c, r, box); if (!v.sessions.length) return toast("Tick at least one workshop to preview.", "bad");
      const w = window.open("", "_blank"); b.disabled = true;  // open first: browsers block tabs opened after a wait
      const blob = await certPdf(c, v.sessions.map(s => ({...v.person, session_title: s.title, session_day: s.day}))); b.disabled = false;
      if (w) w.location = URL.createObjectURL(blob); else toast("The browser blocked the preview tab.", "bad"); return; }
    if (act === "approve") { const err = await approve(c, r, box); if (!err) { toast(`Sent to ${r.email}`); redraw(); } return; }
    if (act === "reject") return armed(b, async () => { const patch = {status: "rejected", decided_at: new Date().toISOString()};
      await SB.from("conf_cert_requests").update(patch).eq("id", r.id); Object.assign(r, patch); toast("Rejected"); redraw(); });
    if (act === "restore") { const patch = {status: "pending", decided_at: null}; await SB.from("conf_cert_requests").update(patch).eq("id", r.id); Object.assign(r, patch); toast("Moved back to waiting"); return redraw(); }
    if (act === "resend") { b.disabled = true; const v = readCard(c, r, box), err = await send(c, v.person, v.sessions); b.disabled = false;
      if (err) return toast(err, "bad"); await SB.from("conf_cert_requests").update({decided_at: new Date().toISOString()}).eq("id", r.id); toast(`Sent again to ${r.email}`); }
  });
  // Bulk: everyone checked in to a session who has an email.
  const bulkPeople = sid => [...new Set((c.checkinsBySession.get(sid) || []).map(k => k.code))].map(code => c.byCode.get(code)).filter(Boolean);
  const info = () => { const sid = $("#cBulkS").value; ui.bulk = sid; if (!sid) { $("#cBulkInfo").textContent = ""; $("#cBulkGo").disabled = true; return; }
    const ppl = bulkPeople(sid), withMail = ppl.filter(a => EMAIL.test(clean(a.email)));
    $("#cBulkInfo").textContent = `${ppl.length} checked in, ${withMail.length} with an email${ppl.length - withMail.length ? `; ${ppl.length - withMail.length} without an email are skipped` : ""}.`;
    $("#cBulkGo").disabled = !withMail.length; $("#cBulkGo").textContent = `Email ${withMail.length} certificate${withMail.length === 1 ? "" : "s"}`; };
  $("#cBulkS").onchange = info; info();
  $("#cBulkGo").onclick = e => armed(e.currentTarget, async () => {
    const s = c.sessionById.get($("#cBulkS").value), ppl = bulkPeople(s.id).filter(a => EMAIL.test(clean(a.email)));
    const btn = $("#cBulkGo"); btn.disabled = true; let ok = 0, fail = 0;
    for (const [i, a] of ppl.entries()) { btn.textContent = `Sending ${i + 1} of ${ppl.length}…`;
      const err = await send(c, {...a, cert_name: a.cert_name || a.full_name, email: clean(a.email).toLowerCase()}, [s]);
      if (err) { fail++; if (/set up|refused the login|limit|admin/i.test(err)) { toast(err, "bad"); break; } } else ok++;
      await new Promise(x => setTimeout(x, 700)); }
    toast(`Sent ${ok}${fail ? `, ${fail} not sent` : ""}`, fail ? "bad" : ""); info();
  });
}
// Which sessions appear on the public form. Workshops are ticked by default the first time.
function pickDialog(c, ctx, thenOpen){
  const cur = new Set(c.conf.cert_sessions || []), first = !cur.size;
  const days = [...new Set(c.sessions.map(s => s.day))];
  {
    const dl = dialog({need: "manage", title: "Workshops on the request form", submit: thenOpen ? "Save and open the form" : "Save", wide: true,
      body: `<p class="note" style="margin:0">Tick the sessions people can ask a certificate for.</p>
        <div class="row"><button type="button" class="ghost small" data-pick="ws">Workshops only</button><button type="button" class="ghost small" data-pick="all">All</button><button type="button" class="ghost small" data-pick="none">None</button></div>
        ${days.map(dy => `<div><h3 style="margin:8px 0 6px">${esc(dayShort(dy))}</h3><div style="display:grid;gap:4px">${c.sessions.filter(s => s.day === dy).map(s =>
          `<label class="check"><input type="checkbox" name="cs" value="${s.id}" data-kind="${esc(s.kind)}" ${(first ? s.kind === "workshop" : cur.has(s.id)) ? "checked" : ""}> ${esc(s.title)} <span class="note">${t5(s.start_time)}${s.kind !== "session" ? ", " + esc(s.kind) : ""}</span></label>`).join("")}</div></div>`).join("")}`,
      onSubmit: async form => { const ids = $$("input[name=cs]:checked", form).map(x => x.value);
        if (!ids.length) { toast("Tick at least one session.", "bad"); return false; }
        const { error } = await SB.from("conferences").update({cert_sessions: ids, ...(thenOpen ? {cert_form_open: true} : {})}).eq("id", c.conf.id); if (error) throw error;
        toast(`${ids.length} session${ids.length === 1 ? "" : "s"} on the form${thenOpen ? ", form open" : ""}`); await ctx.reload(); }});
    $$("[data-pick]", dl).forEach(b => b.onclick = () => $$("input[name=cs]", dl).forEach(x => x.checked = b.dataset.pick === "all" || (b.dataset.pick === "ws" && x.dataset.kind === "workshop")));
  }
}
// A4 sign for the tables, English and Arabic.
function printSign(c){
  const style = document.getElementById("pageStyle") || document.head.appendChild(Object.assign(document.createElement("style"), {id: "pageStyle"}));
  style.textContent = "@page{size:210mm 297mm;margin:0}";
  $("#printArea").innerHTML = `<div class="print-page" style="width:210mm;height:297mm;display:grid;justify-items:center;align-content:center;gap:8mm;text-align:center;font-family:'Bricolage Grotesque','Cairo',sans-serif;color:#002a3d;padding:20mm">
    <img src="assets/jv-mark.svg" style="height:15mm" alt=""><div style="font-size:14pt;color:#587080;max-width:160mm">${esc(c.conf.name)}</div>
    <div style="font-size:38pt;font-weight:700;line-height:1.05">Get your<br>workshop certificate</div><div dir="rtl" style="font-family:Cairo,sans-serif;font-size:24pt;font-weight:700">احصل على شهادة ورشة العمل</div>
    <div style="width:100mm;height:100mm;padding:6mm;border:1.2mm solid #00bdeb;border-radius:8mm">${qrSvg(formUrl(c.conf.id))}</div>
    <div style="font-size:13pt;color:#587080;max-width:160mm">Scan with your phone camera, type your name and email, and tick your workshops. Your certificate arrives by email once approved.</div></div>`;
  setTimeout(() => print(), 150);
}
