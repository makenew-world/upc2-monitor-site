/* UPC2 Account Monitor — app logic (ported from v4 prototype, Mist design)
   Runs after the password gate decrypts the payload (see auth.js). */
window.initApp = function () {
const DATA = window.DATA;

const FAM_ORDER = ['EPO', 'ZEMI'];
const FAM_BRANDS = { EPO: ['ESPOGEN','EPOTIV','EUVAX'], ZEMI: ['ZEMIGLO','ZEMIMET','ZEMIDAPA'] };
const FAM_COLOR = {
  EPO:  { color: '#1F3A5F', light: '#E6EBF2' },
  ZEMI: { color: '#F49800', light: '#FDF1DD' }
};
const MIST_ACCENT = { color: '#0e9384', tint: '#e1f4f0', bar: '#bfe6df' };

let state = {
  level: 'family', scope: 'ALL', search: '', area: 'ALL', status: 'all',
  sortBy: 'total12m', sortDir: 'desc', page: 1, perPage: 25,
  detailScope: 'ALL', ovCompare: 'single', dCompare: 'single',
  activeSection: 'overview'
};

/* ---------- helpers ---------- */
const fmt = n => Math.round(n).toLocaleString('en-US');
const fmtCompact = n => {
  n = Math.round(n);
  if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n/1e3).toFixed(0) + 'K';
  return fmt(n);
};
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const monthLabel = m => { const [y,mo]=m.split('-'); return MONTH_NAMES[+mo-1]+" '"+y.slice(2); };
const shortMonth = m => MONTH_NAMES[+m.split('-')[1]-1];
const scopeColor = s => s==='EPO'||s==='ZEMI' ? FAM_COLOR[s] : { color: DATA.brands[s].color, light: DATA.brands[s].colorLight };
const tint = (hex,pct) => `color-mix(in srgb, ${hex} ${pct}%, white)`;

Chart.defaults.font.family = "'Space Grotesk', sans-serif";
Chart.defaults.color = '#586675';

function getMonthlyAcc(acc, scope) {
  const len = DATA.months_curr.length;
  if (scope === 'ALL') return { curr: acc.total_curr, prior: acc.total_prior };
  if (scope === 'EPO' || scope === 'ZEMI') {
    const curr = new Array(len).fill(0), prior = new Array(len).fill(0);
    for (const b of FAM_BRANDS[scope]) {
      if (acc.brands[b]) {
        acc.brands[b].net.forEach((v,i) => curr[i] += v);
        acc.brands[b].net_prior.forEach((v,i) => prior[i] += v);
      }
    }
    return { curr, prior };
  }
  if (acc.brands[scope]) return { curr: acc.brands[scope].net.slice(), prior: acc.brands[scope].net_prior.slice() };
  return { curr: new Array(len).fill(0), prior: new Array(len).fill(0) };
}
const getStatus = (acc, scope) => acc.status[scope] || null;

/* multi-area: ALL view shows merged accounts (combined sales); an area filter
   shows per-area entries only. DU3/DU4 carry no EPO → hide those scopes there. */
const activeAccounts = () => state.area === 'ALL' ? DATA.accounts_merged : DATA.accounts.filter(a => a.area === state.area);
const familiesForArea = () => state.area === 'ALL' ? FAM_ORDER : (DATA.area_families[state.area] || FAM_ORDER);
const brandsForArea = () => state.area === 'ALL' ? Object.keys(DATA.brands) : (DATA.area_brands[state.area] || Object.keys(DATA.brands));
const accId = a => a.code + '|' + a.area;

/* ---------- theming: accent cascades through the Mist UI ---------- */
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

/* ---------- static header bits ---------- */
document.getElementById('range-label').textContent =
  'WINDOW: ' + DATA.months_curr[0] + ' → ' + DATA.latest_month + ' · 24M DATA';
document.getElementById('live-label').textContent =
  'SYNCED · ' + monthLabel(DATA.latest_month).toUpperCase().replace("'", '20') + ' · ' + DATA.total_accounts + ' ACCOUNTS';
document.getElementById('s-new-sub').textContent = "FIRST BUY '" + DATA.latest_month.slice(2,4);

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
    // scope may not exist in this area (e.g. EPO in DU3/DU4) → fall back to ALL
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
function aggForScope(scope, area) {
  if (area === 'ALL') return DATA.upc2_agg[scope] || { curr: [], prior: [] };
  const curr = new Array(DATA.months_curr.length).fill(0);
  const prior = new Array(DATA.months_curr.length).fill(0);
  DATA.accounts.filter(a => a.area === area).forEach(a => {
    const m = getMonthlyAcc(a, scope);
    m.curr.forEach((v,i) => curr[i] += v);
    m.prior.forEach((v,i) => prior[i] += v);
  });
  return { curr, prior };
}
function ytdPair(curr, prior) {
  const latestYear = DATA.latest_month.split('-')[0];
  const priorYear = String(+latestYear - 1);
  let c = 0, p = 0;
  DATA.months_curr.forEach((m,i) => { if (m.startsWith(latestYear)) c += curr[i]; });
  DATA.months_prior.forEach((m,i) => {
    if (m.startsWith(priorYear) && DATA.months_curr.some(cm => cm.startsWith(latestYear) && cm.endsWith(m.split('-')[1])))
      p += prior[i];
  });
  return { ytdCurr: c, ytdPrior: p, latestYear, priorYear };
}
function yoyKstack(currTotal, priorTotal, ytd) {
  const yoy = priorTotal > 0 ? (currTotal - priorTotal) / priorTotal * 100 : (currTotal > 0 ? 100 : 0);
  const ytdYoY = ytd.ytdPrior > 0 ? (ytd.ytdCurr - ytd.ytdPrior) / ytd.ytdPrior * 100 : (ytd.ytdCurr > 0 ? 100 : 0);
  const sign = v => (v >= 0 ? '+' : '');
  const cls = v => v >= 0 ? 'pos' : 'neg';
  return `
    <div class="k"><span class="lab">Current 12M</span><span class="val">${fmtCompact(currTotal).replace('M','<small>M</small>')}</span></div>
    <div class="k"><span class="lab">Prior 12M</span><span class="val" style="color:var(--txt-2)">${fmtCompact(priorTotal).replace('M','<small>M</small>')}</span></div>
    <div class="k"><span class="lab">12M YoY</span><span class="val ${cls(yoy)}">${sign(yoy)}${yoy.toFixed(1)}%</span></div>
    <div class="k"><span class="lab">YTD ’${ytd.latestYear.slice(2)} vs ’${ytd.priorYear.slice(2)}</span><span class="val ${cls(ytdYoY)}">${sign(ytdYoY)}${ytdYoY.toFixed(1)}%</span></div>
    <div class="k"><span class="lab">YTD totals</span><span class="sub">${fmtCompact(ytd.ytdCurr)} vs ${fmtCompact(ytd.ytdPrior)}</span></div>`;
}
function renderOverview() {
  const agg = aggForScope(state.scope, state.area);
  const currTotal = agg.curr.reduce((s,v) => s+v, 0);
  const priorTotal = agg.prior.reduce((s,v) => s+v, 0);
  const ytd = ytdPair(agg.curr, agg.prior);

  const scopeLabel = state.scope === 'ALL' ? 'All products' : (state.scope === 'EPO' || state.scope === 'ZEMI') ? state.scope + ' Family' : state.scope;
  document.getElementById('ov-title').textContent = 'Net sales / month — ' + scopeLabel;
  document.getElementById('ov-sub').textContent = (state.area === 'ALL' ? 'ALL AREAS' : state.area) + ' · THB';
  document.getElementById('ov-cards').innerHTML = yoyKstack(currTotal, priorTotal, ytd);

  if (overviewChart) overviewChart.destroy();
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const labels = DATA.months_curr.map(shortMonth);
  const datasets = [{ label: 'Current window', data: agg.curr, backgroundColor: accent, borderRadius: 4, order: 2 }];
  if (state.ovCompare === 'compare')
    datasets.push({ label: 'Prior year', data: agg.prior, backgroundColor: '#c2cbd6', borderRadius: 4, order: 1 });
  overviewChart = new Chart(document.getElementById('overview-chart'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 14, padding: 8 } },
        tooltip: { callbacks: {
          title: ctx => monthLabel(DATA.months_curr[ctx[0].dataIndex]) + (state.ovCompare === 'compare' ? ' vs ' + monthLabel(DATA.months_prior[ctx[0].dataIndex]) : ''),
          label: ctx => ctx.dataset.label + ': ' + fmt(ctx.parsed.y)
        }}
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
        y: { grid: { color: '#eef1f5' }, ticks: { callback: v => fmtCompact(v), font: { size: 11 } } }
      }
    }
  });
}
document.getElementById('ov-compare-toggle').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('#ov-compare-toggle button').forEach(x => x.classList.toggle('on', x === b));
  state.ovCompare = b.dataset.mode;
  if (state.activeSection === 'overview') renderOverview();
});

/* ---------- pareto ---------- */
let paretoChart = null;
function renderPareto() {
  const { scope, area } = state;
  const items = [];
  activeAccounts().forEach(a => {
    const { curr } = getMonthlyAcc(a, scope);
    const total = curr.reduce((s,v) => s+v, 0);
    if (total > 0) items.push({ code: a.code, name: a.name, area: a.area, total });
  });
  items.sort((a,b) => b.total - a.total);
  const total = items.reduce((s,i) => s+i.total, 0);
  let cum = 0;
  items.forEach(it => {
    cum += it.total;
    it.share_pct = total > 0 ? it.total/total*100 : 0;
    it.cum_pct = total > 0 ? cum/total*100 : 0;
  });
  const totalAccts = items.length;
  const grandTotal = items.reduce((s,i) => s+i.total, 0);
  let n80 = items.findIndex(it => it.cum_pct >= 80) + 1;
  if (n80 === 0) n80 = totalAccts;
  const pct80 = totalAccts > 0 ? n80/totalAccts*100 : 0;
  const top10Share = items.slice(0,10).reduce((s,i) => s+i.share_pct, 0);
  const top1Share = items.length ? items[0].share_pct : 0;

  const scopeLabel = scope === 'ALL' ? 'All products' : (scope === 'EPO' || scope === 'ZEMI') ? scope + ' Family' : scope;
  document.getElementById('pa-scope-label').textContent = scopeLabel;
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
function renderHeatmap() {
  document.getElementById('hm-level-label').textContent = state.level === 'family' ? 'Family' : 'Brand';
  const cols = state.level === 'family' ? familiesForArea() : brandsForArea();
  const rows = state.area === 'ALL' ? DATA.areas : [state.area];
  const inArea = (area, c) => state.level === 'family'
    ? (DATA.area_families[area] || []).includes(c)
    : (DATA.area_brands[area] || []).includes(c);
  let html = '<thead><tr><th></th>' + cols.map(c => {
    const color = state.level === 'family' ? FAM_COLOR[c].color : DATA.brands[c].color;
    return `<th style="color:${color}">${c}</th>`;
  }).join('') + '</tr></thead><tbody>';
  rows.forEach(area => {
    html += `<tr><td class="heat-area">${area}</td>`;
    cols.forEach(c => {
      const cell = DATA.heatmap[area]?.[c];
      if (!inArea(area, c)) {
        html += '<td></td>'; // product not sold in this area (e.g. EPO in DU3/DU4)
      } else if (!cell || cell.yoy === null) {
        html += `<td><div class="heat-cell" style="background:#e7ecf1;color:#8a95a4"><div class="h-yoy">—</div><div class="h-val">No data</div></div></td>`;
      } else {
        const { bg, fg } = yoyColor(cell.yoy);
        const sign = cell.yoy >= 0 ? '+' : '';
        html += `<td><div class="heat-cell" style="background:${bg};color:${fg}" title="${area} × ${c}: ${fmtCompact(cell.curr)} vs prior ${fmtCompact(cell.prior)}"><div class="h-yoy">${sign}${cell.yoy.toFixed(1)}%</div><div class="h-val">${fmtCompact(cell.curr)}</div></div></td>`;
      }
    });
    html += '</tr>';
  });
  document.getElementById('heatmap-table').innerHTML = html + '</tbody>';
}

/* ---------- status strip ---------- */
function renderStats() {
  const summary = { growing: 0, stable: 0, at_risk: 0, new: 0 };
  activeAccounts().forEach(a => {
    const s = a.status[state.scope];
    if (s in summary) summary[s]++;
  });
  const total = summary.growing + summary.stable + summary.at_risk + summary.new;
  document.getElementById('s-total').textContent = total;
  ['growing','stable','at_risk','new'].forEach(k => document.getElementById('s-'+k).textContent = summary[k]);
  document.getElementById('s-total-sub').textContent =
    ((state.scope === 'ALL' ? 'ALL STATUS' : 'IN ' + state.scope) + (state.area !== 'ALL' ? ' · ' + state.area : '')).toUpperCase();
}

/* ---------- account table ---------- */
function buildRow(acc) {
  const { curr, prior } = getMonthlyAcc(acc, state.scope);
  const status = getStatus(acc, state.scope);
  if (status === null) return null;
  const total12 = curr.reduce((s,v) => s+v, 0);
  if (total12 === 0 && state.scope !== 'ALL') return null;
  const recent3 = curr.slice(-3).reduce((s,v) => s+v, 0);
  const prior3 = prior.slice(-3).reduce((s,v) => s+v, 0);
  const yoy = prior3 > 0 ? (recent3 - prior3) / prior3 * 100 : (recent3 > 0 ? 100 : 0);
  return { ...acc, monthly: curr, status, total12m: total12, recent3, prior3, yoy };
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

  document.getElementById('acc-tbody').innerHTML = page.map(r => {
    const max = Math.max(1, ...r.monthly);
    const spark = r.monthly.map((v,i) => {
      const h = v > 0 ? Math.max(8, v/max*100) : 4;
      return `<i class="${i >= r.monthly.length-3 ? 'r' : ''}" style="height:${h}%" title="${monthLabel(DATA.months_curr[i])}: ${fmt(v)}"></i>`;
    }).join('');
    const yoyCls = r.yoy > 0 ? 'pos' : r.yoy < 0 ? 'neg' : '';
    return `<tr data-id="${accId(r)}">
      <td><div class="acct">${r.name}</div><div class="c">${r.code}</div></td>
      <td>${r.area.split('+').map(a => `<span class="atag">${a}</span>`).join(' ')}</td>
      <td><span class="st st-${r.status}"><span class="d"></span>${STATUS_LABEL[r.status]}</span></td>
      <td class="r money">${fmt(r.total12m)}</td>
      <td class="r money" style="color:var(--txt-2)">${fmt(r.recent3)}</td>
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
  const header = ['Code','Account','Area','Status','Total 12M','Recent 3M','YoY %', ...DATA.months_curr.map(monthLabel)];
  const csv = [header.join(',')];
  rows.forEach(r => csv.push([r.code, '"'+r.name.replace(/"/g,'""')+'"', r.area, r.status, r.total12m, r.recent3, r.yoy.toFixed(1), ...r.monthly].join(',')));
  const url = URL.createObjectURL(new Blob([csv.join('\n')], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'upc2_accounts_' + state.scope + (state.area !== 'ALL' ? '_' + state.area : '') + '.csv';
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
  document.querySelectorAll('#d-compare-toggle button').forEach(b =>
    b.classList.toggle('on', b.dataset.mode === 'single'));
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
    c.addEventListener('click', () => {
      state.detailScope = c.dataset.dscope;
      renderDetailProdFilter(); renderDetail();
    });
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
  const { curr, prior } = getMonthlyAcc(acc, scope);
  const status = getStatus(acc, scope);

  const total12 = curr.reduce((s,v) => s+v, 0);
  const totalPrior = prior.reduce((s,v) => s+v, 0);
  const recent3 = curr.slice(-3).reduce((s,v) => s+v, 0);
  const prior3 = prior.slice(-3).reduce((s,v) => s+v, 0);
  const yoy3 = prior3 > 0 ? (recent3 - prior3) / prior3 * 100 : (recent3 > 0 ? 100 : 0);
  const yoyTotal = totalPrior > 0 ? (total12 - totalPrior) / totalPrior * 100 : 0;
  const ytd = ytdPair(curr, prior);

  // header color follows detail scope
  const header = document.querySelector('.detail-header');
  header.style.background = scope === 'ALL'
    ? getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    : scopeColor(scope).color;

  document.getElementById('d-name').textContent = acc.name;
  document.getElementById('d-sub').textContent = acc.code + ' · ' + acc.area + (scope !== 'ALL' ? ' · ' + scope : '');
  document.getElementById('d-total').textContent = fmt(total12);
  document.getElementById('d-recent').textContent = fmt(recent3/3);
  document.getElementById('d-prior').textContent = fmt(prior3/3);
  const yoyCls = yoy3 > 0 ? 'pos' : yoy3 < 0 ? 'neg' : '';
  document.getElementById('d-yoy').innerHTML = `<span class="${yoyCls}">${yoy3 > 0 ? '+' : ''}${yoy3.toFixed(1)}%</span>`;

  document.getElementById('d-yoy-cards').innerHTML = yoyKstack(total12, totalPrior, ytd);

  let explain = '';
  if (status === 'growing') explain = `<b style="color:var(--grow)">● Growing</b> — Recent 3M avg ${fmt(recent3/3)} vs prior year ${fmt(prior3/3)} (${yoy3 > 0 ? '+' : ''}${yoy3.toFixed(1)}%) → โต > 10% ขยายต่อได้`;
  else if (status === 'stable') explain = `<b style="color:var(--stable)">● Stable</b> — Recent 3M vs prior year ±10% (${yoy3 > 0 ? '+' : ''}${yoy3.toFixed(1)}%) → ทรงตัว maintain`;
  else if (status === 'at_risk') explain = `<b style="color:var(--risk)">● At Risk</b> — Recent 3M avg ${fmt(recent3/3)} vs prior ${fmt(prior3/3)} (${yoy3.toFixed(1)}%) → ต้องคุยกับลูกค้า`;
  else if (status === 'new') explain = `<b style="color:var(--new)">✦ New</b> — ลูกค้าใหม่ เริ่มซื้อปี ${acc.first_year} → เก็บ data, สร้าง relationship`;
  else explain = 'ไม่มียอดขายในกลุ่มสินค้านี้';
  document.getElementById('d-explain').innerHTML = explain;

  if (trendChart) trendChart.destroy();
  const labels = DATA.months_curr.map(shortMonth);
  let datasets;
  if (state.dCompare === 'compare') {
    const accent = scope === 'ALL'
      ? getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      : scopeColor(scope).color;
    datasets = [
      { label: 'Current year', data: curr, backgroundColor: accent, borderRadius: 3, order: 2 },
      { label: 'Prior year', data: prior, backgroundColor: '#c2cbd6', borderRadius: 3, order: 1 }
    ];
  } else if (scope === 'ALL' || scope === 'EPO' || scope === 'ZEMI') {
    const brandsToShow = scope === 'ALL' ? Object.keys(acc.brands) : FAM_BRANDS[scope].filter(b => acc.brands[b]);
    datasets = brandsToShow.map(b => ({ label: b, data: acc.brands[b].net, backgroundColor: DATA.brands[b]?.color || '#888' }));
  } else {
    datasets = [{ label: scope, data: acc.brands[scope]?.net || [], backgroundColor: DATA.brands[scope]?.color || '#888' }];
  }
  trendChart = new Chart(document.getElementById('trend-chart'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12, padding: 8 } },
        tooltip: { callbacks: {
          title: ctx => state.dCompare === 'compare'
            ? monthLabel(DATA.months_curr[ctx[0].dataIndex]) + ' vs ' + monthLabel(DATA.months_prior[ctx[0].dataIndex])
            : monthLabel(DATA.months_curr[ctx[0].dataIndex]),
          label: ctx => ctx.dataset.label + ': ' + fmt(ctx.parsed.y)
        }}
      },
      scales: {
        x: { stacked: state.dCompare === 'single', grid: { display: false }, ticks: { font: { size: 10 } } },
        y: { stacked: state.dCompare === 'single', grid: { color: '#eef1f5' }, ticks: { callback: v => fmtCompact(v), font: { size: 11 } } }
      }
    }
  });

  // brand × month table
  let brandsToShow;
  if (scope === 'ALL') brandsToShow = Object.keys(acc.brands);
  else if (scope === 'EPO' || scope === 'ZEMI') brandsToShow = FAM_BRANDS[scope].filter(b => acc.brands[b]);
  else brandsToShow = [scope];
  let bthtml = '<thead><tr><th>Brand</th>' + DATA.months_curr.map(m => `<th class="r">${shortMonth(m)}</th>`).join('') + '<th class="r">Total</th></tr></thead><tbody>';
  brandsToShow.forEach(b => {
    if (!acc.brands[b]) return;
    const vals = acc.brands[b].net;
    const tot = vals.reduce((s,v) => s+v, 0);
    bthtml += `<tr><td class="bt-brand" style="color:${DATA.brands[b]?.color || '#888'}">${b}</td>`
            + vals.map(v => `<td class="r">${v > 0 ? fmtCompact(v) : '—'}</td>`).join('')
            + `<td class="r"><b>${fmtCompact(tot)}</b></td></tr>`;
  });
  document.getElementById('brand-table').innerHTML = bthtml + '</tbody>';

  // transactions
  let txns = acc.txns;
  if (scope === 'EPO') txns = txns.filter(t => FAM_BRANDS.EPO.includes(t.brand));
  else if (scope === 'ZEMI') txns = txns.filter(t => FAM_BRANDS.ZEMI.includes(t.brand));
  else if (scope !== 'ALL') txns = txns.filter(t => t.brand === scope);
  document.getElementById('txn-count').textContent = txns.length;
  document.getElementById('txn-list').innerHTML = txns.map(t => `
    <div class="txn-row">
      <span class="txn-date">${t.date}</span>
      <span><span class="txn-brand-tag" style="background:${DATA.brands[t.brand]?.color || '#888'}">${t.brand}</span> <span class="txn-mat">${t.material}</span></span>
      <span class="txn-qty">${t.qty}</span>
      <span class="txn-net">${fmt(t.net)}</span>
    </div>`).join('');
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
renderAreaTabs();
renderProductChips();
renderAll();
};
