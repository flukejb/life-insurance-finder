import data from "../../public/data/insurers.json";

const TREASURY_URL =
  "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=";
const FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10";

const TENORS = {
  BC_1YEAR: "1Y",
  BC_2YEAR: "2Y",
  BC_5YEAR: "5Y",
  BC_10YEAR: "10Y",
  BC_20YEAR: "20Y",
  BC_30YEAR: "30Y",
};

const monthKey = (d) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

function parseTreasury(xml) {
  const entries = xml.split("<entry>").slice(1);
  const rows = entries.map((entry) => {
    const date = (entry.match(/<d:NEW_DATE[^>]*>([^<]+)</) || [])[1];
    const curve = {};
    for (const [, key, val] of entry.matchAll(/<d:(BC_[0-9A-Z]+)[^>]*>([^<]*)</g)) {
      if (TENORS[key] && val !== "") curve[TENORS[key]] = Number(val);
    }
    return { date: date ? date.slice(0, 10) : null, curve };
  });
  return rows.filter((r) => r.date && r.curve["10Y"] != null);
}

async function fetchTreasury() {
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  let rows = [];
  for (const month of [monthKey(now), monthKey(prev)]) {
    const res = await fetch(TREASURY_URL + month, { cf: { cacheTtl: 0 } });
    if (!res.ok) throw new Error(`Treasury HTTP ${res.status}`);
    rows = parseTreasury(await res.text()).concat(rows);
    if (rows.length >= 2) break;
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const last = rows[rows.length - 1];
  const before = rows[rows.length - 2];
  if (!last) throw new Error("Treasury returned no rows");
  return {
    ok: true,
    source: "U.S. Treasury daily par yield curve",
    url: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates",
    asOf: last.date,
    curve: last.curve,
    change10Y: before ? +(last.curve["10Y"] - before.curve["10Y"]).toFixed(3) : null,
    history10Y: rows.slice(-30).map((r) => ({ date: r.date, y: r.curve["10Y"] })),
  };
}

async function fetchFred() {
  const res = await fetch(FRED_URL, { cf: { cacheTtl: 0 } });
  if (!res.ok) throw new Error(`FRED HTTP ${res.status}`);
  const lines = (await res.text()).trim().split("\n").slice(1);
  const rows = lines
    .map((l) => l.split(","))
    .filter(([, v]) => v && v !== ".")
    .map(([date, v]) => ({ date, y: Number(v) }));
  const last = rows[rows.length - 1];
  const before = rows[rows.length - 2];
  return {
    ok: true,
    source: "FRED 10-Year Treasury (DGS10)",
    url: "https://fred.stlouisfed.org/series/DGS10",
    asOf: last.date,
    curve: { "10Y": last.y },
    change10Y: before ? +(last.y - before.y).toFixed(3) : null,
    history10Y: rows.slice(-30),
  };
}

async function getRates() {
  const errors = [];
  for (const fn of [fetchTreasury, fetchFred]) {
    try {
      return await fn();
    } catch (err) {
      errors.push(String(err.message || err));
    }
  }
  return { ok: false, errors };
}

export async function onRequestGet() {
  const rates = await getRates();
  const body = {
    fetchedAt: new Date().toISOString(),
    rates,
    ratingsAsOf: data.ratingsAsOf,
    insurers: data.insurers,
  };
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
