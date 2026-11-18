// Self-registration: a QR sign on the desk opens a form on the visitor's phone; the request waits until an admin approves it.
// Approving creates the attendee with the next free ID, and the visitor's phone then shows their badge QR.
import {SB, $, $$, esc, hm, dayShort, dateRange, store, toast, formData, qrSvg, barcodeSvg, selectOptions, countriesOf, initials, icon, armed, DEFAULT_COUNTRIES, countryPicker, dialog, categoriesOf, flag} from "./core.js";
import {nextCode} from "./attendees.js";
import {printDocs} from "./print.js";
import {STD, formOf, questionInput, answersFrom, answersList, editForm} from "./regform.js";

const waited = iso => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 6e4));
  return m < 1 ? "Just now" : m < 60 ? `${m} min` : m < 24 * 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${dayShort(iso.slice(0, 10))} ${hm(iso)}`; };
const regUrl = id => `${location.href.split("#")[0]}#/register/${id}`;
const digits = s => String(s || "").replace(/\D/g, "").slice(-8);
const publicBar = `<header class="topbar"><div class="wrap"><span class="brand"><img class="brand-mark" src="assets/jv-mark.svg" alt="" width="14" height="24">JV Connect</span></div></header>`;

/* ---------- public: the form on the visitor's phone ---------- */
let pollT = null;
addEventListener("hashchange", () => clearInterval(pollT));
export async function renderPublic(app, confId){
  app.innerHTML = publicBar + `<main><div class="wrap"><div class="scan-wrap" id="pg"><div class="empty">Loading…</div></div></div></main>`;
  const { data: info, error } = await SB.rpc("c_reg_info", {p_conf: confId});
  if (error) throw error;
  const pg = $("#pg");
  if (!info) { pg.innerHTML = `<div class="panel empty-state">${icon("alert", "ic lg")}<h2>This registration link doesn't work</h2><p>Ask the registration desk for help.</p></div>`; return; }
  const head = `<div class="panel" style="display:grid;gap:4px"><h1 style="font-size:24px">${esc(info.name)}</h1>
    <p class="note" style="margin:0">${esc(dateRange(info.start_date, info.end_date))}${info.venue ? ", " + esc(info.venue) : ""}${info.location_url ? ` <a href="${esc(info.location_url)}" target="_blank" rel="noopener">Map</a>` : ""}</p></div>`;
  const mine = store.get(`reg:${confId}`);
  if (mine) return showStatus(pg, head, confId, mine);
  if (!info.open) { pg.innerHTML = head + `<div class="panel empty-state">${icon("clock", "ic lg")}<h2>Registration isn't open</h2><p>Please go to the registration desk. <span dir="rtl">يرجى التوجه إلى مكتب التسجيل.</span></p></div>`; return; }
  const cats = (info.categories || []).filter(Boolean), countries = info.countries?.length ? info.countries : DEFAULT_COUNTRIES;
  const L = (en, ar) => `${en} <span dir="rtl" style="font-weight:500">${ar}</span>`;
  const form = formOf({reg_form: info.form}), F = form.fields, lab = k => { const [, en, ar] = STD.find(x => x[0] === k); return L(en, ar); };
  const ask = k => F[k] !== "hidden", req = k => F[k] === "required" ? "required" : "";
  pg.innerHTML = head + `<form class="panel form" id="regForm"><div><h2>Register for your badge</h2><p class="note" style="margin:4px 0 0">Fill in your details. The desk approves them and your badge ID appears on this screen.
      <span dir="rtl" style="display:block">املأ بياناتك، وبعد الموافقة يظهر رقم بطاقتك هنا.</span></p></div>
    <label>${L("Full name", "الاسم الكامل")}<input name="full_name" required minlength="2" maxlength="200" autocomplete="name"></label>
    ${ask("cert_name") ? `<label>${lab("cert_name")}<input name="cert_name" maxlength="200" placeholder="e.g. Dr. Lina Haddad" ${req("cert_name")}></label>` : ""}
    ${ask("phone") || ask("email") ? `<div class="form-grid">${ask("phone") ? `<label>${lab("phone")}<input name="phone" type="tel" ${req("phone")} maxlength="40" autocomplete="tel" inputmode="tel"></label>` : ""}
      ${ask("email") ? `<label>${lab("email")}<input name="email" type="email" ${req("email")} maxlength="200" autocomplete="email"></label>` : ""}</div>` : ""}
    ${cats.length && ask("category") ? `<label>${lab("category")}<select name="category" ${req("category")}>${selectOptions(cats, "", "Choose…")}</select></label>` : ""}
    ${ask("entity") ? `<label>${lab("entity")}<input name="entity" maxlength="200" autocomplete="organization" ${req("entity")}></label>` : ""}
    ${ask("country") ? countryPicker("country", "", countries, {label: lab("country"), empty: "Choose…"}) : ""}
    ${form.questions.map(q => questionInput(q, "", {bilingual: true})).join("")}
    <button type="submit" class="big-btn">Send for approval</button><p class="note" id="regMsg" role="status" style="margin:0"></p></form>`;
  $("#regForm").onsubmit = async e => {
    e.preventDefault();
    // The country picker isn't a native field, so check "required" for it here.
    if (F.country === "required" && !e.target.country?.value) { $("#regMsg").textContent = "Choose your country. اختر الدولة."; return; }
    const btn = $("button[type=submit]", e.target); btn.disabled = true; $("#regMsg").textContent = "Sending…";
    const p = Object.fromEntries(Object.entries(formData(e.target)).filter(([k]) => !k.startsWith("ans:")));
    if (form.questions.length) p.answers = answersFrom(form, e.target);
    const { data, error } = await SB.rpc("c_register", {p_conf: confId, p});
    btn.disabled = false;
    if (error || data?.status !== "ok") { $("#regMsg").textContent = data?.status === "closed" ? "Registration just closed. Please go to the desk." : "Not sent. Check your connection and try again."; return; }
    store.set(`reg:${confId}`, data.id); showStatus(pg, head, confId, data.id);
  };
}
/* ---------- public: "My badge" on the attendee's phone ---------- */
// Shows the badge ID as a QR code and barcode so the door scanner can read the phone screen. Remembers the ID on this phone.
export const badgeUrl = (confId, code) => `${location.href.split("#")[0]}#/badge/${confId}${code ? "/" + encodeURIComponent(code) : ""}`;
export async function renderBadge(app, confId, fromLink = ""){
  app.innerHTML = publicBar + `<main><div class="wrap"><div class="scan-wrap" id="pg"><div class="empty">Loading…</div></div></div></main>`;
  const key = `badge:${confId}`, pg = $("#pg"), code = (decodeURIComponent(fromLink) || store.get(key) || "").trim();
  const { data, error } = await SB.rpc("c_badge", {p_conf: confId, p_code: code || "-"});
  if (error) throw error;
  if (!data) { pg.innerHTML = `<div class="panel empty-state">${icon("alert", "ic lg")}<h2>This badge link doesn't work</h2><p>Ask the registration desk for help.</p></div>`; return; }
  const conf = data.conf, b = data.badge;
  const head = `<div class="panel" style="display:grid;gap:4px"><h1 style="font-size:22px">${esc(conf.name)}</h1>
    <p class="note" style="margin:0">${esc(dateRange(conf.start_date, conf.end_date))}${conf.venue ? ", " + esc(conf.venue) : ""}${conf.location_url ? ` <a href="${esc(conf.location_url)}" target="_blank" rel="noopener">Map</a>` : ""}</p></div>`;
  if (b) {
    store.set(key, b.code);
    pg.innerHTML = head + `<div class="panel reg-done my-badge"><h2 style="margin:0">${esc(b.short_name)}</h2>${b.category ? `<span class="pill acc">${esc(b.category)}</span>` : ""}
      <div class="qr">${qrSvg(b.code)}</div><div class="bc">${barcodeSvg(b.code, {height: 70})}</div><div class="code num">${esc(b.code)}</div>
      <p class="note" style="margin:0">Show this screen at the hall door. Turn the brightness up if it doesn't scan.<span dir="rtl" style="display:block">أظهر هذه الشاشة عند باب القاعة. ارفع سطوع الشاشة إذا لم تُقرأ.</span></p>
      <p class="note" style="margin:0">${b.sessions ? `Checked in to ${b.sessions} session${b.sessions === 1 ? "" : "s"} so far.` : "No check-ins yet."}</p>
      <button type="button" class="ghost" id="bOther">Not you? Use another badge ID</button></div>`;
    navigator.wakeLock?.request("screen").catch(() => {});
    $("#bOther").onclick = () => { store.set(key, ""); location.hash = `#/badge/${confId}`; renderBadge(app, confId); };
    return;
  }
  pg.innerHTML = head + `<form class="panel form" id="bForm"><div><h2>My badge <span dir="rtl" style="font-weight:500">بطاقتي</span></h2>
      <p class="note" style="margin:4px 0 0">Type the ID printed on your badge. Your phone then shows it as a code the door scanner can read.<span dir="rtl" style="display:block">اكتب الرقم المطبوع على بطاقتك لتظهر على هاتفك كرمز يُقرأ عند الباب.</span></p></div>
    <label>Badge ID <span dir="rtl" style="font-weight:500">رقم البطاقة</span><input name="code" required maxlength="40" inputmode="numeric" autocomplete="off" value="${esc(code)}" style="font-size:22px;letter-spacing:.08em"></label>
    <button type="submit" class="big-btn">Show my badge</button><p class="note" id="bMsg" role="status" style="margin:0">${code ? `We couldn't find badge ID ${esc(code)}. Check the number on your badge.` : ""}</p></form>`;
  $("#bForm").onsubmit = e => { e.preventDefault(); const v = formData(e.target).code.trim(); store.set(key, ""); location.hash = `#/badge/${confId}/${encodeURIComponent(v)}`; };
}
async function showStatus(pg, head, confId, id){
  const draw = async () => {
    const { data: r } = await SB.rpc("c_reg_status", {p_id: id});
    if (!r) { store.set(`reg:${confId}`, ""); return renderPublic(document.getElementById("app"), confId); }
    const again = `<button type="button" class="ghost" id="regAgain">Register someone else on this phone</button>`;
    pg.innerHTML = head + (r.status === "approved" && r.code ? `<div class="panel reg-done"><span class="pill ok">Approved</span><h2>${esc(r.full_name)}</h2>
        <div class="qr">${qrSvg(r.code)}</div><div class="code num">${esc(r.code)}</div><p class="note" style="margin:0">Your badge ID. Show this screen at the desk to collect your badge.<span dir="rtl" style="display:block">هذا رقم بطاقتك. أظهر هذه الشاشة لاستلامها.</span></p>${again}</div>`
      : r.status === "rejected" ? `<div class="panel reg-done"><span class="pill bad">Not approved</span><h2>${esc(r.full_name)}</h2><p>Please speak to the registration desk.</p>${again}</div>`
      : `<div class="panel reg-done"><span class="pill acc live">Waiting for approval</span><h2>${esc(r.full_name)}</h2><p class="note" style="margin:0">Thanks. The desk will approve your details shortly; keep this page open.<span dir="rtl" style="display:block">شكراً، سيتم اعتماد بياناتك قريباً. أبقِ الصفحة مفتوحة.</span></p>
          <div class="code num" style="font-size:22px;opacity:.7">Ref ${esc(id.slice(0, 6).toUpperCase())}</div>${again}</div>`);
    $("#regAgain").onclick = () => { clearInterval(pollT); store.set(`reg:${confId}`, ""); renderPublic(document.getElementById("app"), confId); };
    if (r.status !== "pending") clearInterval(pollT);
  };
  clearInterval(pollT); await draw(); pollT = setInterval(() => document.visibilityState === "visible" && draw(), 8000);
}

/* ---------- admin: the approval queue ---------- */
const dupOf = (c, r) => c.attendees.find(a => (digits(r.phone).length >= 7 && digits(a.phone) === digits(r.phone)) || (r.email && a.email && a.email.toLowerCase() === r.email.toLowerCase())
  || a.full_name.trim().toLowerCase() === r.full_name.trim().toLowerCase());
const row = (r, code) => ({conference_id: r.conference_id, code, full_name: r.full_name, cert_name: r.cert_name, phone: r.phone, email: r.email,
  category: r.category, entity: r.entity, country: r.country, fee_amount: 0, fee_paid: false, fee_note: "Self-registered", ...(r.answers && Object.keys(r.answers).length ? {answers: r.answers} : {})});
// Yes/no questions can tag the person ("Will you attend the workshop?" Yes → Workshop).
const autoTags = (c, r) => formOf(c.conf).questions.filter(q => q.type === "yesno" && q.tag_on_yes && (r.answers || {})[q.id] === "Yes").map(q => q.tag_on_yes.trim()).filter(Boolean);
async function approve(c, list, ctx, {print = false} = {}){
  let n = Number(nextCode(c));
  const rows = list.map(r => { const x = row(r, r.code || String(n++).padStart(4, "0")), t = autoTags(c, r); if (t.length) x.tags = [...new Set(t)]; return x; });
  const { data: made, error } = await SB.from("attendees").insert(rows).select("*");
  if (error) { toast(error.message, "bad"); return false; }
  const byCode = new Map(made.map(a => [a.code, a])), at = new Date().toISOString();
  await Promise.all(list.map((r, i) => SB.from("registrations").update({status: "approved", attendee_id: byCode.get(rows[i].code)?.id, decided_at: at}).eq("id", r.id)));
  toast(list.length === 1 ? `${list[0].full_name} approved with ID ${rows[0].code}` : `${list.length} approved`);
  if (print) await printDocs(c, "badge", made);
  await ctx.reload();
}
// Check a request before it goes in: every detail can be corrected, then approve (and print) or reject.
function review(c, r, ctx){
  const d = dupOf(c, r), cats = categoriesOf(c), form = formOf(c.conf);
  const dl = dialog({drawer: true, need: "edit", title: "Check and approve", submit: "Approve", danger: "Reject",
    body: `<p class="note" style="margin:0">Sent ${esc(dayShort(r.created_at.slice(0, 10)))} at ${hm(r.created_at)}. Correct anything that's wrong; what you approve is what goes into the system and onto the badge.</p>
      ${d ? `<div class="dup-box">${icon("alert", "ic sm")}<span>Looks like <b>${esc(d.code)} ${esc(d.full_name)}</b>, already registered${d.phone ? `, ${esc(d.phone)}` : ""}.</span>
        <button type="button" class="ghost small" id="rvSame">Same person, use ${esc(d.code)}</button></div>` : ""}
      <fieldset class="fs"><legend>${icon("user")}Person</legend><div class="form-grid">
        <label>Full name<input name="full_name" required maxlength="200" value="${esc(r.full_name)}" autocomplete="off"></label>
        <label>Name on certificate<input name="cert_name" maxlength="200" value="${esc(r.cert_name)}" placeholder="Same as full name if empty" autocomplete="off"></label>
        <label>Badge ID<input name="code" required pattern="[A-Za-z0-9\\-]{1,32}" title="Letters, numbers and dashes only, up to 32" maxlength="32" value="${esc(nextCode(c))}" class="num" autocomplete="off">
          <small class="hint">The next free ID. Change it to use a pre-printed badge.</small></label>
        <label>Category<select name="category">${selectOptions(cats, r.category || "", "No category")}</select></label></div></fieldset>
      <fieldset class="fs"><legend>${icon("link")}Contact</legend><div class="form-grid">
        <label>Phone<input name="phone" type="tel" inputmode="tel" maxlength="40" value="${esc(r.phone)}" autocomplete="off"></label>
        <label>Email<input name="email" type="email" maxlength="200" value="${esc(r.email)}" autocomplete="off"></label>
        <label>Entity<input name="entity" maxlength="200" value="${esc(r.entity)}" placeholder="Hospital, university, company"></label>
        ${countryPicker("country", r.country || "", countriesOf(c.conf))}</div></fieldset>
      ${form.questions.length ? `<fieldset class="fs"><legend>${icon("tag")}Their answers</legend><div class="form-grid">${form.questions.map(q => questionInput({...q, required: false}, (r.answers || {})[q.id] || "")).join("")}</div></fieldset>` : ""}
      <label class="check"><input type="checkbox" name="print" checked> Print the badge after approving</label>`,
    onSubmit: async form => {
      const f = formData(form), code = f.code.trim();
      const clash = c.attendees.find(a => a.code === code);
      if (clash) { toast(`ID ${code} already belongs to ${clash.full_name}. Pick another.`, "bad"); return false; }
      const fixed = {full_name: f.full_name.trim(), cert_name: f.cert_name.trim(), phone: f.phone.trim(), email: f.email.trim(), category: f.category, entity: f.entity.trim(), country: f.country};
      if (form.questions.length) fixed.answers = {...(r.answers || {}), ...answersFrom(form, $("form", dl))};
      // keep the corrected details on the request too, so the history matches what was approved
      await SB.from("registrations").update(fixed).eq("id", r.id);
      return await approve(c, [{...r, ...fixed, code}], ctx, {print: !!f.print}) !== false;
    },
    onDanger: async () => { await SB.from("registrations").update({status: "rejected", decided_at: new Date().toISOString()}).eq("id", r.id); toast("Rejected"); await ctx.reload(); }});
  const same = $("#rvSame", dl);
  if (same) same.onclick = async () => { await SB.from("registrations").update({status: "approved", attendee_id: d.id, decided_at: new Date().toISOString()}).eq("id", r.id);
    dl.close(); toast(`Linked to ${d.code} ${d.full_name}`); ctx.reload(); };
}
export function render(el, c, ctx){
  const conf = c.conf, url = regUrl(conf.id), regs = c.regs || [];
  el.innerHTML = `<div class="ov-grid">
    <section class="panel"><div class="panel-head"><div><h2>Waiting for approval</h2><span class="note">${regs.length ? `${regs.length} request${regs.length === 1 ? "" : "s"}, oldest first. New ones appear every 15 seconds.` : "New requests appear here every 15 seconds."}</span></div>
        ${regs.length > 1 ? `<button type="button" id="rAll">${icon("check")}Approve all ${regs.length}</button>` : ""}</div>
      <div class="tips">${regs.map(r => { const d = dupOf(c, r);
        const ans = r.answers && Object.keys(r.answers).length ? formOf(c.conf).questions.filter(q => r.answers[q.id]) : [];
        return `<div class="reg-card" data-review="${r.id}" tabindex="0" role="button" aria-label="Check ${esc(r.full_name)}">
          <div class="rq-top"><span class="av">${esc(initials(r.full_name))}</span>
            <div class="rq-who"><b class="rq-name" dir="auto">${esc(r.full_name)}</b>${r.cert_name && r.cert_name !== r.full_name ? `<span class="rq-cert" dir="auto">On certificate: ${esc(r.cert_name)}</span>` : ""}
              <div class="rq-meta">${r.category ? `<span class="pill acc">${esc(r.category)}</span>` : ""}
                ${r.entity ? `<span dir="auto">${icon("home", "ic sm")}${esc(r.entity)}</span>` : ""}
                ${r.country ? `<span>${flag(r.country)}${esc(r.country)}</span>` : ""}
                ${r.phone ? `<span class="num">${icon("user", "ic sm")}${esc(r.phone)}</span>` : ""}
                ${r.email ? `<span>${esc(r.email)}</span>` : ""}</div>
              ${ans.length ? `<div class="rq-ans">${ans.map(q => `<span><small>${esc(q.label)}</small>${esc(r.answers[q.id])}</span>`).join("")}</div>` : ""}</div>
            <span class="rq-wait" title="Sent ${esc(dayShort(r.created_at.slice(0, 10)))} ${hm(r.created_at)}">${icon("clock", "ic sm")}${waited(r.created_at)}</span></div>
          ${d ? `<div class="rq-dup">${icon("alert", "ic sm")}<span>Looks like <b>${esc(d.code)} ${esc(d.full_name)}</b>, already registered</span><button type="button" class="ghost small" data-link="${r.id}" data-to="${d.id}">Same person, use ${esc(d.code)}</button></div>` : ""}
          <div class="rq-acts"><button type="button" class="ghost small" data-check="${r.id}">${icon("search")}Check and edit</button><button type="button" class="rq-rej" data-rej="${r.id}">Reject</button>
            <span class="rq-gap"></span><button type="button" class="ghost small" data-okp="${r.id}">${icon("print")}Approve and print</button><button type="button" class="small" data-ok="${r.id}">${icon("check")}Approve</button></div></div>`; }).join("")
        || `<div class="tip"><span class="tip-ic">${icon("attendees")}</span><span><b>No one waiting</b><small>${conf.registration_open ? "Put the desk sign out; requests land here." : "Registration is closed. Open it on the right."}</small></span></div>`}</div></section>
    <section class="panel form"><div class="panel-head" style="margin:0"><h2>Desk sign</h2><span class="pill ${conf.registration_open ? "ok live" : ""}">${conf.registration_open ? "Open" : "Closed"}</span></div>
      <p class="note" style="margin:0">Visitors scan this code with their phone camera, fill in their details, and wait for you to approve them here.</p>
      <div class="codes" style="justify-content:center"><div style="width:180px;height:180px">${qrSvg(url)}</div></div>
      <div class="linkbox"><input readonly value="${esc(url)}" onfocus="this.select()" aria-label="Registration link"><button type="button" class="ghost small" id="rCopy">Copy</button></div>
      <div class="row"><button type="button" id="rToggle" class="${conf.registration_open ? "ghost" : ""}">${conf.registration_open ? "Close registration" : "Open registration"}</button>
        <button type="button" class="ghost" id="rForm">${icon("settings")}Edit the form</button><button type="button" class="ghost" id="rSign">${icon("print")}Print the desk sign</button><a class="btn ghost" href="#/register/${conf.id}" target="_blank" rel="noopener">Preview the form</a></div></section></div>`;
  const find = id => regs.find(r => r.id === id);
  // Tap a request (or "Check and edit") to correct it before approving.
  $$("[data-review]", el).forEach(card => { const open = e => { if (e.target.closest("button")) return; review(c, find(card.dataset.review), ctx); };
    card.onclick = open; card.onkeydown = e => { if (e.key === "Enter" && e.target === card) open(e); }; });
  $$("[data-check]", el).forEach(b => b.onclick = () => review(c, find(b.dataset.check), ctx));
  $$("[data-ok]", el).forEach(b => b.onclick = () => { b.disabled = true; approve(c, [find(b.dataset.ok)], ctx); });
  $$("[data-okp]", el).forEach(b => b.onclick = () => { b.disabled = true; approve(c, [find(b.dataset.okp)], ctx, {print: true}); });
  $("#rAll") && ($("#rAll").onclick = e => armed(e.currentTarget, () => approve(c, regs, ctx)));
  $$("[data-rej]", el).forEach(b => b.onclick = () => armed(b, async () => { await SB.from("registrations").update({status: "rejected", decided_at: new Date().toISOString()}).eq("id", b.dataset.rej); toast("Rejected"); ctx.reload(); }));
  $$("[data-link]", el).forEach(b => b.onclick = async () => { await SB.from("registrations").update({status: "approved", attendee_id: b.dataset.to, decided_at: new Date().toISOString()}).eq("id", b.dataset.link); toast("Linked to the existing attendee"); ctx.reload(); });
  $("#rCopy").onclick = () => navigator.clipboard.writeText(url).then(() => toast("Link copied"));
  $("#rToggle").onclick = async () => { const { error } = await SB.from("conferences").update({registration_open: !conf.registration_open}).eq("id", conf.id); if (error) return toast(error.message, "bad");
    toast(conf.registration_open ? "Registration closed" : "Registration open"); ctx.reload(); };
  $("#rSign").onclick = () => printSign(c, url);
  $("#rForm").onclick = () => editForm(c, ctx);
  // Keep the queue fresh while this page is open.
  const t = setInterval(async () => { if (!document.contains(el) || location.hash.indexOf("/register") < 0) return clearInterval(t);
    if (document.visibilityState !== "visible" || $("dialog[open]")) return;
    const { count } = await SB.from("registrations").select("id", {count: "exact", head: true}).eq("conference_id", conf.id).eq("status", "pending");
    if (count !== regs.length) ctx.reload(); }, 15000);
}
// A4 sign for the registration desk, in English and Arabic.
function printSign(c, url){
  const style = document.getElementById("pageStyle") || document.head.appendChild(Object.assign(document.createElement("style"), {id: "pageStyle"}));
  style.textContent = "@page{size:210mm 297mm;margin:0}";
  $("#printArea").innerHTML = `<div class="print-page" style="width:210mm;height:297mm;display:grid;justify-items:center;align-content:center;gap:9mm;text-align:center;font-family:'Bricolage Grotesque','Cairo',sans-serif;color:#002a3d;padding:20mm">
    <img src="assets/jv-mark.svg" style="height:16mm" alt=""><div style="font-size:15pt;color:#587080;max-width:150mm">${esc(c.conf.name)}</div>
    <div style="font-size:40pt;font-weight:700;line-height:1.05">Scan to register<br>for your badge</div>
    <div dir="rtl" style="font-family:Cairo,sans-serif;font-size:28pt;font-weight:700">امسح الرمز للتسجيل</div>
    <div style="width:105mm;height:105mm;padding:6mm;border:1.2mm solid #00bdeb;border-radius:8mm">${qrSvg(url)}</div>
    <div style="font-size:13pt;color:#587080;max-width:150mm">Open your phone camera and point it at the code. Fill in your details; your badge ID appears once the desk approves it.</div></div>`;
  setTimeout(() => print(), 150);
}
