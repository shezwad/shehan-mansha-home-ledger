'use strict';

const STORAGE_KEY = 'home-ledger-cache';
const EXPENSE_CATEGORIES = [
  'Housing', 'Utilities', 'Groceries', 'Transport', 'Insurance',
  'Subscriptions', 'Healthcare', 'Education', 'Dining', 'Shopping',
  'Entertainment', 'Childcare', 'Debt', 'Gifts', 'Other'
];
const INCOME_CATEGORIES = ['Salary', 'Freelance', 'Business', 'Benefits', 'Refund', 'Gift', 'Other'];
const RECURRENCE_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 };
const RECURRENCE_LABELS = { monthly: 'Monthly', quarterly: 'Every 3 months', semiannual: 'Every 6 months', yearly: 'Yearly' };

const defaultState = () => ({
  version: 1,
  settings: { householdName: 'Home Ledger', currency: 'USD' },
  periods: [],
  transactions: [],
  fixedExpenses: [
    { id: uid(), name: 'Rent', amount: 0, category: 'Housing', anchorDate: nextDueDateForDay(1), recurrence: 'monthly', reminderDays: 3, person: '', active: false, createdAt: new Date().toISOString() },
    { id: uid(), name: 'Spectrum bill', amount: 0, category: 'Utilities', anchorDate: nextDueDateForDay(1), recurrence: 'monthly', reminderDays: 3, person: '', active: false, createdAt: new Date().toISOString() },
    { id: uid(), name: 'Insurance', amount: 0, category: 'Insurance', anchorDate: nextDueDateForDay(1), recurrence: 'yearly', reminderDays: 7, person: '', active: false, createdAt: new Date().toISOString() }
  ],
  activePeriodId: null
});

let state = loadState();
let currentView = 'overview';
let currentEntryType = 'expense';
let toastTimer;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const els = {
  appTitle: $('#appTitle'),
  activePeriodSelect: $('#activePeriodSelect'),
  activePeriodDates: $('#activePeriodDates'),
  overviewContent: $('#overviewContent'),
  noPeriodOverview: $('#noPeriodOverview'),
  entriesContent: $('#entriesContent'),
  noPeriodEntries: $('#noPeriodEntries'),
  incomeTotal: $('#incomeTotal'),
  expenseTotal: $('#expenseTotal'),
  balanceTotal: $('#balanceTotal'),
  plannedTotal: $('#plannedTotal'),
  incomeCount: $('#incomeCount'),
  expenseCount: $('#expenseCount'),
  plannedCount: $('#plannedCount'),
  budgetCard: $('#budgetCard'),
  budgetStatusText: $('#budgetStatusText'),
  budgetRemainingText: $('#budgetRemainingText'),
  budgetProgress: $('#budgetProgress'),
  categoryChart: $('#categoryChart'),
  recentEntries: $('#recentEntries'),
  billReminderCard: $('#billReminderCard'),
  billReminders: $('#billReminders'),
  entriesList: $('#entriesList'),
  entrySearch: $('#entrySearch'),
  entryTypeFilter: $('#entryTypeFilter'),
  entryCategoryFilter: $('#entryCategoryFilter'),
  fixedBillsList: $('#fixedBillsList'),
  periodsList: $('#periodsList'),
  householdName: $('#householdName'),
  currencyCode: $('#currencyCode'),
  entryDialog: $('#entryDialog'),
  fixedDialog: $('#fixedDialog'),
  periodDialog: $('#periodDialog'),
  installDialog: $('#installDialog'),
  toast: $('#toast'),
  offlineBanner: $('#offlineBanner')
};

function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch (error) {
    console.error('Could not load saved data:', error);
    return defaultState();
  }
}

function normalizeState(input) {
  const base = defaultState();
  const clean = {
    version: 1,
    settings: {
      householdName: String(input?.settings?.householdName || base.settings.householdName).slice(0, 40),
      currency: String(input?.settings?.currency || base.settings.currency).toUpperCase()
    },
    periods: Array.isArray(input?.periods) ? input.periods : [],
    transactions: Array.isArray(input?.transactions) ? input.transactions : [],
    fixedExpenses: Array.isArray(input?.fixedExpenses) ? input.fixedExpenses : base.fixedExpenses,
    activePeriodId: input?.activePeriodId || null
  };

  clean.periods = clean.periods.filter(p => p?.id && isIsoDate(p.startDate) && isIsoDate(p.endDate));
  clean.transactions = clean.transactions.filter(t => t?.id && t?.periodId && ['expense', 'income'].includes(t.type) && isIsoDate(t.date));
  clean.fixedExpenses = clean.fixedExpenses.filter(f => f?.id && f?.name).map(normalizeFixedBill);
  if (!clean.periods.some(p => p.id === clean.activePeriodId)) clean.activePeriodId = clean.periods[0]?.id || null;
  return clean;
}

function saveState(message) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (window.HomeLedgerCloud?.householdId && state.activePeriodId) {
      localStorage.setItem(`home-ledger-active-period-${window.HomeLedgerCloud.householdId}`, state.activePeriodId);
    }
  } catch (error) {
    console.warn('Could not save the local cache:', error);
  }

  if (window.HomeLedgerCloud?.saveState) {
    window.HomeLedgerCloud.saveState(structuredCloneSafe(state), message);
  } else if (message) {
    showToast(message);
  }
}

function structuredCloneSafe(value) {
  return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function applyCloudState(input) {
  const next = normalizeState(structuredCloneSafe(input));
  const storedActive = window.HomeLedgerCloud?.householdId
    ? localStorage.getItem(`home-ledger-active-period-${window.HomeLedgerCloud.householdId}`)
    : null;
  if (storedActive && next.periods.some(period => period.id === storedActive)) {
    next.activePeriodId = storedActive;
  } else if (!next.periods.some(period => period.id === next.activePeriodId)) {
    next.activePeriodId = [...next.periods].sort((a, b) => b.startDate.localeCompare(a.startDate))[0]?.id || null;
  }
  state = next;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  renderAll();
}

function getActivePeriod() {
  return state.periods.find(period => period.id === state.activePeriodId) || null;
}

function getPeriodTransactions(periodId = state.activePeriodId) {
  return state.transactions.filter(item => item.periodId === periodId);
}

function parseLocalDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(parseLocalDate(value).getTime());
}

function nextDueDateForDay(day) {
  const today = new Date();
  const safeDay = Math.min(31, Math.max(1, Number(day) || 1));
  const candidateFor = (year, month) => new Date(year, month, Math.min(safeDay, new Date(year, month + 1, 0).getDate()));
  let candidate = candidateFor(today.getFullYear(), today.getMonth());
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (candidate < todayOnly) candidate = candidateFor(today.getFullYear(), today.getMonth() + 1);
  return toIsoDate(candidate);
}

function normalizeFixedBill(item) {
  const recurrence = RECURRENCE_MONTHS[item?.recurrence] ? item.recurrence : 'monthly';
  const anchorDate = isIsoDate(item?.anchorDate) ? item.anchorDate : nextDueDateForDay(item?.dueDay || 1);
  return {
    ...item,
    anchorDate,
    recurrence,
    reminderDays: Math.min(30, Math.max(0, Number(item?.reminderDays ?? 3))),
    dueDay: parseLocalDate(anchorDate).getDate()
  };
}

function recurrenceLabel(value) {
  return RECURRENCE_LABELS[value] || RECURRENCE_LABELS.monthly;
}

function addDays(iso, amount) {
  const date = parseLocalDate(iso);
  date.setDate(date.getDate() + Number(amount || 0));
  return toIsoDate(date);
}

function dayDifference(fromIso, toIso) {
  return Math.round((parseLocalDate(toIso) - parseLocalDate(fromIso)) / 86400000);
}

function addMonthsFromAnchor(anchorIso, monthOffset) {
  const anchor = parseLocalDate(anchorIso);
  const totalMonth = anchor.getFullYear() * 12 + anchor.getMonth() + Number(monthOffset || 0);
  const year = Math.floor(totalMonth / 12);
  const month = ((totalMonth % 12) + 12) % 12;
  const day = Math.min(anchor.getDate(), new Date(year, month + 1, 0).getDate());
  return toIsoDate(new Date(year, month, day));
}

function occurrenceDatesInRange(bill, startIso, endIso) {
  const cleanBill = normalizeFixedBill(bill);
  const interval = RECURRENCE_MONTHS[cleanBill.recurrence] || 1;
  if (endIso < cleanBill.anchorDate) return [];

  const anchor = parseLocalDate(cleanBill.anchorDate);
  const start = parseLocalDate(startIso);
  const monthDifference = (start.getFullYear() - anchor.getFullYear()) * 12 + (start.getMonth() - anchor.getMonth());
  let occurrenceIndex = Math.max(0, Math.floor(monthDifference / interval) - 1);
  let candidate = addMonthsFromAnchor(cleanBill.anchorDate, occurrenceIndex * interval);

  while (candidate < startIso) {
    occurrenceIndex += 1;
    candidate = addMonthsFromAnchor(cleanBill.anchorDate, occurrenceIndex * interval);
  }

  const dates = [];
  while (candidate <= endIso) {
    dates.push(candidate);
    occurrenceIndex += 1;
    candidate = addMonthsFromAnchor(cleanBill.anchorDate, occurrenceIndex * interval);
  }
  return dates;
}

function nextOccurrenceDate(bill, onOrAfterIso = toIsoDate(new Date())) {
  const horizon = addMonthsFromAnchor(onOrAfterIso, 240);
  return occurrenceDatesInRange(bill, onOrAfterIso, horizon)[0] || normalizeFixedBill(bill).anchorDate;
}

function nextUnpaidOccurrenceDate(bill, onOrAfterIso = toIsoDate(new Date())) {
  const overdue = state.transactions
    .filter(item => item.fixedTemplateId === bill.id && item.type === 'expense' && item.status === 'planned' && item.date < onOrAfterIso)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (overdue) return { dueDate: overdue.date, overdue: true };

  let dueDate = nextOccurrenceDate(bill, onOrAfterIso);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const paid = state.transactions.some(item => item.fixedTemplateId === bill.id && item.date === dueDate && item.status !== 'planned');
    if (!paid) return { dueDate, overdue: false };
    dueDate = nextOccurrenceDate(bill, addDays(dueDate, 1));
  }
  return { dueDate, overdue: false };
}

function formatDate(iso, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!isIsoDate(iso)) return '';
  return new Intl.DateTimeFormat(undefined, options).format(parseLocalDate(iso));
}

function formatMoney(amount) {
  const value = Number(amount) || 0;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${state.settings.currency} ${value.toFixed(2)}`;
  }
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function clampDateToPeriod(dateIso, period) {
  if (!period) return dateIso;
  if (dateIso < period.startDate) return period.startDate;
  if (dateIso > period.endDate) return period.endDate;
  return dateIso;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add('show');
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

function switchView(viewName) {
  currentView = viewName;
  $$('.view').forEach(view => view.classList.toggle('active', view.dataset.view === viewName));
  $$('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.viewTarget === viewName));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderAll() {
  renderHeader();
  renderOverview();
  renderBillReminders();
  renderEntries();
  renderFixedBills();
  renderPeriods();
  renderSettings();
}

function renderHeader() {
  els.appTitle.textContent = state.settings.householdName || 'Home Ledger';
  document.title = state.settings.householdName || 'Home Ledger';

  const periods = [...state.periods].sort((a, b) => b.startDate.localeCompare(a.startDate));
  els.activePeriodSelect.innerHTML = periods.length
    ? periods.map(period => `<option value="${period.id}" ${period.id === state.activePeriodId ? 'selected' : ''}>${escapeHtml(period.name)}</option>`).join('')
    : '<option value="">No budget periods yet</option>';
  els.activePeriodSelect.disabled = periods.length === 0;

  const active = getActivePeriod();
  els.activePeriodDates.textContent = active
    ? `${formatDate(active.startDate)} – ${formatDate(active.endDate)}`
    : 'Create a period with any start and end dates.';
}

function renderOverview() {
  const period = getActivePeriod();
  els.noPeriodOverview.hidden = Boolean(period);
  els.overviewContent.hidden = !period;
  if (!period) return;

  const transactions = getPeriodTransactions();
  const income = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + Number(t.amount || 0), 0);
  const paidExpenses = transactions.filter(t => t.type === 'expense' && t.status !== 'planned').reduce((sum, t) => sum + Number(t.amount || 0), 0);
  const planned = transactions.filter(t => t.type === 'expense' && t.status === 'planned').reduce((sum, t) => sum + Number(t.amount || 0), 0);
  const incomeEntries = transactions.filter(t => t.type === 'income').length;
  const expenseEntries = transactions.filter(t => t.type === 'expense' && t.status !== 'planned').length;
  const plannedEntries = transactions.filter(t => t.type === 'expense' && t.status === 'planned').length;

  els.incomeTotal.textContent = formatMoney(income);
  els.expenseTotal.textContent = formatMoney(paidExpenses);
  els.balanceTotal.textContent = formatMoney(income - paidExpenses);
  els.balanceTotal.style.color = income - paidExpenses < 0 ? 'var(--expense)' : 'var(--primary)';
  els.plannedTotal.textContent = formatMoney(planned);
  els.incomeCount.textContent = plural(incomeEntries, 'entry', 'entries');
  els.expenseCount.textContent = plural(expenseEntries, 'entry', 'entries');
  els.plannedCount.textContent = plural(plannedEntries, 'unpaid bill', 'unpaid bills');

  const budget = Number(period.budget || 0);
  els.budgetCard.hidden = budget <= 0;
  if (budget > 0) {
    const percentage = Math.min((paidExpenses / budget) * 100, 100);
    const remaining = budget - paidExpenses;
    els.budgetStatusText.textContent = `${formatMoney(paidExpenses)} of ${formatMoney(budget)} used`;
    els.budgetRemainingText.textContent = remaining >= 0 ? `${formatMoney(remaining)} left` : `${formatMoney(Math.abs(remaining))} over`;
    els.budgetRemainingText.style.color = remaining >= 0 ? 'var(--income)' : 'var(--expense)';
    els.budgetProgress.style.width = `${percentage}%`;
    els.budgetProgress.classList.toggle('over', paidExpenses > budget);
  }

  renderCategoryChart(transactions);
  renderTransactionList(els.recentEntries, transactions.slice().sort(sortTransactions).slice(0, 5), { compact: true });
}

function renderCategoryChart(transactions) {
  const totals = new Map();
  transactions
    .filter(t => t.type === 'expense' && t.status !== 'planned')
    .forEach(t => totals.set(t.category || 'Other', (totals.get(t.category || 'Other') || 0) + Number(t.amount || 0)));

  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
  if (!rows.length) {
    els.categoryChart.innerHTML = '<div class="empty-state"><p>No paid expenses in this period yet.</p></div>';
    return;
  }
  const max = Math.max(...rows.map(([, amount]) => amount));
  els.categoryChart.innerHTML = rows.map(([category, amount]) => `
    <div class="category-row">
      <div class="category-meta">
        <span class="category-name">${escapeHtml(category)}</span>
        <span class="category-amount">${formatMoney(amount)}</span>
      </div>
      <div class="category-bar-track"><div class="category-bar" style="width:${Math.max(4, (amount / max) * 100)}%"></div></div>
    </div>`).join('');
}

function renderEntries() {
  const period = getActivePeriod();
  els.noPeriodEntries.hidden = Boolean(period);
  els.entriesContent.hidden = !period;
  if (!period) return;

  const transactions = getPeriodTransactions();
  const categories = [...new Set(transactions.map(t => t.category).filter(Boolean))].sort();
  const currentCategory = els.entryCategoryFilter.value || 'all';
  els.entryCategoryFilter.innerHTML = '<option value="all">All categories</option>' + categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
  if (categories.includes(currentCategory)) els.entryCategoryFilter.value = currentCategory;

  const query = els.entrySearch.value.trim().toLowerCase();
  const typeFilter = els.entryTypeFilter.value;
  const categoryFilter = els.entryCategoryFilter.value;

  const filtered = transactions.filter(item => {
    const haystack = `${item.description} ${item.category} ${item.person || ''}`.toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    let matchesType = true;
    if (typeFilter === 'expense') matchesType = item.type === 'expense' && item.status !== 'planned';
    if (typeFilter === 'income') matchesType = item.type === 'income';
    if (typeFilter === 'planned') matchesType = item.type === 'expense' && item.status === 'planned';
    const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter;
    return matchesQuery && matchesType && matchesCategory;
  }).sort(sortTransactions);

  renderTransactionList(els.entriesList, filtered);
}

function sortTransactions(a, b) {
  return b.date.localeCompare(a.date) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
}

function renderTransactionList(container, transactions, options = {}) {
  if (!transactions.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🪙</div><h3>No entries found</h3><p>Add income, paid expenses, or upcoming bills for this period.</p></div>';
    return;
  }

  if (options.compact) {
    container.innerHTML = transactions.map(transactionItemHtml).join('');
    bindTransactionActions(container);
    return;
  }

  const groups = new Map();
  transactions.forEach(transaction => {
    if (!groups.has(transaction.date)) groups.set(transaction.date, []);
    groups.get(transaction.date).push(transaction);
  });

  container.innerHTML = [...groups.entries()].map(([date, items]) => `
    <section class="date-group">
      <h3 class="date-heading">${formatDate(date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</h3>
      ${items.map(transactionItemHtml).join('')}
    </section>`).join('');
  bindTransactionActions(container);
}

function transactionItemHtml(item) {
  const planned = item.type === 'expense' && item.status === 'planned';
  const visualType = planned ? 'planned' : item.type;
  const sign = item.type === 'income' ? '+' : '−';
  const icon = item.type === 'income' ? '↓' : planned ? '◷' : '↑';
  const details = [item.category, item.person ? `For ${item.person}` : '', item.recordedByName ? `Added by ${item.recordedByName}` : '', planned ? 'Upcoming' : ''].filter(Boolean).join(' · ');
  return `
    <article class="transaction-item" data-transaction-id="${item.id}">
      <div class="transaction-icon ${visualType}">${icon}</div>
      <div class="transaction-main">
        <p class="transaction-title">${escapeHtml(item.description || item.category)}</p>
        <p class="transaction-meta">${escapeHtml(details)}</p>
      </div>
      <div class="transaction-right">
        <span class="transaction-amount ${visualType}">${sign}${formatMoney(item.amount)}</span>
        <div class="transaction-actions">
          ${planned ? '<button class="mini-action primary mark-paid" type="button">Paid</button>' : ''}
          <button class="mini-action edit-transaction" type="button">Edit</button>
          <button class="mini-action danger delete-transaction" type="button">Delete</button>
        </div>
      </div>
    </article>`;
}

function bindTransactionActions(container) {
  $$('.edit-transaction', container).forEach(button => button.addEventListener('click', () => {
    const id = button.closest('[data-transaction-id]').dataset.transactionId;
    openEntryDialog(state.transactions.find(item => item.id === id));
  }));

  $$('.delete-transaction', container).forEach(button => button.addEventListener('click', () => {
    const id = button.closest('[data-transaction-id]').dataset.transactionId;
    const item = state.transactions.find(t => t.id === id);
    if (!item) return;
    if (confirm(`Delete “${item.description}” for ${formatMoney(item.amount)}?`)) {
      state.transactions = state.transactions.filter(t => t.id !== id);
      saveState('Entry deleted');
      renderAll();
    }
  }));

  $$('.mark-paid', container).forEach(button => button.addEventListener('click', () => {
    const id = button.closest('[data-transaction-id]').dataset.transactionId;
    const item = state.transactions.find(t => t.id === id);
    if (!item) return;
    item.status = 'paid';
    item.updatedByUid = window.HomeLedgerCloud?.currentUser?.uid || '';
    item.updatedByName = window.HomeLedgerCloud?.currentUser?.displayName || window.HomeLedgerCloud?.currentUser?.email || '';
    item.updatedAt = new Date().toISOString();
    saveState('Bill marked as paid');
    renderAll();
  }));
}

function getBillReminderItems() {
  const today = toIsoDate(new Date());
  return state.fixedExpenses
    .filter(item => item.active && Number(item.amount) > 0)
    .map(item => {
      const bill = normalizeFixedBill(item);
      const next = nextUnpaidOccurrenceDate(bill, today);
      const daysUntil = dayDifference(today, next.dueDate);
      return {
        bill,
        dueDate: next.dueDate,
        overdue: next.overdue,
        daysUntil,
        needsAttention: next.overdue || daysUntil <= Number(bill.reminderDays || 0)
      };
    })
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.dueDate.localeCompare(b.dueDate));
}

function reminderStatusText(item) {
  if (item.overdue) return `${Math.abs(item.daysUntil)} ${Math.abs(item.daysUntil) === 1 ? 'day' : 'days'} overdue`;
  if (item.daysUntil === 0) return 'Due today';
  if (item.daysUntil === 1) return 'Due tomorrow';
  if (item.daysUntil <= item.bill.reminderDays) return `Due in ${item.daysUntil} days`;
  return `In ${item.daysUntil} days`;
}

function renderBillReminders() {
  if (!els.billReminderCard || !els.billReminders) return;
  const items = getBillReminderItems();
  els.billReminderCard.hidden = false;
  if (!items.length) {
    els.billReminders.innerHTML = '<div class="reminder-empty"><span>🔔</span><p>Add and activate a fixed bill to see its next due date here.</p></div>';
    return;
  }

  els.billReminders.innerHTML = items.slice(0, 6).map(item => `
    <button class="reminder-row ${item.needsAttention ? 'attention' : ''}" data-reminder-fixed-id="${item.bill.id}" type="button">
      <span class="reminder-icon">${item.overdue ? '!' : '◷'}</span>
      <span class="reminder-main">
        <strong>${escapeHtml(item.bill.name)}</strong>
        <small>${escapeHtml(recurrenceLabel(item.bill.recurrence))} · ${formatMoney(item.bill.amount)}</small>
      </span>
      <span class="reminder-due">
        <strong>${escapeHtml(reminderStatusText(item))}</strong>
        <small>${formatDate(item.dueDate, { month: 'short', day: 'numeric' })}</small>
      </span>
    </button>`).join('');

  $$('[data-reminder-fixed-id]', els.billReminders).forEach(button => button.addEventListener('click', () => {
    const bill = state.fixedExpenses.find(item => item.id === button.dataset.reminderFixedId);
    if (bill) openFixedDialog(bill);
  }));

  const attention = items.filter(item => item.needsAttention);
  if (attention.length) {
    const today = toIsoDate(new Date());
    const household = window.HomeLedgerCloud?.householdId || 'local';
    const key = `home-ledger-reminder-shown-${household}-${today}`;
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, '1');
      setTimeout(() => showToast(attention.length === 1 ? 'One fixed bill needs attention' : `${attention.length} fixed bills need attention`), 500);
    }
  }
}

function renderFixedBills() {
  const fixed = [...state.fixedExpenses]
    .map(normalizeFixedBill)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.anchorDate.localeCompare(b.anchorDate));
  if (!fixed.length) {
    els.fixedBillsList.innerHTML = '<div class="empty-state"><div class="empty-icon">🔁</div><h3>No fixed bills yet</h3><p>Add rent, internet, subscriptions, insurance, and other recurring expenses.</p></div>';
    return;
  }

  els.fixedBillsList.innerHTML = fixed.map(item => {
    const next = nextUnpaidOccurrenceDate(item);
    const reminderText = Number(item.reminderDays) === 0 ? 'Reminder on due date' : `Reminder ${item.reminderDays} ${item.reminderDays === 1 ? 'day' : 'days'} before`;
    return `
    <article class="fixed-item" data-fixed-id="${item.id}">
      <div class="fixed-top">
        <div>
          <h3>${escapeHtml(item.name)}</h3>
          <span class="badge ${item.active ? 'active' : 'inactive'}">${item.active ? 'Active' : 'Inactive'}</span>
        </div>
        <span class="fixed-amount">${Number(item.amount) > 0 ? formatMoney(item.amount) : 'Set amount'}</span>
      </div>
      <div class="item-meta fixed-meta">
        <span>${escapeHtml(item.category || 'Other')}</span>
        <span>· ${escapeHtml(recurrenceLabel(item.recurrence))}</span>
        <span>· ${next.overdue ? 'Overdue since' : 'Next'} ${formatDate(next.dueDate, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        <span>· ${escapeHtml(reminderText)}</span>
        ${item.person ? `<span>· ${escapeHtml(item.person)}</span>` : ''}
      </div>
      <div class="item-actions">
        <button class="calendar-fixed" type="button">Add reminder</button>
        <button class="edit-fixed" type="button">Edit</button>
        <button class="toggle-fixed" type="button">${item.active ? 'Deactivate' : 'Activate'}</button>
        <button class="delete-fixed danger" type="button">Delete</button>
      </div>
    </article>`;
  }).join('');

  $$('.calendar-fixed', els.fixedBillsList).forEach(button => button.addEventListener('click', () => {
    const id = button.closest('[data-fixed-id]').dataset.fixedId;
    const item = state.fixedExpenses.find(f => f.id === id);
    if (item) exportBillCalendar(item);
  }));
  $$('.edit-fixed', els.fixedBillsList).forEach(button => button.addEventListener('click', () => {
    const id = button.closest('[data-fixed-id]').dataset.fixedId;
    openFixedDialog(state.fixedExpenses.find(item => item.id === id));
  }));
  $$('.toggle-fixed', els.fixedBillsList).forEach(button => button.addEventListener('click', () => {
    const id = button.closest('[data-fixed-id]').dataset.fixedId;
    const item = state.fixedExpenses.find(f => f.id === id);
    item.active = !item.active;
    item.updatedByUid = window.HomeLedgerCloud?.currentUser?.uid || '';
    item.updatedByName = window.HomeLedgerCloud?.currentUser?.displayName || window.HomeLedgerCloud?.currentUser?.email || '';
    item.updatedAt = new Date().toISOString();
    saveState(item.active ? 'Fixed bill activated' : 'Fixed bill deactivated');
    renderAll();
  }));
  $$('.delete-fixed', els.fixedBillsList).forEach(button => button.addEventListener('click', () => {
    const id = button.closest('[data-fixed-id]').dataset.fixedId;
    const item = state.fixedExpenses.find(f => f.id === id);
    if (item && confirm(`Delete fixed bill “${item.name}”? Existing period entries will remain.`)) {
      state.fixedExpenses = state.fixedExpenses.filter(f => f.id !== id);
      saveState('Fixed bill deleted');
      renderAll();
    }
  }));
}

function renderPeriods() {
  const periods = [...state.periods].sort((a, b) => b.startDate.localeCompare(a.startDate));
  if (!periods.length) {
    els.periodsList.innerHTML = '<div class="empty-state"><div class="empty-icon">📆</div><h3>No periods yet</h3><p>Create a custom budget month using any start and end dates.</p></div>';
    return;
  }

  els.periodsList.innerHTML = periods.map(period => {
    const transactions = getPeriodTransactions(period.id);
    const income = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const expense = transactions.filter(t => t.type === 'expense' && t.status !== 'planned').reduce((sum, t) => sum + Number(t.amount || 0), 0);
    return `
      <article class="period-item" data-period-id="${period.id}">
        <div class="period-top">
          <div>
            <h3>${escapeHtml(period.name)}</h3>
            ${period.id === state.activePeriodId ? '<span class="badge current">Active period</span>' : ''}
          </div>
          <strong>${formatMoney(income - expense)}</strong>
        </div>
        <div class="item-meta">
          <span>${formatDate(period.startDate)} – ${formatDate(period.endDate)}</span>
          <span>· ${plural(transactions.length, 'entry', 'entries')}</span>
          ${Number(period.budget) > 0 ? `<span>· Budget ${formatMoney(period.budget)}</span>` : ''}
        </div>
        <div class="item-actions">
          ${period.id !== state.activePeriodId ? '<button class="activate activate-period" type="button">Make active</button>' : ''}
          <button class="edit-period" type="button">Edit</button>
          <button class="delete-period danger" type="button">Delete</button>
        </div>
      </article>`;
  }).join('');

  $$('.activate-period', els.periodsList).forEach(button => button.addEventListener('click', () => {
    state.activePeriodId = button.closest('[data-period-id]').dataset.periodId;
    saveState('Active period changed');
    renderAll();
    switchView('overview');
  }));
  $$('.edit-period', els.periodsList).forEach(button => button.addEventListener('click', () => {
    const id = button.closest('[data-period-id]').dataset.periodId;
    openPeriodDialog(state.periods.find(period => period.id === id));
  }));
  $$('.delete-period', els.periodsList).forEach(button => button.addEventListener('click', () => {
    const id = button.closest('[data-period-id]').dataset.periodId;
    deletePeriod(id);
  }));
}

function renderSettings() {
  els.householdName.value = state.settings.householdName || 'Home Ledger';
  els.currencyCode.value = state.settings.currency || 'USD';
  const userLabel = $('#currentUserLabel');
  const codeLabel = $('#householdCodeLabel');
  if (userLabel) userLabel.textContent = window.HomeLedgerCloud?.currentUser?.displayName || window.HomeLedgerCloud?.currentUser?.email || '—';
  if (codeLabel) codeLabel.textContent = window.HomeLedgerCloud?.householdCode || '—';
}

function updateCategoryOptions(type, selected = '') {
  const categories = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const select = $('#entryCategory');
  select.innerHTML = categories.map(category => `<option value="${category}">${category}</option>`).join('');
  if (selected && categories.includes(selected)) select.value = selected;
  $('#entryStatusField').hidden = type === 'income';
  if (type === 'income') $('#entryStatus').value = 'paid';
  $$('.segment').forEach(button => button.classList.toggle('active', button.dataset.entryType === type));
  $('#entryType').value = type;
  currentEntryType = type;
}

function openEntryDialog(item = null) {
  const period = getActivePeriod();
  if (!period) {
    showToast('Create a budget period first');
    openPeriodDialog();
    return;
  }
  $('#entryForm').reset();
  $('#entryId').value = item?.id || '';
  $('#entryDialogTitle').textContent = item ? 'Edit entry' : 'Add entry';
  updateCategoryOptions(item?.type || 'expense', item?.category || '');
  $('#entryAmount').value = item?.amount || '';
  const today = toIsoDate(new Date());
  $('#entryDate').min = period.startDate;
  $('#entryDate').max = period.endDate;
  $('#entryDate').value = item?.date || clampDateToPeriod(today, period);
  $('#entryDescription').value = item?.description || '';
  $('#entryPerson').value = item?.person || '';
  $('#entryStatus').value = item?.status || 'paid';
  els.entryDialog.showModal();
  setTimeout(() => $('#entryAmount').focus(), 50);
}

function openFixedDialog(item = null) {
  $('#fixedForm').reset();
  const bill = item ? normalizeFixedBill(item) : null;
  $('#fixedId').value = bill?.id || '';
  $('#fixedDialogTitle').textContent = bill ? 'Edit fixed bill' : 'Add fixed bill';
  $('#fixedName').value = bill?.name || '';
  $('#fixedAmount').value = Number(bill?.amount) > 0 ? bill.amount : '';
  $('#fixedDueDate').value = bill?.anchorDate || toIsoDate(new Date());
  $('#fixedRecurrence').value = bill?.recurrence || 'monthly';
  $('#fixedReminderDays').value = Number(bill?.reminderDays ?? 3);
  $('#fixedCategory').innerHTML = EXPENSE_CATEGORIES.map(category => `<option value="${category}">${category}</option>`).join('');
  $('#fixedCategory').value = bill?.category || 'Utilities';
  $('#fixedPerson').value = bill?.person || '';
  $('#fixedActive').checked = bill ? Boolean(bill.active) : true;
  els.fixedDialog.showModal();
  setTimeout(() => $('#fixedName').focus(), 50);
}

function openPeriodDialog(period = null, defaults = {}) {
  $('#periodForm').reset();
  $('#periodId').value = period?.id || '';
  $('#periodDialogTitle').textContent = period ? 'Edit budget period' : 'Create budget period';
  const today = toIsoDate(new Date());
  const start = period?.startDate || defaults.startDate || today;
  const endDate = new Date(parseLocalDate(start));
  endDate.setDate(endDate.getDate() + 29);
  const end = period?.endDate || defaults.endDate || toIsoDate(endDate);
  $('#periodName').value = period?.name || defaults.name || `Period starting ${formatDate(start, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  $('#periodStart').value = start;
  $('#periodEnd').value = end;
  $('#periodBudget').value = Number(period?.budget) > 0 ? period.budget : (defaults.budget || '');
  els.periodDialog.showModal();
  setTimeout(() => $('#periodName').focus(), 50);
}

function deletePeriod(id) {
  const period = state.periods.find(item => item.id === id);
  if (!period) return;
  const count = state.transactions.filter(item => item.periodId === id).length;
  const warning = count ? ` This will also delete ${plural(count, 'entry', 'entries')}.` : '';
  if (!confirm(`Delete “${period.name}”?${warning}`)) return;
  state.periods = state.periods.filter(item => item.id !== id);
  state.transactions = state.transactions.filter(item => item.periodId !== id);
  if (state.activePeriodId === id) state.activePeriodId = [...state.periods].sort((a, b) => b.startDate.localeCompare(a.startDate))[0]?.id || null;
  saveState('Budget period deleted');
  renderAll();
}

function createNextPeriod() {
  const current = getActivePeriod();
  if (!current) {
    openPeriodDialog();
    return;
  }
  const start = parseLocalDate(current.endDate);
  start.setDate(start.getDate() + 1);
  const oldStart = parseLocalDate(current.startDate);
  const oldEnd = parseLocalDate(current.endDate);
  const duration = Math.round((oldEnd - oldStart) / 86400000) + 1;
  const end = new Date(start);
  end.setDate(end.getDate() + duration - 1);
  openPeriodDialog(null, {
    startDate: toIsoDate(start),
    endDate: toIsoDate(end),
    name: `Period starting ${formatDate(toIsoDate(start), { month: 'short', day: 'numeric', year: 'numeric' })}`,
    budget: current.budget || ''
  });
}

function generateFixedBills() {
  const period = getActivePeriod();
  if (!period) {
    showToast('Create a budget period first');
    openPeriodDialog();
    return;
  }
  const activeBills = state.fixedExpenses.filter(item => item.active && Number(item.amount) > 0).map(normalizeFixedBill);
  if (!activeBills.length) {
    showToast('Activate fixed bills and enter their amounts first');
    return;
  }

  let added = 0;
  let dueOccurrences = 0;
  activeBills.forEach(bill => {
    const occurrences = occurrenceDatesInRange(bill, period.startDate, period.endDate);
    dueOccurrences += occurrences.length;
    occurrences.forEach(dueDate => {
      const exists = state.transactions.some(transaction =>
        transaction.periodId === period.id && transaction.fixedTemplateId === bill.id && transaction.date === dueDate
      );
      if (exists) return;
      state.transactions.push({
        id: uid(),
        periodId: period.id,
        type: 'expense',
        status: 'planned',
        date: dueDate,
        amount: Number(bill.amount),
        category: bill.category || 'Other',
        description: bill.name,
        person: bill.person || '',
        fixedTemplateId: bill.id,
        fixedOccurrenceDate: dueDate,
        fixedRecurrence: bill.recurrence,
        reminderDays: bill.reminderDays,
        createdAt: new Date().toISOString(),
        recordedByUid: window.HomeLedgerCloud?.currentUser?.uid || '',
        recordedByName: window.HomeLedgerCloud?.currentUser?.displayName || window.HomeLedgerCloud?.currentUser?.email || ''
      });
      added += 1;
    });
  });

  const message = added
    ? `${plural(added, 'fixed bill occurrence')} added to this period`
    : dueOccurrences
      ? 'All fixed bills due in this period are already included'
      : 'No active fixed bills are due in this period';
  saveState(message);
  renderAll();
}

function icsEscape(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll(/\r?\n/g, '\\n');
}

function icsTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function calendarOccurrenceDates(input, years = 15) {
  const bill = normalizeFixedBill(input);
  const today = toIsoDate(new Date());
  const first = nextOccurrenceDate(bill, today);
  const horizonDate = parseLocalDate(first);
  horizonDate.setFullYear(horizonDate.getFullYear() + years);
  return occurrenceDatesInRange(bill, first, toIsoDate(horizonDate));
}

function buildBillCalendarEvent(input) {
  const bill = normalizeFixedBill(input);
  const dates = calendarOccurrenceDates(bill);
  const firstDate = (dates[0] || bill.anchorDate).replaceAll('-', '');
  const additionalDates = dates.slice(1).map(value => `${value.replaceAll('-', '')}T090000`);
  const reminderDays = Number(bill.reminderDays || 0);
  const trigger = reminderDays > 0 ? `-P${reminderDays}D` : '-PT0M';
  const description = [
    `${recurrenceLabel(bill.recurrence)} household bill`,
    `Amount: ${formatMoney(bill.amount)}`,
    `Category: ${bill.category || 'Other'}`,
    bill.person ? `Usually paid by: ${bill.person}` : '',
    'Calendar dates are generated for the next 15 years.',
    'Created by Home Ledger'
  ].filter(Boolean).join('\n');
  return [
    'BEGIN:VEVENT',
    `UID:home-ledger-${icsEscape(bill.id)}@local`,
    `DTSTAMP:${icsTimestamp()}`,
    `DTSTART:${firstDate}T090000`,
    `DTEND:${firstDate}T091500`,
    additionalDates.length ? `RDATE:${additionalDates.join(',')}` : '',
    `SUMMARY:${icsEscape(`Home Ledger: ${bill.name}`)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    'CATEGORIES:Finance',
    'BEGIN:VALARM',
    `TRIGGER:${trigger}`,
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(`${bill.name} is due ${reminderDays ? `in ${reminderDays} day${reminderDays === 1 ? '' : 's'}` : 'today'}.`)}`,
    'END:VALARM',
    'END:VEVENT'
  ].filter(Boolean).join('\r\n');
}

function buildCalendarFile(bills) {
  const events = bills.map(buildBillCalendarEvent).join('\r\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Home Ledger//Household Bills//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Home Ledger Bills', events, 'END:VCALENDAR', ''].join('\r\n');
}

async function deliverCalendarFile(filename, content) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  try {
    const file = new File([blob], filename, { type: 'text/calendar' });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title: 'Home Ledger bill reminder', text: 'Add this recurring bill reminder to your calendar.', files: [file] });
      showToast('Calendar reminder shared');
      return;
    }
  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.warn('Calendar sharing was unavailable:', error);
  }
  downloadBlob(filename, content, 'text/calendar;charset=utf-8');
  showToast('Calendar file created. Open it and add the reminder to Calendar.');
}

function exportBillCalendar(bill) {
  const safeName = String(bill.name || 'bill').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bill';
  deliverCalendarFile(`home-ledger-${safeName}-reminder.ics`, buildCalendarFile([bill]));
}

function exportAllBillCalendars() {
  const bills = state.fixedExpenses.filter(item => item.active && Number(item.amount) > 0).map(normalizeFixedBill);
  if (!bills.length) {
    showToast('Add and activate at least one fixed bill first');
    return;
  }
  deliverCalendarFile('home-ledger-bill-reminders.ics', buildCalendarFile(bills));
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportBackup() {
  const stamp = toIsoDate(new Date());
  downloadBlob(`home-ledger-backup-${stamp}.json`, JSON.stringify(state, null, 2), 'application/json');
  showToast('Backup exported');
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function exportCsv() {
  const periodMap = new Map(state.periods.map(period => [period.id, period.name]));
  const rows = [
    ['Period', 'Date', 'Type', 'Status', 'Description', 'Category', 'Household member', 'Amount', 'Currency']
  ];
  [...state.transactions].sort(sortTransactions).forEach(item => rows.push([
    periodMap.get(item.periodId) || '', item.date, item.type, item.status || 'paid', item.description,
    item.category, item.person || '', Number(item.amount || 0).toFixed(2), state.settings.currency
  ]));
  const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  downloadBlob(`home-ledger-entries-${toIsoDate(new Date())}.csv`, csv, 'text/csv;charset=utf-8');
  showToast('CSV exported');
}

function importBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const imported = normalizeState(parsed);
      if (!confirm('Replace all current app data with this backup?')) return;
      state = imported;
      saveState('Backup imported');
      renderAll();
      switchView('overview');
    } catch (error) {
      console.error(error);
      alert('This file is not a valid Home Ledger backup.');
    }
  };
  reader.readAsText(file);
}

function resetAllData() {
  if (!confirm('Delete every period, transaction, and fixed bill from the shared household on both phones? This cannot be undone.')) return;
  if (!confirm('Final confirmation: permanently delete all Home Ledger data?')) return;
  state = defaultState();
  saveState('All app data deleted');
  renderAll();
  switchView('overview');
}

function registerEvents() {
  $$('.nav-button').forEach(button => button.addEventListener('click', () => switchView(button.dataset.viewTarget)));
  $$('[data-go-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.goView)));
  $$('.create-first-period').forEach(button => button.addEventListener('click', () => openPeriodDialog()));

  $('#newPeriodHeaderButton').addEventListener('click', () => openPeriodDialog());
  $('#periodAddButton').addEventListener('click', () => openPeriodDialog());
  $('#createNextPeriodButton').addEventListener('click', createNextPeriod);
  $('#fixedAddButton').addEventListener('click', () => openFixedDialog());
  $('#generateFixedButton').addEventListener('click', generateFixedBills);
  $('#addAllCalendarRemindersButton').addEventListener('click', exportAllBillCalendars);
  $('#overviewCalendarRemindersButton').addEventListener('click', exportAllBillCalendars);
  $('#overviewAddButton').addEventListener('click', () => openEntryDialog());
  $('#entriesAddButton').addEventListener('click', () => openEntryDialog());
  $('#floatingAddButton').addEventListener('click', () => openEntryDialog());

  $('#installHelpButton').addEventListener('click', () => els.installDialog.showModal());
  $('#settingsInstallHelp').addEventListener('click', () => els.installDialog.showModal());
  $$('.close-dialog').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  $$('.app-dialog').forEach(dialog => dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  }));

  els.activePeriodSelect.addEventListener('change', event => {
    state.activePeriodId = event.target.value || null;
    saveState();
    renderAll();
  });

  $$('.segment').forEach(button => button.addEventListener('click', () => updateCategoryOptions(button.dataset.entryType)));

  $('#entryForm').addEventListener('submit', event => {
    event.preventDefault();
    const period = getActivePeriod();
    if (!period) return;
    const id = $('#entryId').value;
    const date = $('#entryDate').value;
    if (date < period.startDate || date > period.endDate) {
      alert(`Choose a date between ${formatDate(period.startDate)} and ${formatDate(period.endDate)}.`);
      return;
    }
    const payload = {
      id: id || uid(),
      periodId: period.id,
      type: $('#entryType').value,
      status: $('#entryType').value === 'income' ? 'paid' : $('#entryStatus').value,
      date,
      amount: Number($('#entryAmount').value),
      category: $('#entryCategory').value,
      description: $('#entryDescription').value.trim(),
      person: $('#entryPerson').value.trim(),
      createdAt: id ? (state.transactions.find(item => item.id === id)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
      recordedByUid: id ? (state.transactions.find(item => item.id === id)?.recordedByUid || window.HomeLedgerCloud?.currentUser?.uid || '') : (window.HomeLedgerCloud?.currentUser?.uid || ''),
      recordedByName: id ? (state.transactions.find(item => item.id === id)?.recordedByName || window.HomeLedgerCloud?.currentUser?.displayName || window.HomeLedgerCloud?.currentUser?.email || '') : (window.HomeLedgerCloud?.currentUser?.displayName || window.HomeLedgerCloud?.currentUser?.email || ''),
      updatedByUid: window.HomeLedgerCloud?.currentUser?.uid || '',
      updatedByName: window.HomeLedgerCloud?.currentUser?.displayName || window.HomeLedgerCloud?.currentUser?.email || '',
      updatedAt: new Date().toISOString()
    };
    const old = state.transactions.find(item => item.id === id);
    if (old?.fixedTemplateId) payload.fixedTemplateId = old.fixedTemplateId;
    if (old?.fixedOccurrenceDate) payload.fixedOccurrenceDate = old.fixedOccurrenceDate;
    if (old?.fixedRecurrence) payload.fixedRecurrence = old.fixedRecurrence;
    if (old?.reminderDays !== undefined) payload.reminderDays = old.reminderDays;
    if (id) state.transactions = state.transactions.map(item => item.id === id ? payload : item);
    else state.transactions.push(payload);
    saveState(id ? 'Entry updated' : 'Entry added');
    els.entryDialog.close();
    renderAll();
  });

  $('#fixedForm').addEventListener('submit', event => {
    event.preventDefault();
    const id = $('#fixedId').value;
    const payload = {
      id: id || uid(),
      name: $('#fixedName').value.trim(),
      amount: Number($('#fixedAmount').value),
      category: $('#fixedCategory').value,
      anchorDate: $('#fixedDueDate').value,
      dueDay: parseLocalDate($('#fixedDueDate').value).getDate(),
      recurrence: $('#fixedRecurrence').value,
      reminderDays: Math.min(30, Math.max(0, Number($('#fixedReminderDays').value || 0))),
      person: $('#fixedPerson').value.trim(),
      active: $('#fixedActive').checked,
      createdAt: id ? (state.fixedExpenses.find(item => item.id === id)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
      updatedByUid: window.HomeLedgerCloud?.currentUser?.uid || '',
      updatedByName: window.HomeLedgerCloud?.currentUser?.displayName || window.HomeLedgerCloud?.currentUser?.email || '',
      updatedAt: new Date().toISOString()
    };
    if (id) state.fixedExpenses = state.fixedExpenses.map(item => item.id === id ? payload : item);
    else state.fixedExpenses.push(payload);
    saveState(id ? 'Fixed bill updated' : 'Fixed bill added');
    els.fixedDialog.close();
    renderAll();
  });

  $('#periodForm').addEventListener('submit', event => {
    event.preventDefault();
    const id = $('#periodId').value;
    const startDate = $('#periodStart').value;
    const endDate = $('#periodEnd').value;
    if (endDate < startDate) {
      alert('The end date must be on or after the start date.');
      return;
    }
    const payload = {
      id: id || uid(),
      name: $('#periodName').value.trim(),
      startDate,
      endDate,
      budget: Number($('#periodBudget').value || 0),
      createdAt: id ? (state.periods.find(item => item.id === id)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
      updatedByUid: window.HomeLedgerCloud?.currentUser?.uid || '',
      updatedByName: window.HomeLedgerCloud?.currentUser?.displayName || window.HomeLedgerCloud?.currentUser?.email || '',
      updatedAt: new Date().toISOString()
    };

    const overlap = state.periods.find(period => period.id !== id && startDate <= period.endDate && endDate >= period.startDate);
    if (overlap && !confirm(`This period overlaps with “${overlap.name}.” Save it anyway?`)) return;

    if (id) {
      const outsideCount = state.transactions.filter(item => item.periodId === id && (item.date < startDate || item.date > endDate)).length;
      if (outsideCount && !confirm(`${plural(outsideCount, 'entry', 'entries')} will fall outside the new dates. Save anyway?`)) return;
      state.periods = state.periods.map(item => item.id === id ? payload : item);
    } else {
      state.periods.push(payload);
      state.activePeriodId = payload.id;
    }
    saveState(id ? 'Budget period updated' : 'Budget period created');
    els.periodDialog.close();
    renderAll();
    switchView('overview');
  });

  $('#settingsForm').addEventListener('submit', event => {
    event.preventDefault();
    state.settings.householdName = $('#householdName').value.trim() || 'Home Ledger';
    state.settings.currency = $('#currencyCode').value;
    saveState('Preferences saved');
    renderAll();
  });

  [els.entrySearch, els.entryTypeFilter, els.entryCategoryFilter].forEach(control => control.addEventListener(control.tagName === 'INPUT' ? 'input' : 'change', renderEntries));
  $('#exportJsonButton').addEventListener('click', exportBackup);
  $('#exportCsvButton').addEventListener('click', exportCsv);
  $('#importJsonInput').addEventListener('change', event => {
    importBackup(event.target.files?.[0]);
    event.target.value = '';
  });
  $('#resetDataButton').addEventListener('click', resetAllData);

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
}

function updateOnlineStatus() {
  els.offlineBanner.hidden = navigator.onLine;
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker registration failed:', error));
  }
}

function init() {
  registerEvents();
  renderAll();
  updateOnlineStatus();
  registerServiceWorker();
}

window.HomeLedgerApp = {
  getState: () => structuredCloneSafe(state),
  applyCloudState,
  normalizeState,
  defaultState,
  showToast,
  renderAll
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
