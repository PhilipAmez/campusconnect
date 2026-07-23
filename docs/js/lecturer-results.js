import { supabase } from './supabaseClient.js';
import { showLecturerNotice } from './lecturer-notify.js';

let state = {
  profile: null,
  quizzes: [],
  selectedQuizId: 'all',
  attempts: [],
  questions: []
};

let activeContainer = null;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

function median(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/* ============================================================
   Data loading
   ============================================================ */

async function loadData(profile) {
  const { data: quizzes, error: quizzesError } = await supabase
    .from('quizzes')
    .select('id, title, close_date, attempts_allowed, status')
    .eq('creator_id', profile.id)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });
  if (quizzesError) console.error('Failed to load quizzes for results:', quizzesError);

  state.quizzes = quizzes || [];
  const quizIds = state.quizzes
    .filter((q) => state.selectedQuizId === 'all' || q.id === state.selectedQuizId)
    .map((q) => q.id);

  if (!quizIds.length) {
    state.attempts = [];
    state.questions = [];
    return;
  }

  const { data: attempts, error: attemptsError } = await supabase
    .from('quiz_attempts')
    .select('id, quiz_id, group_id, status, score, max_score, submitted_at, full_name')
    .in('quiz_id', quizIds)
    .in('status', ['submitted', 'graded']);
  if (attemptsError) console.error('Failed to load attempts for results:', attemptsError);
  state.attempts = attempts || [];

  const { data: questions, error: questionsError } = await supabase
    .from('quiz_questions')
    .select('id, quiz_id, question_order, prompt, points, question_type')
    .in('quiz_id', quizIds);
  if (questionsError) console.error('Failed to load questions for results:', questionsError);
  state.questions = questions || [];

  // Question difficulty needs per-answer scoring
  const attemptIds = state.attempts.map((a) => a.id);
  if (attemptIds.length) {
    const { data: answers } = await supabase
      .from('quiz_answers')
      .select('attempt_id, question_id, points_awarded, is_correct')
      .in('attempt_id', attemptIds);
    state.answers = answers || [];
  } else {
    state.answers = [];
  }

  // Completion rate needs total assigned students across the linked groups
  const { data: links } = await supabase.from('quiz_groups').select('quiz_id, group_id').in('quiz_id', quizIds);
  const groupIdsByQuiz = {};
  (links || []).forEach((l) => {
    if (!groupIdsByQuiz[l.quiz_id]) groupIdsByQuiz[l.quiz_id] = [];
    groupIdsByQuiz[l.quiz_id].push(l.group_id);
  });
  const allGroupIds = [...new Set((links || []).map((l) => l.group_id))];
  let memberCountByGroup = {};
  if (allGroupIds.length) {
    const { data: members } = await supabase.from('group_members').select('group_id').in('group_id', allGroupIds);
    (members || []).forEach((m) => { memberCountByGroup[m.group_id] = (memberCountByGroup[m.group_id] || 0) + 1; });
  }
  state.groupIdsByQuiz = groupIdsByQuiz;
  state.memberCountByGroup = memberCountByGroup;
}

/* ============================================================
   Computed stats
   ============================================================ */

function computeStats() {
  const graded = state.attempts.filter((a) => a.status === 'graded' && a.score != null && a.max_score);
  const percentages = graded.map((a) => (Number(a.score) / Number(a.max_score)) * 100);

  const average = percentages.length ? percentages.reduce((s, v) => s + v, 0) / percentages.length : null;
  const highest = percentages.length ? Math.max(...percentages) : null;
  const lowest = percentages.length ? Math.min(...percentages) : null;
  const med = median(percentages);
  const passRate = percentages.length ? pct(percentages.filter((p) => p >= 50).length, percentages.length) : null;

  const totalAssigned = new Set();
  state.quizzes.forEach((q) => {
    if (state.selectedQuizId !== 'all' && q.id !== state.selectedQuizId) return;
    (state.groupIdsByQuiz[q.id] || []).forEach((gid) => {
      for (let i = 0; i < (state.memberCountByGroup[gid] || 0); i++) totalAssigned.add(`${q.id}:${gid}:${i}`);
    });
  });
  const completionRate = totalAssigned.size ? pct(state.attempts.length, totalAssigned.size) : null;

  const lateCount = state.attempts.filter((a) => {
    const quiz = state.quizzes.find((q) => q.id === a.quiz_id);
    return a.submitted_at && quiz?.close_date && new Date(a.submitted_at) > new Date(quiz.close_date);
  }).length;

  const distributionBuckets = [
    { label: '0–49%', min: 0, max: 49 },
    { label: '50–59%', min: 50, max: 59 },
    { label: '60–69%', min: 60, max: 69 },
    { label: '70–79%', min: 70, max: 79 },
    { label: '80–89%', min: 80, max: 89 },
    { label: '90–100%', min: 90, max: 100 }
  ].map((bucket) => ({
    ...bucket,
    count: percentages.filter((p) => p >= bucket.min && p <= bucket.max).length
  }));

  const answersByQuestion = {};
  (state.answers || []).forEach((a) => {
    if (!answersByQuestion[a.question_id]) answersByQuestion[a.question_id] = [];
    answersByQuestion[a.question_id].push(a);
  });

  const questionDifficulty = state.questions
    .slice()
    .sort((a, b) => a.question_order - b.question_order)
    .map((q) => {
      const relevant = (answersByQuestion[q.id] || []).filter((a) => a.points_awarded != null);
      const avgPct = relevant.length
        ? relevant.reduce((sum, a) => sum + (Number(a.points_awarded) / (Number(q.points) || 1)) * 100, 0) / relevant.length
        : null;
      return { ...q, avgPct, responseCount: relevant.length };
    });

  return { average, highest, lowest, med, passRate, completionRate, lateCount, distributionBuckets, questionDifficulty, gradedCount: graded.length };
}

/* ============================================================
   Rendering
   ============================================================ */

function fmtPct(value) {
  return value == null ? '—' : `${Math.round(value)}%`;
}

function renderDistributionChart(buckets) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return `
    <div class="distribution-chart">
      ${buckets.map((b) => `
        <div class="distribution-bar-wrap">
          <div class="distribution-bar" style="height: ${Math.round((b.count / max) * 100)}%;" title="${b.count} student${b.count === 1 ? '' : 's'}"></div>
          <span class="distribution-count">${b.count}</span>
          <span class="distribution-label">${b.label}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderQuestionDifficulty(questions) {
  if (!questions.length) {
    return `<p class="empty-inline">No questions to analyze yet.</p>`;
  }
  return `
    <div class="difficulty-list">
      ${questions.map((q, i) => {
        const difficultyClass = q.avgPct == null ? '' : q.avgPct >= 75 ? 'easy' : q.avgPct >= 50 ? 'medium' : 'hard';
        return `
          <div class="difficulty-row">
            <div class="difficulty-question">
              <strong>Q${i + 1}.</strong> ${escapeHtml((q.prompt || '').slice(0, 90))}${(q.prompt || '').length > 90 ? '…' : ''}
            </div>
            <div class="difficulty-bar-track">
              <div class="difficulty-bar-fill ${difficultyClass}" style="width: ${q.avgPct ?? 0}%;"></div>
            </div>
            <div class="difficulty-value">${fmtPct(q.avgPct)}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderShell(stats) {
  return `
    <section class="hero-card">
      <div>
        <div class="hero-badge"><i class="fa-solid fa-chart-line"></i> Results</div>
        <h3>Performance analytics</h3>
        <p>See how your students are doing at a glance, then dig into question-level difficulty.</p>
      </div>
      <div class="glass-card">
        <h4>Export</h4>
        <div class="stacked-actions">
          <button class="secondary-btn" id="exportCsvBtn"><i class="fa-solid fa-file-csv"></i> Export CSV</button>
          <button class="secondary-btn" id="exportExcelBtn"><i class="fa-solid fa-file-excel"></i> Export Excel</button>
          <button class="secondary-btn" id="exportPdfBtn"><i class="fa-solid fa-file-pdf"></i> Export PDF</button>
        </div>
      </div>
    </section>

    <section class="glass-card">
      <div class="field-group flex">
        <span>Quiz</span>
        <select class="quiz-input compact" id="resultsQuizSelect">
          <option value="all" ${state.selectedQuizId === 'all' ? 'selected' : ''}>All quizzes</option>
          ${state.quizzes.map((q) => `<option value="${q.id}" ${state.selectedQuizId === q.id ? 'selected' : ''}>${escapeHtml(q.title || 'Untitled quiz')}</option>`).join('')}
        </select>
      </div>

      <div class="stats-grid results-stats-grid">
        <div class="stat-card"><p class="value">${fmtPct(stats.average)}</p><p class="label">Average score</p></div>
        <div class="stat-card"><p class="value">${fmtPct(stats.highest)}</p><p class="label">Highest</p></div>
        <div class="stat-card"><p class="value">${fmtPct(stats.lowest)}</p><p class="label">Lowest</p></div>
        <div class="stat-card"><p class="value">${fmtPct(stats.med)}</p><p class="label">Median</p></div>
        <div class="stat-card"><p class="value">${fmtPct(stats.passRate)}</p><p class="label">Pass rate</p></div>
        <div class="stat-card"><p class="value">${stats.completionRate != null ? stats.completionRate + '%' : '—'}</p><p class="label">Completion rate</p></div>
        <div class="stat-card"><p class="value">${stats.lateCount}</p><p class="label">Late submissions</p></div>
        <div class="stat-card"><p class="value">${stats.gradedCount}</p><p class="label">Graded attempts</p></div>
      </div>
    </section>

    <div class="grid-2">
      <section class="glass-card">
        <h4>Score distribution</h4>
        ${stats.gradedCount ? renderDistributionChart(stats.distributionBuckets) : '<p class="empty-inline">No graded attempts yet — publish some grades to see the distribution.</p>'}
      </section>

      <section class="glass-card">
        <h4>Question difficulty</h4>
        ${renderQuestionDifficulty(stats.questionDifficulty)}
      </section>
    </div>
  `;
}

function wireShell(container, stats) {
  container.querySelector('#resultsQuizSelect')?.addEventListener('change', async (e) => {
    state.selectedQuizId = e.target.value;
    await refresh(container);
  });

  container.querySelector('#exportCsvBtn')?.addEventListener('click', () => exportCsv());
  container.querySelector('#exportExcelBtn')?.addEventListener('click', () => exportExcel());
  container.querySelector('#exportPdfBtn')?.addEventListener('click', () => exportPdf(stats));
}

/* ============================================================
   Exports
   ============================================================ */

function buildExportRows() {
  return state.attempts.map((a) => {
    const quiz = state.quizzes.find((q) => q.id === a.quiz_id);
    return {
      Student: a.full_name || 'Unnamed student',
      Quiz: quiz?.title || 'Untitled quiz',
      Status: a.status,
      Score: a.score ?? '',
      'Max Score': a.max_score ?? '',
      'Submitted At': a.submitted_at || ''
    };
  });
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportCsv() {
  const rows = buildExportRows();
  if (!rows.length) {
    showLecturerNotice('Nothing to export', 'There are no submissions for this selection yet.', 'info');
    return;
  }
  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => `"${String(row[h]).replace(/"/g, '""')}"`).join(','))
  ];
  downloadBlob(csvLines.join('\n'), 'quiz-results.csv', 'text/csv');
}

let libraryLoadPromises = {};
function loadScriptOnce(src, key) {
  if (libraryLoadPromises[key]) return libraryLoadPromises[key];
  libraryLoadPromises[key] = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-lib="${key}"]`);
    if (existing) { existing.addEventListener('load', resolve); return; }
    const script = document.createElement('script');
    script.src = src;
    script.dataset.lib = key;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return libraryLoadPromises[key];
}

async function exportExcel() {
  const rows = buildExportRows();
  if (!rows.length) {
    showLecturerNotice('Nothing to export', 'There are no submissions for this selection yet.', 'info');
    return;
  }
  try {
    await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', 'xlsx');
    const wb = window.XLSX.utils.book_new();
    const ws = window.XLSX.utils.json_to_sheet(rows);
    window.XLSX.utils.book_append_sheet(wb, ws, 'Results');
    window.XLSX.writeFile(wb, 'quiz-results.xlsx');
  } catch (err) {
    console.error('Excel export failed:', err);
    showLecturerNotice('Export failed', 'Could not generate the Excel file. Please try again.', 'error');
  }
}

const BRAND = {
  name: 'Peerloom Technologies Limited',
  accent: [124, 58, 237], // matches --accent purple used across the app
  accentDark: [76, 29, 149],
  ink: [30, 41, 59],
  muted: [100, 116, 139]
};

function initialsFor(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words[0][0] + (words[1]?.[0] || '')).toUpperCase();
}

// Every report page (after the cover) gets the same slim header + footer:
// a running title on top, and page number + copyright on the bottom.
function drawPageChrome(doc, { title, pageLabel }) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setDrawColor(...BRAND.accent);
  doc.setLineWidth(0.6);
  doc.line(14, 20, pageWidth - 14, 20);
  doc.setFontSize(9);
  doc.setTextColor(...BRAND.muted);
  doc.text(title, 14, 15);
  doc.text(pageLabel, pageWidth - 14, 15, { align: 'right' });

  doc.setDrawColor(230, 230, 235);
  doc.setLineWidth(0.4);
  doc.line(14, pageHeight - 16, pageWidth - 14, pageHeight - 16);
  doc.setFontSize(8);
  doc.setTextColor(...BRAND.muted);
  doc.text(`© ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.`, 14, pageHeight - 10);
  const pageCount = doc.internal.getNumberOfPages();
  doc.text(`Page ${doc.internal.getCurrentPageInfo().pageNumber} of ${pageCount}`, pageWidth - 14, pageHeight - 10, { align: 'right' });
}

function drawCoverPage(doc, { institution, quizLabel, lecturerName, stats }) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Full-bleed accent panel across the top third of the cover.
  doc.setFillColor(...BRAND.accentDark);
  doc.rect(0, 0, pageWidth, 92, 'F');
  doc.setFillColor(...BRAND.accent);
  doc.rect(0, 92, pageWidth, 6, 'F');

  // Institution "logo" badge — a monogram, since no institution logo is
  // uploaded anywhere in the product yet. Swap this for a real image once
  // logo uploads exist.
  doc.setFillColor(255, 255, 255);
  doc.circle(28, 40, 15, 'F');
  doc.setTextColor(...BRAND.accentDark);
  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text(initialsFor(institution), 28, 44.5, { align: 'center' });

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont(undefined, 'normal');
  doc.text((institution || 'Institution').toUpperCase(), 52, 33);
  doc.setFontSize(24);
  doc.setFont(undefined, 'bold');
  doc.text('Quiz Performance Report', 52, 46);
  doc.setFontSize(12);
  doc.setFont(undefined, 'normal');
  doc.text(quizLabel, 52, 56, { maxWidth: pageWidth - 66 });

  // Meta block beneath the banner.
  doc.setTextColor(...BRAND.ink);
  doc.setFontSize(10.5);
  const metaY = 118;
  const metaLine = (label, value, y) => {
    doc.setFont(undefined, 'bold');
    doc.text(label, 14, y);
    doc.setFont(undefined, 'normal');
    doc.text(value, 60, y);
  };
  metaLine('Prepared by:', lecturerName || 'Lecturer', metaY);
  metaLine('Generated on:', new Date().toLocaleString('en', { dateStyle: 'long', timeStyle: 'short' }), metaY + 8);
  metaLine('Report scope:', quizLabel, metaY + 16);
  metaLine('Classification:', 'Confidential — for internal academic use', metaY + 24);

  // Headline KPI strip.
  const kpis = [
    ['Average score', fmtPct(stats.average)],
    ['Pass rate', fmtPct(stats.passRate)],
    ['Completion rate', stats.completionRate != null ? `${stats.completionRate}%` : '—'],
    ['Graded attempts', String(stats.gradedCount)]
  ];
  const kpiY = metaY + 40;
  const kpiWidth = (pageWidth - 28 - 3 * 6) / 4;
  kpis.forEach((kpi, i) => {
    const x = 14 + i * (kpiWidth + 6);
    doc.setFillColor(247, 245, 255);
    doc.roundedRect(x, kpiY, kpiWidth, 30, 3, 3, 'F');
    doc.setTextColor(...BRAND.accentDark);
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text(kpi[1], x + kpiWidth / 2, kpiY + 15, { align: 'center' });
    doc.setTextColor(...BRAND.muted);
    doc.setFontSize(8.5);
    doc.setFont(undefined, 'normal');
    doc.text(kpi[0], x + kpiWidth / 2, kpiY + 23, { align: 'center' });
  });

  doc.setTextColor(...BRAND.muted);
  doc.setFontSize(8);
  doc.text(`© ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.`, 14, pageHeight - 10);
  doc.text('Page 1', pageWidth - 14, pageHeight - 10, { align: 'right' });
}

function drawExecutiveSummary(doc, stats) {
  doc.addPage();
  let y = 34;
  doc.setTextColor(...BRAND.ink);
  doc.setFontSize(15);
  doc.setFont(undefined, 'bold');
  doc.text('Executive summary', 14, y);
  y += 9;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(...BRAND.muted);
  const summary = `This report covers ${stats.gradedCount} graded attempt${stats.gradedCount === 1 ? '' : 's'}. `
    + `Students averaged ${fmtPct(stats.average)}, with a pass rate of ${fmtPct(stats.passRate)} `
    + `and a completion rate of ${stats.completionRate != null ? stats.completionRate + '%' : 'an unknown share of'} assigned students. `
    + `${stats.lateCount} submission${stats.lateCount === 1 ? ' was' : 's were'} received after the deadline.`;
  const wrapped = doc.splitTextToSize(summary, doc.internal.pageSize.getWidth() - 28);
  doc.text(wrapped, 14, y);
  y += wrapped.length * 5 + 10;

  const rows = [
    ['Average score', fmtPct(stats.average)],
    ['Highest score', fmtPct(stats.highest)],
    ['Lowest score', fmtPct(stats.lowest)],
    ['Median score', fmtPct(stats.med)],
    ['Pass rate (≥50%)', fmtPct(stats.passRate)],
    ['Completion rate', stats.completionRate != null ? `${stats.completionRate}%` : '—'],
    ['Late submissions', String(stats.lateCount)],
    ['Graded attempts', String(stats.gradedCount)]
  ];
  doc.autoTable({
    startY: y,
    margin: { top: 24, bottom: 22 },
    head: [['Key metric', 'Value']],
    body: rows,
    theme: 'grid',
    headStyles: { fillColor: BRAND.accent, textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 10, cellPadding: 4 },
    didDrawPage: () => drawPageChrome(doc, { title: 'Quiz Performance Report — Executive Summary', pageLabel: 'Summary' })
  });

  if (stats.gradedCount) {
    let chartY = doc.lastAutoTable.finalY + 14;
    if (chartY > doc.internal.pageSize.getHeight() - 70) {
      doc.addPage();
      drawPageChrome(doc, { title: 'Quiz Performance Report — Executive Summary', pageLabel: 'Summary' });
      chartY = 30;
    }
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...BRAND.ink);
    doc.text('Score distribution', 14, chartY);
    chartY += 6;

    const chartHeight = 45;
    const chartWidth = doc.internal.pageSize.getWidth() - 28;
    const barGap = 6;
    const barWidth = (chartWidth - barGap * (stats.distributionBuckets.length - 1)) / stats.distributionBuckets.length;
    const maxCount = Math.max(1, ...stats.distributionBuckets.map((b) => b.count));
    stats.distributionBuckets.forEach((bucket, i) => {
      const barH = (bucket.count / maxCount) * chartHeight;
      const x = 14 + i * (barWidth + barGap);
      doc.setFillColor(...BRAND.accent);
      doc.roundedRect(x, chartY + (chartHeight - barH), barWidth, Math.max(barH, 1), 1.5, 1.5, 'F');
      doc.setFontSize(8.5);
      doc.setTextColor(...BRAND.ink);
      doc.text(String(bucket.count), x + barWidth / 2, chartY + chartHeight - barH - 2, { align: 'center' });
      doc.setTextColor(...BRAND.muted);
      doc.text(bucket.label, x + barWidth / 2, chartY + chartHeight + 6, { align: 'center' });
    });
  }
}

function drawQuestionDifficulty(doc, questions) {
  if (!questions.length) return;
  doc.addPage();
  drawPageChrome(doc, { title: 'Quiz Performance Report — Question Difficulty', pageLabel: 'Question analysis' });
  doc.setFontSize(15);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...BRAND.ink);
  doc.text('Question difficulty', 14, 34);

  doc.autoTable({
    startY: 40,
    margin: { top: 24, bottom: 22 },
    head: [['#', 'Question', 'Avg. score', 'Responses']],
    body: questions.map((q, i) => [
      String(i + 1),
      (q.prompt || '').slice(0, 100) + ((q.prompt || '').length > 100 ? '…' : ''),
      fmtPct(q.avgPct),
      String(q.responseCount)
    ]),
    theme: 'striped',
    headStyles: { fillColor: BRAND.accent, textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 9, cellPadding: 3.5 },
    columnStyles: { 0: { cellWidth: 10 }, 2: { cellWidth: 26 }, 3: { cellWidth: 26 } },
    didDrawPage: () => drawPageChrome(doc, { title: 'Quiz Performance Report — Question Difficulty', pageLabel: 'Question analysis' })
  });
}

function drawDetailedResults(doc, rows) {
  doc.addPage();
  drawPageChrome(doc, { title: 'Quiz Performance Report — Detailed Results', pageLabel: 'Appendix' });
  doc.setFontSize(15);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...BRAND.ink);
  doc.text('Detailed results', 14, 34);

  doc.autoTable({
    startY: 40,
    margin: { top: 24, bottom: 22 },
    head: [Object.keys(rows[0])],
    body: rows.map((r) => Object.values(r)),
    theme: 'striped',
    headStyles: { fillColor: BRAND.accent, textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 8.5, cellPadding: 3 },
    didDrawPage: () => drawPageChrome(doc, { title: 'Quiz Performance Report — Detailed Results', pageLabel: 'Appendix' })
  });
}

async function exportPdf(stats) {
  const rows = buildExportRows();
  if (!rows.length) {
    showLecturerNotice('Nothing to export', 'There are no submissions for this selection yet.', 'info');
    return;
  }
  try {
    await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'jspdf');
    await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js', 'jspdf-autotable');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const activeQuiz = state.selectedQuizId === 'all' ? null : state.quizzes.find((q) => q.id === state.selectedQuizId);
    const quizLabel = activeQuiz ? activeQuiz.title || 'Untitled quiz' : `All quizzes (${state.quizzes.length})`;
    const institution = state.profile?.institution || state.profile?.campus || state.profile?.custom_campus || 'Institution';
    const lecturerName = state.profile?.full_name || 'Lecturer';

    drawCoverPage(doc, { institution, quizLabel, lecturerName, stats });
    drawExecutiveSummary(doc, stats);
    drawQuestionDifficulty(doc, stats.questionDifficulty.filter((q) => q.responseCount > 0));
    drawDetailedResults(doc, rows);

    doc.save(`${(quizLabel || 'quiz-results').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-report.pdf`);
  } catch (err) {
    console.error('PDF export failed:', err);
    showLecturerNotice('Export failed', 'Could not generate the PDF. Please try again.', 'error');
  }
}

/* ============================================================
   Entry point
   ============================================================ */

async function refresh(container) {
  await loadData(state.profile);
  const stats = computeStats();
  container.innerHTML = renderShell(stats);
  wireShell(container, stats);
}

async function renderResultsSection(container, profile) {
  if (!container) return;
  activeContainer = container;
  state.profile = profile;

  container.innerHTML = `
    <section class="hero-card">
      <div>
        <div class="hero-badge"><i class="fa-solid fa-chart-line"></i> Results</div>
        <h3>Loading analytics&hellip;</h3>
      </div>
    </section>
  `;

  try {
    await refresh(container);
  } catch (err) {
    console.error('Failed to load results:', err);
  }
}

export { renderResultsSection };