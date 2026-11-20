// Self-print certificates.
// Kiosk (public): badge ID -> confirm the name and email with big buttons -> the certificate prints by itself.
// Station (team login): a laptop with a printer. It takes the next job from the queue and prints it with no dialog
// (Chrome started with --kiosk-printing). Three stations share one queue; each job goes to whichever is free.
import {SB, $, $$, esc, dateRange, icon, toast, armed, qrSvg, store, state, loadConf, initials, dayShort, hm, dialog, can} from "./core.js";
import {printDocs, printFonts, certPdf, certName, apprFor} from "./print.js";
import {tableSign} from "./certs.js";

const base = () => location.href.split("#")[0];
export const kioskUrl = id => `${base()}#/printcert/${id}`;
export const stationUrl = id => `${base()}#/station/${id}`;
export const digitalUrl = id => `${base()}#/mycertificate/${id}`;
const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const clean = s => String(s || "").replace(/[​-‏‪-‮⁠-⁩﻿ ]/g, "").trim();

/* ---------- kiosk ----------
   One language at a time (English or Arabic, a tap in the corner), three clear steps, big touch targets.
   It goes back to the start by itself, so a tablet on a stand serves one person after another. */
export async function renderKiosk(app, confId){
  const { data: f } = await SB.rpc("c_digital_info", {p_conf: confId});
  const modes = {print: !!f?.print, email: !!f?.email}, digital = modes.email && !modes.print; // digital: email is the only way out
  let lang = store.get("ksLang") || "en";
  const T = (en, ar) => lang === "ar" ? ar : en;
  let resetT = null, pollT = null; const later = (fn, ms) => { clearTimeout(resetT); resetT = setTimeout(fn, ms); };
  let view = () => askId();
  const frame = (step, inner) => {
    app.innerHTML = `<main class="ks" dir="${lang === "ar" ? "rtl" : "ltr"}" lang="${lang}"><header class="ks-bar"><img src="assets/jv-mark.svg" alt="" width="14" height="24">
        <span class="ks-ev"><b dir="auto">${esc(f?.name || "")}</b>${f ? `<small dir="ltr">${esc(dateRange(f.start_date, f.end_date))}${f.venue ? " · " + esc(f.venue) : ""}</small>` : ""}</span>
        <button type="button" class="ks-lang" id="ksLang" lang="${lang === "ar" ? "en" : "ar"}">${lang === "ar" ? "English" : "عربي"}</button></header>
      <div class="ks-stage">${step ? `<ol class="ks-steps" aria-label="${T("Steps", "الخطوات")}">${[T("Badge ID", "رقم البطاقة"), T("Check", "التأكيد"), T("Certificate", "الشهادة")].map((l, i) =>
        `<li class="${i + 1 < step ? "done" : i + 1 === step ? "on" : ""}" ${i + 1 === step ? 'aria-current="step"' : ""}><span>${i + 1 < step ? icon("check", "ic sm") : i + 1}</span>${l}</li>`).join("")}</ol>` : ""}
        <div class="ks-card">${inner}</div></div></main>`;
    $("#ksLang").onclick = () => { lang = lang === "ar" ? "en" : "ar"; store.set("ksLang", lang); view(); };
  };
  const closed = () => { view = closed; clearTimeout(resetT); frame(0, `<div class="ks-center">${icon("clock", "ic lg")}<h1>${T("Certificates aren't available right now", "الشهادات غير متاحة الآن")}</h1>
    <p class="ks-sub">${T("Please ask at the registration desk.", "يرجى السؤال في مكتب التسجيل.")}</p></div>`); };

  // 1. Badge ID on a big keypad; the digits show large as they are typed.
  const askId = (msg = "", code = "") => {
    view = () => askId(msg, $("#ksCode")?.value || code); clearTimeout(resetT); clearInterval(pollT);
    frame(1, `<form id="ksId" novalidate><h1>${T("Get your certificate", "احصل على شهادتك")}</h1>
      <p class="ks-sub">${T("Type the ID printed on your badge.", "اكتب الرقم المطبوع على بطاقتك.")}</p>
      <input id="ksCode" class="ks-code" inputmode="numeric" autocomplete="off" maxlength="10" dir="ltr" aria-label="${T("Badge ID", "رقم البطاقة")}" placeholder="—" value="${esc(code)}">
      <div class="ks-pad" dir="ltr">${[1, 2, 3, 4, 5, 6, 7, 8, 9, "C", 0, "⌫"].map(k => `<button type="button" data-k="${k}" class="${typeof k === "string" ? "fn" : ""}" aria-label="${k === "⌫" ? T("Delete", "حذف") : k === "C" ? T("Clear", "مسح") : k}">${k === "⌫" ? "⌫" : k === "C" ? T("Clear", "مسح") : k}</button>`).join("")}</div>
      <button type="submit" class="ks-go" id="ksGo">${T("Continue", "متابعة")}${icon("chevron")}</button>
      <p class="ks-err" role="status">${esc(msg)}</p></form>`);
    const form = $("#ksId"), inp = $("#ksCode"), go = $("#ksGo"), sync = () => go.disabled = !clean(inp.value);
    inp.focus(); sync(); inp.oninput = sync;
    $$("[data-k]", form).forEach(b => b.onclick = () => { const k = b.dataset.k; inp.value = k === "⌫" ? inp.value.slice(0, -1) : k === "C" ? "" : (inp.value + k).slice(0, 10); sync(); inp.focus(); });
    form.onsubmit = async e => { e.preventDefault(); const v = clean(inp.value); if (!v) return;
      go.disabled = true; go.classList.add("wait");
      const { data: p, error } = await SB.rpc("c_kiosk_lookup", {p_conf: confId, p_code: v});
      if (error) return askId(T("No connection. Try again.", "لا يوجد اتصال. حاول مرة أخرى."), v);
      if (p.closed) return closed();
      if (!p.found) return askId(T("No one has this ID. Check the number on your badge.", "لا يوجد أحد بهذا الرقم. تأكد من الرقم على بطاقتك."), v);
      confirm(p); };
  };

  // The certificate they will get, in small: the real design and the name in its place, the same size proportions as print.
  const preview = (p, name) => {
    const ls = f?.layouts || [], ap = ls.find(l => l.kind === "appreciation")?.layout;
    const L = ls.find(l => l.kind === "certificate")?.layout;
    const nf = L?.bg && (L.fields || []).find(x => x.show && (x.key === "cert_name" || x.key === "full_name") && x.type !== "qr");
    if (!nf) return "";
    const pct = (v, of) => (v / of * 100).toFixed(3) + "%", cq = pt => (pt * .3528 / L.w * 100).toFixed(3) + "cqw";
    return `<div class="ks-prev" style="aspect-ratio:${L.w}/${L.h}"><img src="${esc(L.bg)}" alt="">
      <div class="ks-prev-name" id="ksPrevName" dir="auto" data-pt="${nf.size}" data-sp="${L === ls.find(l => l.kind === "certificate")?.layout && p.category === "Speaker" ? 1 : ""}" style="left:${pct(nf.x, L.w)};top:${pct(nf.y, L.h)};width:${pct(nf.w, L.w)};font-size:${cq(nf.size)};font-weight:${nf.weight};color:${esc(nf.color)};text-align:${nf.align};font-family:'${esc(nf.font)}',Cairo,sans-serif;${nf.upper ? "text-transform:uppercase;" : ""}">${esc(certName({cert_name: name, category: p.category}, L === ls.find(l => l.kind === "certificate")?.layout ? "certificate" : ""))}</div></div>`;
  };
  const fitPrev = () => { const el = $("#ksPrevName"); if (!el) return; let s = parseFloat(el.style.fontSize);
    while (el.scrollWidth > el.clientWidth + 1 && s > 1) { s -= .1; el.style.fontSize = s.toFixed(2) + "cqw"; } };

  // 2. One look: their certificate with their name, the name and email as two rows with Edit, then one button.
  // If it's all right they press the button; nothing else to tap.
  const confirm = (p, st = {name: p.name, editName: false, email: "", editMail: !p.email_hint}) => {
    view = () => confirm(p, st); later(() => askId(), 90000);
    const first = String(p.name).replace(/^(dr|prof|د)\.?\s+/i, "").split(" ")[0], noMail = !p.email_hint;
    frame(2, `<div class="ks-hello"><span class="ks-av">${esc(initials(p.name))}</span><div><h1 dir="auto">${T("Hello", "أهلًا")} ${esc(first)}</h1>
        <p class="ks-sub">${T("Badge ID", "رقم البطاقة")} <b class="num" dir="ltr">${esc(p.code)}</b>${p.category ? ` · ${esc(p.category)}` : ""}</p></div>
        <button type="button" class="ks-link" id="ksBack">${T("Not you?", "لست أنت؟")}</button></div>
      ${p.prints ? `<p class="ks-note">${icon("alert", "ic sm")}${T("Your certificate was printed before. You can print it again.", "طُبعت شهادتك من قبل، يمكنك طباعتها مرة أخرى.")}</p>` : ""}
      ${preview(p, st.name)}
      <p class="ks-ask">${T("Check your details. If they're right, choose below.", "تأكد من بياناتك، وإن كانت صحيحة اختر من الأسفل.")}</p>
      <div class="ks-rows">
        <div class="ks-r ${st.editName ? "editing" : ""}"><span class="ks-rl">${icon("award", "ic sm")}${T("Name on the certificate", "الاسم على الشهادة")}</span>
          ${st.editName ? `<input id="ksName" class="ks-in" dir="auto" maxlength="120" value="${esc(st.name)}" aria-label="${T("Name on the certificate", "الاسم على الشهادة")}">
              <span class="ks-hint">${T("Fix the spelling or add your title. It prints exactly like this.", "صحّح الاسم أو أضف اللقب. سيُطبع كما هو تمامًا.")}</span>
              <div class="ks-rowacts"><button type="button" class="ks-b ok" id="ksNameSave">${icon("check")}${T("Save", "حفظ")}</button><button type="button" class="ks-b" id="ksNameCancel">${T("Cancel", "إلغاء")}</button></div>`
            : `<div class="ks-rv"><b dir="auto">${esc(st.name)}</b><button type="button" class="ks-chip" id="ksNameEdit">${T("Edit", "تعديل")}</button></div>`}</div>
        <div class="ks-r ${st.editMail ? "editing" : ""} ${noMail ? "need" : ""}"><span class="ks-rl">${icon("mail", "ic sm")}${T("Email", "البريد الإلكتروني")}</span>
          ${st.editMail ? `${noMail ? `<span class="ks-need">${modes.email ? T("We don't have your email. Add it to receive your certificate.", "لا يوجد لدينا بريدك. أضفه لتصلك شهادتك.") : T("We don't have your email. You can add it now.", "لا يوجد لدينا بريدك. يمكنك إضافته الآن.")}</span>` : ""}
              <input id="ksMail" class="ks-in" type="email" inputmode="email" dir="ltr" maxlength="200" value="${esc(st.email)}" placeholder="name@example.com" aria-label="${T("Email", "البريد الإلكتروني")}">
              ${p.email_hint ? `<span class="ks-hint">${T("The desk checks a new email before it replaces", "سيتحقق المكتب من البريد الجديد قبل استبدال")} <span dir="ltr">${esc(p.email_hint)}</span>.</span>
                <div class="ks-rowacts"><button type="button" class="ks-b" id="ksMailCancel">${T("Keep", "أبقِ")} <span dir="ltr">${esc(p.email_hint)}</span></button></div>` : ""}`
            : `<div class="ks-rv"><b dir="ltr">${esc(p.email_hint)}</b><button type="button" class="ks-chip" id="ksMailEdit">${T("Change", "تغيير")}</button></div>`}</div>
      </div>
      <div class="ks-outs ${modes.print && modes.email ? "two" : ""}">${modes.print ? `<button type="button" class="ks-go print" id="ksPrint" ${st.editName ? "disabled" : ""}>${icon("print")}${T("Print at the desk", "اطبعها على المكتب")}</button>` : ""}
        ${modes.email ? `<button type="button" class="ks-go ${modes.print ? "mail" : "print"}" id="ksEmail" ${st.editName ? "disabled" : ""}>${icon("mail")}${modes.print ? T("Send by email", "أرسلها بالبريد") : T("Email my certificate", "أرسل شهادتي لبريدي")}</button>` : ""}</div>
      <p class="ks-err" role="status">${st.editName ? T("Save the name first.", "احفظ الاسم أولًا.") : ""}</p>`);
    const set = patch => confirm(p, {...st, email: $("#ksMail")?.value ?? st.email, ...patch});
    $("#ksBack").onclick = () => askId();
    $("#ksNameEdit") && ($("#ksNameEdit").onclick = () => set({editName: true}));
    $("#ksNameCancel") && ($("#ksNameCancel").onclick = () => set({editName: false}));
    $("#ksNameSave") && ($("#ksNameSave").onclick = () => { const v = clean($("#ksName").value).replace(/\s+/g, " "); if (v.length < 2) return $(".ks-err").textContent = T("Type your full name.", "اكتب اسمك الكامل."); set({name: v, editName: false}); });
    $("#ksName") && ($("#ksName").onkeydown = e => { if (e.key === "Enter") $("#ksNameSave").click(); });
    $("#ksMailEdit") && ($("#ksMailEdit").onclick = () => set({editMail: true}));
    $("#ksMailCancel") && ($("#ksMailCancel").onclick = () => set({editMail: false, email: ""}));
    $("#ksMail") && ($("#ksMail").oninput = e => { st.email = e.target.value; });
    if (st.editName) { const n = $("#ksName"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    else if (st.editMail && !noMail) $("#ksMail")?.focus();
    $("#ksName") && ($("#ksName").oninput = e => { const el = $("#ksPrevName"); if (el) { el.textContent = (e.target.value || " ") + (el.dataset.sp && e.target.value ? " (Speaker)" : ""); el.style.fontSize = (parseFloat(el.dataset.pt) * .3528 / ((f.layouts.find(l => l.kind === "certificate")?.layout?.w) || 297) * 100).toFixed(3) + "cqw"; fitPrev(); } });
    document.fonts.ready.then(fitPrev); fitPrev();
    const email = () => $("#ksMail") ? clean($("#ksMail").value).toLowerCase() : "";
    const bad = () => { const e = email(); if (e && !EMAIL.test(e)) { $(".ks-err").textContent = T("That email doesn't look right.", "البريد الإلكتروني غير صحيح."); return true; } };
    const busy = on => $$(".ks-outs button").forEach(x => { x.disabled = on; x.classList.toggle("wait", on); });
    $("#ksEmail") && ($("#ksEmail").onclick = async () => {
      if (bad()) return;
      const e = email();
      if (!e && !p.email_hint) return $(".ks-err").textContent = T("Add your email to receive your certificate.", "أضف بريدك الإلكتروني لتصلك الشهادة.");
      if (st.editMail && !e && p.email_hint) return $(".ks-err").textContent = T("Type the new email, or keep the one we have.", "اكتب البريد الجديد أو أبقِ البريد الحالي.");
      if (st.name !== p.name) {
        busy(true);
        const { data } = await SB.rpc("c_digital_name", {p_conf: confId, p_code: p.code, p_name: st.name});
        if (data?.status === "review") return review(p, st.name, data.registered);
        if (data?.status === "closed") return closed();
      }
      return show(p, st.name, e);
    });
    $("#ksPrint") && ($("#ksPrint").onclick = async () => {
      if (bad()) return;
      busy(true);
      const { data, error } = await SB.rpc("c_kiosk_print", {p_conf: confId, p_code: p.code, p_name: st.name, p_email: email()});
      const s = error ? "net" : data?.status;
      if (s === "ok") return track(p, st.name, data.job);
      if (s === "review") return review(p, st.name, data.registered);
      if (s === "closed") return closed();
      busy(false);
      $(".ks-err").textContent = {limit: T("This certificate was printed 3 times already. Please ask at the desk.", "طُبعت هذه الشهادة 3 مرات. يرجى السؤال في المكتب."),
        busy: T("The printers are busy. Try again in a minute.", "الطابعات مشغولة، حاول بعد دقيقة."), name: T("Type your full name.", "اكتب اسمك الكامل."),
        email: T("That email doesn't look right.", "البريد الإلكتروني غير صحيح."), code: T("That ID wasn't found.", "لم يتم العثور على الرقم."),
        net: T("No connection. Try again.", "لا يوجد اتصال. حاول مرة أخرى.")}[s] || T("Not sent. Try again.", "لم يُرسل، حاول مرة أخرى.");
    });
  };

  // 3. A little certificate with their name slides out of the printer; then where to collect it, and back to the start.
  const track = (p, name, job) => {
    clearTimeout(resetT); clearInterval(pollT);
    let j = {status: "queued", ahead: null};
    const draw = () => {
      const done = j.status === "printed", printing = j.status === "printing", failed = j.status === "failed";
      frame(3, `<div class="ks-center ks-track ${done ? "done" : ""}">
        <div class="ks-machine ${printing ? "busy" : ""} ${done ? "done" : ""}" aria-hidden="true"><div class="ks-sheet"><small>${T("Certificate of attendance", "شهادة حضور")}</small><b dir="auto">${esc(name)}</b><i></i></div><div class="ks-body"><span></span></div></div>
        <h1>${done ? T("Your certificate is ready", "شهادتك جاهزة") : printing ? T("Printing…", "جاري الطباعة…") : failed ? T("Something went wrong", "حدث خطأ") : T("Sending to the printer…", "جاري الإرسال للطابعة…")}</h1>
        <p class="ks-status">${done ? T(`Collect it from <b>${esc(j.station || "the printer")}</b>`, `استلمها من <b>${esc(j.station || "الطابعة")}</b>`)
          : printing ? T(`At <b>${esc(j.station)}</b>`, `على <b>${esc(j.station)}</b>`) : failed ? T("Please ask at the desk.", "يرجى السؤال في المكتب.")
          : j.ahead ? T(`${j.ahead} ahead of you`, `أمامك ${j.ahead}`) : T("You're next", "أنت التالي")}</p>
        ${done ? `<div class="ks-count"><i></i></div>` : ""}
        <button type="button" class="ks-b" id="ksNext">${done ? T("Done", "تم") : T("Start again", "ابدأ من جديد")}</button></div>`);
      $("#ksNext").onclick = () => askId();
    };
    view = draw; draw();
    pollT = setInterval(async () => {
      if (!document.querySelector(".ks-track")) return clearInterval(pollT);
      const { data } = await SB.rpc("c_kiosk_job", {p_job: job}); if (!data) return;
      const changed = data.status !== j.status || data.ahead !== j.ahead || data.station !== j.station; j = data;
      if (changed) draw();
      if (data.status === "printed" || data.status === "failed") { clearInterval(pollT); later(() => askId(), 12000); }
    }, 1500);
  };
  // A name that isn't a correction of the registered one (another person's name) goes to the desk, and nothing prints.
  const review = (p, typed, registered) => {
    view = () => review(p, typed, registered); later(() => askId(), 60000);
    frame(2, `<div class="ks-center ks-review">${icon("alert", "ic lg")}<h1>${T("The desk needs to check this name", "يجب أن يتحقق المكتب من هذا الاسم")}</h1>
      <p class="ks-sub">${T("The name you typed is very different from the name registered for this badge:", "الاسم الذي كتبته مختلف كثيرًا عن الاسم المسجل لهذه البطاقة:")}</p>
      <div class="ks-names"><div><small>${T("Registered", "المسجل")}</small><b dir="auto">${esc(registered || p.name)}</b></div><div class="new"><small>${T("You typed", "كتبت")}</small><b dir="auto">${esc(typed)}</b></div></div>
      <p class="ks-sub">${T("We sent it to the registration desk. Please go to the desk, or continue with the registered name.", "أرسلناه إلى مكتب التسجيل. يرجى التوجه للمكتب، أو المتابعة بالاسم المسجل.")}</p>
      <div class="ks-acts"><button type="button" class="ks-go" id="ksUseReg">${T("Use the registered name", "استخدم الاسم المسجل")}</button><button type="button" class="ks-b" id="ksDone">${T("Done", "تم")}</button></div></div>`);
    $("#ksUseReg").onclick = () => confirm({...p, name: registered || p.name});
    $("#ksDone").onclick = () => askId();
  };

  // 3 (digital). Make the certificate on the phone (same layout the team prints) and email it; no download.
  const show = async (p, name, email) => {
    clearTimeout(resetT); clearInterval(pollT);
    const c = {conf: f, layouts: f.layouts || []}, person = {code: p.code, full_name: name, cert_name: name, category: p.category};
    let stage = "make", sent = "", err = "", from = {name: f.name, email: ""}, two = false;
    const draw = () => {
      const done = stage === "sent", failed = stage === "error";
      frame(3, `<div class="ks-center ks-mail ${done ? "done" : ""}">
        <div class="ks-env ${done ? "done" : failed ? "" : "busy"}" aria-hidden="true">${icon(done ? "check" : failed ? "alert" : "mail", "ic lg")}</div>
        <h1>${done ? (two ? T("Your 2 certificates are on their way", "شهادتاك في الطريق إليك") : T("Your certificate is on its way", "شهادتك في الطريق إليك")) : failed ? T("It wasn't sent", "لم تُرسل") : stage === "send" ? T("Sending…", "جاري الإرسال…") : T("Making your certificate…", "جاري تجهيز شهادتك…")}</h1>
        <p class="ks-status">${done ? T(`Sent to <b dir="ltr">${esc(sent)}</b>`, `أُرسلت إلى <b dir="ltr">${esc(sent)}</b>`) : failed ? esc(err)
          : T(`To <b dir="ltr">${esc(email || p.email_hint)}</b>`, `إلى <b dir="ltr">${esc(email || p.email_hint)}</b>`)}</p>
        ${done ? `<div class="ks-spam">${icon("alert", "ic sm")}<div><b>${T("Not in your inbox? Check Spam or Junk.", "لم تجدها؟ تفقّد مجلد البريد المزعج (Spam / Junk).")}</b>
          <span>${T("Look for an email from", "ابحث عن رسالة من")} <b dir="auto">${esc(from.name)}</b>${from.email ? ` <span dir="ltr">(${esc(from.email)})</span>` : ""}. ${T("Mark it as Not spam so the next one arrives normally.", "اضغط \"ليس بريدًا مزعجًا\" لتصلك الرسائل القادمة بشكل طبيعي.")}</span></div></div><div class="ks-count"><i></i></div>` : ""}
        ${failed ? `<div class="ks-acts"><button type="button" class="ks-go" id="ksRetry">${T("Try again", "حاول مرة أخرى")}</button><button type="button" class="ks-b" id="ksAgain">${T("Start again", "ابدأ من جديد")}</button></div>`
          : done ? `<button type="button" class="ks-b" id="ksAgain">${T("Done", "تم")}</button>` : ""}</div>`);
      $("#ksAgain") && ($("#ksAgain").onclick = () => askId());
      $("#ksRetry") && ($("#ksRetry").onclick = () => go());
    };
    const go = async () => {
      stage = "make"; err = ""; view = draw; draw();
      try {
        // Speakers get both in the same email: the attendance certificate and the appreciation one.
        const toB64 = blob => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); });
        const pdf = await toB64(await certPdf(c, [person])), pdf2 = apprFor(c, person) ? await toB64(await certPdf(c, [person], {kind: "appreciation"})) : "";
        stage = "send"; draw();
        const { data, error } = await SB.functions.invoke("cert-digital", {body: {conf: confId, code: p.code, name, email, pdf, ...(pdf2 ? {pdf2} : {})}});
        if (error || !data?.ok) {
          let j = {}; try { j = await error.context.json(); } catch {}
          if (j.code === "review") return review(p, name, j.registered);
          if (j.code === "closed") return closed();
          stage = "error"; err = j.error || T("No connection. Try again.", "لا يوجد اتصال. حاول مرة أخرى."); return draw();
        }
        stage = "sent"; sent = data.email_hint; two = !!data.both; from = {name: data.from_name || f.name, email: data.from_email || ""}; draw(); later(() => askId(), 25000);
      } catch (e) { stage = "error"; err = T("The certificate couldn't be made on this phone. Please ask at the desk.", "تعذر تجهيز الشهادة على هذا الجهاز، يرجى السؤال في المكتب."); draw(); }
    };
    go();
  };
  if (!f || !f.open) return closed();
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
  const k = {open: false, full: true, digital: false, ...(c.conf.print_kiosk || {})}, on = k.open || k.digital;
  return `<section class="panel form ksp" id="ksPanel"><div class="panel-head" style="margin:0"><h2>Certificate QR</h2><span class="pill ${on ? "ok live" : ""}">${on ? "Open" : "Closed"}</span></div>
    <p class="note" style="margin:0">One QR for everyone: people type their badge ID, check their name and email, then get their certificate the ways you switch on.</p>
    <div class="ksp-opts">
      <label class="ksp-opt ${k.open ? "on" : ""}"><input type="checkbox" id="ksOptPrint" ${k.open ? "checked" : ""}><span>${icon("print")}<b>Print at the desk</b><small>Prints by itself on a printer device</small></span></label>
      <label class="ksp-opt ${k.digital ? "on" : ""}"><input type="checkbox" id="ksOptMail" ${k.digital ? "checked" : ""}><span>${icon("mail")}<b>Send by email</b><small>The certificate arrives as a PDF</small></span></label></div>
    ${on ? `<div class="codes" style="justify-content:center"><div style="width:150px;height:150px">${qrSvg(kioskUrl(c.conf.id))}</div></div>` : ""}
    <div class="row"><button type="button" class="ghost" id="ksSign">${icon("print")}Table sign</button><button type="button" class="ghost" id="ksCopy">${icon("link")}Copy link</button></div>
    ${k.open ? `<div class="ksp-print"><b>Printing</b>
      <div class="ksp-live" id="ksLive"><span class="note">Loading the printers…</span></div>
      <label>Prints<select id="ksFull"><option value="1" ${k.full !== false ? "selected" : ""}>Full design, on blank paper</option><option value="" ${k.full === false ? "selected" : ""}>Text only, on paper with the design already printed</option></select></label>
      </div>` : ""}</section>`;
}
export function wireKiosk(el, c, ctx){
  const k = {open: false, full: true, digital: false, ...(c.conf.print_kiosk || {})};
  const save = async patch => { const { error } = await SB.from("conferences").update({print_kiosk: {...k, ...patch}}).eq("id", c.conf.id); if (error) return toast(error.message, "bad"); ctx.reload(); };
  $("#ksOptPrint", el).onchange = e => save({open: e.target.checked}).then(() => toast(e.target.checked ? "Printing at the desk is on" : "Printing at the desk is off"));
  $("#ksOptMail", el).onchange = e => save({digital: e.target.checked}).then(() => toast(e.target.checked ? "Sending by email is on" : "Sending by email is off"));
  $("#ksFull", el) && ($("#ksFull", el).onchange = e => save({full: !!e.target.value}));
  $("#ksSign", el).onclick = () => {
    const how = k.open && k.digital ? ["Check your name: print it at the desk or get it by email", "وتأكد من اسمك لتطبعها على المكتب أو تصلك بالبريد."]
      : k.digital ? ["Check your name and email: it arrives by email", "وتأكد من اسمك وبريدك لتصلك الشهادة على بريدك الإلكتروني."]
      : ["Check your name: it prints at the desk", "وتأكد من اسمك لتُطبع شهادتك على المكتب."];
    tableSign(c, kioskUrl(c.conf.id), {kind: "certificate", title: "Get your<br>certificate", ar: "احصل على شهادتك",
      steps: ["Scan with your phone camera", "Type the ID printed on your badge", how[0]], arLine: "امسح الرمز، اكتب رقم بطاقتك، " + how[1]});
  };
  $("#ksCopy", el).onclick = () => navigator.clipboard.writeText(kioskUrl(c.conf.id)).then(() => toast("Certificate QR link copied"));
  const live = async () => {
    const box = $("#ksLive", el); if (!box || !document.contains(box)) return;
    const [{ data: st }, { data: jobs }] = await Promise.all([SB.from("print_stations").select("*").eq("conference_id", c.conf.id).order("name"),
      SB.from("print_jobs").select("code,name,status,station,created_at,printed_at").eq("conference_id", c.conf.id).order("created_at", {ascending: false}).limit(6)]);
    if (!document.contains(box)) return;
    const on = s => Date.now() - Date.parse(s.seen_at) < 15000, q = (jobs || []).filter(j => j.status === "queued").length;
    box.innerHTML = `<div class="ksp-st">${(st || []).map(s => `<span class="ksp-s ${on(s) ? "on" : ""}">${icon("print", "ic sm")}${esc(s.name)}<small>${on(s) ? `${s.printed} printed` : "offline"}</small></span>`).join("")
        || `<span class="note">No printer is on yet. On the laptop with the printer, turn on <b>Print certificates here</b> in the side menu.</span>`}</div>
      ${(jobs || []).length ? `<ul class="ksp-jobs">${jobs.map(j => `<li class="${j.status}"><span class="num">${esc(j.code)}</span><span dir="auto">${esc(j.name)}</span><small>${j.status === "printed" ? `${esc(j.station || "")} ✓` : j.status === "printing" ? `printing at ${esc(j.station || "")}` : esc(j.status)}</small></li>`).join("")}</ul>` : ""}
      ${q ? `<p class="note" style="margin:0">${q} waiting for a printer</p>` : ""}`;
    setTimeout(live, 4000);
  };
  live();
}

/* ---------- "This device prints certificates": any team laptop with a printer, from any page of the system ----------
   Turned on from the side menu. While on, this device takes the next certificate from the queue every few seconds and
   prints it, the same as a station page. Only one device ever gets each certificate. */
const BG = {conf: null, name: "", t: null, busy: false, count: 0, state: "", sub: ""};
const bgKey = id => `printhere:${id}`;
async function printJob(confId, j){
  let c = await loadConf(confId);
  if (!c.attendees.some(a => a.id === j.attendee_id)) c = await loadConf(confId, {force: true});
  const a = c.attendees.find(x => x.id === j.attendee_id);
  const done = new Promise(res => { addEventListener("afterprint", res, {once: true}); setTimeout(res, 45000); });
  await printDocs(c, "certificate", [{...(a || {code: j.code, full_name: j.name}), cert_name: j.name}], {full: c.conf.print_kiosk?.full !== false});
  await done;
  await SB.from("print_jobs").update({status: "printed", printed_at: new Date().toISOString()}).eq("id", j.id);
}
const set = (st, sub = "") => { BG.state = st; BG.sub = sub; paint(); };
async function loop(){
  const id = BG.conf; if (!id) return;
  const area = document.getElementById("printArea");
  // Wait while something else is printing on this device (a badge, a sign): one print job at a time.
  if (!BG.busy && !(area && area.innerHTML.trim()) && !document.querySelector("dialog[open]")) {
    BG.busy = true;
    try {
      const { data: jobs, error } = await SB.rpc("c_station_claim", {p_conf: id, p_station: BG.name});
      if (BG.conf !== id) return;
      if (error) set("Offline", error.message);
      else if (jobs?.length) { set("Printing", jobs[0].name); await printJob(id, jobs[0]); BG.count++; set("Printed", jobs[0].name);
        SB.from("print_stations").update({printed: BG.count}).eq("conference_id", id).eq("name", BG.name); }
      else if (BG.state !== "Printed" || Date.now() % 4 === 0) set("Ready");
    } catch (err) { set("Error", err.message || ""); }
    finally { BG.busy = false; }
  }
  if (BG.conf === id) BG.t = setTimeout(loop, 3000);
}
function bgStop(){ clearTimeout(BG.t); Object.assign(BG, {conf: null, name: "", t: null, count: 0, state: ""}); }
// Called on every conference page: start, keep or stop printing on this device for that conference.
export function bgWatch(confId){
  const name = store.get(bgKey(confId)) || "";
  if (!name) { if (BG.conf === confId) bgStop(); return paint(); }
  if (BG.conf === confId && BG.name === name && BG.t) return paint();
  bgStop(); Object.assign(BG, {conf: confId, name, state: "Ready"}); loop(); paint();
}
export const printHereBtn = () => `<button type="button" class="side-print" id="printHere"></button>`;
function paint(){
  const b = document.getElementById("printHere"); if (!b) return;
  const on = !!BG.name && BG.conf === state.c?.conf.id;
  b.className = "side-print" + (on ? ` on${BG.state === "Printing" ? " busy" : ""}${["Offline", "Error"].includes(BG.state) ? " bad" : ""}` : "");
  b.title = on ? `${BG.name} prints certificates from the self-print QR on this device. Click to stop.` : "Use this device and its printer for the self-print certificates";
  b.innerHTML = on ? `<span class="sp-dot" aria-hidden="true"></span><span class="sp-t"><b>${esc(BG.name)} · ${esc(BG.state)}</b><small>${BG.state === "Printing" ? esc(BG.sub) : `${BG.count} printed on this device`}</small></span>`
    : `${icon("print")}<span class="sp-t"><b>Print certificates here</b><small>Use this device's printer</small></span>`;
}
document.addEventListener("click", e => {
  if (!e.target.closest("#printHere") || !state.c) return;
  const id = state.c.conf.id, on = BG.conf === id && BG.name;
  if (on) return dialog({title: `${BG.name} is printing certificates`, submit: "", danger: "Stop printing here", need: "edit",
    body: `<p style="margin:0">This device prints the certificates people ask for from the self-print QR. ${BG.count} printed so far.</p>
      <p class="note" style="margin:0">Keep this tab open. Other pages of the system keep working while it prints.</p>`,
    onDanger: () => { store.set(bgKey(id), ""); bgStop(); paint(); toast("This device stopped printing certificates"); }});
  const k = state.c.conf.print_kiosk || {};
  dialog({title: "Print certificates on this device", submit: "Start printing here", need: "edit",
    body: `${k.open ? "" : `<p class="note" style="margin:0;color:var(--warn)">Self-print is closed. Open it on the Certificates page so people can send certificates.</p>`}
      <p style="margin:0">Certificates people ask for from the QR print by themselves on this device's printer. With several devices on, each certificate goes to only one of them.</p>
      <div class="seg" role="radiogroup" aria-label="Printer name">${["Printer 1", "Printer 2", "Printer 3", "Printer 4"].map((n, i) => `<label class="sp-pick"><input type="radio" name="pn" value="${n}" ${i === 0 ? "checked" : ""}>${n}</label>`).join("")}</div>
      <p class="note" style="margin:0">Give each device a different name, so people see which printer to go to. To print without the print window, open Chrome with <code>--kiosk-printing</code>, and set this printer as the default with the certificate paper size.</p>`,
    onSubmit: form => { const n = new FormData(form).get("pn") || "Printer 1"; store.set(bgKey(id), n); bgWatch(id); toast(`${n}: this device now prints certificates`); }});
});
