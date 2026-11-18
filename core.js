// Shared pieces: data access, small helpers, dialogs, codes, and the per-conference data cache.
export const SB = supabase.createClient("https://vcysyduqorgnhihbihxy.supabase.co", "sb_publishable_37lZJr6FXwizba524tLclQ_awnw9kqT");
export const TZ = "Asia/Amman";

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
export const pad = n => String(n).padStart(2, "0");
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => ymd(new Date());
export const t5 = t => String(t || "").slice(0, 5);
export const hm = iso => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const dayOf = iso => ymd(new Date(iso));
export const dateObj = day => new Date(`${day}T12:00`);
export const dayShort = day => dateObj(day).toLocaleDateString("en-GB", {weekday: "short", day: "numeric", month: "short"});
export const dayLong = day => dateObj(day).toLocaleDateString("en-GB", {weekday: "long", day: "numeric", month: "long"});
export function dateRange(a, b){
  const A = dateObj(a), B = dateObj(b), mo = d => d.toLocaleDateString("en-GB", {month: "short"});
  if (a === b) return A.toLocaleDateString("en-GB", {day: "numeric", month: "short", year: "numeric"});
  if (A.getMonth() === B.getMonth() && A.getFullYear() === B.getFullYear()) return `${A.getDate()}–${B.getDate()} ${mo(B)} ${B.getFullYear()}`;
  return `${A.getDate()} ${mo(A)} – ${B.getDate()} ${mo(B)} ${B.getFullYear()}`;
}
export const daysBetween = (a, b) => { const out = []; for (let d = dateObj(a); ymd(d) <= b; d.setDate(d.getDate() + 1)) out.push(ymd(d)); return out; };
export const startOf = s => new Date(`${s.day}T${t5(s.start_time)}`);
export const endOf = s => new Date(`${s.day}T${t5(s.end_time)}`);
export const initials = n => (n || "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
export const money = n => Number(n || 0).toLocaleString("en-GB", {minimumFractionDigits: 0, maximumFractionDigits: 2});
export const store = {
  get(k){ try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v){ try { localStorage.setItem(k, v); } catch {} },
};

export const state = {admin: false, role: null, session: null, confs: [], c: null};

/* ---------- access levels: owner > admin > staff > viewer. The database enforces them; the screens only hide what won't work. ---------- */
export const LEVELS = [["owner", "Owner", "Everything, including the team and deleting conferences"], ["admin", "Admin", "Everything except the team"],
  ["staff", "Staff", "Attendees, check-in, registrations, printing and certificates. No settings, fees or deleting"], ["viewer", "Viewer", "Sees everything and exports reports; changes nothing"]];
const RANK = {viewer: 0, staff: 1, admin: 2, owner: 3}, NEED = {view: 0, edit: 1, manage: 2, owner: 3};
export const can = need => (RANK[state.role] ?? -1) >= NEED[need];
export const levelName = r => LEVELS.find(l => l[0] === r)?.[1] || r;
// A blocked write comes back as a security error or as zero rows changed: say it in plain words.
export const deniedMsg = "Your access level doesn't allow this. Ask the owner if you need it.";

/* ---------- lists ---------- */
// Built-in countries: the region first (most attendees), then everyone else A–Z. A conference can edit its own copy in Settings.
const NEAR = ["Jordan", "Palestine", "Saudi Arabia", "Iraq", "Egypt", "United Arab Emirates", "Kuwait", "Qatar", "Bahrain", "Oman", "Lebanon", "Syria", "Yemen", "Libya", "Tunisia", "Algeria", "Morocco", "Sudan", "Turkey"];
const REST = ["Afghanistan", "Albania", "Andorra", "Angola", "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", "Bangladesh", "Belarus", "Belgium", "Bolivia", "Bosnia and Herzegovina", "Brazil",
  "Bulgaria", "Cambodia", "Cameroon", "Canada", "Chile", "China", "Colombia", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czechia", "Denmark", "Djibouti", "Dominican Republic", "Ecuador", "Eritrea", "Estonia",
  "Ethiopia", "Finland", "France", "Georgia", "Germany", "Ghana", "Greece", "Guatemala", "Hong Kong", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Ireland", "Italy", "Japan", "Kazakhstan", "Kenya",
  "Kyrgyzstan", "Latvia", "Lithuania", "Luxembourg", "Malaysia", "Maldives", "Malta", "Mauritania", "Mexico", "Moldova", "Monaco", "Mongolia", "Montenegro", "Nepal", "Netherlands", "New Zealand", "Nigeria",
  "North Macedonia", "Norway", "Pakistan", "Panama", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Romania", "Russia", "Senegal", "Serbia", "Singapore", "Slovakia", "Slovenia", "Somalia",
  "South Africa", "South Korea", "Spain", "Sri Lanka", "Sweden", "Switzerland", "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Turkmenistan", "Uganda", "Ukraine", "United Kingdom", "United States",
  "Uruguay", "Uzbekistan", "Venezuela", "Vietnam", "Zambia", "Zimbabwe"];
export const DEFAULT_COUNTRIES = [...NEAR, ...REST];
export const countriesOf = conf => conf.countries?.length ? conf.countries : DEFAULT_COUNTRIES;
// Flags are images: Windows shows flag emoji as two letters.
const ISO = Object.fromEntries(("Jordan=jo;Palestine=ps;Saudi Arabia=sa;Iraq=iq;Egypt=eg;United Arab Emirates=ae;Kuwait=kw;Qatar=qa;Bahrain=bh;Oman=om;Lebanon=lb;Syria=sy;" +
  "Yemen=ye;Libya=ly;Tunisia=tn;Algeria=dz;Morocco=ma;Sudan=sd;Turkey=tr;Afghanistan=af;Albania=al;Andorra=ad;Angola=ao;Argentina=ar;Armenia=am;Australia=au;Austria=at;" +
  "Azerbaijan=az;Bangladesh=bd;Belarus=by;Belgium=be;Bolivia=bo;Bosnia and Herzegovina=ba;Brazil=br;Bulgaria=bg;Cambodia=kh;Cameroon=cm;Canada=ca;Chile=cl;China=cn;" +
  "Colombia=co;Costa Rica=cr;Croatia=hr;Cuba=cu;Cyprus=cy;Czechia=cz;Denmark=dk;Djibouti=dj;Dominican Republic=do;Ecuador=ec;Eritrea=er;Estonia=ee;Ethiopia=et;Finland=fi;" +
  "France=fr;Georgia=ge;Germany=de;Ghana=gh;Greece=gr;Guatemala=gt;Hong Kong=hk;Hungary=hu;Iceland=is;India=in;Indonesia=id;Iran=ir;Ireland=ie;Italy=it;Japan=jp;" +
  "Kazakhstan=kz;Kenya=ke;Kyrgyzstan=kg;Latvia=lv;Lithuania=lt;Luxembourg=lu;Malaysia=my;Maldives=mv;Malta=mt;Mauritania=mr;Mexico=mx;Moldova=md;Monaco=mc;Mongolia=mn;" +
  "Montenegro=me;Nepal=np;Netherlands=nl;New Zealand=nz;Nigeria=ng;North Macedonia=mk;Norway=no;Pakistan=pk;Panama=pa;Paraguay=py;Peru=pe;Philippines=ph;Poland=pl;" +
  "Portugal=pt;Romania=ro;Russia=ru;Senegal=sn;Serbia=rs;Singapore=sg;Slovakia=sk;Slovenia=si;Somalia=so;South Africa=za;South Korea=kr;Spain=es;Sri Lanka=lk;Sweden=se;" +
  "Switzerland=ch;Taiwan=tw;Tajikistan=tj;Tanzania=tz;Thailand=th;Turkmenistan=tm;Uganda=ug;Ukraine=ua;United Kingdom=gb;United States=us;Uruguay=uy;Uzbekistan=uz;" +
  "Venezuela=ve;Vietnam=vn;Zambia=zm;Zimbabwe=zw;UAE=ae;KSA=sa;USA=us;UK=gb;Türkiye=tr;Czech Republic=cz;الأردن=jo;فلسطين=ps;السعودية=sa;العراق=iq;مصر=eg").split(";").map(p => p.split("=")));
const isoOf = name => ISO[String(name || "").trim()] || ISO[Object.keys(ISO).find(k => k.toLowerCase() === String(name || "").trim().toLowerCase())];
export const flag = name => { const c = isoOf(name);
  return c ? `<img class="flag" src="https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/flags/4x3/${c}.svg" alt="" width="20" height="15" loading="lazy" decoding="async">` : `<span class="flag none" aria-hidden="true"></span>`; };

// Country picker with flags and search. A plain <select> can only show text, so this is a button plus a searchable list.
// The value travels in a hidden input named `name`, so formData() picks it up like any field.
let cpickN = 0;
export function countryPicker(name, value, list, {label = "Country", empty = "No country"} = {}){
  const id = "cp" + ++cpickN, all = [...new Set([...(value && !list.includes(value) ? [value] : []), ...list])];
  const opt = (v, txt) => `<li role="option" id="${id}-${esc(v || "none")}" data-v="${esc(v)}" aria-selected="${v === (value || "")}">${v ? flag(v) : '<span class="flag none" aria-hidden="true"></span>'}<span>${esc(txt)}</span></li>`;
  return `<div class="cpick" data-cpick><span class="cpick-l" id="${id}-l">${label}</span><input type="hidden" name="${esc(name)}" value="${esc(value || "")}">
    <button type="button" class="cpick-btn" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="${id}-l ${id}-v"><span class="cpick-v" id="${id}-v">${value ? flag(value) + esc(value) : `<span class="muted">${esc(empty)}</span>`}</span>${icon("down", "ic sm")}</button>
    <div class="cpick-pop" hidden><input type="search" class="cpick-q" placeholder="Find a country" aria-label="Find a country" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="${id}-list">
      <ul role="listbox" id="${id}-list" aria-labelledby="${id}-l">${opt("", empty)}${all.map(v => opt(v, v)).join("")}</ul></div></div>`;
}
{
  const close = p => { if (!p) return; $(".cpick-pop", p).hidden = true; $(".cpick-btn", p).setAttribute("aria-expanded", "false"); };
  const open = p => { $$("[data-cpick]").forEach(x => x !== p && close(x)); const pop = $(".cpick-pop", p), q = $(".cpick-q", pop);
    pop.hidden = false; $(".cpick-btn", p).setAttribute("aria-expanded", "true"); q.value = ""; filter(p, ""); q.focus();
    $('[aria-selected="true"]', pop)?.scrollIntoView({block: "nearest"}); };
  const items = p => $$("li", p).filter(li => !li.hidden);
  const filter = (p, q) => { q = q.trim().toLowerCase(); $$("li", p).forEach(li => li.hidden = !!q && !li.textContent.toLowerCase().includes(q)); mark(p, items(p)[q ? 0 : -1] || null); };
  const mark = (p, li) => { $$("li.on", p).forEach(x => x.classList.remove("on")); if (li) { li.classList.add("on"); li.scrollIntoView({block: "nearest"}); $(".cpick-q", p).setAttribute("aria-activedescendant", li.id); } };
  const pick = (p, li) => { const v = li.dataset.v; $("input[type=hidden]", p).value = v;
    $$("li", p).forEach(x => x.setAttribute("aria-selected", x === li)); $(".cpick-v", p).innerHTML = v ? flag(v) + esc(v) : `<span class="muted">${li.textContent}</span>`;
    close(p); $(".cpick-btn", p).focus(); $("input[type=hidden]", p).dispatchEvent(new Event("change", {bubbles: true})); };
  document.addEventListener("click", e => {
    const p = e.target.closest("[data-cpick]");
    $$("[data-cpick]").forEach(x => x !== p && close(x));
    if (!p) return;
    if (e.target.closest(".cpick-btn")) return $(".cpick-pop", p).hidden ? open(p) : close(p);
    const li = e.target.closest("li"); if (li) pick(p, li);
  });
  document.addEventListener("input", e => { if (e.target.matches(".cpick-q")) filter(e.target.closest("[data-cpick]"), e.target.value); });
  document.addEventListener("keydown", e => {
    const p = e.target.closest?.("[data-cpick]"); if (!p) return;
    if (e.target.matches(".cpick-btn") && /^(ArrowDown|Enter| )$/.test(e.key)) { e.preventDefault(); return open(p); }
    if (!e.target.matches(".cpick-q")) return;
    const list = items(p), at = list.indexOf($("li.on", p));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); mark(p, list[Math.max(0, Math.min(list.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))]); }
    else if (e.key === "Enter") { e.preventDefault(); const li = $("li.on", p) || list[0]; if (li) pick(p, li); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(p); $(".cpick-btn", p).focus(); }
    else if (e.key === "Tab") close(p);
  }, true);
}
// Category list = the conference's list, plus any category already used by an attendee (so nothing disappears).
export const categoriesOf = c => [...new Set([...(c.conf.categories || []), ...c.attendees.map(a => a.category).filter(Boolean)])];
// Tags on attendees ("Workshop", "Gala dinner"…): the ones in use, plus a few suggestions. Each tag keeps one colour everywhere.
export const TAG_SUGGESTIONS = ["Workshop", "Gala dinner", "VIP", "Speaker dinner", "Sponsor guest"];
export const tagsUsed = c => [...new Set(c.attendees.flatMap(a => a.tags || []))].sort((a, b) => a.localeCompare(b));
export const tagsOf = c => [...new Set([...tagsUsed(c), ...TAG_SUGGESTIONS])];
export const tagChip = t => { let h = 0; for (const ch of String(t)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return `<span class="tagc" style="--tc:var(--h${h % 6 + 1})">${esc(t)}</span>`; };
export const cleanTag = t => String(t || "").replace(/\s+/g, " ").trim().slice(0, 40);
// A <select> that always keeps the current value, even if it isn't in the list any more.
export const selectOptions = (list, cur, empty = "Choose…") =>
  `<option value="">${esc(empty)}</option>` + [...new Set([...(cur && !list.includes(cur) ? [cur] : []), ...list])].map(v => `<option ${v === cur ? "selected" : ""}>${esc(v)}</option>`).join("");

// Supabase returns at most 1000 rows per request: the first page says how many there are, the rest load in parallel.
// `key` gives the pages a fixed order, so no row is skipped or repeated between pages.
export async function fetchAll(table, filter, key = "id"){
  const page = (from, count) => { let q = SB.from(table).select("*", count ? {count: "exact"} : undefined).range(from, from + 999);
    if (filter) q = filter(q); for (const k of key ? key.split(",") : []) q = q.order(k); return q; };
  const first = await page(0, true);
  if (first.error) throw first.error;
  const total = first.count ?? first.data.length;
  if (first.data.length < 1000 || total <= 1000) return first.data;
  const rest = await Promise.all(Array.from({length: Math.ceil(total / 1000) - 1}, (_, i) => page((i + 1) * 1000)));
  for (const r of rest) if (r.error) throw r.error;
  return first.data.concat(...rest.map(r => r.data));
}

/* ---------- conference data cache ---------- */
let inflight = null; // one download at a time per conference: quick clicks share it
export function loadConf(id, {force = false} = {}){
  if (!force && state.c?.conf.id === id) return Promise.resolve(state.c);
  if (!force && inflight?.id === id) return inflight.p;
  const p = fetchConf(id).finally(() => { if (inflight?.p === p) inflight = null; });
  inflight = {id, p};
  return p;
}
async function fetchConf(id){
  const by = q => q.eq("conference_id", id);
  const [confRes, halls, sessions, attendees, checkins, vouchers, layouts, regs] = await Promise.all([
    SB.from("conferences").select("*").eq("id", id).maybeSingle(),
    fetchAll("conf_halls", by), fetchAll("conf_sessions", by), fetchAll("attendees", by),
    fetchAll("conf_checkins", by), fetchAll("vouchers", by), fetchAll("print_layouts", by, ""),
    fetchAll("registrations", q => by(q).eq("status", "pending").order("created_at")),
  ]);
  if (confRes.error) throw confRes.error;
  if (!confRes.data) throw new Error("This conference doesn't exist or was deleted.");
  const uses = vouchers.length ? await fetchAll("voucher_uses", q => q.in("voucher_id", vouchers.map(v => v.id)), "voucher_id,attendee_id") : [];
  state.c = index({conf: confRes.data, halls, sessions, attendees, checkins, vouchers, uses, layouts, regs});
  return state.c;
}
export function index(c){
  c.halls.sort((a, b) => a.sort - b.sort || (b.capacity ?? 0) - (a.capacity ?? 0) || a.name.localeCompare(b.name));
  c.hallById = new Map(c.halls.map(h => [h.id, h]));
  c.hallRank = new Map(c.halls.map((h, i) => [h.id, i]));
  c.sessions.sort((a, b) => (a.day + a.start_time).localeCompare(b.day + b.start_time) || a.title.localeCompare(b.title));
  c.sessionById = new Map(c.sessions.map(s => [s.id, s]));
  c.byCode = new Map(c.attendees.map(a => [a.code, a]));
  c.checkinsBySession = new Map();
  c.checkinsByCode = new Map();
  for (const k of c.checkins) {
    (c.checkinsBySession.get(k.session_id) || c.checkinsBySession.set(k.session_id, []).get(k.session_id)).push(k);
    (c.checkinsByCode.get(k.code) || c.checkinsByCode.set(k.code, []).get(k.code)).push(k);
  }
  c.usesByVoucher = new Map();
  for (const u of c.uses) (c.usesByVoucher.get(u.voucher_id) || c.usesByVoucher.set(u.voucher_id, []).get(u.voucher_id)).push(u);
  return c;
}
export const hallColor = (c, hallId) => { const i = c.hallRank.get(hallId); return i == null ? "var(--muted)" : `var(--h${i % 6 + 1})`; };
export const hallName = (c, hallId) => c.hallById.get(hallId)?.name || "No hall";

/* ---------- icons (24px line icons, drawn with currentColor) ---------- */
const ICONS = {
  overview: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  program: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h3M8 17h6"/>',
  attendees: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
  scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M7 12h10"/>',
  vouchers: '<path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z"/><path d="M14 5v2M14 11v2M14 17v2"/>',
  print: '<path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7" rx="1"/>',
  reports: '<path d="M3 21h18M6 17V11M11 17V6M16 17v-4M21 17V8"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h12"/>', home: '<path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  check: '<path d="m5 12 5 5L20 7"/>', money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  live: '<circle cx="12" cy="12" r="2.5"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4M9.2 9.2a4 4 0 0 0 0 5.6M14.8 9.2a4 4 0 0 1 0 5.6"/>',
  award: '<circle cx="12" cy="9" r="6"/><path d="m8.5 14.2-1.5 7.3 5-2.8 5 2.8-1.5-7.3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7M14 11a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>', download: '<path d="M12 4v12M7 11l5 5 5-5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
};
export const icon = (name, cls = "ic") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;

/* ---------- UI helpers ---------- */
let toastT;
export function toast(msg, kind = ""){
  if (/row-level security|permission denied|42501/i.test(msg)) msg = deniedMsg; // a blocked write, said plainly
  const t = $("#toast"); t.textContent = msg; t.className = "toast " + kind; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, kind === "bad" ? 5000 : 2600);
}
// A dialog with a form. onSubmit(form) may return false to keep it open.
// need / dangerNeed: the level required to save / to use the danger button. Below it the form is read-only.
export function dialog({title, body, submit = "Save", danger = "", onSubmit, onDanger, wide = false, drawer = false, need = "view", dangerNeed = need}){
  const readOnly = !can(need);
  if (readOnly) { submit = ""; body = `<p class="note ro-note">${icon("alert", "ic sm")}You can look but not change this. Ask the owner if you need to.</p>${body}`; }
  if (!can(dangerNeed)) danger = "";
  const d = $("#dlg");
  d.style.width = wide && !drawer ? "min(900px, calc(100% - 32px))" : "";
  d.classList.toggle("drawer", drawer); // side panel on wide screens, bottom sheet on phones
  d.innerHTML = `<form method="dialog" class="form" style="display:contents">
    <div class="dlg-head"><h2>${esc(title)}</h2><button type="button" class="ghost small" data-close>Close</button></div>
    <div class="dlg-body form">${body}</div>
    <div class="dlg-foot">${danger ? `<button type="button" class="danger" data-danger style="margin-right:auto">${esc(danger)}</button>` : ""}
      <button type="button" class="ghost" data-close>Cancel</button>${submit ? `<button type="submit">${esc(submit)}</button>` : ""}</div></form>`;
  const form = $("form", d);
  $$("[data-close]", d).forEach(b => b.onclick = () => d.close());
  const dz = $("[data-danger]", d);
  if (dz) dz.onclick = () => armed(dz, async () => { if (await onDanger?.() !== false) d.close(); });
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = $("button[type=submit]", d); if (btn) btn.disabled = true;
    try { if (await onSubmit?.(form) !== false) d.close(); }
    catch (err) { toast(err.message || String(err), "bad"); }
    finally { if (btn) btn.disabled = false; }
  };
  // Read-only: the boxes can't be changed, but buttons like "Badge PDF" still work.
  if (readOnly) $$(".dlg-body input, .dlg-body select, .dlg-body textarea, .dlg-body .cpick-btn", d).forEach(x => { x.disabled = true; });
  d.showModal();
  setTimeout(() => $("input:not(:disabled),select:not(:disabled),textarea:not(:disabled)", d)?.focus(), 30);
  return d;
}
// Two-step delete: first click arms, second click (within 3 s) confirms.
export function armed(btn, fn){
  if (btn.classList.contains("armed")) return fn();
  const label = btn.textContent; btn.classList.add("armed"); btn.textContent = "Tap again to confirm";
  setTimeout(() => { btn.classList.remove("armed"); btn.textContent = label; }, 3000);
}
export const formData = form => Object.fromEntries(new FormData(form).entries());

// CSV that opens cleanly in Excel: UTF-8 BOM (Arabic names) and IDs like 0427 kept with their zero.
export function downloadCsv(name, header, rows){
  const q = v => { const t = String(v ?? ""); return /^0\d+$/.test(t) ? `"=""${t}"""` : `"${t.replace(/"/g, '""')}"`; };
  const csv = [header, ...rows].map(r => r.map(q).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], {type: "text/csv"}));
  a.download = name.replace(/[^\w.-]+/g, "-") + ".csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);

export function loadScript(src){
  if ($(`script[src="${src}"]`)?.dataset.ready) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = $(`script[src="${src}"]`) || document.head.appendChild(Object.assign(document.createElement("script"), {src}));
    s.addEventListener("load", () => { s.dataset.ready = "1"; res(); }); s.addEventListener("error", () => rej(new Error("A part of the page couldn't load. Check the connection.")));
  });
}

// Uploads go to the public "conference-files" bucket (admin only can write).
export async function upload(file, folder){
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) throw new Error("Use a PNG, JPG or WebP image.");
  if (file.size > 8e6) throw new Error("That image is over 8 MB. Use a smaller one.");
  const path = `${folder}/${Date.now()}-${slug(file.name.replace(/\.\w+$/, "")) || "image"}.${file.type.split("/")[1].replace("jpeg", "jpg")}`;
  const { error } = await SB.storage.from("conference-files").upload(path, file, {upsert: true, contentType: file.type});
  if (error) throw error;
  return SB.storage.from("conference-files").getPublicUrl(path).data.publicUrl;
}

/* ---------- badge codes ---------- */
// QR holds only the attendee's main ID; scanners look up the rest.
export function qrSvg(text){
  const q = qrcode(0, "M"); q.addData(String(text)); q.make();
  return q.createSvgTag({cellSize: 4, margin: 0, scalable: true});
}
export function barcodeSvg(text, {height = 60, displayValue = false} = {}){
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  try { JsBarcode(el, String(text), {format: "CODE128", height, margin: 0, displayValue, width: 2, background: "transparent"}); }
  catch { return ""; }
  el.setAttribute("preserveAspectRatio", "none");
  return el.outerHTML;
}

/* ---------- sounds / vibration for scanners ---------- */
let actx = null;
export const soundState = {on: store.get("sound") !== "off"};
const audio = () => { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); } catch {} return actx; };
["pointerdown", "keydown", "touchend"].forEach(ev => addEventListener(ev, audio, {once: true, passive: true}));
function tone(f, at, dur, type = "sine", vol = .2){
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + at;
  o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .01); g.gain.exponentialRampToValueAtTime(.001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + .05);
}
const SOUND = {ok: () => { tone(784, 0, .14); tone(1175, .11, .28); }, warn: () => { tone(587, 0, .12, "triangle"); tone(587, .18, .12, "triangle"); }, bad: () => tone(180, 0, .4, "square", .1)};
export const playSound = kind => { if (soundState.on) SOUND[kind]?.(); };
let flashT;
export function flash(kind, tag, title, sub){
  // Full-screen camera open: show the result in place so the camera keeps running between badges.
  const inCam = document.querySelector("#camMode:not([hidden]) .cam-result");
  if (inCam) {
    inCam.className = "cam-result " + kind; inCam.innerHTML = `<b>${kind === "ok" ? "✓" : kind === "warn" ? "!" : "✕"} ${esc(title)}</b><span>${esc(tag)}${sub ? ". " + esc(sub) : ""}</span>`;
    playSound(kind); navigator.vibrate?.(kind === "ok" ? 70 : [160, 80, 160]); return;
  }
  const f = $("#flash");
  f.className = "flash " + kind;
  f.innerHTML = `<div class="mark">${kind === "ok" ? "✓" : kind === "warn" ? "!" : "✕"}</div><div class="tag">${esc(tag)}</div><b>${esc(title)}</b><span>${esc(sub)}</span><small style="opacity:.7">Tap anywhere to continue</small>`;
  f.hidden = false; clearTimeout(flashT); flashT = setTimeout(() => f.hidden = true, kind === "ok" ? 1300 : 2600);
  if (soundState.on) SOUND[kind]?.();
  navigator.vibrate?.(kind === "ok" ? 70 : [160, 80, 160]);
}
document.addEventListener("click", e => { if (e.target.closest("#flash")) $("#flash").hidden = true; });
