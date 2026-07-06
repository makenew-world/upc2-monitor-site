/* UPC2 Account Monitor — app logic (Mist design)
   Runs after the password gate decrypts the payload (see auth.js).
   Data model: each account holds a continuous monthly net/qty series aligned to
   DATA.months. The user picks a "current period" and an optional "compare
   period"; every view (chart, KPIs, status, table, pareto, heatmap) is computed
   client-side from those two ranges — like choosing date ranges in a pivot. */
window.initApp = function () {
const DATA = window.DATA;
const M = DATA.months;                       // ['YYYY-MM', ...] oldest → latest
const LAST = M.length - 1;

const FAM_ORDER = ['EPO', 'ZEMI'];
const FAM_BRANDS = { EPO: ['ESPOGEN','EPOTIV','EUVAX'], ZEMI: ['ZEMIGLO','ZEMIMET','ZEMIDAPA'] };
const FAM_COLOR = {
  EPO:  { color: '#1F3A5F', light: '#E6EBF2' },
  ZEMI: { color: '#F49800', light: '#FDF1DD' }
};
const MIST_ACCENT = { color: '#0e9384', tint: '#e1f4f0', bar: '#bfe6df' };
const YEARS = [...new Set(M.map(m => +m.slice(0,4)))].sort();

/* ---------- period helpers ---------- */
const last12 = () => ({ from: Math.max(0, M.length - 12), to: LAST });
const fullYear = y => {
  let from = -1, to = -1;
  M.forEach((m,i) => { if (+m.slice(0,4) === y) { if (from < 0) from = i; to = i; } });
  return from < 0 ? null : { from, to };
};
const ytd = () => fullYear(+DATA.latest_month.slice(0,4));
const priorOf = p => ({ from: p.from - 12, to: p.to - 12 });   // same months, year before
const clampRange = r => ({ from: Math.min(r.from, r.to), to: Math.max(r.from, r.to) });

let state = {
  level: 'family', scope: 'ALL', search: '', area: 'ALL', status: 'all',
  sortBy: 'total', sortDir: 'desc', page: 1, perPage: 25,
  detailScope: 'ALL', dCompare: 'single', activeSection: 'overview',
  period: last12(), periodPreset: '12m',
  compareOn: true, compare: priorOf(last12()), comparePreset: 'prior',
};
const P = () => state.period;
// Baseline for status/YoY. When Compare is off, ALWAYS fall back to the same
// calendar months of the prior year (business rule) — not the preceding window.
const C = () => state.compareOn ? state.compare : priorOf(state.period);

/* ---------- formatting ---------- */
const fmt = n => Math.round(n).toLocaleString('en-US');
const fmtCompact = n => {
  n = Math.round(n);
  if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n/1e3).toFixed(0) + 'K';
  return fmt(n);
};
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const monthLabel = m => { const [y,mo]=m.split('-'); return MONTH_NAMES[+mo-1]+" '"+y.slice(2); };
const shortMonth = m => MONTH_NAMES[+m.split('-')[1]-1] + (m.endsWith('-01') ? " '"+m.slice(2,4) : '');
// Honest label when a compare range falls (partly) outside available data:
// fully outside → 'no data'; partly outside → clamp and mark '(partial)'.
const rangeLabel = r => {
  if (!r || r.to < 0 || r.from > LAST) return 'no data';
  const from = Math.max(0, r.from), to = Math.min(LAST, r.to);
  return monthLabel(M[from]) + '–' + monthLabel(M[to]) + (r.from < 0 || r.to > LAST ? ' (partial)' : '');
};
const scopeColor = s => s==='EPO'||s==='ZEMI' ? FAM_COLOR[s] : { color: DATA.brands[s].color, light: DATA.brands[s].colorLight };
const tint = (hex,pct) => `color-mix(in srgb, ${hex} ${pct}%, white)`;

Chart.defaults.font.family = "'Space Grotesk', sans-serif";
Chart.defaults.color = '#586675';

/* ---------- series access ---------- */
function scopeSeries(acc, scope) {
  if (scope === 'ALL') return acc.total;
  if (scope === 'EPO' || scope === 'ZEMI') {
    const out = new Array(M.length).fill(0);
    for (const b of FAM_BRANDS[scope]) if (acc.brands[b]) acc.brands[b].net.forEach((v,i) => out[i] += v);
    return out;
  }
  return acc.brands[scope] ? acc.brands[scope].net : new Array(M.length).fill(0);
}
function sumR(arr, r) { let s = 0; for (let i = Math.max(0, r.from); i <= r.to; i++) s += arr[i] || 0; return s; }

/* multi-area: ALL view shows merged accounts; an area filter shows per-area entries.
   DU3/DU4 carry no EPO → those scopes hidden there. */
const activeAccounts = () => state.area === 'ALL' ? DATA.accounts_merged : DATA.accounts.filter(a => a.area === state.area);
const familiesForArea = () => state.area === 'ALL' ? FAM_ORDER : (DATA.area_families[state.area] || FAM_ORDER);
const brandsForArea = () => state.area === 'ALL' ? Object.keys(DATA.brands) : (DATA.area_brands[state.area] || Object.keys(DATA.brands));
const accId = a => a.code + '|' + a.area;

function statusFor(acc, scope) {
  const ser = scopeSeries(acc, scope);
  if (scope !== 'ALL' && !ser.some(v => v > 0)) return null;
  const p = P();
  const cur = sumR(ser, p);
  let hadHistory = false;
  for (let i = 0; i <= p.to; i++) if (ser[i] > 0) { hadHistory = true; break; }
  if (!hadHistory) return null;          // not a customer yet by period end → exclude
  const fm = acc.first_month;
  if (fm >= M[p.from] && fm <= M[p.to]) return 'new';
  if (cur === 0) return 'at_risk';       // had history but stopped in this period
  const base = sumR(ser, C());
  if (base <= 0) return 'growing';       // no baseline data, active now
  if (cur > base * 1.10) return 'growing';
  if (cur >= base * 0.90) return 'stable';
  return 'at_risk';
}

/* ---------- theming ---------- */
function applyTheme() {
  const r = document.documentElement.style;
  const label = document.getElementById('theme-label');
  if (state.scope === 'ALL') {
    r.setProperty('--accent', MIST_ACCENT.color);
    r.setProperty('--accent-tint', MIST_ACCENT.tint);
    r.setProperty('--accent-bar', MIST_ACCENT.bar);
    label.textContent = '';
  } else {
    const c = scopeColor(state.scope);
    r.setProperty('--accent', c.color);
    r.setProperty('--accent-tint', tint(c.color, 11));
    r.setProperty('--accent-bar', tint(c.color, 32));
    label.textContent = state.scope === 'EPO' || state.scope === 'ZEMI' ? state.scope + ' FAMILY' : state.scope;
  }
}

document.getElementById('live-label').textContent =
  'SYNCED · ' + monthLabel(DATA.latest_month).toUpperCase().replace("'", '20') + ' · ' + DATA.total_accounts + ' ACCOUNTS';

/* ---------- period bar ---------- */
function buildPeriodControls() {
  const opts = M.map((m,i) => `<option value="${i}">${monthLabel(m)}</option>`).join('');
  ['period-from','period-to','compare-from','compare-to'].forEach(id => document.getElementById(id).innerHTML = opts);

  const periodPresets = [{id:'12m',label:'12M'}, {id:'ytd',label:'YTD'}, ...YEARS.map(y => ({id:'y'+y, label:String(y)}))];
  const comparePresets = [{id:'prior',label:'Prior yr'}, ...YEARS.map(y => ({id:'y'+y, label:String(y)}))];
  document.getElementById('period-presets').innerHTML = periodPresets.map(p => `<button data-preset="${p.id}">${p.label}</button>`).join('');
  document.getElementById('compare-presets').innerHTML = comparePresets.map(p => `<button data-preset="${p.id}">${p.label}</button>`).join('');

  document.getElementById('period-presets').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const r = resolvePreset(b.dataset.preset); if (!r) return;
    state.period = r; state.periodPreset = b.dataset.preset;
    if (state.comparePreset === 'prior') state.compare = priorOf(state.period);
    state.page = 1; syncControls(); renderAll();
  });
  document.getElementById('compare-presets').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const r = resolvePreset(b.dataset.preset); if (!r) return;
    state.compare = r; state.comparePreset = b.dataset.preset;
    state.page = 1; syncControls(); renderAll();
  });
  const onSel = (fromId, toId, key, presetKey) => {
    const upd = () => {
      const r = clampRange({ from: +document.getElementById(fromId).value, to: +document.getElementById(toId).value });
      state[key] = r; state[presetKey] = 'custom';
      if (key === 'period' && state.comparePreset === 'prior') state.compare = priorOf(r);
      state.page = 1; syncControls(); renderAll();
    };
    document.getElementById(fromId).addEventListener('change', upd);
    document.getElementById(toId).addEventListener('change', upd);
  };
  onSel('period-from','period-to','period','periodPreset');
  onSel('compare-from','compare-to','compare','comparePreset');

  document.getElementById('cmp-toggle').addEventListener('change', e => {
    state.compareOn = e.target.checked;
    state.page = 1; syncControls(); renderAll();
  });
}
function resolvePreset(id) {
  if (id === '12m') return last12();
  if (id === 'ytd') return ytd();
  if (id === 'prior') return priorOf(state.period);
  if (id[0] === 'y') return fullYear(+id.slice(1));
  return null;
}
function syncControls() {
  const p = state.period, c = state.compare;
  document.getElementById('period-from').value = p.from;
  document.getElementById('period-to').value = p.to;
  document.getElementById('compare-from').value = Math.max(0, c.from);
  document.getElementById('compare-to').value = Math.max(0, c.to);
  document.getElementById('cmp-toggle').checked = state.compareOn;
  document.getElementById('compare-wrap').classList.toggle('off', !state.compareOn);
  document.querySelectorAll('#period-presets button').forEach(b => b.classList.toggle('on', b.dataset.preset === state.periodPreset));
  document.querySelectorAll('#compare-presets button').forEach(b => b.classList.toggle('on', b.dataset.preset === state.comparePreset));
  const live = document.getElementById('range-label');
  live.textContent = 'PERIOD: ' + rangeLabel(p) + (state.compareOn ? '  vs  ' + rangeLabel(c) : '');
}

/* ---------- area tabs ---------- */
function renderAreaTabs() {
  const counts = { ALL: DATA.accounts_merged.length };
  DATA.areas.forEach(a => counts[a] = DATA.accounts.filter(x => x.area === a).length);
  const wrap = document.getElementById('area-tabs');
  wrap.innerHTML = ['ALL', ...DATA.areas].map(a =>
    `<button class="area ${a===state.area?'on':''}" data-area="${a}">
       <div class="c">${a==='ALL'?'ALL UPC2':a}</div><div class="m">${counts[a]} acct</div>
     </button>`).join('');
  wrap.querySelectorAll('.area').forEach(b => b.addEventListener('click', () => {
    state.area = b.dataset.area; state.page = 1;
    wrap.querySelectorAll('.area').forEach(x => x.classList.toggle('on', x === b));
    const valid = ['ALL', ...familiesForArea(), ...brandsForArea()];
    if (!valid.includes(state.scope)) { state.scope = 'ALL'; applyTheme(); }
    renderProductChips();
    renderAll();
  }));
}

/* ---------- product chips ---------- */
function renderProductChips() {
  const wrap = document.getElementById('product-chips');
  let html = '<button class="chip" data-scope="ALL">ALL</button>';
  if (state.level === 'family') {
    familiesForArea().forEach(f => {
      const c = FAM_COLOR[f];
      html += `<button class="chip" data-scope="${f}" style="--chip-c:${c.color};--chip-t:${c.light}">${f}</button>`;
    });
  } else {
    brandsForArea().forEach(b => {
      const m = DATA.brands[b];
      html += `<button class="chip" data-scope="${b}" style="--chip-c:${m.color};--chip-t:${m.colorLight}">${b}</button>`;
    });
  }
  wrap.innerHTML = html;
  wrap.querySelectorAll('.chip').forEach(c => {
    if (c.dataset.scope === state.scope) c.classList.add('on');
    c.addEventListener('click', () => {
      state.scope = c.dataset.scope; state.page = 1;
      applyTheme(); renderProductChips(); renderAll();
    });
  });
}

document.querySelectorAll('#level-toggle button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#level-toggle button').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    state.level = btn.dataset.level; state.scope = 'ALL'; state.page = 1;
    applyTheme(); renderProductChips(); renderAll();
  });
});

/* ---------- section tabs ---------- */
document.querySelectorAll('#secnav a').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('#secnav a').forEach(x => x.classList.remove('on'));
    t.classList.add('on');
    state.activeSection = t.dataset.sec;
    ['overview','pareto','heatmap'].forEach(s =>
      document.getElementById('sec-'+s).classList.toggle('hidden', state.activeSection !== s));
    renderActiveSection();
  });
});

/* ---------- overview ---------- */
let overviewChart = null;
function teamSeries(scope) {
  const out = new Array(M.length).fill(0);
  activeAccounts().forEach(a => { const s = scopeSeries(a, scope); for (let i = 0; i < out.length; i++) out[i] += s[i]; });
  return out;
}
function kpiStack(curTotal, cmpTotal) {
  const yoy = cmpTotal > 0 ? (curTotal - cmpTotal) / cmpTotal * 100 : (curTotal > 0 ? 100 : 0);
  const delta = curTotal - cmpTotal;
  const sign = v => v >= 0 ? '+' : '';
  const cls = v => v >= 0 ? 'pos' : 'neg';
  return `
    <div class="k"><span class="lab">Current period<small>${rangeLabel(P())}</small></span><span class="val">${fmtCompact(curTotal).replace('M','<small>M</small>')}</span></div>
    <div class="k"><span class="lab">Compare period<small>${rangeLabel(C())}</small></span><span class="val" style="color:var(--txt-2)">${fmtCompact(cmpTotal).replace('M','<small>M</small>')}</span></div>
    <div class="k"><span class="lab">YoY change</span><span class="val ${cls(yoy)}">${sign(yoy)}${yoy.toFixed(1)}%</span></div>
    <div class="k"><span class="lab">Δ Absolute</span><span class="val ${cls(delta)}" style="font-size:18px">${sign(delta)}${fmtCompact(delta)}</span></div>`;
}
function renderOverview() {
  const ser = teamSeries(state.scope);
  const p = P(), c = C();
  const curSlice = ser.slice(p.from, p.to + 1);
  const curTotal = curSlice.reduce((s,v) => s+v, 0);
  const cmpTotal = sumR(ser, c);

  const scopeLabel = state.scope === 'ALL' ? 'All products' : (state.scope === 'EPO' || state.scope === 'ZEMI') ? state.scope + ' Family' : state.scope;
  document.getElementById('ov-title').textContent = 'Net sales / month — ' + scopeLabel;
  document.getElementById('ov-sub').textContent = (state.area === 'ALL' ? 'ALL AREAS' : state.area) + ' · THB';
  document.getElementById('ov-cards').innerHTML = kpiStack(curTotal, cmpTotal);

  const labels = [];
  for (let i = p.from; i <= p.to; i++) labels.push(shortMonth(M[i]));
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const datasets = [{ label: 'Current', data: curSlice, backgroundColor: accent, borderRadius: 4, order: 2 }];
  let cmpSlice = null;
  if (state.compareOn) {
    cmpSlice = labels.map((_,k) => { const ci = c.from + k; return ci >= 0 && ci <= c.to ? ser[ci] : null; });
    datasets.push({ label: 'Compare', data: cmpSlice, backgroundColor: '#c2cbd6', borderRadius: 4, order: 1 });
  }
  if (overviewChart) overviewChart.destroy();
  overviewChart = new Chart(document.getElementById('overview-chart'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 14, padding: 8 } },
        tooltip: { callbacks: {
          title: ctx => {
            const k = ctx[0].dataIndex;
            const cur = M[p.from + k];
            const cm = state.compareOn && (c.from + k) >= 0 ? M[c.from + k] : null;
            return monthLabel(cur) + (cm ? ' vs ' + monthLabel(cm) : '');
          },
          label: ctx => ctx.dataset.label + ': ' + fmt(ctx.parsed.y)
        }}
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 }, autoSkip: true, maxRotation: 0 } },
        y: { grid: { color: '#eef1f5' }, ticks: { callback: v => fmtCompact(v), font: { size: 11 } } }
      }
    }
  });
}

/* ---------- pareto ---------- */
let paretoChart = null;
function renderPareto() {
  const { scope, area } = state;
  const p = P();
  const items = [];
  activeAccounts().forEach(a => {
    const total = sumR(scopeSeries(a, scope), p);
    if (total > 0) items.push({ code: a.code, name: a.name, area: a.area, total });
  });
  items.sort((a,b) => b.total - a.total);
  const grandTotal = items.reduce((s,i) => s+i.total, 0);
  let cum = 0;
  items.forEach(it => { cum += it.total; it.share_pct = grandTotal>0?it.total/grandTotal*100:0; it.cum_pct = grandTotal>0?cum/grandTotal*100:0; });
  const totalAccts = items.length;
  let n80 = items.findIndex(it => it.cum_pct >= 80) + 1;
  if (n80 === 0) n80 = totalAccts;
  const pct80 = totalAccts > 0 ? n80/totalAccts*100 : 0;
  const top10Share = items.slice(0,10).reduce((s,i) => s+i.share_pct, 0);
  const top1Share = items.length ? items[0].share_pct : 0;

  const scopeLabel = scope === 'ALL' ? 'All products' : (scope === 'EPO' || scope === 'ZEMI') ? scope + ' Family' : scope;
  document.getElementById('pa-scope-label').textContent = scopeLabel + ' · ' + rangeLabel(p);
  document.getElementById('pa-area-label').textContent = area === 'ALL' ? 'All areas' : area;

  const level = pct80 < 20 ? '● Highly concentrated' : pct80 < 35 ? '● Concentrated' : '● Diversified';
  document.getElementById('pa-summary').innerHTML = `
    <div class="pstat"><div class="lab">Total accounts</div><div class="v">${totalAccts}</div><div class="s">${fmtCompact(grandTotal)} total revenue</div></div>
    <div class="pstat ${pct80 < 35 ? 'warn' : ''}"><div class="lab">Accounts driving 80%</div><div class="v">${n80} <span style="font-size:13px;opacity:.7">(${pct80.toFixed(1)}%)</span></div><div class="s">${level}</div></div>
    <div class="pstat"><div class="lab">Top 1 share</div><div class="v">${top1Share.toFixed(1)}%</div><div class="s">${items.length ? items[0].name.substring(0,28) : '—'}</div></div>
    <div class="pstat"><div class="lab">Top 10 share</div><div class="v">${top10Share.toFixed(1)}%</div><div class="s">of total revenue</div></div>`;

  let insight;
  if (pct80 < 20) insight = `<b>Concentration risk:</b> only ${n80} accounts (${pct80.toFixed(1)}%) drive 80% of ${scopeLabel} revenue — churn in any top account hits hard.`;
  else if (pct80 < 35) insight = `<b>Pareto holds:</b> top ${n80} accounts (${pct80.toFixed(1)}%) generate 80% — classic 80/20. Focus on these strategic accounts.`;
  else insight = `<b>Diversified base:</b> revenue is spread across many accounts (top ${pct80.toFixed(1)}% drive 80%). Lower concentration risk.`;
  document.getElementById('pa-insight').innerHTML = insight;

  if (paretoChart) paretoChart.destroy();
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const topN = Math.min(50, items.length);
  const view = items.slice(0, topN);
  paretoChart = new Chart(document.getElementById('pareto-chart'), {
    data: {
      labels: view.map((it,i) => i < 10 ? it.name.substring(0,18) : ''),
      datasets: [
        { type: 'bar', label: 'Share %', data: view.map(it => it.share_pct), backgroundColor: accent, yAxisID: 'y', order: 2, borderRadius: 2 },
        { type: 'line', label: 'Cumulative %', data: view.map(it => it.cum_pct), borderColor: '#d97706', backgroundColor: 'transparent', yAxisID: 'y1', order: 1, tension: .2, pointRadius: 0, borderWidth: 2.5 },
        { type: 'line', label: '80% line', data: new Array(topN).fill(80), borderColor: '#dc2f3a', borderDash: [4,4], yAxisID: 'y1', pointRadius: 0, borderWidth: 1.5, order: 0 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 14, padding: 8 } },
        tooltip: { callbacks: {
          title: ctx => view[ctx[0].dataIndex] ? view[ctx[0].dataIndex].name : '',
          label: ctx => {
            const it = view[ctx.dataIndex];
            if (ctx.dataset.label === 'Share %') return `Revenue: ${fmtCompact(it.total)} (${it.share_pct.toFixed(1)}%)`;
            if (ctx.dataset.label === 'Cumulative %') return `Cumulative: ${it.cum_pct.toFixed(1)}%`;
            return '';
          }
        }}
      },
      scales: {
        x: { ticks: { font: { size: 9 }, maxRotation: 45, minRotation: 45, autoSkip: false }, grid: { display: false } },
        y: { position: 'left', ticks: { callback: v => v.toFixed(1) + '%', font: { size: 11 } }, title: { display: true, text: 'Share %', font: { size: 11 } } },
        y1: { position: 'right', min: 0, max: 100, ticks: { callback: v => v + '%', font: { size: 11 } }, grid: { display: false }, title: { display: true, text: 'Cumulative %', font: { size: 11 } } }
      }
    }
  });
}

/* ---------- heatmap ---------- */
function yoyColor(yoy) {
  if (yoy === null || yoy === undefined) return { bg: '#e7ecf1', fg: '#8a95a4' };
  if (yoy <= -20) return { bg: '#b91c1c', fg: '#ffffff' };
  if (yoy <= -10) return { bg: '#ef4444', fg: '#ffffff' };
  if (yoy < 0)    return { bg: '#fca5a5', fg: '#7f1d1d' };
  if (yoy < 10)   return { bg: '#fef3c7', fg: '#78350f' };
  if (yoy < 20)   return { bg: '#86efac', fg: '#14532d' };
  if (yoy < 30)   return { bg: '#22c55e', fg: '#ffffff' };
  return { bg: '#15803d', fg: '#ffffff' };
}
function areaScopeSeries(area, scope) {
  const out = new Array(M.length).fill(0);
  DATA.accounts.filter(a => a.area === area).forEach(a => { const s = scopeSeries(a, scope); for (let i = 0; i < out.length; i++) out[i] += s[i]; });
  return out;
}
function renderHeatmap() {
  document.getElementById('hm-level-label').textContent = (state.level === 'family' ? 'Family' : 'Brand') + ' — ' + rangeLabel(P()) + ' vs ' + rangeLabel(C());
  const cols = state.level === 'family' ? familiesForArea() : brandsForArea();
  const rows = state.area === 'ALL' ? DATA.areas : [state.area];
  const p = P(), c = C();
  const inArea = (area, x) => state.level === 'family'
    ? (DATA.area_families[area] || []).includes(x)
    : (DATA.area_brands[area] || []).includes(x);
  let html = '<thead><tr><th></th>' + cols.map(x => {
    const color = state.level === 'family' ? FAM_COLOR[x].color : DATA.brands[x].color;
    return `<th style="color:${color}">${x}</th>`;
  }).join('') + '</tr></thead><tbody>';
  rows.forEach(area => {
    html += `<tr><td class="heat-area">${area}</td>`;
    cols.forEach(x => {
      if (!inArea(area, x)) { html += '<td></td>'; return; }
      const ser = areaScopeSeries(area, x);
      const curr = sumR(ser, p), prior = sumR(ser, c);
      const yoy = prior > 0 ? (curr - prior) / prior * 100 : (curr > 0 ? 100 : null);
      if (curr === 0 && prior === 0) {
        html += `<td><div class="heat-cell" style="background:#e7ecf1;color:#8a95a4"><div class="h-yoy">—</div><div class="h-val">No data</div></div></td>`;
      } else {
        const { bg, fg } = yoyColor(yoy);
        const sign = yoy >= 0 ? '+' : '';
        const yoyTxt = yoy === null ? 'NEW' : sign + yoy.toFixed(1) + '%';
        html += `<td><div class="heat-cell" style="background:${bg};color:${fg}" title="${area} × ${x}: ${fmtCompact(curr)} vs ${fmtCompact(prior)}"><div class="h-yoy">${yoyTxt}</div><div class="h-val">${fmtCompact(curr)}</div></div></td>`;
      }
    });
    html += '</tr>';
  });
  document.getElementById('heatmap-table').innerHTML = html + '</tbody>';
}

/* ---------- status strip ---------- */
function renderStats() {
  const summary = { growing: 0, stable: 0, at_risk: 0, new: 0 };
  activeAccounts().forEach(a => { const s = statusFor(a, state.scope); if (s in summary) summary[s]++; });
  const total = summary.growing + summary.stable + summary.at_risk + summary.new;
  document.getElementById('s-total').textContent = total;
  ['growing','stable','at_risk','new'].forEach(k => document.getElementById('s-'+k).textContent = summary[k]);
  document.getElementById('s-total-sub').textContent =
    ((state.scope === 'ALL' ? 'ALL STATUS' : 'IN ' + state.scope) + (state.area !== 'ALL' ? ' · ' + state.area : '')).toUpperCase();
}

/* ---------- account table ---------- */
function buildRow(acc) {
  const ser = scopeSeries(acc, state.scope);
  const status = statusFor(acc, state.scope);
  if (status === null) return null;
  const p = P(), c = C();
  const total = sumR(ser, p);
  const cmp = sumR(ser, c);
  if (total === 0 && status !== 'at_risk') return null;
  const yoy = cmp > 0 ? (total - cmp) / cmp * 100 : (total > 0 ? 100 : 0);
  const monthly = ser.slice(p.from, p.to + 1);
  return { ...acc, monthly, status, total, cmp, yoy };
}
function getFilteredRows() {
  const rows = [];
  for (const a of activeAccounts()) {
    if (state.search) {
      const s = state.search.toLowerCase();
      if (!a.name.toLowerCase().includes(s) && !a.code.includes(s)) continue;
    }
    const r = buildRow(a);
    if (!r) continue;
    if (state.status !== 'all' && r.status !== state.status) continue;
    rows.push(r);
  }
  const dir = state.sortDir === 'asc' ? 1 : -1;
  rows.sort((a,b) => {
    const va = a[state.sortBy], vb = b[state.sortBy];
    if (typeof va === 'string') return va.localeCompare(vb) * dir;
    return ((va||0) - (vb||0)) * dir;
  });
  return rows;
}
const STATUS_LABEL = { growing: 'Growing', stable: 'Stable', at_risk: 'At Risk', new: 'New' };
function renderTable() {
  const rows = getFilteredRows();
  const totalPages = Math.max(1, Math.ceil(rows.length / state.perPage));
  if (state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * state.perPage;
  const page = rows.slice(start, start + state.perPage);
  const p = P();

  document.getElementById('acc-tbody').innerHTML = page.map(r => {
    const max = Math.max(1, ...r.monthly);
    const spark = r.monthly.map((v,i) => {
      const h = v > 0 ? Math.max(8, v/max*100) : 4;
      return `<i class="${i >= r.monthly.length-3 ? 'r' : ''}" style="height:${h}%" title="${monthLabel(M[p.from+i])}: ${fmt(v)}"></i>`;
    }).join('');
    const yoyCls = r.yoy > 0 ? 'pos' : r.yoy < 0 ? 'neg' : '';
    return `<tr data-id="${accId(r)}">
      <td><div class="acct">${r.name}</div><div class="c">${r.code}</div></td>
      <td>${r.area.split('+').map(a => `<span class="atag">${a}</span>`).join(' ')}</td>
      <td><span class="st st-${r.status}"><span class="d"></span>${STATUS_LABEL[r.status]}</span></td>
      <td class="r money">${fmt(r.total)}</td>
      <td class="r money" style="color:var(--txt-2)">${fmt(r.cmp)}</td>
      <td class="r money ${yoyCls}" style="font-weight:600">${(r.yoy > 0 ? '+' : '')}${r.yoy.toFixed(1)}%</td>
      <td><span class="spark">${spark}</span></td>
    </tr>`;
  }).join('');

  document.getElementById('page-info').textContent =
    rows.length === 0 ? 'No accounts match' : `${start+1}–${Math.min(start+state.perPage, rows.length)} / ${rows.length}`;
  document.getElementById('prev-page').disabled = state.page <= 1;
  document.getElementById('next-page').disabled = state.page >= totalPages;

  document.querySelectorAll('#acc-tbody tr').forEach(tr =>
    tr.addEventListener('click', () => openDetail(tr.dataset.id)));
}

function renderActiveSection() {
  if (state.activeSection === 'overview') renderOverview();
  else if (state.activeSection === 'pareto') renderPareto();
  else renderHeatmap();
}
function renderAll() {
  renderActiveSection();
  renderStats();
  renderTable();
}

/* sort / search / status / pagination / export */
document.querySelectorAll('#acc-table th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (state.sortBy === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    else { state.sortBy = key; state.sortDir = ['name','area','status'].includes(key) ? 'asc' : 'desc'; }
    document.querySelectorAll('#acc-table th').forEach(t => {
      t.classList.remove('sorted');
      const arr = t.querySelector('.sort-arrow'); if (arr) arr.textContent = '▲▼';
    });
    th.classList.add('sorted');
    th.querySelector('.sort-arrow').textContent = state.sortDir === 'asc' ? '▲' : '▼';
    state.page = 1; renderTable();
  });
});
document.getElementById('search').addEventListener('input', e => {
  state.search = e.target.value; state.page = 1; renderTable();
});
document.querySelectorAll('.scard[data-filter]').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.scard').forEach(c => c.classList.remove('on'));
    card.classList.add('on');
    state.status = card.dataset.filter; state.page = 1; renderTable();
  });
});
document.getElementById('prev-page').addEventListener('click', () => { state.page--; renderTable(); });
document.getElementById('next-page').addEventListener('click', () => { state.page++; renderTable(); });
document.getElementById('btn-export').addEventListener('click', () => {
  const rows = getFilteredRows();
  const p = P();
  const months = []; for (let i = p.from; i <= p.to; i++) months.push(monthLabel(M[i]));
  const header = ['Code','Account','Area','Status','Total','Compare','YoY %', ...months];
  const csv = [header.join(',')];
  rows.forEach(r => csv.push([r.code, '"'+r.name.replace(/"/g,'""')+'"', r.area, r.status, r.total, r.cmp, r.yoy.toFixed(1), ...r.monthly].join(',')));
  const url = URL.createObjectURL(new Blob([csv.join('\n')], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'upc2_' + state.scope + (state.area !== 'ALL' ? '_' + state.area : '') + '_' + M[p.from] + '_' + M[p.to] + '.csv';
  link.click();
  URL.revokeObjectURL(url);
});

/* ---------- detail panel ---------- */
let trendChart = null, currentAccount = null;
function openDetail(id) {
  currentAccount = activeAccounts().find(x => accId(x) === id);
  if (!currentAccount) return;
  state.detailScope = state.scope;
  state.dCompare = 'single';
  document.querySelectorAll('#d-compare-toggle button').forEach(b => b.classList.toggle('on', b.dataset.mode === 'single'));
  renderDetailProdFilter();
  renderDetail();
  document.getElementById('detail').classList.add('open');
  document.getElementById('overlay').classList.add('open');
}
function renderDetailProdFilter() {
  const wrap = document.getElementById('detail-prod-filter');
  const acc = currentAccount;
  let html = '<span class="label">Product</span><button class="chip" data-dscope="ALL">All</button>';
  FAM_ORDER.forEach(f => {
    if (FAM_BRANDS[f].some(b => acc.brands[b])) {
      const c = FAM_COLOR[f];
      html += `<button class="chip" data-dscope="${f}" style="--chip-c:${c.color};--chip-t:${c.light}">${f}</button>`;
    }
  });
  Object.keys(DATA.brands).forEach(b => {
    if (acc.brands[b]) {
      const m = DATA.brands[b];
      html += `<button class="chip" data-dscope="${b}" style="--chip-c:${m.color};--chip-t:${m.colorLight}">${b}</button>`;
    }
  });
  wrap.innerHTML = html;
  wrap.querySelectorAll('.chip').forEach(c => {
    if (c.dataset.dscope === state.detailScope) c.classList.add('on');
    c.addEventListener('click', () => { state.detailScope = c.dataset.dscope; renderDetailProdFilter(); renderDetail(); });
  });
}
document.getElementById('d-compare-toggle').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('#d-compare-toggle button').forEach(x => x.classList.toggle('on', x === b));
  state.dCompare = b.dataset.mode;
  renderDetail();
});

function renderDetail() {
  const acc = currentAccount;
  const scope = state.detailScope;
  const ser = scopeSeries(acc, scope);
  const p = P(), c = C();
  const status = statusFor(acc, scope);
  const months = []; for (let i = p.from; i <= p.to; i++) months.push(i);

  const total = sumR(ser, p);
  const cmp = sumR(ser, c);
  const nCur = p.to - p.from + 1, nCmp = c.to - Math.max(0,c.from) + 1;
  const yoy = cmp > 0 ? (total - cmp) / cmp * 100 : (total > 0 ? 100 : 0);

  const header = document.querySelector('.detail-header');
  header.style.background = scope === 'ALL'
    ? getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    : scopeColor(scope).color;

  document.getElementById('d-name').textContent = acc.name;
  document.getElementById('d-sub').textContent = acc.code + ' · ' + acc.area + (scope !== 'ALL' ? ' · ' + scope : '');
  document.getElementById('d-total').textContent = fmt(total);
  document.getElementById('d-recent').textContent = fmt(total / nCur);
  document.getElementById('d-prior').textContent = fmt(cmp / Math.max(1,nCmp));
  const yoyCls = yoy > 0 ? 'pos' : yoy < 0 ? 'neg' : '';
  document.getElementById('d-yoy').innerHTML = `<span class="${yoyCls}">${yoy > 0 ? '+' : ''}${yoy.toFixed(1)}%</span>`;
  document.getElementById('d-yoy-cards').innerHTML = kpiStack(total, cmp);

  let explain = '';
  const avgCur = fmt(total / nCur), avgCmp = fmt(cmp / Math.max(1,nCmp));
  if (status === 'growing') explain = `<b style="color:var(--grow)">● Growing</b> — current ${avgCur}/mo vs compare ${avgCmp}/mo (${yoy > 0 ? '+' : ''}${yoy.toFixed(1)}%) → โต > 10% ขยายต่อได้`;
  else if (status === 'stable') explain = `<b style="color:var(--stable)">● Stable</b> — current vs compare ±10% (${yoy > 0 ? '+' : ''}${yoy.toFixed(1)}%) → ทรงตัว maintain`;
  else if (status === 'at_risk') explain = `<b style="color:var(--risk)">● At Risk</b> — current ${avgCur}/mo vs compare ${avgCmp}/mo (${yoy.toFixed(1)}%) → ต้องคุยกับลูกค้า`;
  else if (status === 'new') explain = `<b style="color:var(--new)">✦ New</b> — ลูกค้าใหม่ เริ่มซื้อ ${monthLabel(acc.first_month)} → เก็บ data, สร้าง relationship`;
  else explain = 'ไม่มียอดขายในกลุ่มสินค้านี้';
  document.getElementById('d-explain').innerHTML = explain;

  if (trendChart) trendChart.destroy();
  const labels = months.map(i => shortMonth(M[i]));
  let datasets;
  if (state.dCompare === 'compare') {
    const accent = scope === 'ALL' ? getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() : scopeColor(scope).color;
    const cmpData = labels.map((_,k) => { const ci = c.from + k; return ci >= 0 && ci <= c.to ? ser[ci] : null; });
    datasets = [
      { label: 'Current', data: months.map(i => ser[i]), backgroundColor: accent, borderRadius: 3, order: 2 },
      { label: 'Compare', data: cmpData, backgroundColor: '#c2cbd6', borderRadius: 3, order: 1 }
    ];
  } else if (scope === 'ALL' || scope === 'EPO' || scope === 'ZEMI') {
    const brandsToShow = scope === 'ALL' ? Object.keys(acc.brands) : FAM_BRANDS[scope].filter(b => acc.brands[b]);
    datasets = brandsToShow.map(b => ({ label: b, data: months.map(i => acc.brands[b].net[i]), backgroundColor: DATA.brands[b]?.color || '#888' }));
  } else {
    datasets = [{ label: scope, data: months.map(i => acc.brands[scope] ? acc.brands[scope].net[i] : 0), backgroundColor: DATA.brands[scope]?.color || '#888' }];
  }
  trendChart = new Chart(document.getElementById('trend-chart'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12, padding: 8 } },
        tooltip: { callbacks: {
          title: ctx => {
            const k = ctx[0].dataIndex;
            const cm = state.dCompare === 'compare' && (c.from + k) >= 0 ? M[c.from + k] : null;
            return monthLabel(M[p.from + k]) + (cm ? ' vs ' + monthLabel(cm) : '');
          },
          label: ctx => ctx.dataset.label + ': ' + fmt(ctx.parsed.y)
        }}
      },
      scales: {
        x: { stacked: state.dCompare === 'single', grid: { display: false }, ticks: { font: { size: 10 }, autoSkip: true, maxRotation: 0 } },
        y: { stacked: state.dCompare === 'single', grid: { color: '#eef1f5' }, ticks: { callback: v => fmtCompact(v), font: { size: 11 } } }
      }
    }
  });

  // brand × month table (current period months)
  let brandsToShow;
  if (scope === 'ALL') brandsToShow = Object.keys(acc.brands);
  else if (scope === 'EPO' || scope === 'ZEMI') brandsToShow = FAM_BRANDS[scope].filter(b => acc.brands[b]);
  else brandsToShow = [scope];
  let bthtml = '<thead><tr><th>Brand</th>' + months.map(i => `<th class="r">${shortMonth(M[i])}</th>`).join('') + '<th class="r">Total</th></tr></thead><tbody>';
  brandsToShow.forEach(b => {
    if (!acc.brands[b]) return;
    const vals = months.map(i => acc.brands[b].net[i]);
    const tot = vals.reduce((s,v) => s+v, 0);
    bthtml += `<tr><td class="bt-brand" style="color:${DATA.brands[b]?.color || '#888'}">${b}</td>`
            + vals.map(v => `<td class="r">${v > 0 ? fmtCompact(v) : '—'}</td>`).join('')
            + `<td class="r"><b>${fmtCompact(tot)}</b></td></tr>`;
  });
  document.getElementById('brand-table').innerHTML = bthtml + '</tbody>';

  // transactions (within current period)
  const lo = M[p.from], hi = M[p.to];
  let txns = acc.txns.filter(t => t.date.slice(0,7) >= lo && t.date.slice(0,7) <= hi);
  if (scope === 'EPO') txns = txns.filter(t => FAM_BRANDS.EPO.includes(t.brand));
  else if (scope === 'ZEMI') txns = txns.filter(t => FAM_BRANDS.ZEMI.includes(t.brand));
  else if (scope !== 'ALL') txns = txns.filter(t => t.brand === scope);
  document.getElementById('txn-count').textContent = txns.length;
  let txnHtml = txns.map(t => `
    <div class="txn-row">
      <span class="txn-date">${t.date}</span>
      <span><span class="txn-brand-tag" style="background:${DATA.brands[t.brand]?.color || '#888'}">${t.brand}</span> <span class="txn-mat">${t.material}</span></span>
      <span class="txn-qty">${t.qty}</span>
      <span class="txn-net">${fmt(t.net)}</span>
    </div>`).join('') || '<div class="txn-row" style="color:var(--txt-3)">ไม่มี transaction ในช่วงนี้</div>';
  // only the last 100 txns are stored — older periods may look emptier than reality
  if (acc.txns.length >= 100) txnHtml += '<div class="txn-row" style="color:var(--txt-3)">* เก็บเฉพาะ 100 รายการล่าสุด — ช่วงเก่าอาจแสดงไม่ครบ (ยอดรวมในกราฟ/ตารางครบถ้วน)</div>';
  document.getElementById('txn-list').innerHTML = txnHtml;
}

document.getElementById('close-detail').addEventListener('click', closeDetail);
document.getElementById('overlay').addEventListener('click', closeDetail);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });
function closeDetail() {
  document.getElementById('detail').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
}

/* ---------- init ---------- */
applyTheme();
buildPeriodControls();
syncControls();
renderAreaTabs();
renderProductChips();
renderAll();
};
