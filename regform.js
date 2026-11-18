// The registration form each conference asks visitors to fill in: which standard fields to ask, and its own questions.
// Stored on the conference (reg_form); answers are stored on the request and copied to the attendee when approved.
import {SB, $, $$, esc, toast, dialog, icon, selectOptions} from "./core.js";

// [key, English, Arabic]. Full name is always asked.
export const STD = [["cert_name", "Name on the certificate", "الاسم على الشهادة"], ["phone", "Mobile", "رقم الهاتف"], ["email", "Email", "البريد الإلكتروني"],
  ["category", "I am a", "الفئة"], ["entity", "Hospital, university or company", "جهة العمل"], ["country", "Country", "الدولة"]];
// Today's form, so a conference that never edits its form keeps it exactly.
const DEFAULT_FIELDS = {cert_name: "optional", phone: "required", email: "optional", category: "required", entity: "optional", country: "optional"};
const TYPES = [["text", "Short text"], ["number", "Number"], ["choice", "Pick from a list"], ["yesno", "Yes or no"]];
// Ready-made questions for medical conferences; each one can be edited after it's added.
export const PRESETS = [
  {label: "Specialty", label_ar: "التخصص", type: "choice", required: true, options: ["Endocrinology", "Internal Medicine", "Family Medicine", "Paediatrics", "Surgery", "Obstetrics and Gynaecology", "Nursing", "Pharmacy", "Nutrition", "Other"]},
  {label: "Job title", label_ar: "المسمى الوظيفي", type: "choice", required: true, options: ["Consultant", "Specialist", "Resident", "General Practitioner", "Nurse", "Pharmacist", "Dietitian", "Student", "Other"]},
  {label: "Medical syndicate or license number", label_ar: "رقم النقابة أو الترخيص", type: "text", required: false, options: []},
  {label: "Years of experience", label_ar: "سنوات الخبرة", type: "number", required: false, options: []},
  {label: "Will you attend the workshop?", label_ar: "هل ستحضر الورشة؟", type: "yesno", required: false, options: [], tag_on_yes: "Workshop"},
];
export const formOf = conf => ({fields: {...DEFAULT_FIELDS, ...(conf?.reg_form?.fields || {})}, questions: (conf?.reg_form?.questions || []).filter(q => q && q.id && q.label)});
const newId = () => "q" + Math.random().toString(36).slice(2, 8);

// One question as a form control. name = "ans:<id>"; bilingual adds the Arabic label (visitor's phone).
export function questionInput(q, value = "", {bilingual = false, disabled = false} = {}){
  const lab = bilingual && q.label_ar ? `${esc(q.label)} <span dir="rtl" style="font-weight:500">${esc(q.label_ar)}</span>` : esc(q.label);
  const req = q.required ? "required" : "", dis = disabled ? "disabled" : "", name = `ans:${esc(q.id)}`;
  if (q.type === "choice") return `<label>${lab}<select name="${name}" ${req} ${dis}>${selectOptions(q.options || [], value || "", "Choose…")}</select></label>`;
  if (q.type === "yesno") return `<label>${lab}<select name="${name}" ${req} ${dis}>${selectOptions(["Yes", "No"], value || "", "Choose…")}</select></label>`;
  return `<label>${lab}<input name="${name}" ${q.type === "number" ? 'type="number" inputmode="numeric" min="0"' : ""} maxlength="300" value="${esc(value)}" ${req} ${dis}></label>`;
}
// Answers out of a submitted form, only for this form's questions.
export const answersFrom = (form, f) => Object.fromEntries(form.questions.map(q => [q.id, String(new FormData(f).get(`ans:${q.id}`) ?? "").trim()]).filter(([, v]) => v));
// Read-only list; answers to questions that were later removed still show, under their saved id.
export function answersList(form, answers){
  const a = answers || {}, known = form.questions.filter(q => a[q.id]).map(q => [q.label, a[q.id]]), extra = Object.entries(a).filter(([k]) => !form.questions.some(q => q.id === k));
  const rows = [...known, ...extra];
  return rows.length ? `<dl class="ans-list">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : "";
}

/* ---------- the editor (Registrations → Edit the form) ---------- */
export function editForm(c, ctx){
  const st = JSON.parse(JSON.stringify(formOf(c.conf)));
  const d = dialog({wide: true, need: "manage", title: "Registration form", submit: "Save the form",
    body: `<p class="note" style="margin:0">What visitors fill in after scanning the desk QR code. Full name is always asked. Changes apply to new requests straight away.</p><div id="rfBody"></div>`,
    onSubmit: async () => {
      for (const q of st.questions) {
        q.label = q.label.trim(); q.label_ar = (q.label_ar || "").trim(); q.options = (q.options || []).map(o => o.trim()).filter(Boolean);
        if (!q.label) { toast("Every question needs an English label.", "bad"); return false; }
        if (q.type === "choice" && q.options.length < 2) { toast(`“${q.label}” needs at least two choices.`, "bad"); return false; }
      }
      const { error } = await SB.from("conferences").update({reg_form: st}).eq("id", c.conf.id);
      if (error) { toast(/reg_form/.test(error.message) ? "The database needs a one-time update before the form can be saved." : error.message, "bad"); return false; }
      toast("Registration form saved"); await ctx.reload();
    }});
  const box = $("#rfBody", d);
  const draw = () => {
    box.innerHTML = `<h3 class="rf-h">Standard fields</h3>
      <div class="rf-std">${STD.map(([k, en, ar]) => `<div class="rf-row"><span><b>${esc(en)}</b><small dir="rtl">${esc(ar)}</small></span>
        <div class="seg" role="group" aria-label="${esc(en)}">${[["required", "Required"], ["optional", "Optional"], ["hidden", "Don't ask"]].map(([v, l]) => `<button type="button" data-std="${k}" data-v="${v}" aria-pressed="${st.fields[k] === v}">${l}</button>`).join("")}</div></div>`).join("")}</div>
      <h3 class="rf-h">Your questions</h3>
      <div class="rf-qs">${st.questions.map((q, i) => `<div class="rf-q" data-i="${i}">
        <div class="form-grid"><label>Question<input data-k="label" value="${esc(q.label)}" maxlength="120" placeholder="Specialty"></label>
          <label>In Arabic (optional)<input data-k="label_ar" dir="rtl" value="${esc(q.label_ar || "")}" maxlength="120" placeholder="التخصص"></label>
          <label>Answer<select data-k="type">${TYPES.map(([v, l]) => `<option value="${v}" ${q.type === v ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
        ${q.type === "choice" ? `<label>Choices, one per line<textarea data-k="options" rows="4">${esc((q.options || []).join("\n"))}</textarea></label>` : ""}
        ${q.type === "yesno" ? `<label>When they answer Yes, tag them (optional)<input data-k="tag_on_yes" value="${esc(q.tag_on_yes || "")}" maxlength="40" placeholder="Workshop"></label>` : ""}
        <div class="row" style="align-items:center"><label class="check"><input type="checkbox" data-k="required" ${q.required ? "checked" : ""}> Required</label>
          <span style="margin-left:auto"></span><button type="button" class="ghost small" data-mv="-1" ${i ? "" : "disabled"} aria-label="Move up">↑</button><button type="button" class="ghost small" data-mv="1" ${i < st.questions.length - 1 ? "" : "disabled"} aria-label="Move down">↓</button>
          <button type="button" class="danger small" data-rm>Remove</button></div></div>`).join("") || '<p class="note" style="margin:0">No questions of your own yet.</p>'}</div>
      <div class="rf-add"><button type="button" id="rfAdd">${icon("plus")}Add a question</button><span class="note">or add a ready-made one:</span>
        ${PRESETS.filter(p => !st.questions.some(q => q.label === p.label)).map((p, i) => `<button type="button" class="soft small" data-preset="${PRESETS.indexOf(p)}">${esc(p.label)}</button>`).join("")}</div>`;
    $$("[data-std]", box).forEach(b => b.onclick = () => { st.fields[b.dataset.std] = b.dataset.v; draw(); });
    $$(".rf-q", box).forEach(row => { const q = st.questions[Number(row.dataset.i)];
      $$("[data-k]", row).forEach(inp => inp.oninput = inp.onchange = () => { const k = inp.dataset.k;
        q[k] = k === "required" ? inp.checked : k === "options" ? inp.value.split("\n") : inp.value; if (k === "type") draw(); });
      $("[data-rm]", row).onclick = () => { st.questions.splice(Number(row.dataset.i), 1); draw(); };
      $$("[data-mv]", row).forEach(b => b.onclick = () => { const i = Number(row.dataset.i), j = i + Number(b.dataset.mv); [st.questions[i], st.questions[j]] = [st.questions[j], st.questions[i]]; draw(); }); });
    $("#rfAdd", box).onclick = () => { st.questions.push({id: newId(), label: "", label_ar: "", type: "text", required: false, options: []}); draw(); $$(".rf-q [data-k=label]", box).at(-1)?.focus(); };
    $$("[data-preset]", box).forEach(b => b.onclick = () => { st.questions.push({id: newId(), ...JSON.parse(JSON.stringify(PRESETS[Number(b.dataset.preset)]))}); draw(); });
  };
  draw();
}
