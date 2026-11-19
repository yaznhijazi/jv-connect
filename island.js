// Island: a pill at the top of every conference page. When someone registers from the desk QR, or sends a fix for their
// certificate name or email, it opens on its own with the details and the actions, so the desk never leaves the page it is on.
// Two looks: navy for a new registration, plum for a detail change.
import {SB, $, esc, state, can, icon, flag, toast, initials} from "./core.js";
import {approve, dupOf, link, review, waited, fetchEdits, approveEdit, declineEdit, editLines} from "./register.js";

const POLL = 6000;
let last = "", shown = null, box = null, confId = null, ctx = null, timer = null, queue = [], seen = new Set(), skipped = new Set(), open = false, busy = false, first = true;

// Start watching a conference (called on every conference page); stop on any other page.
export function watch(id, c){
  ctx = c;
  if (confId === id && timer) return draw();
  stop(); confId = id; first = true; seen = new Set(); skipped = new Set(); queue = []; open = false;
  if (!can("edit")) return;
  box = document.body.appendChild(Object.assign(document.createElement("div"), {className: "isl", hidden: true}));
  box.setAttribute("role", "region"); box.setAttribute("aria-label", "New registrations"); box.setAttribute("aria-live", "polite");
  poll(); timer = setInterval(poll, POLL);
}
export function stop(){ last = ""; shown = null; clearInterval(timer); timer = null; box?.remove(); box = null; confId = null; }

async function poll(){
  if (busy || document.visibilityState !== "visible" || !confId) return;
  const id = confId, [{ data: regs, error }, edits] = await Promise.all([
    SB.from("registrations").select("*").eq("conference_id", id).eq("status", "pending").order("created_at").limit(50), fetchEdits(id)]);
  if (error || id !== confId) return;
  // one queue, oldest first; _t says which kind
  const data = [...regs.map(r => ({...r, _t: "reg"})), ...edits.map(r => ({...r, _t: "edit"}))].sort((x, y) => x.created_at < y.created_at ? -1 : 1);
  const fresh = data.filter(r => !seen.has(r.id));
  data.forEach(r => seen.add(r.id));
  queue = data;
  if (fresh.length && !first) { open = true; skipped = new Set([...skipped].filter(x => !fresh.some(r => r.id === x))); }
  first = false;
  draw();
}

const onRegPage = () => /\/register$/.test(location.hash);
function draw(){
  if (!box) return;
  const live = queue.filter(r => !skipped.has(r.id)), r = live[0];
  // The Registrations page already lists everyone, so the island steps aside there.
  if (!queue.length || onRegPage()) { box.hidden = true; shown = null; return; }
  box.hidden = false;
  if (box.querySelector(".armed")) return; // keep "Tap again to confirm" until it is tapped or times out
  if (!open || !r) {
    shown = null;
    // Compact: a black capsule, like the iPhone's. Left: what's waiting; right: how many.
    const nR = queue.filter(x => x._t === "reg").length, nE = queue.length - nR, first = queue.find(x => !skipped.has(x.id)) || queue[0];
    const who = first._t === "edit" ? c0(first)?.full_name || first.code : first.full_name;
    return put("isl", `<button type="button" class="isl-pill" data-isl="open" aria-label="Open: ${nR} new registrations, ${nE} detail changes">
      <span class="isl-mini ${first._t === "edit" ? "ed" : ""}" aria-hidden="true">${esc(initials(who))}</span>
      <span class="isl-pt">${!r ? "All skipped" : nR && nE ? "Waiting at the desk" : nR ? `New registration${nR === 1 ? "" : "s"}` : `Detail change${nE === 1 ? "" : "s"}`}</span>
      ${nR ? `<span class="isl-n">${nR}</span>` : ""}${nE ? `<span class="isl-n ed">${nE}</span>` : ""}</button>`);
  }
  const c = state.c, pos = queue.indexOf(r) + 1;
  // The card springs open only when a new person comes up, not on every refresh.
  const pop = shown !== r.id; shown = r.id;
  const top = (label, ed) => `<div class="isl-top"><span class="isl-dot ${ed ? "ed" : ""}"></span><span>${label}</span>${queue.length > 1 ? `<span class="isl-sep">·</span><span class="num">${pos} of ${queue.length}</span>` : ""}
      <span class="isl-sep">·</span><span>${esc(waited(r.created_at))}</span><button type="button" class="isl-x" data-isl="min" aria-label="Minimise">${icon("down", "ic sm")}</button></div>`;
  if (r._t === "edit") {
    const a = c0(r);
    return put("isl open", `<div class="isl-card edit${pop ? " pop" : ""}">${top("Detail change", true)}
      <div class="isl-row"><div class="isl-who"><span class="isl-av ed" aria-hidden="true">${esc(initials(a?.full_name || r.code))}</span><span class="isl-txt"><b dir="auto">${esc(a?.full_name || "")}</b><span>ID <span class="num">${esc(r.code)}</span>${a?.category ? " · " + esc(a.category) : ""}</span></span></div>
        <div class="isl-round"><button type="button" class="isl-r no" data-isl="decline" aria-label="Decline" title="Decline">${icon("x")}</button><button type="button" class="isl-r ok ed" data-isl="approve" aria-label="Approve change" title="Approve change">${icon("check")}</button></div></div>
      <div class="isl-diff">${editLines(r).map(([k, o, n]) => `<div><small>${esc(k)}</small><s dir="auto">${esc(o)}</s><b dir="auto">${esc(n)}</b></div>`).join("")}</div>
      <div class="isl-caps"><button type="button" class="isl-cap" data-isl="skip">Skip</button></div></div>`, pop);
  }
  const d = c && dupOf(c, r);
  put("isl open", `<div class="isl-card${pop ? " pop" : ""}">${top("New registration")}
    <div class="isl-row"><button type="button" class="isl-who" data-isl="edit" title="Check and edit the details"><span class="isl-av" aria-hidden="true">${esc(initials(r.full_name))}</span><span class="isl-txt"><b dir="auto">${esc(r.full_name)}</b>
      <span>${[r.category && esc(r.category), r.entity && esc(r.entity), r.country && `${flag(r.country)}${esc(r.country)}`].filter(Boolean).join(" · ") || "No other details"}</span></span></button>
      <div class="isl-round"><button type="button" class="isl-r no" data-isl="decline" aria-label="Decline" title="Decline">${icon("x")}</button><button type="button" class="isl-r ok" data-isl="print" aria-label="Add and print badge" title="Add and print badge">${icon("print")}</button></div></div>
    ${d ? `<div class="isl-dup"><p>${icon("alert", "ic sm")}Looks like <b>${esc(d.code)} ${esc(d.full_name)}</b>, already registered</p>
      <div class="isl-caps"><button type="button" class="isl-cap" data-isl="link">Same person, link</button><button type="button" class="isl-cap warn" data-isl="linkprint">${icon("print", "ic sm")}Link and print</button></div></div>` : ""}
    <div class="isl-caps"><button type="button" class="isl-cap" data-isl="skip">Skip</button><button type="button" class="isl-cap" data-isl="add">${icon("check", "ic sm")}Add without printing</button></div></div>`, pop);
}
const c0 = r => state.c?.attendees.find(x => x.id === r.attendee_id);
// Round buttons can't hold "Tap again to confirm", so the first tap turns the red circle into a capsule that says "Decline?".
function sure(b, fn){
  if (b.classList.contains("armed")) return fn();
  const was = b.innerHTML; b.classList.add("armed"); b.textContent = "Decline?";
  setTimeout(() => { if (!document.contains(b)) return; b.classList.remove("armed"); b.innerHTML = was; }, 3000);
}
function put(cls, html, force = false){
  if (!force && html.replace(" pop", "") === last.replace(" pop", "") && box.className === cls) return;
  last = html; box.className = cls; box.innerHTML = html;
}

addEventListener("hashchange", () => setTimeout(draw, 0));
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-isl]"); if (!b || !box?.contains(b)) return;
  const k = b.dataset.isl, r = queue.filter(x => !skipped.has(x.id))[0];
  if (k === "open") { if (!r) skipped.clear(); open = true; return draw(); }
  if (k === "min") { open = false; return draw(); }
  if (!r || busy) return;
  if (k === "skip") { skipped.add(r.id); return draw(); }
  if (r._t === "edit") {
    if (k === "approve") return act(r, () => approveEdit(r, {reload: async () => {}}));
    if (k === "decline") return sure(b, () => act(r, () => declineEdit(r, {reload: async () => {}})));
    return;
  }
  if (k === "edit") return review(state.c, r, {reload: done(r)});
  if (k === "decline") return sure(b, () => act(r, async () => {
    const { error } = await SB.from("registrations").update({status: "rejected", decided_at: new Date().toISOString()}).eq("id", r.id);
    if (error) throw error; toast(`${r.full_name} declined`); }));
  if (k === "link" || k === "linkprint") { const a = dupOf(state.c, r); if (a) return act(r, () => link(state.c, r, a, {reload: async () => {}}, {print: k === "linkprint"})); }
  if (k === "add" || k === "print") return act(r, () => approve(state.c, [r], {reload: async () => {}}, {print: k === "print"}));
});
// Take the request off the island, then refresh the conference so IDs, counts and lists follow.
const done = r => async () => { queue = queue.filter(x => x.id !== r.id); skipped.delete(r.id); draw(); await ctx?.reload(); };
async function act(r, fn){
  busy = true; box?.querySelectorAll("button").forEach(x => x.disabled = true);
  try { if (await fn() === false) return; await done(r)(); }
  catch (err) { toast(err.message || "That didn't work. Try again.", "bad"); }
  finally { busy = false; last = ""; draw(); }
}
