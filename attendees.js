// Attendees: search, filter, add / edit / remove, import from Excel or CSV, badges and certificates.
import {SB, $, $$, esc, hm, dayShort, t5, money, initials, toast, dialog, armed, formData, downloadCsv, slug, loadScript, qrSvg, barcodeSvg, hallName,
  categoriesOf, countriesOf, selectOptions, today, startOf, endOf, state, icon, flag, countryPicker, can, store, tagsOf, tagsUsed, tagChip, cleanTag, loadConf} from "./core.js";
import {printDocs, certPdf, certKind, workshopsOf} from "./print.js";
import {badgeUrl} from "./register.js";
import {emailMain, emailMany, mainSent, hasMail, emailWorkshops} from "./certs.js";
import {formOf, questionInput, answersFrom} from "./regform.js";

let syncT = null;
export const view = {q: "", category: "", country: "", tag: "", pay: "", sort: store.get("attSort") || "id", show: 200, sel: new Set()}; // ID order by default; the last choice is remembered
const FIELDS = [["code", "Main ID"], ["full_name", "Full name"], ["cert_name", "Name on certificate"], ["phone", "Phone"], ["email", "Email"],
  ["category", "Category"], ["entity", "Entity"], ["country", "Country"], ["fee_amount", "Fee (JOD)"], ["fee_paid", "Paid"], ["fee_note", "Fee note"]];

// Next free 4-digit ID (0001, 0002, …), based on the highest numeric ID so far.
// The next free number at or after the conference's first badge ID (Settings); IDs below it are left alone.
export const nextCode = c => { const start = Number(c.conf.id_start) || 1;
  const n = Math.max(start - 1, ...c.attendees.map(a => /^\d+$/.test(a.code) && Number(a.code) >= start ? Number(a.code) : 0)) + 1; return String(n).padStart(4, "0"); };
const attendedCount = (c, a) => (c.checkinsByCode.get(a.code) || []).length;
const options = (list, cur, all) => `<option value="">${all}</option>` + [...new Set(list.filter(Boolean))].sort().map(v => `<option ${v === cur ? "selected" : ""}>${esc(v)}</option>`).join("");

// Quick filters shown as chips with live counts. `pay` holds the chosen chip (name kept so Overview links still work).
const QUICK = [["", "Everyone", () => true], ["unpaid", "Not paid", a => !a.fee_paid && Number(a.fee_amount) > 0], ["paid", "Paid", a => a.fee_paid && Number(a.fee_amount) > 0],
  ["new", "Badge not printed", a => !a.badge_printed_at], ["nocat", "No category", a => !a.category], ["absent", "Not seen yet", (a, c) => !c.checkinsByCode.has(a.code)]];
const SORTS = {name: (a, b) => a.full_name.localeCompare(b.full_name), id: (a, b) => a.code.localeCompare(b.code, undefined, {numeric: true}),
  new: (a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))};
function filtered(c){
  const q = view.q.trim().toLowerCase(), quick = (QUICK.find(x => x[0] === view.pay) || QUICK[0])[2];
  return c.attendees.filter(a => (!view.category || a.category === view.category) && (!view.country || a.country === view.country) && (!view.tag || (a.tags || []).includes(view.tag)) && quick(a, c)
    && (!q || [a.code, a.full_name, a.cert_name, a.phone, a.email, a.entity].some(v => String(v ?? "").toLowerCase().includes(q))))
    .sort(SORTS[view.sort] || SORTS.name);
}

export function render(el, c, ctx){
  const list = filtered(c);
  for (const id of view.sel) if (!c.attendees.some(a => a.id === id)) view.sel.delete(id);
  const sel = c.attendees.filter(a => view.sel.has(a.id));
  const narrowed = view.q || view.category || view.country || view.tag || view.pay, nFilt = [view.category, view.country, view.tag].filter(Boolean).length, used = tagsUsed(c);
  el.innerHTML = `<div class="att-top">
      <div class="chips" role="group" aria-label="Quick filters">${QUICK.map(([k, l, fn]) => { const n = c.attendees.filter(a => fn(a, c)).length;
        return (k && !n) ? "" : `<button type="button" class="chip" data-quick="${k}" aria-pressed="${view.pay === k}">${l}<span>${n}</span></button>`; }).join("")}</div>
      <div class="att-acts"><button type="button" class="ghost small" id="aPaste" title="Paste a list of names">${icon("plus")}<span>Paste a list</span></button><button type="button" class="ghost small" id="aImport" title="Import">${icon("upload")}<span>Import</span></button><button type="button" class="ghost small" id="aExport" title="Export">${icon("download")}<span>Export${sel.length ? ` ${sel.length}` : ""}</span></button>
        <button type="button" class="small fab" id="aAdd" aria-label="Add attendee">${icon("plus")}<span>Add attendee</span></button></div></div>
    <div class="panel att-panel">
    <div class="toolbar"><label class="search-field" style="max-width:none">${icon("search")}<input type="search" id="aQ" placeholder="Name, ID, phone or email" value="${esc(view.q)}" aria-label="Search attendees"></label>
      <button type="button" class="ghost filt-btn" id="aFilt" aria-expanded="${!!view.filtersOpen}">${icon("settings")}${nFilt ? `<span class="dot">${nFilt}</span>` : ""}<span class="sr-only">Filters</span></button>
      <div class="att-filters ${view.filtersOpen ? "open" : ""}">
      <select id="aCat" aria-label="Category">${options(categoriesOf(c), view.category, "All categories")}</select>
      <select id="aCountry" aria-label="Country">${options(c.attendees.map(a => a.country), view.country, "All countries")}</select>
      ${used.length ? `<select id="aTag" aria-label="Tag">${options(used, view.tag, "All tags")}</select>` : ""}
      <select id="aSort" aria-label="Sort"><option value="name">Sort by name</option><option value="id" ${view.sort === "id" ? "selected" : ""}>Sort by ID</option><option value="new" ${view.sort === "new" ? "selected" : ""}>Newest first</option></select></div></div>
    <div class="att-meta"><span>${list.length === c.attendees.length ? `${c.attendees.length} attendee${c.attendees.length === 1 ? "" : "s"}` : `${list.length} of ${c.attendees.length} shown`}</span>
      ${narrowed ? `<button type="button" class="linkish" id="aClear">Clear filters</button>` : ""}</div>
    ${sel.length ? `<div class="bulkbar"><span>${sel.length} selected</span><span style="flex:1"></span>
      <button type="button" class="ghost small" data-bulk="badge">${icon("print")}Badges</button><button type="button" class="ghost small" data-bulk="badgetext" title="Only the names, for cards that already have the design">${icon("print")}Badges, text only</button><button type="button" class="ghost small" data-bulk="certificate">${icon("print")}Certificates</button><button type="button" class="ghost small" data-bulk="mailcert">${icon("mail")}Email certificates</button>
      <button type="button" class="ghost small" data-bulk="tag">${icon("tag")}Tag</button><button type="button" class="ghost small" data-bulk="paid">Mark paid</button><button type="button" class="ghost small" data-bulk="unpaid">Mark not paid</button>
      <button type="button" class="danger small" data-bulk="delete">Delete</button><button type="button" class="ghost small" data-bulk="clear" aria-label="Clear selection">${icon("x")}</button></div>` : ""}
    <div class="tbl"><table class="rt att"><thead><tr><th class="sel"><input type="checkbox" id="aAll" aria-label="Select all shown" ${list.length && list.every(a => view.sel.has(a.id)) ? "checked" : ""}></th>
      <th>Attendee</th><th>ID</th><th>Category</th><th>Entity and country</th><th>Fee</th><th>Sessions</th><th class="sr">Open</th></tr></thead><tbody>
      ${list.slice(0, view.show).map(a => { const n = attendedCount(c, a), fee = Number(a.fee_amount);
        return `<tr data-open="${a.id}" tabindex="0" class="${view.sel.has(a.id) ? "on" : ""}"><td class="sel"><input type="checkbox" data-sel="${a.id}" ${view.sel.has(a.id) ? "checked" : ""} aria-label="Select ${esc(a.full_name)}"></td>
        <td class="main" data-l="Attendee"><div class="person"><span class="av">${esc(initials(a.full_name))}</span><span style="min-width:0"><b>${esc(a.full_name)}</b><span class="sub">${esc(a.email || a.phone || "No contact details")}</span></span></div></td>
        <td data-l="ID"><span class="idtag num">${esc(a.code)}</span>${a.badge_printed_at ? "" : '<span class="sub">Badge not printed</span>'}</td>
        <td data-l="Category"><div class="cat-tags">${a.category ? `<span class="pill">${esc(a.category)}</span>` : (a.tags || []).length ? "" : '<span class="muted">—</span>'}${(a.tags || []).map(tagChip).join("")}${sentPills(c, a)}</div></td>
        <td data-l="Entity and country" data-ec="${esc([a.entity, a.country].filter(Boolean).join(", "))}"><span class="clip">${esc(a.entity) || '<span class="muted">No entity</span>'}</span><span class="sub">${a.country ? `${flag(a.country)} ${esc(a.country)}` : ""}</span></td>
        <td data-l="Fee">${fee ? `<span class="pill ${a.fee_paid ? "ok" : "warn"}">${money(fee)} JOD, ${a.fee_paid ? "paid" : "not paid"}</span>` : '<span class="muted">Free</span>'}</td>
        <td data-l="Sessions" class="num">${n ? `<span class="att-n">${icon("check", "ic sm")}${n}</span>` : '<span class="muted">None</span>'}</td>
        <td class="actions">${icon("chevron", "ic sm")}</td></tr>`; }).join("")
      || `<tr><td colspan="8"><div class="empty-state">${icon(c.attendees.length ? "search" : "attendees", "ic lg")}<h2>${c.attendees.length ? "Nobody matches" : "No attendees yet"}</h2>
          <p style="margin:0">${c.attendees.length ? "Try another search, or clear the filters." : "Add people one by one, import the registration sheet, or open registration from a desk QR code."}</p>
          ${c.attendees.length ? `<button type="button" class="ghost" data-clear2>Clear filters</button>` : `<div class="row" style="justify-content:center"><button type="button" data-add2>${icon("plus")}Add attendee</button><button type="button" class="ghost" data-imp2>${icon("upload")}Import Excel</button></div>`}</div></td></tr>`}</tbody></table></div>
    ${list.length > view.show ? `<div style="text-align:center;margin-top:12px"><button type="button" class="ghost" id="aMore">Show ${Math.min(200, list.length - view.show)} more</button></div>` : ""}</div>`;

  const rerender = () => render(el, c, ctx);
  // Live list: when someone else on the team adds or removes a person, the list (and the search) picks it up within seconds.
  // Only a count and the newest row are checked; the full reload happens only when they change. Typing in the search box is kept.
  clearInterval(syncT); const n0 = c.attendees.length, last0 = c.attendees.reduce((m, a) => a.created_at > m ? a.created_at : m, "");
  syncT = setInterval(async () => {
    if (!document.contains(el)) return clearInterval(syncT);
    if (document.visibilityState !== "visible" || $("dialog[open]")) return;
    const [{ count }, { data: top }] = await Promise.all([SB.from("attendees").select("id", {count: "exact", head: true}).eq("conference_id", c.conf.id),
      SB.from("attendees").select("created_at").eq("conference_id", c.conf.id).order("created_at", {ascending: false}).limit(1)]);
    if (count == null || (count === n0 && (top?.[0]?.created_at || "") <= last0) || !document.contains(el)) return;
    clearInterval(syncT);
    const box = $("#aQ"), typing = document.activeElement === box, pos = typing ? [box.selectionStart, box.selectionEnd] : null, y = scrollY;
    if (box) view.q = box.value;
    const fresh = await loadConf(c.conf.id, {force: true});
    if (!document.contains(el) || $("dialog[open]")) return;
    render(el, fresh, ctx); scrollTo(0, y);
    if (pos) { $("#aQ").focus(); $("#aQ").setSelectionRange(...pos); }
  }, 8000);
  let qT; $("#aQ").oninput = e => { clearTimeout(qT); qT = setTimeout(() => { view.q = e.target.value; view.show = 200; rerender(); $("#aQ").focus(); $("#aQ").setSelectionRange(9999, 9999); }, 200); };
  $("#aCat").onchange = e => { view.category = e.target.value; rerender(); };
  $("#aCountry").onchange = e => { view.country = e.target.value; rerender(); };
  $("#aTag") && ($("#aTag").onchange = e => { view.tag = e.target.value; view.show = 200; rerender(); });
  $("#aSort").onchange = e => { view.sort = e.target.value; store.set("attSort", view.sort); rerender(); };
  $("#aFilt").onclick = () => { view.filtersOpen = !view.filtersOpen; rerender(); };
  $$("[data-quick]", el).forEach(b => b.onclick = () => { view.pay = b.dataset.quick; view.show = 200; rerender(); });
  const clear = () => { Object.assign(view, {q: "", category: "", country: "", tag: "", pay: "", show: 200}); rerender(); };
  $("#aClear") && ($("#aClear").onclick = clear); $("[data-clear2]", el) && ($("[data-clear2]", el).onclick = clear);
  $("#aMore") && ($("#aMore").onclick = () => { view.show += 200; rerender(); });
  $("#aAll").onchange = e => { list.forEach(a => e.target.checked ? view.sel.add(a.id) : view.sel.delete(a.id)); rerender(); };
  $$("[data-sel]", el).forEach(b => { b.onclick = e => e.stopPropagation(); b.onchange = () => { b.checked ? view.sel.add(b.dataset.sel) : view.sel.delete(b.dataset.sel); rerender(); }; });
  $$("td.sel", el).forEach(td => td.onclick = e => e.stopPropagation());
  $$("tr[data-open]", el).forEach(tr => { const open = () => personDialog(c, c.attendees.find(a => a.id === tr.dataset.open), ctx);
    tr.onclick = open; tr.onkeydown = e => { if (e.key === "Enter") open(); }; });
  $("#aAdd").onclick = () => personDialog(c, null, ctx);
  $("[data-add2]", el) && ($("[data-add2]", el).onclick = () => personDialog(c, null, ctx));
  const qs = formOf(c.conf).questions;
  $("#aExport").onclick = () => downloadCsv(`attendees-${slug(c.conf.name)}`, [...FIELDS.map(f => f[1]), "Tags", "Sessions attended", ...qs.map(q => q.label)],
    (sel.length ? sel : list).map(a => [...FIELDS.map(([k]) => k === "fee_paid" ? (a.fee_paid ? "Yes" : "No") : a[k]), (a.tags || []).join(", "), attendedCount(c, a), ...qs.map(q => (a.answers || {})[q.id] || "")]));
  $("#aImport").onclick = () => importDialog(c, ctx);
  $("#aPaste").onclick = () => pasteDialog(c, ctx);
  $("[data-imp2]", el) && ($("[data-imp2]", el).onclick = () => importDialog(c, ctx));
  $$("[data-bulk]", el).forEach(b => b.onclick = async () => {
    const k = b.dataset.bulk, ids = sel.map(a => a.id);
    if (k === "clear") { view.sel.clear(); return rerender(); }
    if (k === "badge" || k === "certificate") return printDocs(c, k, sel);
    if (k === "badgetext") return printDocs(c, "badge", sel, {full: false}); // pre-printed cards: no design, just the text
    if (k === "tag") return tagDialog(c, sel, ctx);
    if (k === "mailcert") { const to = sel.filter(hasMail);
      if (!to.length) return toast("None of them has an email.", "bad");
      return armed(b, async () => { b.disabled = true;
        const r = await emailMany(c, to, {onStep: (i, n) => { b.textContent = `Sending ${i + 1} of ${n}…`; }});
        toast(`${r.ok} certificate${r.ok === 1 ? "" : "s"} emailed${r.skipped ? `, ${r.skipped} already had theirs` : ""}${to.length < sel.length ? `, ${sel.length - to.length} had no email` : ""}${r.bad.length ? `, ${r.bad.length} not sent` : ""}`, r.bad.length ? "bad" : "");
        await ctx.reload(); }); }
    if (k === "paid" || k === "unpaid") { const { error } = await SB.from("attendees").update({fee_paid: k === "paid"}).in("id", ids); if (error) return toast(error.message, "bad"); toast(`${ids.length} marked ${k === "paid" ? "paid" : "not paid"}`); return ctx.reload(); }
    if (k === "delete") return armed(b, async () => { const { error } = await SB.from("attendees").delete().in("id", ids); if (error) return toast(error.message, "bad"); view.sel.clear(); toast(`${ids.length} deleted`); ctx.reload(); });
  });
}

/* ---------- tags ---------- */
// Tick the tags this person has; type a new one to create it.
export function tagPicker(c, cur){
  const all = [...new Set([...cur, ...tagsOf(c)])];
  return `<div class="tag-pick">${all.map(t => `<label class="tag-opt"><input type="checkbox" name="tag" value="${esc(t)}" ${cur.includes(t) ? "checked" : ""}>${tagChip(t)}</label>`).join("")}
    <input name="tagNew" maxlength="40" placeholder="New tag" aria-label="New tag" class="tag-new"></div>`;
}
export const tagsFrom = form => { const fd = new FormData(form); return [...new Set([...fd.getAll("tag"), fd.get("tagNew")].map(cleanTag).filter(Boolean))].slice(0, 20); };
function tagDialog(c, people, ctx){
  const d = dialog({need: "edit", title: `Tag ${people.length} ${people.length === 1 ? "person" : "people"}`, submit: "Add tag", danger: "Remove tag", dangerNeed: "edit",
    body: `<label>Tag<input name="t" list="tdTags" maxlength="40" required placeholder="Workshop" autocomplete="off"></label><datalist id="tdTags">${tagsOf(c).map(t => `<option value="${esc(t)}">`).join("")}</datalist>
      <div class="tag-pick">${tagsOf(c).map(t => `<button type="button" class="tag-btn" data-t="${esc(t)}">${tagChip(t)}</button>`).join("")}</div>
      <p class="note" style="margin:0">Pick a tag or type a new one. "Remove tag" takes it off everyone selected.</p>`,
    onSubmit: async form => save(cleanTag(form.t.value), true),
    onDanger: async () => save(cleanTag($("[name=t]", d).value), false)});
  $$("[data-t]", d).forEach(b => b.onclick = () => { $("[name=t]", d).value = b.dataset.t; });
  async function save(t, add){
    if (!t) { toast("Pick or type a tag first.", "bad"); return false; }
    const todo = people.filter(a => add !== (a.tags || []).includes(t));
    for (let i = 0; i < todo.length; i += 25)
      await Promise.all(todo.slice(i, i + 25).map(a => SB.from("attendees").update({tags: add ? [...(a.tags || []), t] : (a.tags || []).filter(x => x !== t)}).eq("id", a.id).then(r => { if (r.error) throw r.error; })));
    toast(add ? `Tagged ${todo.length} with “${t}”` : `Removed “${t}” from ${todo.length}`); view.sel.clear(); await ctx.reload();
  }
}

/* ---------- right after adding: the next thing you usually want ---------- */
export function quickActions(c, a, ctx){
  const d = dialog({title: "Added", submit: "",
    body: `<div class="qa-done"><span class="qa-tick">${icon("check")}</span><div><b>${esc(a.full_name)}</b><span>is in, with badge ID</span></div><b class="qa-id num">${esc(a.code)}</b></div>
      <div class="qa-grid">
        <button type="button" class="qx big" data-qa-do="print">${icon("print")}<span><b>Print badge</b><small>Text only, on the pre-printed card</small></span></button>
        <button type="button" class="qx" data-qa-do="pdf">${icon("download")}<span><b>Badge PDF</b><small>To send on WhatsApp</small></span></button>
        <button type="button" class="qx" data-qa-do="link">${icon("link")}<span><b>Copy phone badge link</b><small>Their badge on their phone</small></span></button>
        <button type="button" class="qx" data-qa-do="open">${icon("user")}<span><b>Open their details</b><small>Check in, certificate, fees</small></span></button>
        <button type="button" class="qx" data-qa-do="another">${icon("plus")}<span><b>Add another</b><small>Next free ID ${esc(nextCode(c))}</small></span></button></div>`});
  $$("[data-qa-do]", d).forEach(b => b.onclick = async () => {
    const k = b.dataset.qaDo;
    if (k === "print") { d.close(); return printDocs(c, "badge", [a], {full: false}); } // pre-printed cards: just the text
    if (k === "pdf") { b.disabled = true; try { const url = URL.createObjectURL(await certPdf(c, [{...a, cert_name: a.cert_name || a.full_name}], {kind: "badge"}));
      Object.assign(document.createElement("a"), {href: url, download: `Badge ${a.code} - ${a.full_name}.pdf`}).click(); setTimeout(() => URL.revokeObjectURL(url), 4000); } catch (err) { toast(err.message, "bad"); } b.disabled = false; return; }
    if (k === "link") return navigator.clipboard.writeText(badgeUrl(c.conf.id, a.code)).then(() => toast("Link copied. Send it to them on WhatsApp."), () => toast("Couldn't copy the link.", "bad"));
    d.close();
    if (k === "open") return personDialog(c, c.attendees.find(x => x.id === a.id) || a, ctx);
    if (k === "another") return personDialog(c, null, ctx);
  });
}
// Names pasted straight from WhatsApp, Excel or a document: one per line; numbering and "[time] Name:" chat prefixes are removed.
export const cleanNames = text => String(text || "").split(/\r?\n/)
  .map(l => l.replace(/^\s*\[[^\]]*\]\s*[^:]{0,60}:\s*/, "").replace(/^\s*\d+\s*[-.)]\s+/, "").replace(/\s+/g, " ").trim())
  .filter(l => l.length >= 2 && /\p{L}/u.test(l))
  .map(l => l === l.toUpperCase() && /[A-Z]/.test(l) ? l.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, p, ch) => p + ch.toUpperCase()) : l);
function pasteDialog(c, ctx){
  const cats = categoriesOf(c);
  const d = dialog({wide: true, need: "edit", title: "Paste a list of names", submit: "Add them",
    body: `<p class="note" style="margin:0">One name per line, straight from WhatsApp, Excel or a document. Numbers, times and sender names from chats are removed; names in CAPITALS are tidied.</p>
      <textarea id="plText" rows="8" placeholder="Huda Ahmed Saleh&#10;Ramzi Ahmed Alwan" aria-label="Names, one per line"></textarea>
      <div class="form-grid"><label>Category for all<select name="category">${selectOptions(cats, cats.includes("Participant") ? "Participant" : "", "No category")}</select></label>
        ${countryPicker("country", "", countriesOf(c.conf), {label: "Country for all"})}</div>
      <label>Tag for all (optional)<input name="tag" list="plTags" maxlength="40" placeholder="Workshop"></label><datalist id="plTags">${tagsOf(c).map(t => `<option value="${esc(t)}">`).join("")}</datalist>
      <label class="check"><input type="checkbox" name="skipDup" checked> Skip names already registered</label>
      <div id="plPrev" class="pl-prev" aria-live="polite"></div>`,
    onSubmit: async form => {
      const list = plan(); if (!list.add.length) { toast("Paste at least one new name.", "bad"); return false; }
      const f = formData(form), rows = list.add.map(x => ({conference_id: c.conf.id, code: "", full_name: x.name, category: f.category || "", country: f.country || "", fee_amount: 0, fee_paid: false, fee_note: "Added from a pasted list", ...(cleanTag(f.tag) ? {tags: [cleanTag(f.tag)]} : {})}));
      const { data: made, error } = await SB.from("attendees").insert(rows).select();
      if (error) throw error;
      await ctx.reload();
      setTimeout(() => { const people = made.map(m => state.c.attendees.find(x => x.id === m.id) || m).sort((x, y) => x.code.localeCompare(y.code, undefined, {numeric: true}));
        const q = dialog({title: `${people.length} added`, submit: "", body: `<p style="margin:0">IDs <b class="num">${esc(people[0]?.code)}</b> to <b class="num">${esc(people.at(-1)?.code)}</b>.</p>
          <div class="qa-grid"><button type="button" class="qx big" id="plPrint">${icon("print")}<span><b>Print their ${people.length} badges</b><small>One print job</small></span></button>
            <button type="button" class="qx" id="plPdf">${icon("download")}<span><b>Badges as one PDF</b><small>To send or print later</small></span></button></div>`});
        $("#plPrint", q).onclick = () => { q.close(); printDocs(state.c, "badge", people); };
        $("#plPdf", q).onclick = async e => { e.currentTarget.disabled = true; try { const url = URL.createObjectURL(await certPdf(state.c, people.map(x => ({...x, cert_name: x.cert_name || x.full_name})), {kind: "badge"}));
          Object.assign(document.createElement("a"), {href: url, download: `Badges ${people[0].code}-${people.at(-1).code}.pdf`}).click(); setTimeout(() => URL.revokeObjectURL(url), 4000); } catch (err) { toast(err.message, "bad"); } e.currentTarget.disabled = false; };
      }, 50);
    }});
  const plan = () => {
    const names = [...new Set(cleanNames($("#plText", d).value))], skip = $("[name=skipDup]", d).checked;
    const have = new Map(c.attendees.map(a => [a.full_name.trim().toLowerCase(), a]));
    let n = Number(nextCode(c)); const add = [], dup = [];
    for (const name of names) { const was = have.get(name.toLowerCase()); if (was && skip) dup.push({name, was}); else add.push({name, code: String(n++).padStart(4, "0"), was}); }
    return {add, dup};
  };
  const prev = () => { const {add, dup} = plan();
    $("#plPrev", d).innerHTML = (add.length ? `<p class="note" style="margin:0 0 6px"><b>${add.length}</b> will be added, IDs <b class="num">${add[0].code}</b> to <b class="num">${add.at(-1).code}</b>.</p><ol class="pl-list">${add.map(x => `<li><b class="num">${x.code}</b> ${esc(x.name)}${x.was ? ` <span class="pill warn">same name as ${esc(x.was.code)}</span>` : ""}</li>`).join("")}</ol>` : "")
      + (dup.length ? `<p class="note" style="margin:8px 0 0">${dup.length} already registered, skipped: ${dup.map(x => `${esc(x.name)} (${esc(x.was.code)})`).join(", ")}</p>` : "");
    $("button[type=submit]", d).textContent = add.length ? `Add ${add.length}` : "Add them"; };
  $("#plText", d).oninput = prev; $("[name=skipDup]", d).onchange = prev; prev();
}

/* ---------- one attendee ---------- */
export function openPerson(c, a, ctx){ return personDialog(c, a, ctx); }
function personDialog(c, a, ctx){
  const rf = formOf(c.conf);
  const checks = a ? (c.checkinsByCode.get(a.code) || []).map(k => ({k, s: c.sessionById.get(k.session_id)})).filter(x => x.s).sort((x, y) => x.k.at.localeCompare(y.k.at)) : [];
  const vouchers = a ? c.vouchers.map(v => ({v, use: (c.usesByVoucher.get(v.id) || []).find(u => u.attendee_id === a.id)})) : [];
  // Sessions offered for a manual check-in: running now first, then the rest of today, then everything else.
  const now = new Date(), inIds = new Set(checks.map(x => x.s.id)), rank = s => now >= startOf(s) && now <= endOf(s) ? 0 : s.day === today() ? 1 : 2;
  const pickable = c.sessions.filter(s => !inIds.has(s.id)).sort((x, y) => rank(x) - rank(y) || startOf(x) - startOf(y));
  const d = dialog({drawer: true, need: "edit", dangerNeed: "manage", title: a ? "Attendee" : "Add attendee", submit: a ? "Save changes" : "Add attendee", danger: a ? "Delete attendee" : "",
    body: `${a ? `<div class="p-head"><span class="av lg">${esc(initials(a.full_name))}</span><div style="min-width:0"><b>${esc(a.full_name)}</b>
        <div class="p-tags"><span class="pill acc num">ID ${esc(a.code)}</span>${a.category ? `<span class="pill">${esc(a.category)}</span>` : ""}
        ${Number(a.fee_amount) ? `<span class="pill ${a.fee_paid ? "ok" : "warn"}">${a.fee_paid ? "Paid" : "Not paid"} ${money(a.fee_amount)} JOD</span>` : ""}${sentPills(c, a)}</div></div></div>
      <div class="p-actions"><button type="button" class="ghost small" data-print="badge">${icon("print")}Badge</button><button type="button" class="ghost small" data-print="badge" data-text="1">${icon("print")}Badge, text only</button><button type="button" class="ghost small" data-print="certificate" data-full="1">${icon("print")}Certificate</button><button type="button" class="ghost small" data-print="certificate" data-text="1" title="Only the text, for certificate paper that already has the design">${icon("print")}Certificate, text only</button><button type="button" class="ghost small" data-pdf="badge">${icon("download")}Badge PDF</button><button type="button" class="ghost small" data-pdf="certificate">${icon("download")}Certificate PDF</button>${hasMail(a) ? `<button type="button" class="ghost small" data-mailcert title="${mainSent(a) ? `Sent ${esc(dayShort(mainSent(a).at.slice(0, 10)))} to ${esc(mainSent(a).email)}` : `To ${esc(a.email)}`}">${icon("mail")}${mainSent(a) ? "Email certificate again" : certKind(c, a) === "appreciation" ? "Email appreciation certificate" : "Email attendance certificate"}</button>` : ""}${wsFor(c, a).length ? `<button type="button" class="ghost small" data-wspdf>${icon("download")}Workshop certificate${wsFor(c, a).length > 1 ? "s" : ""} PDF</button>` : ""}${wsFor(c, a).length && hasMail(a) ? (() => { const all = wsFor(c, a).every(w => (a.cert_sent || {})[w.id]);
          return `<button type="button" class="ghost small" data-mailws title="To ${esc(a.email)}">${icon("mail")}${all ? "Email workshop certificates again" : `Email workshop certificate${wsFor(c, a).length > 1 ? "s" : ""}`}</button>`; })() : ""}
        ${Number(a.fee_amount) ? `<button type="button" class="ghost small" data-paytoggle>${icon("money")}${a.fee_paid ? "Mark not paid" : "Mark paid"}</button>` : ""}</div>
      ${pickable.length ? `<div class="p-checkin"><select id="pSess" aria-label="Session">${pickable.slice(0, 60).map(s => `<option value="${s.id}">${rank(s) === 0 ? "Live: " : ""}${esc(dayShort(s.day))} ${t5(s.start_time)}, ${esc(s.title)}</option>`).join("")}</select>
        <button type="button" class="soft small" id="pCheck">${icon("check")}Check in</button></div>` : ""}` : ""}
      <fieldset class="fs"><legend>${icon("user")}Person</legend><div class="form-grid">
        <label>Full name<input name="full_name" required maxlength="200" value="${esc(a?.full_name)}" placeholder="As it should appear on the badge" autocomplete="off"></label>
        <label>Name on certificate<input name="cert_name" maxlength="200" value="${esc(a?.cert_name)}" placeholder="Same as full name if empty" autocomplete="off"></label>
        <label>Badge ID<input name="code" required pattern="[A-Za-z0-9\\-]{1,32}" title="Letters, numbers and dashes only, up to 32" maxlength="32" value="${esc(a?.code ?? nextCode(c))}" ${a ? "" : `data-auto="${esc(nextCode(c))}"`} class="num" autocomplete="off">
          ${a ? "" : '<small class="hint">The next free ID. Change it if the badge is already printed.</small>'}</label>
        <label>Category<select name="category">${selectOptions(categoriesOf(c), a?.category || "", "No category")}</select></label></div></fieldset>
      <fieldset class="fs"><legend>${icon("link")}Contact</legend><div class="form-grid">
        <label>Phone<input name="phone" type="tel" inputmode="tel" maxlength="40" value="${esc(a?.phone)}" placeholder="+962 7…" autocomplete="off"></label>
        <label>Email<input name="email" type="email" maxlength="200" value="${esc(a?.email)}" placeholder="For the certificate" autocomplete="off"></label>
        <label>Entity<input name="entity" list="entList" maxlength="200" value="${esc(a?.entity)}" placeholder="Hospital, university, company"></label>
        ${countryPicker("country", a?.country || "", countriesOf(c.conf))}</div></fieldset>
      <fieldset class="fs"><legend>${icon("tag")}Tags</legend>${tagPicker(c, a?.tags || [])}</fieldset>
      ${rf.questions.length ? `<fieldset class="fs"><legend>${icon("tag")}Registration answers</legend><div class="form-grid">${rf.questions.map(q => questionInput({...q, required: false}, (a?.answers || {})[q.id] || "")).join("")}</div></fieldset>` : ""}
      <fieldset class="fs" ${can("manage") ? "" : "disabled"}><legend>${icon("money")}Fee${can("manage") ? "" : ' <span class="note" style="font-weight:500">only owners and admins change fees</span>'}</legend><div class="fee-row">
        <label>Amount (JOD)<input name="fee_amount" type="number" min="0" step="0.01" inputmode="decimal" value="${a ? Number(a.fee_amount) : 0}" class="num"></label>
        <label class="check fee-paid"><input type="checkbox" name="fee_paid" ${a?.fee_paid ? "checked" : ""}> Paid</label>
        <label class="fee-note">Note<input name="fee_note" maxlength="200" value="${esc(a?.fee_note)}" placeholder="Receipt number, sponsor…"></label></div></fieldset>
      <p class="note" style="margin:0">Categories and countries come from this conference's lists. Edit them in Settings.</p>
      ${datalist("entList", c.attendees.map(x => x.entity))}
      ${a ? `<div class="codes"><div style="width:120px;height:120px">${qrSvg(a.code)}</div><div style="width:200px;height:70px">${barcodeSvg(a.code)}</div>
          <div style="color:#0b2533"><b style="font-size:22px;letter-spacing:.08em">${esc(a.code)}</b><div class="note">QR code and barcode both hold this ID.</div>
            <button type="button" class="ghost small" data-badgelink="${esc(badgeUrl(c.conf.id, a.code))}" style="margin-top:6px">${icon("link")}Copy phone badge link</button></div></div>
        <div class="p-history"><div><h3>Sessions attended (${checks.length})</h3><ul style="margin:8px 0 0;padding-left:18px;display:grid;gap:4px;font-size:14px">${checks.map(({k, s}) =>
            `<li>${esc(s.title)} <span class="note">${dayShort(s.day)} ${t5(s.start_time)}, ${esc(hallName(c, s.hall_id))}, ${k.source === "notebook" ? "from notebook" : "in at " + hm(k.at) + (k.late ? ", late" : "")}</span></li>`).join("") || '<li class="note">None yet</li>'}</ul></div>
          <div><h3>Vouchers</h3><ul style="margin:8px 0 0;padding-left:18px;display:grid;gap:4px;font-size:14px">${vouchers.map(({v, use}) =>
            `<li>${esc(v.name)}: ${use ? `<span class="pill bad">Used ${dayShort(use.used_at.slice(0, 10))} ${hm(use.used_at)}${use.used_by ? " by " + esc(use.used_by) : ""}</span>` : '<span class="pill ok">Not used</span>'}</li>`).join("") || '<li class="note">No vouchers set up</li>'}</ul></div></div>` : ""}`,
    onSubmit: async form => {
      const f = formData(form);
      const row = {conference_id: c.conf.id, code: f.code.trim(), full_name: f.full_name.trim(), cert_name: f.cert_name.trim(), phone: f.phone.trim(), email: f.email.trim(),
        category: f.category.trim(), entity: f.entity.trim(), country: f.country.trim(), fee_amount: Number(f.fee_amount || 0), fee_paid: !!f.fee_paid, fee_note: (f.fee_note || "").trim()};
      if (!can("manage")) { delete row.fee_amount; delete row.fee_paid; delete row.fee_note; } // staff: fees stay as they are (the database checks this too)
      row.tags = tagsFrom(form);
      if (rf.questions.length) { const ans = {...(a?.answers || {})}; for (const q of rf.questions) delete ans[q.id]; row.answers = {...ans, ...answersFrom(rf, form)}; }
      // Left at the suggested ID: the database hands out the next free one, so two desks adding at once never collide.
      if (!a && row.code === form.code.dataset.auto) row.code = "";
      const clash = row.code && c.attendees.find(x => x.code === row.code && x.id !== a?.id);
      if (clash) { toast(`ID ${row.code} already belongs to ${clash.full_name}.`, "bad"); return false; }
      const { data: made, error } = a ? await SB.from("attendees").update(row).eq("id", a.id).select().maybeSingle() : await SB.from("attendees").insert(row).select().single();
      if (error) throw error;
      if (a && a.code !== row.code) await SB.from("conf_checkins").update({code: row.code}).eq("conference_id", c.conf.id).eq("code", a.code); // keep history with the new ID
      if (a) { toast("Saved"); await ctx.reload(); return; }
      await ctx.reload(); setTimeout(() => quickActions(state.c, state.c.attendees.find(x => x.id === made?.id) || {...row, ...made}, ctx), 50);
    },
    onDanger: async () => { const { error } = await SB.from("attendees").delete().eq("id", a.id); if (error) throw error; toast("Attendee deleted"); await ctx.reload(); }});
  $$("[data-print]", d).forEach(b => b.onclick = () => printDocs(c, b.dataset.print, [a], b.dataset.text ? {full: false} : b.dataset.full ? {full: true} : {}));
  $("[data-mailws]", d) && ($("[data-mailws]", d).onclick = async e => { const b = e.currentTarget; b.disabled = true; toast(`Emailing the workshop certificates to ${a.email}…`);
    const r = await emailWorkshops(c, a); b.disabled = false;
    if (r.error) return toast(r.error, "bad");
    toast(`${r.count} workshop certificate${r.count === 1 ? "" : "s"} emailed to ${a.email}`); b.lastChild.textContent = "Email workshop certificates again"; });
  $("[data-mailcert]", d) && ($("[data-mailcert]", d).onclick = async e => { const b = e.currentTarget; b.disabled = true; toast(`Emailing the certificate to ${a.email}…`);
    const r = await emailMain(c, a); b.disabled = false;
    if (r.error) return toast(r.error, "bad");
    toast(`Certificate emailed to ${a.email}`); b.lastChild.textContent = "Email certificate again"; });
  // Digital copies: the badge, or the certificate (attendance or appreciation, by category), as a PDF file to send.
  $$("[data-pdf]", d).forEach(b => b.onclick = async () => {
    const badge = b.dataset.pdf === "badge"; b.disabled = true; toast("Making the PDF…");
    try {
      const url = URL.createObjectURL(await certPdf(c, [{...a, cert_name: a.cert_name || a.full_name}], badge ? {kind: "badge"} : {}));
      const what = badge ? `Badge ${a.code}` : certKind(c, a) === "appreciation" ? "Certificate of Appreciation" : "Certificate of Attendance";
      Object.assign(document.createElement("a"), {href: url, download: `${what} - ${a.cert_name || a.full_name}.pdf`}).click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) { toast(err.message || "The PDF couldn't be made.", "bad"); }
    b.disabled = false;
  });
  // Workshop certificates: one page per workshop this person is tagged for, in the workshop design.
  $$("[data-wspdf]", d).forEach(b => b.onclick = async () => {
    b.disabled = true; toast("Making the PDF…");
    try {
      const name = a.cert_name || a.full_name;
      const url = URL.createObjectURL(await certPdf(c, wsFor(c, a).map(w => ({...a, cert_name: name, session_title: w.title, session_day: w.day})), {kind: "workshop"}));
      Object.assign(document.createElement("a"), {href: url, download: `Workshop certificates - ${name}.pdf`}).click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) { toast(err.message || "The PDF couldn't be made.", "bad"); }
    b.disabled = false;
  });
  $$("[data-badgelink]", d).forEach(b => b.onclick = () => navigator.clipboard.writeText(b.dataset.badgelink).then(() => toast("Link copied. Send it to the attendee on WhatsApp."), () => toast("Couldn't copy the link.", "bad")));
  const pt = $("[data-paytoggle]", d);
  if (pt) pt.onclick = async () => { const { error } = await SB.from("attendees").update({fee_paid: !a.fee_paid}).eq("id", a.id); if (error) return toast(error.message, "bad");
    toast(a.fee_paid ? "Marked not paid" : "Marked paid"); d.close(); await ctx.reload(); openPerson(state.c, state.c.attendees.find(x => x.id === a.id), ctx); };
  const pc = $("#pCheck", d);
  if (pc) pc.onclick = async () => { pc.disabled = true; const s = c.sessionById.get($("#pSess", d).value);
    const { data, error } = await SB.rpc("c_bulk_check_in", {p_session: s.id, p_codes: [a.code]});
    if (error || data?.status !== "ok") { pc.disabled = false; return toast("Not saved. Try again.", "bad"); }
    toast(`${a.full_name} checked in to “${s.title}”`); d.close(); await ctx.reload(); openPerson(state.c, state.c.attendees.find(x => x.id === a.id), ctx); };
}
const datalist = (id, vals) => `<datalist id="${id}">${[...new Set(vals.filter(Boolean))].sort().map(v => `<option value="${esc(v)}">`).join("")}</datalist>`;

/* ---------- names from a photo (Gemini, through the read-people function) ---------- */
// Phone photos are shrunk to 1800 px JPEG first: plenty for handwriting, and well under the upload limit.
const shrink = file => new Promise((ok, no) => { const img = new Image(); img.onload = () => {
  const k = Math.min(1, 1800 / Math.max(img.width, img.height)), cv = Object.assign(document.createElement("canvas"), {width: Math.round(img.width * k), height: Math.round(img.height * k)});
  cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(img.src); ok(cv.toDataURL("image/jpeg", .85).split(",")[1]); };
  img.onerror = () => no(new Error("That file isn't a photo this browser can open.")); img.src = URL.createObjectURL(file); });
async function readPhoto(c, ctx, d, file){
  const box = $("#photoPrev", d); box.innerHTML = '<p class="note">Reading the photo. This takes a few seconds…</p>';
  try {
    const { data, error } = await SB.functions.invoke("read-people", {body: {image: await shrink(file), mime: "image/jpeg", categories: categoriesOf(c)}});
    if (error) { let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch {} throw new Error(msg); }
    const people = data.people || [];
    if (!people.length) { box.innerHTML = '<p class="note">No names found in this photo. Try a sharper, straighter photo in good light.</p>'; return; }
    const known = new Set(c.attendees.map(a => a.full_name.trim().toLowerCase())), cats = categoriesOf(c);
    box.innerHTML = `<p class="note">${people.length} found. Untick anyone you don't want, fix spelling, then add them.</p><div class="photo-rows">${people.map((p, i) => { const dup = known.has(p.full_name.toLowerCase());
      return `<div class="row" data-pr="${i}"><input type="checkbox" ${dup ? "" : "checked"} aria-label="Add"><input data-k="full_name" value="${esc(p.full_name)}" aria-label="Name">
        <input data-k="phone" value="${esc(p.phone)}" placeholder="Phone" aria-label="Phone"><input data-k="entity" value="${esc(p.entity)}" placeholder="Entity" aria-label="Entity">
        <select data-k="category" aria-label="Category">${selectOptions(cats, cats.includes(p.category) ? p.category : "", "No category")}</select>${dup ? '<span class="pill warn">Already added</span>' : ""}</div>`; }).join("")}</div>
      <button type="button" id="photoGo" style="margin-top:12px">Add the ticked people</button>`;
    $("#photoGo", d).onclick = async ev => {
      const rows = $$("[data-pr]", d).filter(r => $("input[type=checkbox]", r).checked).map(r => { const p = people[Number(r.dataset.pr)], v = k => $(`[data-k=${k}]`, r).value.trim();
        return {conference_id: c.conf.id, code: "", full_name: v("full_name"), cert_name: "", phone: v("phone"), email: p.email, entity: v("entity"),
          category: v("category"), country: p.country, fee_amount: 0, fee_paid: false, fee_note: "From a photo"}; }).filter(r => r.full_name.length >= 2);
      if (!rows.length) return toast("Tick at least one person.", "bad");
      ev.target.disabled = true;
      const { data: made, error } = await SB.from("attendees").insert(rows).select("code");
      if (error) { ev.target.disabled = false; return toast(error.message, "bad"); }
      d.close(); toast(`${made.length} added, IDs ${made[0].code} to ${made.at(-1).code}`); ctx.reload();
    };
  } catch (err) { box.innerHTML = `<p style="color:var(--bad);font-weight:600">${esc(err.message || err)}</p>`; }
}

/* ---------- import from Excel / CSV ---------- */
// Column headers are matched loosely, in English or Arabic, so most registration sheets work as they are.
const HEADER = {
  code: /^(id|code|badge|badge ?(id|no|number)|reg(istration)? ?(id|no)|رقم|الرقم)$/i,
  full_name: /^(name|full ?name|attendee|participant|الاسم|الاسم الكامل)$/i,
  cert_name: /(certificate|cert).*name|name.*(certificate|cert)|اسم الشهادة/i,
  phone: /phone|mobile|tel|whats|الهاتف|الموبايل/i, email: /e-?mail|البريد/i,
  category: /category|type|role|الفئة/i, entity: /entity|organi[sz]ation|hospital|company|institution|university|employer|affiliation|الجهة/i,
  country: /country|nationality|الدولة|البلد/i, fee_amount: /fee|amount|price|paid amount|الرسوم|المبلغ/i, fee_paid: /^(paid|payment( status)?|status|مدفوع)$/i,
};
async function importDialog(c, ctx){
  const d = dialog({title: "Import attendees", submit: "",
    body: `<p class="note" style="margin:0">Choose an Excel (.xlsx) or CSV file with one attendee per row and a header row. Matching columns are found automatically: ID, Name, Name on certificate, Phone, Email, Category, Entity, Country, Fee, Paid.</p>
      <p class="note" style="margin:0">Rows with an ID that already exists update that attendee. Rows without an ID get the next free 4-digit ID.</p>
      <input type="file" id="impFile" accept=".xlsx,.xls,.csv,text/csv"><div id="impPrev"></div>
      <div class="panel" style="box-shadow:none;background:var(--surface-2)"><h3>${icon("sparkle")} Or read names from a photo</h3>
        <p class="note" style="margin:4px 0 10px">Take a photo of a handwritten sign-up sheet, a printed list or business cards. The names, phones and entities are read for you; check them before adding.</p>
        <input type="file" id="impPhoto" accept="image/*"><div id="photoPrev"></div></div>`});
  $("#impPhoto", d).onchange = e => e.target.files[0] && readPhoto(c, ctx, d, e.target.files[0]);
  $("#impFile", d).onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    $("#impPrev", d).innerHTML = '<p class="note">Reading the file…</p>';
    try {
      await loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
      const wb = XLSX.read(await file.arrayBuffer(), {type: "array"});
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval: "", raw: false});
      if (!raw.length) throw new Error("The first sheet is empty.");
      const cols = Object.keys(raw[0]), map = {};
      for (const [k, re] of Object.entries(HEADER)) { const col = cols.find(h => re.test(String(h).trim()) && !Object.values(map).includes(h)); if (col) map[k] = col; }
      if (!map.full_name) throw new Error(`No name column found. Columns in the file: ${cols.join(", ")}`);
      let next = Number(nextCode(c));
      const seen = new Set(), rows = [];
      for (const r of raw) {
        const name = String(r[map.full_name] ?? "").trim(); if (!name) continue;
        let code = String(map.code ? r[map.code] : "").trim().replace(/\s+/g, "");
        if (/^\d{1,3}$/.test(code)) code = code.padStart(4, "0");   // Excel drops leading zeros: 427 -> 0427
        if (!code || !/^[A-Za-z0-9-]{1,32}$/.test(code)) code = String(next++).padStart(4, "0");
        if (seen.has(code)) continue; seen.add(code);
        const val = k => map[k] ? String(r[map[k]] ?? "").trim() : "";
        rows.push({conference_id: c.conf.id, code, full_name: name, cert_name: val("cert_name"), phone: val("phone"), email: val("email"), category: val("category"),
          entity: val("entity"), country: val("country"), fee_amount: Number(String(val("fee_amount")).replace(/[^\d.]/g, "")) || 0,
          fee_paid: /^(yes|y|true|1|paid|نعم|مدفوع)$/i.test(val("fee_paid"))});
      }
      const updates = rows.filter(r => c.byCode.has(r.code)).length;
      $("#impPrev", d).innerHTML = `<div class="panel" style="box-shadow:none;margin-top:8px"><b>${rows.length} attendees found</b>: ${rows.length - updates} new, ${updates} updates to existing IDs.
        <p class="note">Columns used: ${Object.entries(map).map(([k, v]) => `${esc(FIELDS.find(f => f[0] === k)?.[1] || k)} ← “${esc(v)}”`).join(", ")}</p>
        <div class="tbl"><table><thead><tr><th>ID</th><th>Name</th><th>Category</th><th>Entity</th><th>Country</th></tr></thead><tbody>${rows.slice(0, 5).map(r => `<tr><td>${esc(r.code)}</td><td>${esc(r.full_name)}</td><td>${esc(r.category)}</td><td>${esc(r.entity)}</td><td>${esc(r.country)}</td></tr>`).join("")}</tbody></table></div>
        <button type="button" id="impGo" style="margin-top:12px">Import ${rows.length} attendees</button></div>`;
      $("#impGo", d).onclick = async ev => {
        ev.target.disabled = true;
        for (let i = 0; i < rows.length; i += 500) {
          ev.target.textContent = `Importing ${Math.min(i + 500, rows.length)} of ${rows.length}…`;
          const { error } = await SB.from("attendees").upsert(rows.slice(i, i + 500), {onConflict: "conference_id,code"});
          if (error) { toast(error.message, "bad"); ev.target.disabled = false; ev.target.textContent = "Try again"; return; }
        }
        const newCats = [...new Set(rows.map(r => r.category).filter(k => k && !(c.conf.categories || []).includes(k)))];
        if (newCats.length) await SB.from("conferences").update({categories: [...(c.conf.categories || []), ...newCats]}).eq("id", c.conf.id);
        d.close(); toast(`Imported ${rows.length} attendees${newCats.length ? `, added ${newCats.length} new categor${newCats.length > 1 ? "ies" : "y"}` : ""}`); ctx.reload();
      };
    } catch (err) { $("#impPrev", d).innerHTML = `<p style="color:var(--bad);font-weight:700">${esc(err.message || err)}</p>`; }
  };
}
// Labels for what the person already received by email: the main certificate and their workshop certificates.
const sentPills = (c, a) => { const s = a?.cert_sent || {}, ws = Object.keys(s).filter(k => k !== "main"), when = v => `${dayShort(String(v.at).slice(0, 10))} to ${v.email}`;
  const title = id => (c.conf.cert_self?.workshops || []).find(w => w.id === id)?.title || "Workshop";
  return (s.main ? `<span class="pill ok" title="Sent ${esc(when(s.main))}">${icon("check", "ic sm")}Certificate received</span>` : "")
    + (ws.length ? `<span class="pill ok" title="${esc(ws.map(id => `${title(id)}, ${when(s[id])}`).join("; "))}">${icon("check", "ic sm")}Workshop certificate${ws.length > 1 ? `s received (${ws.length})` : " received"}</span>` : ""); };
const wsFor = (c, a) => workshopsOf(c).filter(w => (a?.tags || []).includes(w.tag));
