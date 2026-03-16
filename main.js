/**
 * ══════════════════════════════════════════
 *  Vacation Plan – Main Application Logic
 * ══════════════════════════════════════════
 */

// ── Configuration ──
const API_BASE = 'https://151.145.89.228.sslip.io/webhook/979/vacation/';
const HEBCAL_API = 'https://www.hebcal.com/hebcal';

// ── Status Definitions ──
const STATUS_MAP = {
  '1': { label: 'בבסיס', emoji: '🪖', cls: 'status-1' },
  '0': { label: 'בבית', emoji: '🏠', cls: 'status-0' },
  '2': { label: 'מחלה', emoji: '🤒', cls: 'status-2' },
  '3': { label: 'חופש', emoji: '🌴', cls: 'status-3' },
  '4': { label: 'פיצול', emoji: '⚖️', cls: 'status-4' },
  '5': { label: 'שוחרר', emoji: '🚪', cls: 'status-5' },
};

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
];

const HEBREW_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

// ── DOM References ──
const searchForm = document.getElementById('search-form');
const idInput = document.getElementById('id-input');
const searchBtn = document.getElementById('search-btn');
const resultsContainer = document.getElementById('results-container');
const statsSection = document.getElementById('stats-section');
const monthNav = document.getElementById('month-nav');
const calendarsContainer = document.getElementById('calendars-container');
const loadingOverlay = document.getElementById('loading-overlay');
const themeToggle = document.getElementById('theme-toggle');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const userIdLabel = document.getElementById('user-id-label');
const btnPdf = document.getElementById('btn-pdf');
const btnIcs = document.getElementById('btn-ics');
const pdfExportContainer = document.getElementById('pdf-export-container');

// ── State ──
let currentData = null;
let parsedDays = [];
let holidays = {};
let activeMonth = null;

// ── Deep Linking: check URL params ──
// Clear URL parameters on load for clean display
if (window.location.search) {
  const url = new URL(window.location);
  url.search = '';
  window.history.replaceState({}, '', url);
}

// ══════════════════════════════════════════
//  Theme Management
// ══════════════════════════════════════════
function getCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function applyTheme(isLight) {
  document.body.classList.toggle('light-mode', isLight);
  themeToggle.textContent = isLight ? '🌙' : '☀️';
}

const savedTheme = getCookie('vacation-theme');
applyTheme(savedTheme === 'light');

themeToggle.addEventListener('click', () => {
  const isNowLight = !document.body.classList.contains('light-mode');
  applyTheme(isNowLight);
  setCookie('vacation-theme', isNowLight ? 'light' : 'dark', 365);
});

// ══════════════════════════════════════════
//  Main Flow
// ══════════════════════════════════════════
searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const id = idInput.value.trim();
  if (!id) return;
  fetchVacationPlan(id);
});

async function fetchVacationPlan(id) {
  showLoading(true);
  try {
    const response = await fetch(`${API_BASE}?id=${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`שגיאה ${response.status}`);
    
    // Check if response is JSON
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error('Non-JSON response:', text);
      throw new Error('השרת החזיר תגובה לא תקינה');
    }

    const data = await response.json();
    if (!data || typeof data !== 'object') throw new Error('לא נמצאו נתונים');
    currentData = data;

    // Parse dates from the data
    parsedDays = parseDates(data);
    if (parsedDays.length === 0) throw new Error('לא נמצאו ימי חופשה בנתונים');

    // Fetch holidays
    const years = [...new Set(parsedDays.map(d => d.date.getFullYear()))];
    holidays = await fetchHolidays(years);

    // Render
    renderUserInfo(data, id);
    renderStats(parsedDays);
    renderCalendars(parsedDays);
    resultsContainer.classList.remove('hidden');
  } catch (error) {
    console.error('Error:', error);
    resultsContainer.classList.add('hidden');
    showError(error.message);
  } finally {
    showLoading(false);
  }
}

// ══════════════════════════════════════════
//  Data Parsing
// ══════════════════════════════════════════
function parseDates(data) {
  const days = [];
  const datePattern = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;

  for (const [key, value] of Object.entries(data)) {
    const match = key.trim().match(datePattern);
    if (match) {
      const day = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1; // 0-indexed
      let year = parseInt(match[3], 10);
      if (year < 100) year += 2000;

      const date = new Date(year, month, day);
      const strValue = String(value).trim();

      days.push({
        date,
        day,
        month,
        year,
        key,
        rawValue: value,
        status: strValue,
      });
    }
  }

  // Sort by date
  days.sort((a, b) => a.date - b.date);
  return days;
}

// ══════════════════════════════════════════
//  Hebrew Holidays (Hebcal API)
// ══════════════════════════════════════════
async function fetchHolidays(years) {
  const allHolidays = {};
  try {
    const fetches = years.map(year =>
      fetch(`${HEBCAL_API}?v=1&cfg=json&maj=on&min=on&mod=on&nx=off&year=${year}&month=x&ss=off&mf=off&c=off&geo=none&s=off`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    );
    const results = await Promise.all(fetches);
    for (const result of results) {
      if (result && result.items) {
        for (const item of result.items) {
          if (item.date) {
            const dateKey = item.date; // "YYYY-MM-DD"
            if (!allHolidays[dateKey]) allHolidays[dateKey] = [];
            allHolidays[dateKey].push(item.hebrew || item.title);
          }
        }
      }
    }
  } catch (e) {
    console.warn('Could not fetch holidays:', e);
  }
  return allHolidays;
}

function getHolidayForDate(date) {
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return holidays[key] || null;
}

// ══════════════════════════════════════════
//  Rendering: User Info
// ══════════════════════════════════════════
function renderUserInfo(data, id) {
  const name = data['שם'] || data['name'] || 'משתמש';
  userName.textContent = name;
  userIdLabel.textContent = `מ.א: ${id}`;
  userAvatar.textContent = name.charAt(0);
}

// ══════════════════════════════════════════
//  Rendering: Stats Dashboard
// ══════════════════════════════════════════
function renderStats(days) {
  const counts = { '1': 0, '0': 0, '2': 0, '3': 0, '4': 0, '5': 0, 'empty': 0 };
  for (const d of days) {
    if (d.status === '' || d.status === undefined || d.status === null) {
      counts['empty']++;
    } else if (counts.hasOwnProperty(d.status)) {
      counts[d.status]++;
    } else {
      counts['empty']++;
    }
  }

  statsSection.innerHTML = `
    <div class="stat-card glass-card stat-base" style="animation-delay: 0.1s">
      <div class="stat-icon">🪖</div>
      <div class="stat-value">${counts['1']}</div>
      <div class="stat-label">ימי בסיס</div>
    </div>
    <div class="stat-card glass-card stat-home" style="animation-delay: 0.2s">
      <div class="stat-icon">🏠</div>
      <div class="stat-value">${counts['0']}</div>
      <div class="stat-label">ימי בית</div>
    </div>
    <div class="stat-card glass-card stat-sick" style="animation-delay: 0.3s">
      <div class="stat-icon">🤒</div>
      <div class="stat-value">${counts['2']}</div>
      <div class="stat-label">מחלה / גימלים</div>
    </div>
    <div class="stat-card glass-card stat-other" style="animation-delay: 0.4s">
      <div class="stat-icon">🌴</div>
      <div class="stat-value">${counts['3']}</div>
      <div class="stat-label">חופש</div>
    </div>
    <div class="stat-card glass-card stat-split" style="animation-delay: 0.5s">
      <div class="stat-icon">⚖️</div>
      <div class="stat-value">${counts['4']}</div>
      <div class="stat-label">פיצול</div>
    </div>
    <div class="stat-card glass-card stat-released" style="animation-delay: 0.6s">
      <div class="stat-icon">🚪</div>
      <div class="stat-value">${counts['5']}</div>
      <div class="stat-label">שוחרר</div>
    </div>
  `;
}

// ══════════════════════════════════════════
//  Rendering: Calendar
// ══════════════════════════════════════════
function renderCalendars(days) {
  // Group days by month
  const months = {};
  for (const d of days) {
    const monthKey = `${d.year}-${String(d.month).padStart(2, '0')}`;
    if (!months[monthKey]) {
      months[monthKey] = { year: d.year, month: d.month, days: {} };
    }
    months[monthKey].days[d.day] = d;
  }

  const sortedMonths = Object.keys(months).sort();

  // Hide month navigation if it exists
  if (monthNav) monthNav.style.display = 'none';

  // Render each month calendar in a list
  calendarsContainer.innerHTML = sortedMonths.map((key) => {
    const m = months[key];
    return `
      <div class="calendar-month-wrapper">
        <h3 class="month-header">${HEBREW_MONTHS[m.month]} ${m.year}</h3>
        <div class="calendar-month-container" data-month="${key}">
          ${renderMonthCalendar(m.year, m.month, m.days)}
        </div>
      </div>
    `;
  }).join('');
}

function renderMonthCalendar(year, month, daysMap) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const totalDays = lastDay.getDate();
  // In Hebrew calendar, week starts on Sunday (0)
  const startDow = firstDay.getDay(); // 0=Sun

  let html = `<div class="calendar-grid">`;

  // Day headers (Sun to Sat for Hebrew)
  for (let i = 0; i < 7; i++) {
    const isShabbat = i === 6;
    html += `<div class="calendar-day-header${isShabbat ? ' shabbat' : ''}">${HEBREW_DAYS[i]}</div>`;
  }

  // Empty cells before first day
  for (let i = 0; i < startDow; i++) {
    html += `<div class="calendar-day empty"></div>`;
  }

  // Day cells
  for (let day = 1; day <= totalDays; day++) {
    const date = new Date(year, month, day);
    const dayData = daysMap[day];
    const isToday = `${year}-${month}-${day}` === todayStr;
    const dow = date.getDay();
    const isShabbat = dow === 6;
    const holidayList = getHolidayForDate(date);

    let statusCls = 'status-empty';
    let statusLabel = '';
    let statusEmoji = '';

    if (dayData) {
      const s = dayData.status;
      if (s !== '' && s !== undefined && s !== null && STATUS_MAP[s]) {
        statusCls = STATUS_MAP[s].cls;
        statusLabel = STATUS_MAP[s].label;
        statusEmoji = STATUS_MAP[s].emoji;
      } else if (s === '' || s === undefined || s === null) {
        statusCls = 'status-empty';
        statusLabel = '';
      } else {
        statusCls = 'status-empty';
        statusLabel = s;
      }
    }

    const classes = [
      'calendar-day',
      statusCls,
      isToday ? 'today' : '',
      holidayList ? 'holiday-day' : '',
      isShabbat ? 'shabbat-day' : '',
    ].filter(Boolean).join(' ');

    const holidayTitle = holidayList ? holidayList.join(', ') : '';
    const tooltipParts = [];
    if (statusLabel) tooltipParts.push(statusLabel);
    if (holidayTitle) tooltipParts.push(holidayTitle);
    const tooltip = tooltipParts.join(' | ');

    html += `<div class="${classes}" title="${tooltip}">
      <span class="day-number">${day}</span>
      ${statusLabel ? `<span class="day-status">${statusEmoji || statusLabel}</span>` : ''}
      ${holidayList ? `<span class="day-holiday">${holidayList[0]}</span>` : ''}
    </div>`;
  }

  html += `</div>`;
  return html;
}

// ══════════════════════════════════════════
//  Export: PDF (List Style)
// ══════════════════════════════════════════
btnPdf.addEventListener('click', () => {
  if (!currentData || !parsedDays || parsedDays.length === 0) return;
  
  const name = currentData['שם'] || currentData['name'] || 'משתמש';
  const idValue = idInput.value.trim();
  
  // Populate the hidden PDF container with a list view
  renderPdfList(parsedDays, name, idValue);
  
  const element = pdfExportContainer;
  
  const opt = {
    margin: [10, 10, 10, 10],
    filename: `תוכנית_חופשים_${name}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { 
      scale: 2, 
      useCORS: true, 
      scrollY: 0,
      windowWidth: 800,
      onclone: (clonedDoc) => {
        const target = clonedDoc.getElementById('pdf-export-container');
        if (target) {
          target.style.position = 'static';
          target.style.visibility = 'visible';
          target.style.display = 'block';
          target.classList.remove('hidden-pdf');
          target.classList.add('exporting-pdf-list');
          
          // Force light mode colors for the export container
          const content = target.querySelector('.pdf-export-content');
          if (content) {
            content.style.backgroundColor = '#ffffff';
            content.style.color = '#000000';
          }
        }
      }
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['avoid-all', 'css'] },
  };

  html2pdf().set(opt).from(element).save();
});

function renderPdfList(days, name, id) {
  const tableRows = days.map(d => {
    const holidayList = getHolidayForDate(d.date);
    const holidayTitle = holidayList ? holidayList.join(', ') : '';
    
    let statusLabel = 'לא הוזן';
    let statusEmoji = '';
    let statusColor = '#94a3b8';

    if (d.status !== '' && d.status !== undefined && d.status !== null && STATUS_MAP[d.status]) {
      statusLabel = STATUS_MAP[d.status].label;
      statusEmoji = STATUS_MAP[d.status].emoji;
      statusColor = getStatusColor(d.status);
    }
    
    const dateStr = `${d.day}/${d.month + 1}/${d.year}`;
    const dayOfWeek = HEBREW_DAYS[d.date.getDay()];

    return `
      <tr>
        <td>${dateStr} (${dayOfWeek})</td>
        <td>${statusEmoji} ${statusLabel}</td>
        <td>${holidayTitle}</td>
      </tr>
    `;
  }).join('');

  pdfExportContainer.innerHTML = `
    <div class="pdf-export-content">
      <div class="pdf-header">
        <h1>תוכנית חופשים</h1>
        <p>הופק בתאריך: ${new Date().toLocaleDateString('he-IL')}</p>
      </div>
      <div class="pdf-user-info">
        <span>שם: ${name}</span>
        <span>מספר אישי: ${id}</span>
      </div>
      <table class="pdf-table">
        <thead>
          <tr>
            <th>תאריך</th>
            <th>סטטוס</th>
            <th>הערות / חגים</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
  `;
}

function getStatusColor(status) {
  const colors = {
    '1': '#10b981',
    '0': '#f59e0b',
    '2': '#ef4444',
    '3': '#f59e0b',
    '4': '#f59e0b',
    '5': '#8b5cf6',
  };
  return colors[status] || '#94a3b8';
}

// ══════════════════════════════════════════
//  Export: iCalendar (.ics)
// ══════════════════════════════════════════
btnIcs.addEventListener('click', () => {
  if (!parsedDays || parsedDays.length === 0) return;
  const name = currentData['שם'] || 'Vacation Plan';
  let ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VacationPlan//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${name} - תוכנית חופשים`,
  ];

  for (const d of parsedDays) {
    if (d.status === '' || d.status === undefined || d.status === null) continue;
    const info = STATUS_MAP[d.status];
    const label = info ? `${info.emoji} ${info.label}` : d.status;
    const dateStr = formatIcsDate(d.date);
    const nextDay = new Date(d.date);
    nextDay.setDate(nextDay.getDate() + 1);
    const endStr = formatIcsDate(nextDay);

    ics.push('BEGIN:VEVENT');
    ics.push(`DTSTART;VALUE=DATE:${dateStr}`);
    ics.push(`DTEND;VALUE=DATE:${endStr}`);
    ics.push(`SUMMARY:${label}`);
    ics.push(`DESCRIPTION:${name} - ${label}`);
    ics.push(`UID:${dateStr}-${d.status}@vacation-plan`);
    ics.push('END:VEVENT');
  }

  ics.push('END:VCALENDAR');

  const blob = new Blob([ics.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `תוכנית_חופשים_${name}.ics`;
  a.click();
  URL.revokeObjectURL(url);
});

function formatIcsDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// ══════════════════════════════════════════
//  Error Display
// ══════════════════════════════════════════
function showError(message) {
  // Insert an error message in place of search card subtitle
  const searchCard = document.querySelector('.search-card');
  const existing = searchCard.querySelector('.error-msg');
  if (existing) existing.remove();
  const errorEl = document.createElement('p');
  errorEl.className = 'error-msg';
  errorEl.style.color = '#f87171';
  errorEl.style.fontWeight = '600';
  errorEl.textContent = `⚠️ ${message}`;
  searchCard.appendChild(errorEl);
  setTimeout(() => errorEl.remove(), 5000);
}

// ══════════════════════════════════════════
//  Loading
// ══════════════════════════════════════════
function showLoading(show) {
  loadingOverlay.classList.toggle('hidden', !show);
}

// ══════════════════════════════════════════
//  PWA: Service Worker & Install Prompt
// ══════════════════════════════════════════
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW registration failed:', err));
}

let deferredPrompt = null;
const installPrompt = document.getElementById('install-prompt');
const btnInstall = document.getElementById('btn-install');
const btnDismissInstall = document.getElementById('btn-dismiss-install');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installPrompt.classList.remove('hidden');
});

btnInstall.addEventListener('click', () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(() => {
    deferredPrompt = null;
    installPrompt.classList.add('hidden');
  });
});

btnDismissInstall.addEventListener('click', () => {
  installPrompt.classList.add('hidden');
});
