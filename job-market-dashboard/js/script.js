/* ============================================================
   HIRING PULSE — script.js
   CSV load -> filter -> KPI count-up -> Chart.js -> table
   ============================================================ */

const CSV_PATH = 'data/india_job_market_2024_2026.csv';

let RAW_DATA = [];      // full parsed dataset
let FILTERED = [];      // dataset after applying current filters
let charts = {};        // Chart.js instances keyed by canvas id
let sortState = { key: 'Date_Posted', dir: 'desc' };
let currentPage = 1;
const ROWS_PER_PAGE = 25;

const PALETTE = ['#F5A524', '#2DD4BF', '#818CF8', '#FB7185', '#34D399', '#60A5FA', '#F472B6', '#FACC15', '#A78BFA', '#4ADE80'];

/* ---------------------------------------------------------
   INIT
--------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initSidebar();
  initThemeToggle();
  loadData();
});

/* ---------------------------------------------------------
   THEME
--------------------------------------------------------- */
function initTheme() {
  const saved = localStorage.getItem('hp-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
}

function initThemeToggle() {
  document.getElementById('themeToggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('hp-theme', next);
    // Re-render charts so axis/legend colors match the new theme
    Object.keys(charts).forEach(id => renderChart(id));
  });
}

/* ---------------------------------------------------------
   SIDEBAR NAV + MOBILE DRAWER
--------------------------------------------------------- */
function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const hamburger = document.getElementById('hamburger');

  hamburger.addEventListener('click', () => {
    sidebar.classList.toggle('is-open');
    overlay.classList.toggle('is-visible');
  });
  overlay.addEventListener('click', () => {
    sidebar.classList.remove('is-open');
    overlay.classList.remove('is-visible');
  });

  const titles = {
    overview: ['Overview', "A pulse check on India's tech hiring market"],
    salary: ['Salary Insights', 'How compensation shifts by industry, experience & location'],
    skills: ['Skills Demand', 'The skills employers are asking for right now'],
    companies: ['Companies', 'Who is hiring, and how they compare'],
    locations: ['Locations', 'Where the jobs are, and what they pay'],
    explorer: ['Job Explorer', 'Search, sort and export individual postings'],
  };

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const view = btn.dataset.view;
      document.querySelectorAll('.view').forEach(v => v.classList.remove('is-active'));
      document.getElementById('view-' + view).classList.add('is-active');

      document.getElementById('viewTitle').textContent = titles[view][0];
      document.getElementById('viewSub').textContent = titles[view][1];

      // KPI strip only makes sense on Overview; hide elsewhere for focus
      document.getElementById('kpiStrip').style.display = view === 'explorer' ? 'none' : 'grid';

      sidebar.classList.remove('is-open');
      overlay.classList.remove('is-visible');

      // Charts inside newly-visible sections need a resize nudge
      requestAnimationFrame(() => {
        Object.values(charts).forEach(c => c && c.resize && c.resize());
      });
    });
  });
}

/* ---------------------------------------------------------
   DATA LOADING
--------------------------------------------------------- */
function loadData() {
  Papa.parse(CSV_PATH, {
    download: true,
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    complete: (results) => {
      RAW_DATA = results.data.filter(r => r.Job_ID); // drop trailing blank rows
      populateFilters(RAW_DATA);
      applyFilters();
      document.getElementById('loader').classList.add('is-hidden');
    },
    error: (err) => {
      document.querySelector('.loader p').textContent =
        'Could not load the CSV. Serve this folder with Live Server (see README).';
      console.error(err);
    }
  });
}

function uniqueSorted(arr, key) {
  return [...new Set(arr.map(r => r[key]).filter(Boolean))].sort();
}

function populateFilters(data) {
  const map = {
    fIndustry: 'Industry',
    fExperience: 'Experience_Level',
    fWorkMode: 'Work_Mode',
    fTier: 'Location_Tier',
  };
  Object.entries(map).forEach(([selId, key]) => {
    const sel = document.getElementById(selId);
    uniqueSorted(data, key).forEach(val => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', applyFilters);
  });

  document.getElementById('resetFilters').addEventListener('click', () => {
    Object.keys(map).forEach(id => document.getElementById(id).value = 'all');
    document.getElementById('tableSearch').value = '';
    applyFilters();
  });

  document.getElementById('tableSearch').addEventListener('input', () => {
    currentPage = 1;
    renderTable();
  });

  document.getElementById('exportCsv').addEventListener('click', exportFilteredCsv);

  document.querySelectorAll('.data-table thead th').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (sortState.key === key) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sortState = { key, dir: 'asc' };
      }
      document.querySelectorAll('.data-table thead th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
      th.classList.add(sortState.dir === 'asc' ? 'sort-asc' : 'sort-desc');
      currentPage = 1;
      renderTable();
    });
  });
}

/* ---------------------------------------------------------
   FILTERING
--------------------------------------------------------- */
function applyFilters() {
  const industry = document.getElementById('fIndustry').value;
  const experience = document.getElementById('fExperience').value;
  const workMode = document.getElementById('fWorkMode').value;
  const tier = document.getElementById('fTier').value;

  FILTERED = RAW_DATA.filter(r =>
    (industry === 'all' || r.Industry === industry) &&
    (experience === 'all' || r.Experience_Level === experience) &&
    (workMode === 'all' || r.Work_Mode === workMode) &&
    (tier === 'all' || r.Location_Tier === tier)
  );

  currentPage = 1;
  updateKPIs(FILTERED);
  updateTicker(FILTERED);
  renderAllCharts(FILTERED);
  renderTable();
}

/* ---------------------------------------------------------
   KPI COUNT-UP
--------------------------------------------------------- */
function countUp(el, endValue, opts = {}) {
  const { decimals = 0, duration = 900 } = opts;
  const startValue = parseFloat(el.dataset.value) || 0;
  const startTime = performance.now();

  function tick(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = startValue + (endValue - startValue) * eased;
    el.textContent = decimals ? current.toFixed(decimals) : Math.round(current).toLocaleString('en-IN');
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      el.dataset.value = endValue;
    }
  }
  requestAnimationFrame(tick);
}

function updateKPIs(data) {
  const totalJobs = data.length;
  const avgSalary = totalJobs ? data.reduce((s, r) => s + (r.Salary_LPA || 0), 0) / totalJobs : 0;
  const totalOpenings = data.reduce((s, r) => s + (r.Openings || 0), 0);
  const totalApplicants = data.reduce((s, r) => s + (r.Applicants || 0), 0);
  const avgRating = totalJobs ? data.reduce((s, r) => s + (r.Company_Rating || 0), 0) / totalJobs : 0;

  countUp(document.getElementById('kpiJobs'), totalJobs);
  countUp(document.getElementById('kpiSalary'), avgSalary, { decimals: 1 });
  countUp(document.getElementById('kpiOpenings'), totalOpenings);
  countUp(document.getElementById('kpiApplicants'), totalApplicants);
  countUp(document.getElementById('kpiRating'), avgRating, { decimals: 1 });
}

/* ---------------------------------------------------------
   TICKER
--------------------------------------------------------- */
function updateTicker(data) {
  const cities = new Set(data.map(r => r.City)).size;
  const industries = new Set(data.map(r => r.Industry)).size;
  const companies = new Set(data.map(r => r.Company)).size;
  const remotePct = data.length ? Math.round(100 * data.filter(r => r.Work_Mode === 'Remote').length / data.length) : 0;
  const avgSalary = data.length ? (data.reduce((s, r) => s + (r.Salary_LPA || 0), 0) / data.length).toFixed(1) : 0;
  const topIndustry = mostCommon(data, 'Industry');

  const facts = [
    `${data.length.toLocaleString('en-IN')} jobs tracked`,
    `₹${avgSalary} LPA avg salary`,
    `${cities} cities`,
    `${industries} industries`,
    `${companies} companies hiring`,
    `${remotePct}% remote roles`,
    `${topIndustry || '—'} leads hiring volume`,
  ];

  const track = document.getElementById('tickerTrack');
  const html = facts.map(f => `<span>${f}</span>`).join('');
  track.innerHTML = html + html; // duplicate for seamless marquee loop
}

function mostCommon(data, key) {
  const counts = {};
  data.forEach(r => { if (r[key]) counts[r[key]] = (counts[r[key]] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
}

/* ---------------------------------------------------------
   AGGREGATION HELPERS
--------------------------------------------------------- */
function countBy(data, key) {
  const counts = {};
  data.forEach(r => { const v = r[key] || 'Unknown'; counts[v] = (counts[v] || 0) + 1; });
  return counts;
}

function avgSalaryBy(data, key) {
  const sums = {}, counts = {};
  data.forEach(r => {
    const v = r[key] || 'Unknown';
    sums[v] = (sums[v] || 0) + (r.Salary_LPA || 0);
    counts[v] = (counts[v] || 0) + 1;
  });
  const out = {};
  Object.keys(sums).forEach(k => out[k] = +(sums[k] / counts[k]).toFixed(1));
  return out;
}

function avgRatingBy(data, key) {
  const sums = {}, counts = {};
  data.forEach(r => {
    const v = r[key] || 'Unknown';
    sums[v] = (sums[v] || 0) + (r.Company_Rating || 0);
    counts[v] = (counts[v] || 0) + 1;
  });
  const out = {};
  Object.keys(sums).forEach(k => out[k] = +(sums[k] / counts[k]).toFixed(2));
  return out;
}

function sortEntries(obj, desc = true) {
  return Object.entries(obj).sort((a, b) => desc ? b[1] - a[1] : a[1] - b[1]);
}

function skillFrequency(data) {
  const counts = {};
  data.forEach(r => {
    if (!r.Skills_Required) return;
    r.Skills_Required.split(',').map(s => s.trim()).filter(Boolean).forEach(skill => {
      counts[skill] = (counts[skill] || 0) + 1;
    });
  });
  return counts;
}

function monthKey(dateStr) {
  // dates arrive as 'YYYY-MM-DD' — parse directly to avoid UTC/local
  // timezone shifts that new Date() introduces for date-only strings.
  if (!dateStr || typeof dateStr !== 'string') return null;
  const match = dateStr.match(/^(\d{4})-(\d{2})-\d{2}$/);
  return match ? `${match[1]}-${match[2]}` : null;
}

/* ---------------------------------------------------------
   CHART THEME
--------------------------------------------------------- */
function chartTheme() {
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  return {
    text: light ? '#666B78' : '#8B93A7',
    grid: light ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.06)',
    font: "'Inter', sans-serif",
  };
}

Chart.defaults.font.family = "'Inter', sans-serif";

/* ---------------------------------------------------------
   CHART CONFIG REGISTRY
   Each function returns a Chart.js config given the filtered data.
--------------------------------------------------------- */
const chartBuilders = {

  chartTrend(data) {
    const t = chartTheme();
    const counts = {};
    data.forEach(r => { const m = monthKey(r.Date_Posted); if (m) counts[m] = (counts[m] || 0) + 1; });
    const labels = Object.keys(counts).sort();
    return {
      type: 'line',
      data: {
        labels: labels.map(l => {
          const [y, m] = l.split('-');
          return new Date(y, m - 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
        }),
        datasets: [{
          label: 'Postings',
          data: labels.map(l => counts[l]),
          borderColor: PALETTE[0],
          backgroundColor: 'rgba(245,165,36,.12)',
          fill: true,
          tension: 0.35,
          pointRadius: 2,
          pointHoverRadius: 5,
          borderWidth: 2.5,
        }]
      },
      options: baseOptions(t, { legend: false })
    };
  },

  chartWorkMode(data) {
    return donutConfig(countBy(data, 'Work_Mode'));
  },

  chartTitles(data) {
    const counts = countBy(data, 'Job_Title');
    const top = sortEntries(counts).slice(0, 10);
    return horizontalBarConfig(top);
  },

  chartExperience(data) {
    const order = ['Fresher (0-1 yr)', 'Junior (1-3 yrs)', 'Mid (3-6 yrs)', 'Senior (6-10 yrs)', 'Lead (10+ yrs)'];
    const counts = countBy(data, 'Experience_Level');
    const t = chartTheme();
    return {
      type: 'bar',
      data: {
        labels: order,
        datasets: [{
          label: 'Postings',
          data: order.map(k => counts[k] || 0),
          backgroundColor: PALETTE.slice(0, order.length),
          borderRadius: 6,
          maxBarThickness: 46,
        }]
      },
      options: baseOptions(t, { legend: false })
    };
  },

  chartSalaryIndustry(data) {
    const avg = avgSalaryBy(data, 'Industry');
    return horizontalBarConfig(sortEntries(avg), '₹ LPA');
  },

  chartSalaryExp(data) {
    const order = ['Fresher (0-1 yr)', 'Junior (1-3 yrs)', 'Mid (3-6 yrs)', 'Senior (6-10 yrs)', 'Lead (10+ yrs)'];
    const avg = avgSalaryBy(data, 'Experience_Level');
    const t = chartTheme();
    return {
      type: 'bar',
      data: {
        labels: order,
        datasets: [{
          label: '₹ LPA',
          data: order.map(k => avg[k] || 0),
          backgroundColor: PALETTE[1],
          borderRadius: 6,
          maxBarThickness: 46,
        }]
      },
      options: baseOptions(t, { legend: false })
    };
  },

  chartSalaryTier(data) {
    const avg = avgSalaryBy(data, 'Location_Tier');
    const sorted = sortEntries(avg);
    const t = chartTheme();
    return {
      type: 'bar',
      data: {
        labels: sorted.map(s => s[0]),
        datasets: [{ label: '₹ LPA', data: sorted.map(s => s[1]), backgroundColor: PALETTE[2], borderRadius: 6, maxBarThickness: 60 }]
      },
      options: baseOptions(t, { legend: false })
    };
  },

  chartSalaryCompanyType(data) {
    const avg = avgSalaryBy(data, 'Company_Type');
    const sorted = sortEntries(avg);
    const t = chartTheme();
    return {
      type: 'bar',
      data: {
        labels: sorted.map(s => s[0]),
        datasets: [{ label: '₹ LPA', data: sorted.map(s => s[1]), backgroundColor: PALETTE[3], borderRadius: 6, maxBarThickness: 60 }]
      },
      options: baseOptions(t, { legend: false })
    };
  },

  chartSkills(data) {
    const freq = skillFrequency(data);
    const top = sortEntries(freq).slice(0, 15);
    return horizontalBarConfig(top, 'mentions');
  },

  chartEducation(data) {
    return donutConfig(countBy(data, 'Education_Required'));
  },

  chartCompanies(data) {
    const counts = countBy(data, 'Company');
    const top = sortEntries(counts).slice(0, 10);
    return horizontalBarConfig(top);
  },

  chartCompanyType(data) {
    return donutConfig(countBy(data, 'Company_Type'));
  },

  chartRatingByType(data) {
    const avg = avgRatingBy(data, 'Company_Type');
    const sorted = sortEntries(avg);
    const t = chartTheme();
    return {
      type: 'bar',
      data: {
        labels: sorted.map(s => s[0]),
        datasets: [{ label: 'Avg Rating / 5', data: sorted.map(s => s[1]), backgroundColor: PALETTE[4], borderRadius: 6, maxBarThickness: 70 }]
      },
      options: baseOptions(t, { legend: false, max: 5 })
    };
  },

  chartCities(data) {
    const counts = countBy(data, 'City');
    const top = sortEntries(counts).slice(0, 11);
    return horizontalBarConfig(top);
  },

  chartTierSplit(data) {
    return donutConfig(countBy(data, 'Location_Tier'));
  },

  chartCityPay(data) {
    const counts = countBy(data, 'City');
    const avg = avgSalaryBy(data, 'City');
    const eligible = Object.keys(counts).filter(c => counts[c] >= 40);
    const sorted = eligible.map(c => [c, avg[c]]).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const t = chartTheme();
    return {
      type: 'bar',
      data: {
        labels: sorted.map(s => s[0]),
        datasets: [{ label: '₹ LPA', data: sorted.map(s => s[1]), backgroundColor: PALETTE[5], borderRadius: 6, maxBarThickness: 46 }]
      },
      options: baseOptions(t, { legend: false })
    };
  },
};

function baseOptions(t, opts = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 700, easing: 'easeOutCubic' },
    plugins: {
      legend: {
        display: opts.legend !== false,
        position: 'bottom',
        labels: { color: t.text, font: { size: 11 }, boxWidth: 10, padding: 14 }
      },
      tooltip: {
        backgroundColor: document.documentElement.getAttribute('data-theme') === 'light' ? '#fff' : '#1E2430',
        titleColor: t.text === '#666B78' ? '#181A1F' : '#E8EAF0',
        bodyColor: t.text,
        borderColor: 'rgba(150,150,150,.15)',
        borderWidth: 1,
        padding: 10,
        cornerRadius: 8,
      }
    },
    scales: {
      x: { ticks: { color: t.text, font: { size: 10.5 } }, grid: { color: t.grid, drawBorder: false }, max: opts.max },
      y: { ticks: { color: t.text, font: { size: 10.5 } }, grid: { color: t.grid, drawBorder: false }, beginAtZero: true, max: opts.max }
    }
  };
}

function horizontalBarConfig(entries, unitLabel = '') {
  const t = chartTheme();
  const labels = entries.map(e => e[0]);
  const values = entries.map(e => e[1]);
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: unitLabel || 'count',
        data: values,
        backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
        borderRadius: 5,
        maxBarThickness: 20,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 700, easing: 'easeOutCubic' },
      plugins: { legend: { display: false }, tooltip: baseOptions(t).plugins.tooltip },
      scales: {
        x: { ticks: { color: t.text, font: { size: 10.5 } }, grid: { color: t.grid, drawBorder: false }, beginAtZero: true },
        y: { ticks: { color: t.text, font: { size: 10.5 } }, grid: { display: false } }
      }
    }
  };
}

function donutConfig(counts) {
  const t = chartTheme();
  const labels = Object.keys(counts);
  const values = Object.values(counts);
  return {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
        borderColor: document.documentElement.getAttribute('data-theme') === 'light' ? '#fff' : '#171B24',
        borderWidth: 3,
        hoverOffset: 8,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      animation: { duration: 700, easing: 'easeOutCubic' },
      plugins: {
        legend: { position: 'bottom', labels: { color: t.text, font: { size: 10.5 }, boxWidth: 9, padding: 10 } },
        tooltip: baseOptions(t).plugins.tooltip,
      }
    }
  };
}

/* ---------------------------------------------------------
   RENDER / UPSERT CHARTS
--------------------------------------------------------- */
function renderChart(id) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const config = chartBuilders[id](FILTERED);
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(canvas.getContext('2d'), config);
}

function renderAllCharts() {
  Object.keys(chartBuilders).forEach(renderChart);
}

/* ---------------------------------------------------------
   TABLE: search + sort + paginate + export
--------------------------------------------------------- */
function getTableData() {
  const q = document.getElementById('tableSearch').value.trim().toLowerCase();
  let rows = FILTERED;
  if (q) {
    rows = rows.filter(r =>
      (r.Job_Title || '').toLowerCase().includes(q) ||
      (r.Company || '').toLowerCase().includes(q)
    );
  }
  const { key, dir } = sortState;
  rows = [...rows].sort((a, b) => {
    let va = a[key], vb = b[key];
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });
  return rows;
}

function renderTable() {
  const rows = getTableData();
  document.getElementById('resultCount').textContent = `${rows.length.toLocaleString('en-IN')} results`;

  const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * ROWS_PER_PAGE;
  const pageRows = rows.slice(start, start + ROWS_PER_PAGE);

  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = pageRows.map(r => `
    <tr>
      <td class="title-cell">${escapeHtml(r.Job_Title)}</td>
      <td>${escapeHtml(r.Company)}</td>
      <td>${escapeHtml(r.Industry)}</td>
      <td>${escapeHtml(r.City)}</td>
      <td>${escapeHtml(r.Experience_Level)}</td>
      <td class="num">${(r.Salary_LPA ?? '').toFixed ? r.Salary_LPA.toFixed(1) : r.Salary_LPA}</td>
      <td class="num">${r.Openings}</td>
      <td class="num">${r.Applicants}</td>
      <td class="num">${r.Company_Rating}</td>
      <td>${escapeHtml(r.Date_Posted)}</td>
    </tr>
  `).join('') || `<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-faint);">No postings match your filters.</td></tr>`;

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const wrap = document.getElementById('pagination');
  let html = '';
  html += `<button class="page-btn" id="pgPrev" ${currentPage === 1 ? 'disabled' : ''}>‹</button>`;

  const windowSize = 2;
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= currentPage - windowSize && p <= currentPage + windowSize)) {
      html += `<button class="page-btn ${p === currentPage ? 'is-active' : ''}" data-page="${p}">${p}</button>`;
    } else if (p === currentPage - windowSize - 1 || p === currentPage + windowSize + 1) {
      html += `<span style="color:var(--text-faint);padding:0 4px;">…</span>`;
    }
  }
  html += `<button class="page-btn" id="pgNext" ${currentPage === totalPages ? 'disabled' : ''}>›</button>`;
  wrap.innerHTML = html;

  document.getElementById('pgPrev')?.addEventListener('click', () => { currentPage--; renderTable(); });
  document.getElementById('pgNext')?.addEventListener('click', () => { currentPage++; renderTable(); });
  wrap.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => { currentPage = +btn.dataset.page; renderTable(); });
  });
}

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function exportFilteredCsv() {
  const rows = getTableData();
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csvLines = [headers.join(',')];
  rows.forEach(r => {
    csvLines.push(headers.map(h => {
      const val = r[h] ?? '';
      const s = String(val);
      return s.includes(',') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','));
  });
  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'hiring_pulse_filtered.csv';
  a.click();
  URL.revokeObjectURL(url);
}
