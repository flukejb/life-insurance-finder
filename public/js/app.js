import {
  HEALTH_CLASSES, RATING_RANK, quote, valueScore, money, dime, maxTermForAge,
} from "/js/engine.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const DEFAULTS = { age: 45, gender: "m", smoker: false, health: "pp", type: "term", face: 500000, term: 20 };
const STORE_KEY = "lif.profile.v1";

const state = {
  profile: { ...DEFAULTS },
  filters: { aPlus: false, noExam: false, convertible: false, direct: false },
  sort: { key: "value", dir: -1 },
  selected: new Set(),
  expanded: new Set(),
  market: null, // { insurers, rates, fetchedAt, live }
  ladder: { edited: false, a: 0, b: 0, c: 0 },
  checklist: new Set(),
};

/* ---------- persistence ---------- */
function loadSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (saved?.profile) state.profile = { ...DEFAULTS, ...saved.profile };
    if (saved?.checklist) state.checklist = new Set(saved.checklist);
  } catch { /* storage unavailable */ }
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ profile: state.profile, checklist: [...state.checklist] }));
  } catch { /* storage unavailable */ }
}

/* ---------- data ---------- */
async function loadMarket({ manual = false } = {}) {
  const btn = $("#refreshBtn");
  btn.classList.add("busy");
  btn.disabled = true;
  setPill("loading", "Fetching live data…");
  try {
    const res = await fetch(`/api/market?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.market = { ...data, live: true };
    if (manual) toast(data.rates?.ok ? "Live data refreshed" : "Refreshed, but the rate feed was unavailable");
  } catch (err) {
    try {
      const res = await fetch("/data/insurers.json");
      const data = await res.json();
      state.market = { insurers: data.insurers, ratingsAsOf: data.ratingsAsOf, rates: { ok: false, errors: [String(err.message)] }, fetchedAt: new Date().toISOString(), live: false };
      toast("Live API unreachable. Showing bundled data.");
    } catch {
      toast("Could not load any data. Check your connection.");
      setPill("cached", "Offline");
      btn.classList.remove("busy");
      btn.disabled = false;
      return;
    }
  }
  btn.classList.remove("busy");
  btn.disabled = false;
  renderPill();
  renderAll();
  renderGuide();
}

function setPill(kind, text) {
  const pill = $("#livePill");
  pill.className = `pill pill-${kind}`;
  $("#liveText").textContent = text;
}
function renderPill() {
  const m = state.market;
  const time = new Date(m.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (m.live && m.rates?.ok) setPill("live", `Live · updated ${time}`);
  else if (m.live) setPill("cached", `Insurers live, rates unavailable · ${time}`);
  else setPill("cached", "Offline data (bundled)");
}

const y10 = () => state.market?.rates?.ok ? state.market.rates.curve["10Y"] : null;

/* ---------- computation ---------- */
function computeRows(profile = state.profile, type = profile.type) {
  const p = { ...profile, type };
  const rows = [];
  for (const insurer of state.market.insurers) {
    const q = quote(insurer, p, y10());
    if (q) rows.push({ insurer, q });
  }
  if (!rows.length) return rows;
  const cheapest = Math.min(...rows.map((r) => r.q.annual));
  const priciest = Math.max(...rows.map((r) => r.q.annual));
  for (const r of rows) r.score = valueScore(r.insurer, r.q, cheapest, priciest);
  return rows;
}

function applyFilters(rows) {
  const f = state.filters;
  return rows.filter(({ insurer: i }) =>
    (!f.aPlus || RATING_RANK[i.amBest] >= 4) &&
    (!f.noExam || i.noExam) &&
    (!f.convertible || i.conversionAge) &&
    (!f.direct || i.channel.startsWith("Direct")));
}

function sortRows(rows) {
  const { key, dir } = state.sort;
  const get = {
    value: (r) => r.score,
    monthly: (r) => r.q.monthly,
    total: (r) => r.q.total,
    rating: (r) => RATING_RANK[r.insurer.amBest],
    name: (r) => r.insurer.name,
  }[key];
  return [...rows].sort((a, b) => {
    const x = get(a), y = get(b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* ---------- renderers ---------- */
function renderAll() {
  renderProfileOutputs();
  renderKpis();
  renderMarket();
  renderCompare();
  renderTerms();
  renderWaiting();
}

function renderProfileOutputs() {
  const p = state.profile;
  $("#ageOut").textContent = p.age;
  $("#faceOut").textContent = money(p.face);
  $("#termField").hidden = p.type === "whole";
  const allowed = [10, 15, 20, 25, 30].filter((t) => t <= maxTermForAge(p.age));
  if (!allowed.includes(p.term) && allowed.length) p.term = allowed[allowed.length - 1];
  $("#termChips").innerHTML = allowed
    .map((t) => `<button type="button" class="chip ${t === p.term ? "on" : ""}" data-term="${t}">${t} yr</button>`)
    .join("");
}

function renderKpis() {
  const rows = computeRows();
  const el = $("#kpis");
  if (!rows.length) {
    el.innerHTML = `<div class="card kpi" style="grid-column:1/-1"><div class="label">No carriers available</div><div class="sub">Try a shorter term or a different policy type for this age.</div></div>`;
    return;
  }
  const low = rows.reduce((a, b) => (a.q.monthly <= b.q.monthly ? a : b));
  const best = rows.reduce((a, b) => (a.score >= b.score ? a : b));
  const med = median(rows.map((r) => r.q.monthly));
  const rate = state.market.rates;
  const tenYear = rate?.ok ? `${rate.curve["10Y"].toFixed(2)}%` : "n/a";
  const change = rate?.ok && rate.change10Y != null
    ? `<span class="${rate.change10Y > 0 ? "up" : "down"}">${rate.change10Y > 0 ? "▲" : "▼"} ${Math.abs(rate.change10Y).toFixed(2)} pts</span> vs prior day`
    : "Live feed unavailable";
  el.innerHTML = `
    <div class="card kpi"><div class="label">Lowest est. monthly</div><div class="value num">${money(low.q.monthly)}</div><div class="sub">${low.insurer.name} · ${low.insurer.amBest}</div></div>
    <div class="card kpi"><div class="label">Median est. monthly</div><div class="value num">${money(med)}</div><div class="sub">Across ${rows.length} carriers</div></div>
    <div class="card kpi"><div class="label">Best overall value</div><div class="value">${best.insurer.name.split(" (")[0]}</div><div class="sub">Score ${best.score}/100 · ${money(best.q.monthly)}/mo</div></div>
    <div class="card kpi"><div class="label">10-yr Treasury (live)</div><div class="value num">${tenYear}</div><div class="sub">${change}</div></div>`;
}

function sparkline(points, w = 260, h = 56) {
  if (!points?.length) return "";
  const ys = points.map((p) => p.y);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const span = hi - lo || 1;
  const d = points.map((p, i) => {
    const x = (i / (points.length - 1 || 1)) * (w - 4) + 2;
    const y = h - 4 - ((p.y - lo) / span) * (h - 8);
    return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="30-day 10-year Treasury yield"><path d="${d}" fill="none" stroke="var(--brand)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function renderMarket() {
  const r = state.market.rates;
  const body = $("#marketBody");
  if (!r?.ok) {
    body.innerHTML = `Live Treasury feed unavailable. Whole-life estimates use a neutral rate assumption.`;
    return;
  }
  body.innerHTML = `
    <div class="big num">${r.curve["10Y"].toFixed(2)}%</div>
    <div class="muted" style="font-size:12.5px">10-yr Treasury · as of ${r.asOf}</div>
    ${sparkline(r.history10Y)}
    <div style="font-size:12.5px;margin-top:6px">${["2Y", "5Y", "30Y"].filter((k) => r.curve[k] != null).map((k) => `${k}: <b class="num">${r.curve[k].toFixed(2)}%</b>`).join(" · ")}</div>
    <small>Source: <a href="${r.url}" target="_blank" rel="noopener">${r.source}</a>. Higher long-term yields generally lower whole-life premiums and raise crediting rates.</small>`;
}

function hbar(rows) {
  const top = rows.slice(0, 18);
  if (!top.length) return "";
  const max = Math.max(...top.map((r) => r.q.monthly));
  const rowH = 26, left = 150, w = 720, h = top.length * rowH + 8;
  const bars = top.map((r, i) => {
    const bw = Math.max(4, ((w - left - 80) * r.q.monthly) / max);
    const y = i * rowH + 4;
    const fill = i === 0 ? "var(--good)" : "var(--brand)";
    return `<text x="${left - 8}" y="${y + 15}" text-anchor="end">${r.insurer.name.split(" (")[0]}</text>
      <rect x="${left}" y="${y + 3}" width="${bw}" height="16" rx="5" fill="${fill}" opacity="${i === 0 ? 1 : 0.85}"/>
      <text class="val" x="${left + bw + 8}" y="${y + 15}">${money(r.q.monthly)}</text>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Estimated monthly premium by carrier">${bars}</svg>`;
}

function ratingBadge(r) {
  return `<span class="badge r${RATING_RANK[r] >= 5 ? 5 : RATING_RANK[r] >= 4 ? 4 : 3}">${r}</span>`;
}

function renderCompare() {
  const p = state.profile;
  const all = computeRows();
  const rows = sortRows(applyFilters(all));
  const cheapestId = all.length ? all.reduce((a, b) => (a.q.annual <= b.q.annual ? a : b)).insurer.id : null;
  const f = state.filters;
  const totalLabel = p.type === "whole" ? "Cost to age 85" : `${p.term}-yr total`;
  const chip = (key, label) => `<button type="button" class="chip ${f[key] ? "on" : ""}" data-filter="${key}">${label}</button>`;
  const th = (key, label, cls = "") => `<th class="${cls} ${state.sort.key === key ? "sorted" : ""}" data-sort="${key}">${label}</th>`;

  const body = rows.map(({ insurer: i, q, score }) => {
    const open = state.expanded.has(i.id);
    const detail = open ? `<tr class="detail"><td colspan="8">
      <div class="detail-grid">
        <div><h4>Best for</h4>${i.bestFor}</div>
        <div><h4>Riders</h4>${i.riders.join(", ")}</div>
        <div><h4>Details</h4>${i.kind} · founded ${i.founded} · ${i.channel}<br>Convertible to age ${i.conversionAge ?? "n/a"}<br>Terms: ${i.termLengths.join(", ")} yr</div>
        <div><h4>Verify independently</h4>
          <a href="https://web.ambest.com/ratings" target="_blank" rel="noopener">AM Best ratings</a><br>
          <a href="https://content.naic.org/cis_consumer_information.htm" target="_blank" rel="noopener">NAIC complaint index</a><br>
          <a href="https://www.google.com/search?q=${encodeURIComponent(i.name + " life insurance quote")}" target="_blank" rel="noopener">Get a real quote</a>
        </div>
      </div></td></tr>` : "";
    return `<tr class="row ${i.id === cheapestId ? "best" : ""}" data-id="${i.id}">
      <td><input type="checkbox" class="pick" data-id="${i.id}" ${state.selected.has(i.id) ? "checked" : ""} aria-label="Shortlist ${i.name}"></td>
      <td><div class="name">${i.name}</div><small>${i.kind}${i.id === cheapestId ? " · lowest price" : ""}</small></td>
      <td>${ratingBadge(i.amBest)}</td>
      <td class="right num"><b>${money(q.monthly)}</b></td>
      <td class="right num">${money(q.annual)}</td>
      <td class="right num">${money(q.total)}</td>
      <td><div class="score"><div class="bar"><i style="width:${score}%"></i></div><b class="num">${score}</b></div></td>
      <td>${i.noExam ? '<span class="tag">No-exam</span>' : ""}${i.conversionAge ? '<span class="tag">Convertible</span>' : ""}</td>
    </tr>${detail}`;
  }).join("");

  const picked = all.filter((r) => state.selected.has(r.insurer.id));
  const cards = picked.length
    ? `<div class="card"><h3>Shortlist</h3><p class="lead">Side-by-side view of the carriers you checked.</p><div class="compare-cards">${picked.map(({ insurer: i, q, score }) => `
        <div class="card"><div class="name">${i.name}</div>${ratingBadge(i.amBest)}
        <dl><dt>Monthly</dt><dd>${money(q.monthly)}</dd><dt>Annual</dt><dd>${money(q.annual)}</dd><dt>${totalLabel}</dt><dd>${money(q.total)}</dd>
        <dt>Per $1,000</dt><dd>${money(q.perThousand, 2)}/yr</dd><dt>Value score</dt><dd>${score}</dd>
        <dt>Convertible to</dt><dd>${i.conversionAge ? "age " + i.conversionAge : "No"}</dd><dt>No-exam</dt><dd>${i.noExam ? "Yes" : "No"}</dd></dl></div>`).join("")}</div></div>` : "";

  $("#tab-compare").innerHTML = `
    <div class="card"><h3>Estimated monthly premium</h3>
      <p class="lead">${p.type === "whole" ? "Whole life" : p.term + "-year term"} · ${money(p.face)} · age ${p.age} · ${p.gender === "m" ? "male" : "female"} · ${p.smoker ? "tobacco" : "non-tobacco"} · ${HEALTH_CLASSES.find((h) => h.id === p.health).label}</p>
      ${hbar(sortRows(all).sort((a, b) => a.q.monthly - b.q.monthly))}
    </div>
    <div class="card">
      <div class="toolbar">
        ${chip("aPlus", "A+ or better")}${chip("noExam", "No-exam option")}${chip("convertible", "Convertible")}${chip("direct", "Buy direct online")}
        <span class="spacer"></span>
        <button class="btn small" id="csvBtn" type="button">Export CSV</button>
        <button class="btn small" id="printBtn" type="button">Print</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th></th>${th("name", "Carrier")}${th("rating", "AM Best")}${th("monthly", "Monthly", "right")}<th class="right" style="cursor:default">Annual</th>${th("total", totalLabel, "right")}${th("value", "Value score")}<th style="cursor:default">Perks</th></tr></thead>
        <tbody>${body || `<tr><td colspan="8" class="muted">No carriers match these filters.</td></tr>`}</tbody>
      </table></div>
      <small>Value score = 60% price, 30% financial strength, 10% flexibility. Click a row for details.</small>
    </div>${cards}`;
}

/* Terms and laddering */
function cheapestFor(profile, type = "term") {
  const rows = computeRows(profile, type);
  if (!rows.length) return null;
  return rows.reduce((a, b) => (a.q.annual <= b.q.annual ? a : b));
}

function groupedBars(data, labelKey) {
  const w = 640, h = 240, padL = 48, padB = 28, padT = 16;
  const max = Math.max(...data.flatMap((d) => [d.low, d.med])) * 1.12;
  const gw = (w - padL - 10) / data.length;
  const y = (v) => h - padB - (v / max) * (h - padB - padT);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const v = max * t;
    return `<line class="grid" x1="${padL}" x2="${w - 6}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${money(v)}</text>`;
  }).join("");
  const bars = data.map((d, i) => {
    const x = padL + i * gw + gw * 0.15, bw = gw * 0.34;
    return `<rect x="${x}" y="${y(d.low)}" width="${bw}" height="${h - padB - y(d.low)}" rx="4" fill="var(--good)"/>
      <rect x="${x + bw + 4}" y="${y(d.med)}" width="${bw}" height="${h - padB - y(d.med)}" rx="4" fill="var(--brand)" opacity="0.8"/>
      <text x="${x + bw}" y="${h - 8}" text-anchor="middle">${d[labelKey]}</text>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Monthly premium by term length">${grid}${bars}</svg>
    <small><span style="color:var(--good)">■</span> Lowest carrier &nbsp; <span style="color:var(--brand)">■</span> Median carrier</small>`;
}

function renderTerms() {
  const p = state.profile;
  const terms = [10, 15, 20, 25, 30].filter((t) => t <= maxTermForAge(p.age));
  const data = terms.map((t) => {
    const rows = computeRows({ ...p, term: t }, "term");
    if (!rows.length) return null;
    const low = rows.reduce((a, b) => (a.q.monthly <= b.q.monthly ? a : b));
    return { term: `${t} yr`, t, low: low.q.monthly, med: median(rows.map((r) => r.q.monthly)), who: low.insurer.name.split(" (")[0] };
  }).filter(Boolean);

  if (!state.ladder.edited) {
    const r = (n) => Math.round(n / 25000) * 25000;
    state.ladder.a = r(p.face * 0.3);
    state.ladder.b = r(p.face * 0.4);
    state.ladder.c = r(p.face * 0.3);
  }
  const L = state.ladder;
  const seg = (term, face) => {
    if (!face || term > maxTermForAge(p.age)) return null;
    const c = cheapestFor({ ...p, term, face }, "term");
    return c ? { term, face, monthly: c.q.monthly, who: c.insurer.name.split(" (")[0] } : null;
  };
  const segs = [seg(10, L.a), seg(20, L.b), seg(30, L.c)].filter(Boolean);
  const ladderTotal = segs.reduce((s, x) => s + x.monthly, 0);
  const faceTotal = L.a + L.b + L.c;
  const single = faceTotal && cheapestFor({ ...p, term: Math.min(30, maxTermForAge(p.age)), face: faceTotal }, "term");

  $("#tab-terms").innerHTML = `
    <div class="card"><h3>Price by term length</h3><p class="lead">Longer terms lock in your rate for more years but cost more per month.</p>
      ${data.length ? groupedBars(data, "term") : '<p class="muted">No terms available.</p>'}
      <div class="table-wrap"><table><thead><tr><th>Term</th><th class="right">Lowest / mo</th><th class="right">Median / mo</th><th>Lowest carrier</th></tr></thead>
      <tbody>${data.map((d) => `<tr><td>${d.term}</td><td class="right num">${money(d.low)}</td><td class="right num">${money(d.med)}</td><td>${d.who}</td></tr>`).join("")}</tbody></table></div>
    </div>
    <div class="card"><h3>Laddering simulator</h3>
      <p class="lead">Stack several policies of different lengths so coverage steps down as your mortgage, kids and obligations wind down.</p>
      <div class="formgrid">
        <div><label for="lad-a">10-year policy</label><input id="lad-a" type="number" step="25000" min="0" value="${L.a}"></div>
        <div><label for="lad-b">20-year policy</label><input id="lad-b" type="number" step="25000" min="0" value="${L.b}"></div>
        <div><label for="lad-c">30-year policy</label><input id="lad-c" type="number" step="25000" min="0" value="${L.c}"></div>
      </div>
      <div class="grid2">
        <div><div class="muted">Laddered total</div><div class="result num">${money(ladderTotal)}<span class="muted" style="font-size:14px"> /mo</span></div>
          <small>${segs.map((s) => `${s.term} yr ${money(s.face)} via ${s.who} (${money(s.monthly)})`).join("<br>")}</small></div>
        <div><div class="muted">One ${money(faceTotal)} policy for the longest term</div>
          <div class="result num">${single ? money(single.q.monthly) : "n/a"}<span class="muted" style="font-size:14px"> /mo</span></div>
          ${single ? `<small>${ladderTotal < single.q.monthly ? `Ladder saves about <b>${money(single.q.monthly - ladderTotal)}/mo</b>.` : "A single policy is cheaper here."}</small>` : ""}</div>
      </div>
    </div>`;

  for (const k of ["a", "b", "c"]) {
    $(`#lad-${k}`).addEventListener("change", (e) => {
      state.ladder.edited = true;
      state.ladder[k] = Math.max(0, Number(e.target.value) || 0);
      renderTerms();
    });
  }
}

/* Cost of waiting */
function renderWaiting() {
  const p = state.profile;
  const years = Array.from({ length: 11 }, (_, n) => n);
  const pts = years.map((n) => {
    const age = p.age + n;
    const type = p.type;
    const term = Math.min(p.term, maxTermForAge(age));
    const c = cheapestFor({ ...p, age, term }, type);
    return c ? { n, age, annual: c.q.annual, monthly: c.q.monthly } : null;
  }).filter(Boolean);
  if (pts.length < 2) { $("#tab-waiting").innerHTML = `<div class="card"><p class="muted">Not enough data for this profile.</p></div>`; return; }
  const base = pts[0];
  const yrs = p.type === "whole" ? 20 : p.term;

  const w = 640, h = 220, padL = 52, padB = 28, padT = 14;
  const max = Math.max(...pts.map((x) => x.monthly)) * 1.1;
  const X = (i) => padL + (i / (pts.length - 1)) * (w - padL - 14);
  const Y = (v) => h - padB - (v / max) * (h - padB - padT);
  const path = pts.map((x, i) => `${i ? "L" : "M"}${X(i)},${Y(x.monthly)}`).join(" ");
  const grid = [0, 0.5, 1].map((t) => `<line class="grid" x1="${padL}" x2="${w - 10}" y1="${Y(max * t)}" y2="${Y(max * t)}"/><text x="${padL - 6}" y="${Y(max * t) + 4}" text-anchor="end">${money(max * t)}</text>`).join("");
  const dots = pts.map((x, i) => `<circle cx="${X(i)}" cy="${Y(x.monthly)}" r="4" fill="var(--brand)"/><text x="${X(i)}" y="${h - 8}" text-anchor="middle">${x.age}</text>`).join("");

  $("#tab-waiting").innerHTML = `
    <div class="card"><h3>What waiting costs you</h3>
      <p class="lead">Lowest estimated monthly price for the same coverage if you buy at each future age.</p>
      <svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Lowest monthly premium by purchase age">${grid}<path d="${path}" fill="none" stroke="var(--brand)" stroke-width="3" stroke-linecap="round"/>${dots}</svg>
      <div class="table-wrap"><table><thead><tr><th>Buy at age</th><th class="right">Monthly</th><th class="right">vs. today</th><th class="right">Extra over ${yrs} yrs</th></tr></thead>
      <tbody>${pts.filter((x) => [0, 1, 2, 3, 5, 8, 10].includes(x.n)).map((x) => `<tr><td>${x.age}${x.n === 0 ? " (now)" : ""}</td><td class="right num">${money(x.monthly)}</td>
        <td class="right num">${x.n ? "+" + Math.round((x.monthly / base.monthly - 1) * 100) + "%" : "-"}</td><td class="right num">${x.n ? money((x.annual - base.annual) * yrs) : "-"}</td></tr>`).join("")}</tbody></table></div>
    </div>
    <div class="callout"><b>Birthday tip:</b> many carriers price by <i>age nearest birthday</i>, so your rate can jump up to six months before you turn 46. If you are close, ask your broker whether the carrier will back-date or "save age" so you keep the lower rate.</div>
    <div class="callout"><b>Health risk:</b> prices rise with age, but the bigger risk is a new diagnosis. A single condition can move you down a health class or make you uninsurable at standard rates.</div>`;
}

/* Static tabs */
function renderNeeds() {
  $("#tab-needs").innerHTML = `
    <div class="card"><h3>How much coverage do you need?</h3>
      <p class="lead">The DIME method adds up Debt, Income replacement, Mortgage and Education, then subtracts assets you already have.</p>
      <div class="formgrid">
        <div><label for="n-debt">Non-mortgage debt</label><input id="n-debt" type="number" value="20000" step="5000" min="0"></div>
        <div><label for="n-income">Annual income to replace</label><input id="n-income" type="number" value="100000" step="5000" min="0"></div>
        <div><label for="n-years">Years of income needed</label><input id="n-years" type="number" value="10" min="0" max="40"></div>
        <div><label for="n-mort">Mortgage balance</label><input id="n-mort" type="number" value="250000" step="10000" min="0"></div>
        <div><label for="n-edu">Education fund goal</label><input id="n-edu" type="number" value="100000" step="10000" min="0"></div>
        <div><label for="n-assets">Existing savings / group life</label><input id="n-assets" type="number" value="150000" step="10000" min="0"></div>
      </div>
      <div class="muted">Suggested coverage</div>
      <div class="result num" id="needResult"></div>
      <div style="margin-top:10px"><button id="useNeed" class="btn btn-primary" type="button">Use this amount in comparison</button></div>
      <small>Rules of thumb: 10 to 12 times income is common. At 45 you may weigh years until retirement and kids' ages more heavily. A broker or fee-only planner can refine this.</small>
    </div>`;
  const calc = () => {
    const v = (id) => Math.max(0, Number($(id).value) || 0);
    const total = dime({ debt: v("#n-debt"), income: v("#n-income"), years: v("#n-years"), mortgage: v("#n-mort"), education: v("#n-edu"), assets: v("#n-assets") });
    $("#needResult").textContent = money(total);
    return total;
  };
  $$("#tab-needs input").forEach((i) => i.addEventListener("input", calc));
  calc();
  $("#useNeed").addEventListener("click", () => {
    const total = calc();
    state.profile.face = Math.min(5000000, Math.max(100000, Math.round(total / 50000) * 50000));
    state.ladder.edited = false;
    syncForm(); save(); renderAll();
    toast(`Coverage set to ${money(state.profile.face)}`);
  });
}

const CHECKLIST = [
  "Decide on coverage amount and term length",
  "Get quotes from an independent broker (they shop many carriers at once)",
  "Compare at least three carriers on price AND financial strength",
  "Check AM Best rating (A or better) and NAIC complaint index",
  "Confirm the policy is convertible and the conversion deadline",
  "Answer the application honestly - misstatements can void a claim",
  "Schedule the paramedical exam (fast the day before, avoid alcohol and heavy exercise)",
  "Name primary and contingent beneficiaries; avoid naming a minor directly",
  "Set up automatic payment so the policy cannot lapse",
  "Store the policy where your family can find it",
];

function renderGuide() {
  $("#tab-guide").innerHTML = `
    <div class="grid2">
      <div class="card"><h3>Buying checklist</h3><p class="lead">Your progress is saved in this browser.</p>
        <ul class="check" id="checklist">${CHECKLIST.map((c, i) => `<li data-i="${i}" class="${state.checklist.has(i) ? "done" : ""}" tabindex="0" role="checkbox" aria-checked="${state.checklist.has(i)}">${c}</li>`).join("")}</ul></div>
      <div class="card"><h3>Questions to ask your agent</h3><p class="lead">Good brokers welcome these.</p>
        <ul style="padding-left:18px;margin:0">
          <li>Which carriers did you shop, and why this one?</li>
          <li>Is this price guaranteed level for the full term?</li>
          <li>What is the conversion window and which products can I convert to?</li>
          <li>Would a different health class be possible if I improve my numbers?</li>
          <li>How do you get paid, and does that change your recommendation?</li>
          <li>Does the policy include accelerated death benefits for terminal illness?</li>
          <li>What is the contestability period (usually two years)?</li>
        </ul></div>
    </div>
    <div class="grid2">
      <div class="card"><h3>Term vs whole life</h3>
        <p><b>Term</b> covers a fixed period at a level price and is typically 5 to 15 times cheaper. Best for income replacement while others depend on you.</p>
        <p><b>Whole / permanent</b> covers your whole life, builds cash value, and costs far more. It can fit estate planning or lifelong dependents, but is rarely the best first policy.</p>
        <p class="muted" style="margin-bottom:0">Many people buy term and later convert a slice to permanent coverage with no new medical exam.</p></div>
      <div class="card"><h3>Red flags</h3>
        <ul style="padding-left:18px;margin:0">
          <li>Pressure to buy an investment-style product when you asked for protection</li>
          <li>Guaranteed-issue policies with low limits when you are healthy</li>
          <li>Quotes far below every other carrier (check rating and class assumed)</li>
          <li>Lead-gen sites that sell your phone number</li>
          <li>Skipping the contestability and conversion details</li>
        </ul></div>
    </div>
    <div class="card"><h3>Glossary</h3><dl class="glossary">
      <dt>Face amount</dt><dd>The death benefit paid to your beneficiaries.</dd>
      <dt>Health class</dt><dd>Underwriting tier (Preferred Plus to Standard) that sets your price.</dd>
      <dt>Convertible</dt><dd>Right to switch term coverage to permanent without a new exam.</dd>
      <dt>Contestability period</dt><dd>Initial window (usually two years) when the insurer can investigate claims for application errors.</dd>
      <dt>Accelerated underwriting</dt><dd>Faster approval using data instead of a medical exam, often for healthier applicants.</dd>
      <dt>AM Best</dt><dd>Rating agency that scores insurer financial strength (A++ is highest).</dd>
      <dt>NAIC complaint index</dt><dd>Regulator-published measure of complaints relative to company size; 1.00 is average.</dd>
    </dl></div>
    <div class="card"><h3>Methodology &amp; sources</h3>
      <p><b>Live:</b> the 10-year Treasury yield and yield curve are fetched on every load and refresh from the U.S. Treasury (FRED as backup) by a serverless function. Whole-life estimates adjust modestly with that yield.</p>
      <p><b>Modeled:</b> premiums are estimated from an age, term, sex, tobacco, health-class and coverage-band rate model with carrier-specific price factors. They are directional, not quotes.</p>
      <p><b>Curated:</b> carrier ratings and features come from a reviewed dataset (${state.market?.ratingsAsOf || "see data file"}). Verify at <a href="https://web.ambest.com/ratings" target="_blank" rel="noopener" style="color:var(--brand)">AM Best</a> and the <a href="https://content.naic.org/cis_consumer_information.htm" target="_blank" rel="noopener" style="color:var(--brand)">NAIC</a>.</p>
      <p class="muted" style="margin-bottom:0">No real-time quote API for life insurance is free or public. For binding prices, use an independent broker or the carrier's own quote engine.</p></div>`;
  $$("#checklist li").forEach((li) => {
    const toggle = () => {
      const i = Number(li.dataset.i);
      state.checklist.has(i) ? state.checklist.delete(i) : state.checklist.add(i);
      li.classList.toggle("done");
      li.setAttribute("aria-checked", state.checklist.has(i));
      save();
    };
    li.addEventListener("click", toggle);
    li.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); } });
  });
}

/* ---------- interactions ---------- */
function syncForm() {
  const p = state.profile;
  $("#age").value = p.age;
  $("#gender").value = p.gender;
  $("#smoker").value = p.smoker ? "1" : "0";
  $("#health").value = p.health;
  $("#type").value = p.type;
  $("#face").value = p.face;
}

function onProfileInput() {
  const p = state.profile;
  p.age = Number($("#age").value);
  p.gender = $("#gender").value;
  p.smoker = $("#smoker").value === "1";
  p.health = $("#health").value;
  p.type = $("#type").value;
  p.face = Number($("#face").value);
  save();
  if (state.market) renderAll();
}

function toCsv() {
  const rows = sortRows(applyFilters(computeRows()));
  const header = ["Carrier", "AM Best", "Monthly", "Annual", "Total", "Value score", "No-exam", "Convertible to"];
  const lines = rows.map(({ insurer: i, q, score }) =>
    [i.name, i.amBest, q.monthly.toFixed(2), q.annual.toFixed(2), q.total.toFixed(0), score, i.noExam ? "yes" : "no", i.conversionAge ?? ""]
      .map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","));
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "life-insurance-comparison.csv" });
  a.click();
  URL.revokeObjectURL(a.href);
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

function bind() {
  $("#health").innerHTML = HEALTH_CLASSES.map((h) => `<option value="${h.id}">${h.label}</option>`).join("");
  syncForm();
  $("#profileForm").addEventListener("input", onProfileInput);
  $("#profileForm").addEventListener("submit", (e) => e.preventDefault());
  $("#termChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-term]");
    if (!b) return;
    state.profile.term = Number(b.dataset.term);
    save(); renderAll();
  });
  $("#resetBtn").addEventListener("click", () => {
    state.profile = { ...DEFAULTS };
    state.ladder.edited = false;
    syncForm(); save(); renderAll();
  });
  $("#refreshBtn").addEventListener("click", () => loadMarket({ manual: true }));
  $("#themeBtn").addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("lif.theme", root.dataset.theme); } catch { /* ignore */ }
  });
  try {
    const theme = localStorage.getItem("lif.theme");
    if (theme) document.documentElement.dataset.theme = theme;
  } catch { /* ignore */ }

  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    $$("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
    $$(".tabpane").forEach((x) => x.classList.toggle("active", x.id === `tab-${b.dataset.tab}`));
  });

  $("#tab-compare").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-filter]");
    if (chip) { state.filters[chip.dataset.filter] = !state.filters[chip.dataset.filter]; return renderCompare(); }
    const th = e.target.closest("th[data-sort]");
    if (th) {
      const key = th.dataset.sort;
      state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : key === "name" || key === "monthly" || key === "total" ? 1 : -1 };
      return renderCompare();
    }
    if (e.target.closest("#csvBtn")) return toCsv();
    if (e.target.closest("#printBtn")) return window.print();
    const pick = e.target.closest(".pick");
    if (pick) {
      const id = pick.dataset.id;
      state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
      return renderCompare();
    }
    const row = e.target.closest("tr.row");
    if (row) {
      const id = row.dataset.id;
      state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
      renderCompare();
    }
  });
}

/* ---------- boot ---------- */
loadSaved();
bind();
renderNeeds();
renderGuide();
loadMarket();
