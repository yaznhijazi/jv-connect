// Certificates: visitors request one from a QR on the table, you check it against real attendance and approve,
// the certificate (your designer layout, one page per workshop) is emailed through the conference Gmail.
// You can also email everyone who attended a session in one go.
import {SB, $, $$, esc, t5, hm, dayShort, dateRange, store, toast, armed, dialog, qrSvg, icon, initials, fetchAll, tagsOf} from "./core.js";
import {certPdf, certShowsSession, workshopsOf, layoutFor, printFonts, certKind} from "./print.js";

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

/* ---------- workshop certificates by badge ID: ID, confirm the name, email if missing, then every workshop certificate is emailed at once ---------- */
export const selfUrl = (id, code = "") => `${location.href.split("#")[0]}#/mycert/${id}${code ? "/" + encodeURIComponent(code) : ""}`;
const errText = async error => { try { return (await error.context.json()).error; } catch { return "No connection. Check your internet and try again."; } };
export async function renderSelf(app, confId, startCode = ""){
  app.innerHTML = publicBar + `<main><div class="wrap"><div class="scan-wrap" id="pg"><div class="empty">Loading…</div></div></div></main>`;
  const { data: f, error } = await SB.rpc("c_cert_self_info", {p_conf: confId});
  if (error) throw error;
  const pg = $("#pg"), L = (en, ar) => `${en} <span dir="rtl" class="ms-ar">${ar}</span>`;
  const head = f ? `<div class="panel ms-head"><h1>${esc(f.name)}</h1><p class="note">${esc(dateRange(f.start_date, f.end_date))}${f.venue ? ", " + esc(f.venue) : ""}</p></div>` : "";
  if (!f || !f.open || !f.workshops.length) { pg.innerHTML = head + `<div class="panel empty-state">${icon("clock", "ic lg")}<h2>Certificates aren't available yet</h2><p>Please ask at the registration desk. <span dir="rtl">يرجى السؤال في مكتب التسجيل.</span></p></div>`; return; }
  const c = {conf: f, layouts: f.layout ? [{kind: "workshop", layout: f.layout}] : []};
  const askId = (code = "", msg = "") => {
    pg.innerHTML = head + `<form class="panel form" id="msId" novalidate><div><h2>${L("Get your workshop certificate", "احصل على شهادة الورشة")}</h2>
        <p class="note" style="margin:4px 0 0">Type the ID printed on your badge, under the QR code. <span dir="rtl" style="display:block">اكتب الرقم المطبوع على بطاقتك تحت رمز QR.</span></p></div>
      <label>${L("Badge ID", "رقم البطاقة")}<input name="code" required maxlength="32" inputmode="numeric" autocomplete="off" class="ms-code" value="${esc(code)}" placeholder="0001"></label>
      <button type="submit" class="big-btn">Continue <span dir="rtl">متابعة</span></button><p class="note ms-err" role="status">${esc(msg)}</p></form>`;
    const form = $("#msId"); form.code.focus();
    form.onsubmit = async e => { e.preventDefault(); const v = clean(form.code.value); if (!v) return $(".ms-err", form).textContent = "Type your badge ID.";
      const btn = $("button", form); btn.disabled = true;
      const { data: p, error } = await SB.rpc("c_cert_self_lookup", {p_conf: confId, p_code: v}); btn.disabled = false;
      if (error) return $(".ms-err", form).textContent = "No connection. Check your internet and try again.";
      if (p.closed) return renderSelf(app, confId);
      if (!p.found) return $(".ms-err", form).textContent = "No attendee has that badge ID. Check the number on your badge.";
      if (!p.items.length) return $(".ms-err", form).textContent = "Your badge isn't registered for a workshop. Please ask at the registration desk.";
      confirm(p); };
    if (code && !msg) form.requestSubmit();
  };

  // Step 2: name (unless locked) and email (only if we have none).
  const confirm = (p, msg = "", draft = {}) => {
    p = {...p, locked: false}; const todo = p.items; // sending again is allowed, and the name can always be corrected
    pg.innerHTML = head + `<form class="panel form" id="msOk" novalidate><div class="ms-who"><span class="pill acc">${esc(p.code)}</span><span class="note">${esc(p.category || "")}</span>
        <button type="button" class="linkish" id="msBack">Not you?</button></div>
      ${p.locked ? `<div class="ms-locked"><span class="note">${L("Name on the certificate", "الاسم على الشهادة")}</span><b dir="auto">${esc(p.name)}</b><input type="hidden" name="name" value="${esc(p.name)}"></div>
          <p class="note" style="margin:-6px 0 0">This name was used on a certificate already sent, so it can't be changed here. Ask the registration desk if it's wrong.</p>`
        : `<label>${L("Name on the certificate", "الاسم على الشهادة")}<input name="name" required maxlength="120" value="${esc(draft.name ?? p.name)}" dir="auto" class="ms-name"></label>
          <p class="note" style="margin:-6px 0 0">Edit it if anything is wrong: it prints exactly like this. <span dir="rtl" style="display:block">عدّل الاسم إذا كان فيه خطأ، سيُطبع كما هو.</span></p>`}
      ${p.has_email ? `<div class="ms-mail">${icon("mail")}<span>Goes to your email on file, <b>${esc(p.email_hint)}</b></span></div>`
        : `<label>${L("Your email", "بريدك الإلكتروني")}<input name="email" type="email" required maxlength="200" autocomplete="email" inputmode="email" value="${esc(draft.email || "")}" placeholder="name@example.com"></label>
           <p class="note" style="margin:-6px 0 0">We don't have an email for you yet. Add one so we can send the certificates.</p>`}
      <div class="ms-ws"><span class="ms-legend">${L("Your workshop certificates", "شهادات ورش العمل")}</span>${p.items.map(w => `<div class="ms-item ${w.sent_at ? "done" : ""}">${icon(w.sent_at ? "check" : "award")}
          <span>${esc(w.title)}${w.day ? ` <span class="note">${esc(dayShort(w.day))}</span>` : ""}</span>${w.sent_at ? `<span class="pill ok">Sent ${esc(dayShort(w.sent_at.slice(0, 10)))}</span>` : ""}</div>`).join("")}</div>
      ${todo.length ? `<button type="submit" class="big-btn">Continue <span dir="rtl">متابعة</span></button>`
        : `<p class="note" style="margin:0">Your workshop certificates were already sent. Check your inbox and spam folder, or ask the registration desk.</p>`}
      <p class="note ms-err" role="status">${esc(msg)}</p></form>`;
    const form = $("#msOk"); $("#msBack").onclick = () => askId();
    form.onsubmit = e => { e.preventDefault(); const err = $(".ms-err", form);
      const name = clean(form.name.value).replace(/\s+/g, " "), email = form.email ? clean(form.email.value).toLowerCase() : "";
      if (name.length < 2) return err.textContent = "Type your full name.";
      if (form.email && !EMAIL.test(email)) return err.textContent = "That email doesn't look right. Check it and try again.";
      check(p, todo, name, email); };
  };

  // Step 3: one clear look at the name before anything is sent.
  const check = (p, todo, name, email) => {
    pg.innerHTML = head + `<div class="panel form ms-check"><h2>${L("Is your name right?", "هل اسمك صحيح؟")}</h2>
      <p class="note" style="margin:0">Your certificate${todo.length > 1 ? "s" : ""} will show:</p>
      <div class="ms-big" dir="auto">${esc(name)}</div>
      <p class="note" style="margin:0">They go to <b>${esc(email || p.email_hint)}</b>:</p>
      <ul class="ms-list">${todo.map(w => `<li>${esc(w.title)}</li>`).join("")}</ul>
      <button type="button" class="big-btn" id="msSend">Yes, email my certificate${todo.length > 1 ? "s" : ""} <span dir="rtl">نعم، أرسل</span></button>
      ${p.locked ? "" : `<button type="button" class="ghost" id="msEdit">Edit the name <span dir="rtl">تعديل الاسم</span></button>`}
      <p class="note ms-err" role="status"></p></div>`;
    $("#msEdit") && ($("#msEdit").onclick = () => confirm(p, "", {name, email}));
    $("#msSend").onclick = async () => {
      const err = $(".ms-err"), btns = $$(".ms-check button"); btns.forEach(b => b.disabled = true); err.style.color = "";
      // One email: one PDF with a page per workshop.
      err.textContent = `Making your certificate${todo.length > 1 ? "s" : ""}…`;
      const pdf = await b64(await certPdf(c, todo.map(w => ({code: p.code, category: p.category, full_name: name, cert_name: name, session_title: w.title, session_day: w.day})), {kind: "workshop"}));
      err.textContent = "Sending…";
      const { data, error } = await SB.functions.invoke("cert-self", {body: {conf: confId, code: p.code, workshops: todo.map(w => w.id), name, email, pdf}});
      if (error || !data?.ok) { const m = error ? await errText(error) : "Not sent.";
        const { data: q } = await SB.rpc("c_cert_self_lookup", {p_conf: confId, p_code: p.code});
        return confirm(q?.found ? q : p, m, {name, email}); }
      const sent = todo.map(w => w.title), hint = data.email_hint;
      pg.innerHTML = head + `<div class="panel reg-done"><span class="pill ok">Sent</span><h2 dir="auto">${esc(name)}</h2>
        <p style="margin:0">Your certificate${sent.length > 1 ? "s are" : " is"} on the way to <b>${esc(hint)}</b>:</p><ul class="ms-list">${sent.map(t => `<li>${esc(t)}</li>`).join("")}</ul>
        <p class="note" dir="rtl" style="margin:0">تم إرسال الشهادات إلى بريدك الإلكتروني.</p><p class="note" style="margin:0">Not in your inbox in a few minutes? Check the spam or junk folder.</p>
        <button type="button" class="ghost" id="msAgain">Get certificates for someone else</button></div>`;
      $("#msAgain").onclick = () => askId();
    };
  };
  askId(startCode);
}

/* ---------- fix my details by badge ID: certificate name or email, sent to the desk for approval ---------- */
export const editUrl = (id, code = "") => `${location.href.split("#")[0]}#/edit/${id}${code ? "/" + encodeURIComponent(code) : ""}`;
export async function renderEdit(app, confId, startCode = ""){
  app.innerHTML = publicBar + `<main><div class="wrap"><div class="scan-wrap" id="pg"><div class="empty">Loading…</div></div></div></main>`;
  const { data: f } = await SB.rpc("c_reg_info", {p_conf: confId});
  const pg = $("#pg"), L = (en, ar) => `${en} <span dir="rtl" class="ms-ar">${ar}</span>`;
  const head = f ? `<div class="panel ms-head"><h1>${esc(f.name)}</h1><p class="note">${esc(dateRange(f.start_date, f.end_date))}${f.venue ? ", " + esc(f.venue) : ""}</p></div>` : "";
  const closed = () => { pg.innerHTML = head + `<div class="panel empty-state">${icon("clock", "ic lg")}<h2>Changes aren't open right now</h2><p>Please ask at the registration desk. <span dir="rtl">يرجى السؤال في مكتب التسجيل.</span></p></div>`; };
  const askId = (code = "", msg = "") => {
    pg.innerHTML = head + `<form class="panel form" id="edId" novalidate><div><h2>${L("Fix your name or email", "تعديل الاسم أو البريد")}</h2>
        <p class="note" style="margin:4px 0 0">Type the ID printed on your badge. <span dir="rtl" style="display:block">اكتب الرقم المطبوع على بطاقتك.</span></p></div>
      <label>${L("Badge ID", "رقم البطاقة")}<input name="code" required maxlength="32" inputmode="numeric" autocomplete="off" class="ms-code" value="${esc(code)}" placeholder="0001"></label>
      <button type="submit" class="big-btn">Continue <span dir="rtl">متابعة</span></button><p class="note ms-err" role="status">${esc(msg)}</p></form>`;
    const form = $("#edId"); form.code.focus();
    form.onsubmit = async e => { e.preventDefault(); const v = clean(form.code.value); if (!v) return $(".ms-err", form).textContent = "Type your badge ID.";
      const btn = $("button", form); btn.disabled = true;
      const { data: p, error } = await SB.rpc("c_edit_lookup", {p_conf: confId, p_code: v}); btn.disabled = false;
      if (error) return $(".ms-err", form).textContent = "No connection. Check your internet and try again.";
      if (p.closed) return closed();
      if (!p.found) return $(".ms-err", form).textContent = "No attendee has that badge ID. Check the number on your badge.";
      details(p); };
    if (code && !msg) form.requestSubmit();
  };
  const details = (p, msg = "", draft = {}) => {
    pg.innerHTML = head + `<form class="panel form" id="edForm" novalidate><div class="ms-who"><span class="pill acc">${esc(p.code)}</span><b dir="auto">${esc(p.name)}</b>
        <button type="button" class="linkish" id="edBack">Not you?</button></div>
      ${p.pending ? `<p class="note" style="margin:0">You already sent a change that's waiting for the desk. Sending again replaces it.</p>` : ""}
      <label>${L("Name on the certificate", "الاسم على الشهادة")}<input name="name" maxlength="120" dir="auto" class="ms-name" value="${esc(draft.name ?? p.cert_name)}"></label>
      <p class="note" style="margin:-6px 0 0">It prints exactly like this. <span dir="rtl" style="display:block">سيُطبع الاسم كما هو.</span></p>
      <label>${L("Email", "البريد الإلكتروني")}<input name="email" type="email" maxlength="200" autocomplete="email" inputmode="email" value="${esc(draft.email || "")}" placeholder="${p.email_hint ? `Now ${esc(p.email_hint)}. Leave empty to keep it` : "name@example.com"}"></label>
      <button type="submit" class="big-btn">Send to the desk <span dir="rtl">إرسال</span></button><p class="note ms-err" role="status">${esc(msg)}</p></form>`;
    const form = $("#edForm"); $("#edBack").onclick = () => askId();
    form.onsubmit = async e => { e.preventDefault(); const err = $(".ms-err", form);
      const name = clean(form.name.value).replace(/\s+/g, " "), email = clean(form.email.value).toLowerCase();
      if (name && name.length < 2) return err.textContent = "Type your full name.";
      if (email && !EMAIL.test(email)) return err.textContent = "That email doesn't look right. Check it and try again.";
      const btn = $("button[type=submit]", form); btn.disabled = true; err.textContent = "Sending…";
      const { data, error } = await SB.rpc("c_edit_request", {p_conf: confId, p_code: p.code, p_cert_name: name, p_email: email}); btn.disabled = false;
      const s = error ? "net" : data?.status;
      if (s === "ok") { pg.innerHTML = head + `<div class="panel reg-done"><span class="pill ok">Sent</span><h2 dir="auto">${esc(p.name)}</h2>
          <p style="margin:0">The desk will check your change. Nothing else to do.</p><p class="note" dir="rtl" style="margin:0">تم الإرسال، سيراجعه فريق التسجيل.</p>
          <button type="button" class="ghost" id="edAgain">Fix someone else's details</button></div>`; return $("#edAgain").onclick = () => askId(); }
      if (s === "closed") return closed();
      err.textContent = {same: "Nothing changed. Edit the name or type a new email.", email: "That email doesn't look right.", name: "Type your full name.",
        code: "That badge ID wasn't found.", busy: "Too many changes waiting. Please ask at the desk.", net: "No connection. Check your internet and try again."}[s] || "Not sent. Try again.";
    };
  };
  if (!f) return closed();
  askId(startCode);
}

/* ---------- admin ---------- */
const ui = {tab: "pending", q: "", bulk: ""};
let reqs = [], timer = null;
addEventListener("hashchange", () => clearTimeout(timer));
const sessionsOf = (c, ids) => ids.map(id => c.sessionById.get(id)).filter(Boolean);
// Requests from the badge-ID page name workshops (Certificate by badge ID), not program sessions, and use the workshop design.
const isWs = r => (r.workshop_ids || []).length > 0;
const idsOf = r => isWs(r) ? r.workshop_ids : r.session_ids;
const itemsOf = (c, r, ids) => isWs(r) ? ids.map(id => workshopsOf(c).find(w => w.id === id)).filter(Boolean) : sessionsOf(c, ids);
const kindOf = r => isWs(r) ? "workshop" : "certificate";
// Who is this request? Badge ID first, then email, then the exact name.
const match = (c, r) => c.byCode.get(r.code) || c.attendees.find(a => a.email && a.email.toLowerCase() === r.email) || c.attendees.find(a => a.full_name.trim().toLowerCase() === r.full_name.trim().toLowerCase());
const attended = (c, a, sid) => !!a && (c.checkinsBySession.get(sid) || []).some(k => k.code === a.code);
const mailText = () => ({subject: store.get("certSubject") || "Your workshop certificate", body: store.get("certBody") ||
  "Dear {name},\n\nThank you for attending. Your certificate is attached as a PDF.\n\nBest regards,\nThe organising committee"});

async function send(c, person, sessions, kind = "certificate"){
  const t = mailText(), fill = s => s.split("{name}").join(person.cert_name);
  const pages = sessions.map(s => ({...person, session_title: s.title, session_day: s.day}));
  const { data, error } = await SB.functions.invoke("send-certificate", {body: {to: person.email, name: person.cert_name, event: c.conf.name, subject: fill(t.subject), text: fill(t.body),
    workshops: sessions.map(s => s.day ? `${s.title}, ${dayShort(s.day)}` : s.title), filename: fileName(person.cert_name), pdf: await b64(await certPdf(c, pages, {kind}))}});
  if (!error && data?.ok) return "";
  try { return (await error.context.json()).error; } catch { return error?.message || "Not sent."; }
}

/* ---------- the main certificate (attendance, or appreciation for their categories) by email ----------
   Uses the certificate layout and the conference Gmail. Each send is remembered on the person (cert_sent.main), so a list
   send skips whoever already has theirs. */
const MAIN = "main";
export const mainSent = a => (a?.cert_sent || {})[MAIN];
export const hasMail = a => EMAIL.test(clean(a?.email));
export async function emailMain(c, a){
  const name = a.cert_name || a.full_name, to = clean(a.email).toLowerCase();
  const what = certKind(c, a) === "appreciation" ? "certificate of appreciation" : "certificate of attendance";
  const { data, error } = await SB.functions.invoke("send-certificate", {body: {to, name, subject: `Your ${what}`,
    text: `Dear ${name},\n\nThank you for taking part in ${c.conf.name}. Your ${what} is attached as a PDF.\n\nBest regards,\nThe organising committee`,
    workshops: [], event: c.conf.name, filename: fileName(name), pdf: await b64(await certPdf(c, [{...a, cert_name: name}]))}});
  if (error || !data?.ok) { let msg = error?.message || "Not sent.", limit = false;
    try { const j = await error.context.json(); msg = j.error || msg; limit = !!j.limit; } catch {} return {error: msg, limit}; }
  const sent = {...(a.cert_sent || {}), [MAIN]: {at: new Date().toISOString(), email: to, name}};
  await SB.from("attendees").update({cert_sent: sent}).eq("id", a.id); a.cert_sent = sent;
  return {};
}
// One at a time, so a long list never trips Gmail; stops at Gmail's daily limit or when stop() says so.
export async function emailMany(c, people, {onStep, stop} = {}){
  let ok = 0; const bad = [];
  for (const [i, a] of people.entries()) {
    if (stop?.()) break;
    onStep?.(i, people.length, a);
    const r = await emailMain(c, a);
    if (r.error) { bad.push(`${a.code} ${a.full_name}: ${r.error}`); if (r.limit) break; } else ok++;
  }
  return {ok, bad};
}
let mailing = null; // {stop}
const cm = {who: ""};

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
    ${mainPanel(c)}
    <div class="ov-grid">
      <section class="panel" style="display:grid;gap:12px">
        <div class="toolbar"><div class="seg" role="group" aria-label="Show">${[["pending", "Waiting"], ["sent", "Sent"], ["rejected", "Rejected"]].map(([k, l]) =>
          `<button type="button" data-tab="${k}" aria-pressed="${ui.tab === k}">${l} <span class="count">${by(k).length}</span></button>`).join("")}</div>
          <label class="search-field">${icon("search")}<input type="search" id="cQ" placeholder="Search name, email or badge" value="${esc(ui.q)}" aria-label="Search requests"></label>
          ${ui.tab === "pending" && list.length > 1 ? `<button type="button" class="small" id="cAll">${icon("check")}Approve all ${list.length}</button>` : ""}</div>
        <div class="tips" id="cList">${list.map(r => card(c, r)).join("") || `<div class="empty-state" style="padding:28px">${icon(ui.tab === "pending" ? "check" : "search", "ic lg")}<p style="margin:0">${q ? "Nobody matches." : ui.tab === "pending" ? (conf.cert_form_open ? "Nobody is waiting. New requests appear here by themselves." : "Nobody is waiting. Open the request form on the right so people can ask.") : "Nothing here yet."}</p></div>`}</div>
      </section>
      <div style="display:grid;gap:20px;align-content:start">
        ${selfPanel(c)}
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
  wire(el, c, ctx, list); wireSelf(el, c, ctx); wireMain(el, c, ctx);
}
const attendedAny = c => c.attendees.filter(a => c.checkinsByCode.has(a.code));
function mainPool(c){
  const who = cm.who || (attendedAny(c).length ? "attended" : "all");
  const pool = who === "attended" ? attendedAny(c) : c.attendees;
  return {who, pool, withMail: pool.filter(hasMail), sent: pool.filter(mainSent), left: pool.filter(a => hasMail(a) && !mainSent(a))};
}
function mainPanel(c){
  const {who, pool, withMail, sent, left} = mainPool(c), pct = withMail.length ? Math.round(sent.filter(hasMail).length / withMail.length * 100) : 0;
  return `<section class="panel cm-panel" id="cmPanel"><div class="cm-head"><div><h2>Certificates by email</h2>
      <p class="note" style="margin:2px 0 0">Everyone gets their certificate of attendance (appreciation for the categories you chose) as a PDF, from the conference Gmail.</p></div>
      <label class="cm-who">Send to<select id="cmWho"><option value="attended" ${who === "attended" ? "selected" : ""}>People who attended a session (${attendedAny(c).length})</option>
        <option value="all" ${who === "all" ? "selected" : ""}>Everyone registered (${c.attendees.length})</option></select></label></div>
    <div class="cm-stats"><div><b class="num">${pool.length}</b><span>in the list</span></div><div><b class="num">${withMail.length}</b><span>have an email</span></div>
      <div class="ok"><b class="num">${sent.length}</b><span>sent</span></div><div class="go"><b class="num">${left.length}</b><span>left to send</span></div></div>
    <div class="cm-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Sent so far"><i style="width:${pct}%"></i></div>
    <div class="cm-acts"><button type="button" id="cmGo" ${left.length ? "" : "disabled"}>${icon("mail")}${left.length ? `Email ${left.length} certificate${left.length === 1 ? "" : "s"}` : "Everyone with an email has theirs"}</button>
      <button type="button" class="ghost" id="cmStop" hidden>Stop</button>
      <span class="note" id="cmNote">${pool.length - withMail.length ? `${pool.length - withMail.length} have no email: add one in Attendees, or they can use the "fix my details" QR.` : ""} Gmail sends about 500 a day.</span></div></section>`;
}
function wireMain(el, c, ctx){
  const go = $("#cmGo", el), stop = $("#cmStop", el), note = $("#cmNote", el), bar = $(".cm-bar i", el);
  $("#cmWho", el).onchange = e => { cm.who = e.target.value; draw(el, c, ctx); };
  stop.onclick = () => { if (mailing) mailing.stopped = true; stop.disabled = true; stop.textContent = "Stopping…"; };
  go.onclick = () => armed(go, async () => {
    const {left, withMail, sent} = mainPool(c); if (!left.length) return;
    mailing = {stopped: false}; go.disabled = true; stop.hidden = false; $("#cmWho", el).disabled = true;
    const base = sent.filter(hasMail).length;
    const r = await emailMany(c, left, {stop: () => mailing.stopped, onStep: (i, n, a) => {
      note.textContent = `Sending ${i + 1} of ${n}: ${a.cert_name || a.full_name}…`; bar.style.width = Math.round((base + i) / withMail.length * 100) + "%"; }});
    mailing = null;
    toast(`${r.ok} certificate${r.ok === 1 ? "" : "s"} emailed${r.bad.length ? `, ${r.bad.length} not sent` : ""}`, r.bad.length ? "bad" : "");
    await ctx.reload();
    if (r.bad.length) setTimeout(() => { const n = $("#cmNote"); if (n) n.textContent = "Not sent: " + r.bad.slice(0, 5).join("; ") + (r.bad.length > 5 ? ` and ${r.bad.length - 5} more` : ""); }, 50);
  });
}
/* ---------- self-service setup (team) ---------- */
const selfOf = c => ({open: false, workshops: [], ...(c.conf.cert_self || {})});
// Who still needs workshop certificates: tagged for a workshop that wasn't sent to them yet.
const toSend = c => { const ws = selfOf(c).workshops;
  return c.attendees.map(a => ({a, todo: ws.filter(w => (a.tags || []).includes(w.tag) && !(a.cert_sent || {})[w.id])})).filter(x => x.todo.length); };
const sentList = c => c.attendees.flatMap(a => Object.entries(a.cert_sent || {}).map(([wid, v]) => ({a, wid, ...v}))).sort((x, y) => String(y.at).localeCompare(String(x.at)));
function selfPanel(c){
  const cs = selfOf(c), sent = sentList(c), title = id => id === MAIN ? "Certificate of attendance" : cs.workshops.find(w => w.id === id)?.title || "Removed workshop";
  const count = w => c.attendees.filter(a => (a.tags || []).includes(w.tag)).length;
  return `<section class="panel form" id="msPanel"><div class="panel-head" style="margin:0"><h2>Certificate by badge ID</h2><span class="pill ${cs.open ? "ok live" : ""}">${cs.open ? "Open" : "Closed"}</span></div>
    <p class="note" style="margin:0">People scan the QR, type their badge ID, confirm their name, add an email if we don't have one, and get all their workshop certificates by email. They can send them again at any time.</p>
    <div class="ms-wlist">${cs.workshops.map(w => `<div class="ms-wrow"><b>${esc(w.title)}</b><span class="note">${w.day ? esc(dayShort(w.day)) + ", " : ""}${count(w)} tagged ${esc(w.tag)}</span></div>`).join("")
      || `<p class="note" style="margin:0">No workshops yet. Add one and pick the tag of the people who attended it.</p>`}</div>
    ${cs.workshops.length ? `<div class="codes" style="justify-content:center"><div style="width:150px;height:150px">${qrSvg(selfUrl(c.conf.id))}</div></div>
      <div class="linkbox"><input readonly value="${esc(selfUrl(c.conf.id))}" onfocus="this.select()" aria-label="Certificate by badge ID link"><button type="button" class="ghost small" id="msCopy">Copy</button></div>` : ""}
    ${cs.workshops.length ? (() => { const left = toSend(c), withMail = left.filter(x => EMAIL.test(clean(x.a.email)));
      return `<div class="ms-bulk"><button type="button" id="msSendAll" ${withMail.length ? "" : "disabled"}>${icon("mail")}Send workshop certificates (${withMail.length})</button>
        <span class="note" id="msBulkNote">${left.length ? !withMail.length ? `Everyone with an email has theirs; ${left.length} without an email can use the QR.` : `${withMail.length} people still need theirs${left.length - withMail.length ? `; ${left.length - withMail.length} have no email and can use the QR` : ""}.` : "Everyone tagged has their certificates."}</span></div>`; })() : ""}
    <div class="row"><button type="button" id="msWs" class="${cs.workshops.length ? "ghost" : ""}">${cs.workshops.length ? "Edit workshops" : "Add workshops"}</button>
      ${cs.workshops.length ? `<button type="button" id="msToggle" class="${cs.open ? "ghost" : ""}">${cs.open ? "Close" : "Open it"}</button><button type="button" class="ghost" id="msSign">${icon("print")}Table sign</button>` : ""}</div>
    ${sent.length ? `<details class="ms-sent"><summary>${sent.length} sent by badge ID</summary><div class="ms-slist">${sent.map(x => `<div class="ms-srow"><span><b>${esc(x.a.code)} ${esc(x.name || x.a.full_name)}</b>
        <small>${esc(title(x.wid))}, ${esc(x.email || "")}${x.at ? `, ${dayShort(x.at.slice(0, 10))} ${hm(x.at)}` : ""}</small></span>
        <button type="button" class="ghost small ms-allow" data-allow="${x.a.id}" data-w="${esc(x.wid)}">Allow again</button></div>`).join("")}</div>
      <p class="note" style="margin:6px 0 0">Allow again lets that person request this certificate once more. If it was their only one, they can also correct the name.</p></details>` : ""}</section>`;
}
function wireSelf(el, c, ctx){
  const cs = selfOf(c), save = async patch => { const { error } = await SB.from("conferences").update({cert_self: {...cs, ...patch}}).eq("id", c.conf.id); if (error) throw error; };
  $("#msWs").onclick = () => selfDialog(c, ctx, cs, save);
  $("#msCopy") && ($("#msCopy").onclick = () => navigator.clipboard.writeText(selfUrl(c.conf.id)).then(() => toast("Link copied")));
  $("#msSign") && ($("#msSign").onclick = () => printSign(c, selfUrl(c.conf.id), true));
  $("#msToggle") && ($("#msToggle").onclick = async () => {
    try { await save({open: !cs.open}); } catch (e) { return toast(e.message, "bad"); }
    toast(cs.open ? "Closed" : "Open: people can get certificates by badge ID"); ctx.reload(); });
  $("#msSendAll") && ($("#msSendAll").onclick = e => armed(e.currentTarget, async () => {
    const list = toSend(c).filter(x => EMAIL.test(clean(x.a.email))), btn = $("#msSendAll"), note = $("#msBulkNote"); btn.disabled = true; let ok = 0, fail = 0;
    for (const [i, {a, todo}] of list.entries()) {
      btn.textContent = `Sending ${i + 1} of ${list.length}…`;
      const person = {...a, cert_name: a.cert_name || a.full_name, email: clean(a.email).toLowerCase()};
      const err = await send(c, person, todo, "workshop");
      if (err) { fail++; note.textContent = `${a.code} ${a.full_name}: ${err}`; if (/set up|refused the login|limit|admin/i.test(err)) { toast(err, "bad"); break; } }
      else { ok++; const at = new Date().toISOString(), sent = {...(a.cert_sent || {})}; todo.forEach(w => { sent[w.id] = {at, email: person.email, name: person.cert_name}; });
        const row = {cert_sent: sent, cert_name: person.cert_name}; const { error } = await SB.from("attendees").update(row).eq("id", a.id); if (!error) Object.assign(a, row); }
      await new Promise(x => setTimeout(x, 700));
    }
    toast(`Sent to ${ok} ${ok === 1 ? "person" : "people"}${fail ? `, ${fail} not sent` : ""}`, fail ? "bad" : ""); draw(el, c, ctx); }));
  $$("[data-allow]", el).forEach(b => b.onclick = () => armed(b, async () => {
    const a = c.attendees.find(x => x.id === b.dataset.allow), next = {...(a.cert_sent || {})}; delete next[b.dataset.w];
    const { error } = await SB.from("attendees").update({cert_sent: next}).eq("id", a.id); if (error) return toast(error.message, "bad");
    a.cert_sent = next; toast(`${a.full_name} can request it again`); draw(el, c, ctx); }));
}
function selfDialog(c, ctx, cs, save){
  const tags = tagsOf(c), row = (w = {}) => `<div class="ms-drow" data-id="${esc(w.id || "")}">
      <label>Title on the certificate<input name="title" maxlength="120" value="${esc(w.title || "")}" placeholder="Insulin pump workshop"></label>
      <label>People tagged<select name="tag">${tags.map(t => `<option ${t === (w.tag || "Workshop") ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
      <label>Date<input name="day" type="date" value="${esc(w.day || "")}"></label>
      <button type="button" class="ghost small" data-rm aria-label="Remove workshop">${icon("x")}</button></div>`;
  const dl = dialog({need: "manage", title: "Workshops for certificates by badge ID", submit: "Save", wide: true,
    body: `<p class="note" style="margin:0">One certificate per workshop, all with the same design; only the title changes. Only people with the tag can ask for it. The design is the Workshop certificate in Badges &amp; certificates.</p>
      <div id="msRows" style="display:grid;gap:10px">${(cs.workshops.length ? cs.workshops : [{}]).map(row).join("")}</div>
      <button type="button" class="ghost small" id="msAdd" style="justify-self:start">${icon("plus")}Add workshop</button>`,
    onSubmit: async form => {
      const ws = $$(".ms-drow", form).map(r => ({id: r.dataset.id || "w" + Math.random().toString(36).slice(2, 8), title: $("[name=title]", r).value.trim().replace(/\s+/g, " "), tag: $("[name=tag]", r).value, day: $("[name=day]", r).value})).filter(w => w.title);
      await save({workshops: ws, ...(ws.length ? {} : {open: false})}); toast(`${ws.length} workshop${ws.length === 1 ? "" : "s"} saved`); await ctx.reload(); }});
  $("#msAdd", dl).onclick = () => $("#msRows", dl).insertAdjacentHTML("beforeend", row());
  $("#msRows", dl).addEventListener("click", e => { const b = e.target.closest("[data-rm]"); if (b) b.closest(".ms-drow").remove(); });
}
function card(c, r){
  const a = match(c, r), ss = itemsOf(c, r, idsOf(r)), pending = r.status === "pending", ws = isWs(r);
  return `<article class="req-card${r.error ? " flag" : ""}" data-id="${r.id}">
    <div class="rc-top"><span class="av">${esc(initials(r.full_name))}</span>
      <div class="rc-who"><input data-name value="${esc(r.full_name)}" ${pending ? "" : "readonly"} aria-label="Name on the certificate"><input data-email type="email" value="${esc(r.email)}" ${pending ? "" : "readonly"} aria-label="Email"></div></div>
    <div class="rc-meta">${ws ? `<span class="pill">Workshop certificate</span>` : ""}${a ? `<span class="pill acc">${ws ? "Badge" : "Matched"}: ${esc(a.code)} ${esc(a.full_name)}</span>` : `<span class="pill warn">Not on the attendee list${r.code ? ` (badge ${esc(r.code)} not found)` : ""}</span>`}
      <span>Asked ${dayShort(r.created_at.slice(0, 10))} ${hm(r.created_at)}</span>${r.decided_at ? `<span>${r.status === "sent" ? "Sent" : "Decided"} ${dayShort(r.decided_at.slice(0, 10))} ${hm(r.decided_at)}</span>` : ""}
      ${r.error ? `<span class="pill bad">Last try failed: ${esc(r.error)}</span>` : ""}</div>
    <div class="rc-ws">${ws ? ss.map(w => { const done = pending && a?.cert_sent?.[w.id];
      return `<label class="${done ? "no" : ""}"><input type="checkbox" data-s="${esc(w.id)}" ${done ? "" : "checked"} ${pending && !done ? "" : "disabled"}>
        <span>${esc(w.title)}${w.day ? ` <small>${esc(dayShort(w.day))}</small>` : ""}</span>${done ? `<span class="pill warn">Already sent</span>` : ""}</label>`; }).join("")
      : ss.map(s => { const ok = attended(c, a, s.id);
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
  const ids = r.status === "pending" ? $$("[data-s]", box).filter(x => x.checked).map(x => x.dataset.s) : idsOf(r);
  return {person: {...(a || {}), full_name: name, cert_name: name, email}, a, ids, sessions: itemsOf(c, r, ids), kind: kindOf(r)};
}
async function approve(c, r, box){
  const v = readCard(c, r, box), msg = box.querySelector("[data-msg]");
  const bad = v.person.cert_name.length < 2 ? "Type the name for the certificate." : !EMAIL.test(v.person.email) ? "That email doesn't look right." : !v.sessions.length ? "Tick at least one workshop, or press Reject." : "";
  if (bad) { msg.style.color = "var(--bad)"; msg.textContent = bad; return bad; }
  $$("button", box).forEach(b => b.disabled = true); msg.style.color = ""; msg.textContent = "Making the certificate and sending…";
  const err = await send(c, v.person, v.sessions, v.kind), now = new Date().toISOString();
  if (err) { await SB.from("conf_cert_requests").update({error: err}).eq("id", r.id); msg.style.color = "var(--bad)"; msg.textContent = err; $$("button", box).forEach(b => b.disabled = false); return err; }
  const patch = {status: "sent", full_name: v.person.cert_name, email: v.person.email, [isWs(r) ? "workshop_ids" : "session_ids"]: v.ids, error: null, decided_at: now};
  await SB.from("conf_cert_requests").update(patch).eq("id", r.id); Object.assign(r, patch);
  // Workshop certificates: remember what was sent (no second request for it) and lock the name and email used.
  if (isWs(r) && v.a) {
    const sent = {...(v.a.cert_sent || {})}; v.ids.forEach(id => { sent[id] = {at: now, email: v.person.email, name: v.person.cert_name}; });
    const row = {cert_sent: sent, cert_name: v.person.cert_name, ...(v.a.email ? {} : {email: v.person.email})};
    const { error } = await SB.from("attendees").update(row).eq("id", v.a.id); if (!error) Object.assign(v.a, row);
  }
  return "";
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
      const blob = await certPdf(c, v.sessions.map(s => ({...v.person, session_title: s.title, session_day: s.day})), {kind: v.kind}); b.disabled = false;
      if (w) w.location = URL.createObjectURL(blob); else toast("The browser blocked the preview tab.", "bad"); return; }
    if (act === "approve") { const err = await approve(c, r, box); if (!err) { toast(`Sent to ${r.email}`); redraw(); } return; }
    if (act === "reject") return armed(b, async () => { const patch = {status: "rejected", decided_at: new Date().toISOString()};
      await SB.from("conf_cert_requests").update(patch).eq("id", r.id); Object.assign(r, patch); toast("Rejected"); redraw(); });
    if (act === "restore") { const patch = {status: "pending", decided_at: null}; await SB.from("conf_cert_requests").update(patch).eq("id", r.id); Object.assign(r, patch); toast("Moved back to waiting"); return redraw(); }
    if (act === "resend") { b.disabled = true; const v = readCard(c, r, box), err = await send(c, v.person, v.sessions, v.kind); b.disabled = false;
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
async function wsSign(c, url){
  const L = layoutFor(c, "workshop"), navy = "#1d2556", amber = "#b4652a";
  await printFonts();
  const style = document.getElementById("pageStyle") || document.head.appendChild(Object.assign(document.createElement("style"), {id: "pageStyle"}));
  style.textContent = "@page{size:210mm 297mm;margin:0}";
  // The top of the certificate (banner, logos) heads the sign; without a design, a plain band in the same colours.
  const top = L.bg ? `<div style="width:210mm;height:43mm;background:url('${esc(L.bg)}') center top/100% auto no-repeat"></div>`
    : `<div style="width:210mm;height:30mm;background:linear-gradient(90deg,${amber},#7a4a2a)"></div>`;
  $("#printArea").innerHTML = `<div class="print-page" style="width:210mm;height:297mm;display:grid;grid-template-rows:auto 1fr auto;justify-items:center;text-align:center;color:${navy};font-family:'Plus Jakarta Sans','Cairo',sans-serif;overflow:hidden">
    ${top}
    <div style="display:grid;justify-items:center;align-content:center;gap:6mm;padding:4mm 18mm">
      <div style="font-family:'Playfair Display',serif;font-size:36pt;font-weight:700;line-height:1.05">Get your<br>workshop certificates</div>
      <div dir="rtl" style="font-family:Amiri,Cairo,serif;font-size:24pt;font-weight:700">احصل على شهادات ورش العمل</div>
      <div style="width:92mm;height:92mm;padding:5mm;border:1.4mm solid ${navy};border-radius:6mm;box-shadow:0 0 0 1.6mm #fff,0 0 0 2.4mm ${amber}">${qrSvg(url)}</div>
      <div style="font-size:14pt;line-height:1.6;text-align:left"><b>1.</b> Scan with your phone camera<br><b>2.</b> Type the ID printed on your badge<br><b>3.</b> Confirm your name: your certificates arrive by email</div>
      <div dir="rtl" style="font-family:Cairo,sans-serif;font-size:13pt;max-width:165mm">امسح الرمز، اكتب رقم بطاقتك، وأكّد اسمك لتصلك الشهادات على بريدك الإلكتروني.</div></div>
    <div style="width:210mm;padding:5mm 0 7mm;border-top:1.2mm solid ${amber};font-size:10.5pt;color:${navy}">${esc(c.conf.name)}</div></div>`;
  await Promise.all($$("#printArea img").map(i => i.complete ? 0 : new Promise(r => i.onload = i.onerror = r)));
  if (L.bg) await new Promise(r => { const im = new Image(); im.onload = im.onerror = r; im.src = L.bg; });
  setTimeout(() => print(), 150);
}
function printSign(c, url = formUrl(c.conf.id), self = false){
  if (self) return wsSign(c, url);
  const style = document.getElementById("pageStyle") || document.head.appendChild(Object.assign(document.createElement("style"), {id: "pageStyle"}));
  style.textContent = "@page{size:210mm 297mm;margin:0}";
  $("#printArea").innerHTML = `<div class="print-page" style="width:210mm;height:297mm;display:grid;justify-items:center;align-content:center;gap:8mm;text-align:center;font-family:'Bricolage Grotesque','Cairo',sans-serif;color:#002a3d;padding:20mm">
    <img src="assets/jv-mark.svg" style="height:15mm" alt=""><div style="font-size:14pt;color:#587080;max-width:160mm">${esc(c.conf.name)}</div>
    <div style="font-size:38pt;font-weight:700;line-height:1.05">Get your<br>workshop certificate</div><div dir="rtl" style="font-family:Cairo,sans-serif;font-size:24pt;font-weight:700">احصل على شهادة ورشة العمل</div>
    <div style="width:100mm;height:100mm;padding:6mm;border:1.2mm solid #00bdeb;border-radius:8mm">${qrSvg(url)}</div>
    <div style="font-size:13pt;color:#587080;max-width:160mm">${self ? "Scan with your phone camera and type the ID on your badge. Confirm your name and your certificate arrives by email in a minute." : "Scan with your phone camera, type your name and email, and tick your workshops. Your certificate arrives by email once approved."}</div>${self ? `<div dir="rtl" style="font-family:Cairo,sans-serif;font-size:13pt;color:#587080">امسح الرمز واكتب رقم بطاقتك، ثم أكّد اسمك لتصلك الشهادة على بريدك.</div>` : ""}</div>`;
  setTimeout(() => print(), 150);
}
