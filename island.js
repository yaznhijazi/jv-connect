// New-registration island: a pill at the top of every conference page. When someone registers from the desk QR it opens
// on its own with their details and four actions, so the desk never has to leave the page it is on.
import {SB, $, esc, state, can, icon, flag, armed, toast} from "./core.js";
import {approve, dupOf, review, waited} from "./register.js";

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
  const id = confId, { data, error } = await SB.from("registrations").select("*").eq("conference_id", id).eq("status", "pending").order("created_at").limit(50);
  if (error || id !== confId) return;
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
    return put("isl", `<button type="button" class="isl-pill" data-isl="open"><span class="isl-dot"></span><b>${queue.length}</b> new registration${queue.length === 1 ? "" : "s"}${!r ? ", all skipped" : ""}</button>`);
  }
  const c = state.c, d = c && dupOf(c, r), pos = queue.indexOf(r) + 1;
  // The card springs open only when a new person comes up, not on every refresh.
  const pop = shown !== r.id; shown = r.id;
  put("isl open", `<div class="isl-card${pop ? " pop" : ""}">
    <div class="isl-top"><span class="isl-dot"></span><span class="isl-count">New registration${queue.length > 1 ? ` ${pos} of ${queue.length}` : ""}</span><span class="isl-wait">${esc(waited(r.created_at))}</span>
      <button type="button" class="isl-x" data-isl="min" aria-label="Minimise">${icon("down", "ic sm")}</button></div>
    <button type="button" class="isl-who" data-isl="edit" title="Check and edit the details"><b dir="auto">${esc(r.full_name)}</b>
      <span>${[r.category && esc(r.category), r.entity && esc(r.entity), r.country && `${flag(r.country)}${esc(r.country)}`, r.phone && `<span class="num">${esc(r.phone)}</span>`].filter(Boolean).join(" · ") || "No other details"}</span></button>
    ${d ? `<p class="isl-dup">${icon("alert", "ic sm")}Looks like ${esc(d.code)} ${esc(d.full_name)}, already registered</p>` : ""}
    <div class="isl-acts"><button type="button" class="isl-b no" data-isl="decline">Decline</button><button type="button" class="isl-b" data-isl="skip">Skip</button>
      <button type="button" class="isl-b" data-isl="add">${icon("check", "ic sm")}Add</button><button type="button" class="isl-b go" data-isl="print">${icon("print", "ic sm")}Add and print</button></div></div>`, pop);
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
  if (k === "edit") return review(state.c, r, {reload: done(r)});
  if (k === "decline") return armed(b, () => act(r, async () => {
    const { error } = await SB.from("registrations").update({status: "rejected", decided_at: new Date().toISOString()}).eq("id", r.id);
    if (error) throw error; toast(`${r.full_name} declined`); }));
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
