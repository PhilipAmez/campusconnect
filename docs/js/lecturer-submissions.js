import { supabase } from './supabaseClient.js';
import { showLecturerNotice, showLecturerConfirm } from './lecturer-notify.js';
import { openStudentProfile } from './lecturer-student-profile.js';

const QUESTION_TYPE_LABELS = {
  mcq: 'Multiple Choice',
  true_false: 'True / False',
  short_answer: 'Short Answer',
  essay: 'Essay'
};

let state = {
  profile: null,
  quizzes: [],
  attempts: [],
  filter: 'pending',
  quizFilter: 'all',
  search: ''
};

let gradingOverlay = null;
let gradingContext = null; // { attempt, quiz, questions, answers, drafts }

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function isLate(attempt, quiz) {
  if (!attempt.submitted_at || !quiz?.close_date) return false;
  return new Date(attempt.submitted_at) > new Date(quiz.close_date);
}

function hasPendingEssay(attempt) {
  return (attempt.__answers || []).some((a) => {
    const q = attempt.__questionsById?.[a.question_id];
    return q && (q.question_type === 'essay' || q.question_type === 'short_answer') && a.points_awarded == null;
  });
}

async function loadData(profile) {
  const { data: quizzes, error: quizzesError } = await supabase
    .from('quizzes')
    .select('id, title, close_date, attempts_allowed, status')
    .eq('creator_id', profile.id)
    .eq('is_deleted', false);
  if (quizzesError) console.error('Failed to load quizzes for submissions:', quizzesError);

  const quizList = quizzes || [];
  const quizIds = quizList.map((q) => q.id);
  const quizById = Object.fromEntries(quizList.map((q) => [q.id, q]));

  if (!quizIds.length) {
    state.quizzes = [];
    state.attempts = [];
    return;
  }

  const { data: attempts, error: attemptsError } = await supabase
    .from('quiz_attempts')
    .select('*')
    .in('quiz_id', quizIds)
    .in('status', ['submitted', 'graded'])
    .order('submitted_at', { ascending: false });
  if (attemptsError) console.error('Failed to load attempts:', attemptsError);

  const attemptIds = (attempts || []).map((a) => a.id);
  let answersByAttempt = {};
  if (attemptIds.length) {
    const { data: answers, error: answersError } = await supabase
      .from('quiz_answers')
      .select('*')
      .in('attempt_id', attemptIds);
    if (answersError) console.error('Failed to load answers:', answersError);
    (answers || []).forEach((a) => {
      if (!answersByAttempt[a.attempt_id]) answersByAttempt[a.attempt_id] = [];
      answersByAttempt[a.attempt_id].push(a);
    });
  }

  // Group names for display
  const groupIds = [...new Set((attempts || []).map((a) => a.group_id).filter(Boolean))];
  let groupNameById = {};
  if (groupIds.length) {
    const { data: groups } = await supabase.from('groups').select('id, name').in('id', groupIds);
    (groups || []).forEach((g) => { groupNameById[g.id] = g.name; });
  }

  // Question types per quiz, so we know which answers still need manual grading
  const { data: questions } = await supabase
    .from('quiz_questions')
    .select('id, quiz_id, question_order, question_type, prompt, points, options, correct_option')
    .in('quiz_id', quizIds)
    .order('question_order', { ascending: true });

  const questionsByQuiz = {};
  const questionsById = {};
  (questions || []).forEach((q) => {
    if (!questionsByQuiz[q.quiz_id]) questionsByQuiz[q.quiz_id] = [];
    questionsByQuiz[q.quiz_id].push(q);
    questionsById[q.id] = q;
  });

  state.quizzes = quizList;
  state.questionsByQuiz = questionsByQuiz;
  state.questionsById = questionsById;
  const realRows = (attempts || []).map((a) => ({
    ...a,
    __quiz: quizById[a.quiz_id],
    __groupName: groupNameById[a.group_id] || 'Unknown group',
    __answers: answersByAttempt[a.id] || [],
    __questionsById: questionsById
  }));

  // Students who were assigned a quiz but never attempted it don't have a
  // quiz_attempts row at all, so the query above never surfaces them — the
  // lecturer only ever saw "0 submissions" with no indication who was
  // actually missing. This builds a synthetic "expired" row for each
  // assigned student with no attempt, but only once the quiz's close_date
  // has actually passed: while a quiz is still open, "hasn't attempted yet"
  // isn't a problem to flag, it's just normal. (A quiz with no close_date
  // never expires, so it never generates these rows.)
  const expiredQuizzes = quizList.filter((q) => q.status === 'published' && q.close_date && new Date(q.close_date) < new Date());
  state.attempts = realRows;
  if (expiredQuizzes.length) {
    const expiredQuizIds = expiredQuizzes.map((q) => q.id);
    const { data: links } = await supabase
      .from('quiz_groups')
      .select('quiz_id, group_id')
      .in('quiz_id', expiredQuizIds);

    const groupIdsForExpired = [...new Set((links || []).map((l) => l.group_id))];
    let membersByGroup = {};
    if (groupIdsForExpired.length) {
      const { data: members } = await supabase
        .from('group_members')
        .select('group_id, user_id')
        .in('group_id', groupIdsForExpired);
      (members || []).forEach((m) => {
        if (!membersByGroup[m.group_id]) membersByGroup[m.group_id] = [];
        membersByGroup[m.group_id].push(m.user_id);
      });
    }

    const studentIds = [...new Set(Object.values(membersByGroup).flat())];
    let profileById = {};
    if (studentIds.length) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, username, is_lecturer, role')
        .in('id', studentIds);
      (profiles || []).forEach((p) => { profileById[p.id] = p; });
    }

    const attemptedByQuiz = {};
    realRows.forEach((a) => {
      if (!attemptedByQuiz[a.quiz_id]) attemptedByQuiz[a.quiz_id] = new Set();
      attemptedByQuiz[a.quiz_id].add(a.student_id);
    });

    const expiredRows = [];
    (links || []).forEach((link) => {
      const quiz = quizById[link.quiz_id];
      const memberIds = membersByGroup[link.group_id] || [];
      memberIds.forEach((studentId) => {
        const p = profileById[studentId];
        // Only students, never the lecturer themself or a co-instructor
        // accidentally swept in as a group member.
        if (!p || p.is_lecturer || p.role === 'lecturer') return;
        if (attemptedByQuiz[link.quiz_id]?.has(studentId)) return;
        expiredRows.push({
          id: `expired_${link.quiz_id}_${studentId}`,
          quiz_id: link.quiz_id,
          student_id: studentId,
          group_id: link.group_id,
          full_name: p.full_name || p.username || 'Unnamed student',
          index_number: null,
          status: 'expired',
          score: null,
          max_score: null,
          submitted_at: null,
          attempt_number: 0,
          __quiz: quiz,
          __groupName: groupNameById[link.group_id] || 'Unknown group',
          __answers: [],
          __questionsById: questionsById
        });
      });
    });

    // A student can be a member of more than one group the same quiz was
    // assigned to — de-dupe so they only ever show up once per quiz.
    const seen = new Set();
    state.attempts = realRows.concat(
      expiredRows.filter((r) => {
        const key = `${r.quiz_id}:${r.student_id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
    );
  }
}

function getFilteredAttempts() {
  let list = [...state.attempts];

  if (state.quizFilter !== 'all') {
    list = list.filter((a) => a.quiz_id === state.quizFilter);
  }

  if (state.filter === 'pending') list = list.filter((a) => a.status === 'submitted');
  else if (state.filter === 'graded') list = list.filter((a) => a.status === 'graded');
  else if (state.filter === 'essay-pending') list = list.filter((a) => hasPendingEssay(a));
  else if (state.filter === 'late') list = list.filter((a) => isLate(a, a.__quiz));
  else if (state.filter === 'expired') list = list.filter((a) => a.status === 'expired');

  if (state.search.trim()) {
    const term = state.search.trim().toLowerCase();
    list = list.filter((a) =>
      (a.full_name || '').toLowerCase().includes(term) ||
      (a.index_number || '').toLowerCase().includes(term) ||
      (a.__quiz?.title || '').toLowerCase().includes(term)
    );
  }

  return list;
}

function renderStatusBadge(attempt) {
  // A student who never attempted a now-closed quiz was never graded and
  // never will be — showing "Not graded" (or worse, a score-looking dash)
  // reads as if grading is still pending. "Expired" says plainly that the
  // window closed with no submission, whether the quiz was MCQ/auto-graded
  // or not.
  if (attempt.status === 'expired') return '<span class="badge-pill badge-muted">Expired</span>';
  if (attempt.status === 'graded') return '<span class="badge-pill badge-success">Graded</span>';
  if (hasPendingEssay(attempt)) return '<span class="badge-pill badge-warning">Essay Pending</span>';
  return '<span class="badge-pill">Submitted</span>';
}

function renderRow(attempt) {
  const quiz = attempt.__quiz;
  const isExpired = attempt.status === 'expired';
  const late = isLate(attempt, quiz);
  const scoreLabel = attempt.status === 'graded' && attempt.score != null
    ? `${attempt.score} / ${attempt.max_score ?? '—'}`
    : '—';

  // There's nothing to grade for a student who never submitted anything —
  // the Grade/Review button only makes sense when a real attempt exists.
  const actionHtml = isExpired
    ? ''
    : `
      <button class="secondary-btn small" data-action="grade" data-attempt-id="${attempt.id}">
        <i class="fa-solid fa-pen-to-square"></i> ${attempt.status === 'graded' ? 'Review' : 'Grade'}
      </button>
    `;

  return `
    <div class="submission-row" data-attempt-id="${attempt.id}">
      <div class="submission-main">
        <strong class="clickable-student" data-action="profile" data-student-id="${attempt.student_id}">${escapeHtml(attempt.full_name || 'Unnamed student')}</strong>
        <small>${escapeHtml(attempt.index_number || 'No index number')} · ${escapeHtml(attempt.__groupName)}</small>
      </div>
      <div class="submission-quiz">
        <span>${escapeHtml(quiz?.title || 'Untitled quiz')}</span>
        <small>${isExpired ? 'No submission received' : formatDateTime(attempt.submitted_at)}${late ? ' · <span class="late-tag">Late</span>' : ''}</small>
      </div>
      <div class="submission-score">${scoreLabel}</div>
      <div class="submission-status">${renderStatusBadge(attempt)}</div>
      ${actionHtml}
    </div>
  `;
}

function renderList(container) {
  const listEl = container.querySelector('#submissionsList');
  if (!listEl) return;

  const filtered = getFilteredAttempts();

  if (!filtered.length) {
    listEl.innerHTML = `
      <div class="empty-state-card">
        <i class="fa-solid fa-inbox"></i>
        <h4>Nothing here yet</h4>
        <p>${state.attempts.length ? 'No submissions match this filter.' : 'Submissions will appear here once students start completing your quizzes.'}</p>
      </div>`;
    return;
  }

  listEl.innerHTML = `
    <div class="submission-row submission-header">
      <div class="submission-main">Student</div>
      <div class="submission-quiz">Quiz</div>
      <div class="submission-score">Score</div>
      <div class="submission-status">Status</div>
      <div></div>
    </div>
    ${filtered.map(renderRow).join('')}
  `;

  listEl.querySelectorAll('[data-action="grade"]').forEach((btn) => {
    btn.addEventListener('click', () => openGradingOverlay(btn.dataset.attemptId));
  });

  listEl.querySelectorAll('[data-action="profile"]').forEach((el) => {
    el.addEventListener('click', () => openStudentProfile(el.dataset.studentId, state.profile));
  });
}

function renderCounts() {
  const pending = state.attempts.filter((a) => a.status === 'submitted').length;
  const essayPending = state.attempts.filter((a) => hasPendingEssay(a)).length;
  const graded = state.attempts.filter((a) => a.status === 'graded').length;
  const late = state.attempts.filter((a) => isLate(a, a.__quiz)).length;
  const expired = state.attempts.filter((a) => a.status === 'expired').length;
  return { pending, essayPending, graded, late, expired };
}

function renderSkeleton() {
  return `
    <section class="hero-card">
      <div>
        <div class="hero-badge"><i class="fa-solid fa-inbox"></i> Quiz submissions</div>
        <h3>Loading submissions&hellip;</h3>
      </div>
    </section>
  `;
}

function renderShell() {
  const counts = renderCounts();

  return `
    <section class="hero-card">
      <div>
        <div class="hero-badge"><i class="fa-solid fa-inbox"></i> Quiz submissions</div>
        <h3>Review &amp; grade submissions</h3>
        <p>Objective questions are already scored. Essay and short-answer responses are waiting on you.</p>
      </div>
      <div class="glass-card">
        <h4>At a glance</h4>
        <div class="stats-grid stats-grid-compact">
          <div class="stat-card"><p class="value">${counts.pending}</p><p class="label">Pending review</p></div>
          <div class="stat-card"><p class="value">${counts.essayPending}</p><p class="label">Essay pending</p></div>
          <div class="stat-card"><p class="value">${counts.graded}</p><p class="label">Graded</p></div>
          <div class="stat-card"><p class="value">${counts.late}</p><p class="label">Late submissions</p></div>
          <div class="stat-card"><p class="value">${counts.expired}</p><p class="label">Expired (no submission)</p></div>
        </div>
      </div>
    </section>

    <section class="glass-card">
      <div class="filter-row">
        <div class="field-group flex field-group-wide">
          <span>Search</span>
          <input type="text" class="quiz-input" id="submissionSearch" placeholder="Student name, index number, or quiz&hellip;" value="${escapeHtml(state.search)}" />
        </div>
        <div class="field-group flex">
          <span>Quiz</span>
          <select class="quiz-input" id="quizFilterSelect">
            <option value="all">All quizzes</option>
            ${state.quizzes.map((q) => `<option value="${q.id}" ${state.quizFilter === q.id ? 'selected' : ''}>${escapeHtml(q.title || 'Untitled quiz')}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="preview-tabs" id="submissionTabs">
        <button class="preview-tab ${state.filter === 'pending' ? 'active' : ''}" data-filter="pending">Pending Review</button>
        <button class="preview-tab ${state.filter === 'essay-pending' ? 'active' : ''}" data-filter="essay-pending">Essay Pending</button>
        <button class="preview-tab ${state.filter === 'graded' ? 'active' : ''}" data-filter="graded">Graded</button>
        <button class="preview-tab ${state.filter === 'late' ? 'active' : ''}" data-filter="late">Late</button>
        <button class="preview-tab ${state.filter === 'expired' ? 'active' : ''}" data-filter="expired">Expired</button>
        <button class="preview-tab ${state.filter === 'all' ? 'active' : ''}" data-filter="all">All</button>
      </div>
      <div class="submissions-list" id="submissionsList"></div>
    </section>
  `;
}

function wireShell(container) {
  container.querySelector('#submissionSearch')?.addEventListener('input', (e) => {
    state.search = e.target.value;
    renderList(container);
  });

  container.querySelector('#quizFilterSelect')?.addEventListener('change', (e) => {
    state.quizFilter = e.target.value;
    renderList(container);
  });

  container.querySelectorAll('#submissionTabs .preview-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.filter = tab.dataset.filter;
      container.querySelectorAll('#submissionTabs .preview-tab').forEach((t) => t.classList.toggle('active', t === tab));
      renderList(container);
    });
  });
}

/* ============================================================
   Grading overlay
   ============================================================ */

function ensureGradingOverlay() {
  if (gradingOverlay) return gradingOverlay;

  gradingOverlay = document.createElement('div');
  gradingOverlay.className = 'grading-overlay';
  gradingOverlay.innerHTML = `
    <div class="grading-card">
      <div class="grading-card-header">
        <div>
          <h3 id="gradingStudentName">Student</h3>
          <p id="gradingQuizMeta" class="grading-meta"></p>
        </div>
        <button class="topbar-btn" id="gradingCloseBtn" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="grading-body" id="gradingBody"></div>
      <div class="grading-footer">
        <div class="grading-total" id="gradingTotal">Total: 0 / 0</div>
        <div class="grading-actions">
          <button class="secondary-btn" id="gradingSaveDraftBtn">Save Draft</button>
          <button class="primary-btn" id="gradingPublishBtn"><i class="fa-solid fa-paper-plane"></i> Publish Grade</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(gradingOverlay);

  gradingOverlay.addEventListener('click', (e) => {
    if (e.target === gradingOverlay) closeGradingOverlay();
  });
  gradingOverlay.querySelector('#gradingCloseBtn').addEventListener('click', closeGradingOverlay);

  return gradingOverlay;
}

function closeGradingOverlay() {
  if (gradingOverlay) gradingOverlay.classList.remove('visible');
  gradingContext = null;
}

function renderQuestionGradeCard(question, answer) {
  const isObjective = question.question_type === 'mcq' || question.question_type === 'true_false';

  // Previously this fell back to `answer.points_awarded` again when it was
  // already null — a no-op that left the points field blank with no
  // explanation. For an objective question we already know the answer key,
  // so there's no reason to make the lecturer manually figure out and type
  // in what the system can calculate itself.
  const isCorrectMatch = isObjective && answer.selected_option != null && Number(answer.selected_option) === Number(question.correct_option);
  const draftPoints = answer.points_awarded != null
    ? answer.points_awarded
    : (isObjective ? (isCorrectMatch ? (question.points || 0) : 0) : '');

  let answerHtml = '';
  let answerKeyControl = '';
  if (question.question_type === 'mcq') {
    const options = Array.isArray(question.options) ? question.options : [];
    const selectedLabel = options[answer.selected_option]?.text || options[answer.selected_option]?.label || 'No answer';
    const correctLabel = options[question.correct_option]?.text || options[question.correct_option]?.label || '—';
    answerHtml = `
      <p><strong>Student answer:</strong> ${escapeHtml(selectedLabel)} ${isCorrectMatch ? '<span class="grading-verdict correct">Correct</span>' : '<span class="grading-verdict incorrect">Incorrect</span>'}</p>
      <p class="grading-correct-answer"><strong>Correct answer:</strong> ${escapeHtml(correctLabel)}</p>
    `;
    // Lets a lecturer fix the answer key itself right from grading — e.g.
    // if it was set wrong when the quiz was built. Changing this updates
    // quiz_questions.correct_option going forward and re-scores the
    // attempt currently being graded; it does not retroactively touch
    // other students' already-graded attempts.
    answerKeyControl = `
      <label class="field-group full grading-answer-key">
        <span>Correct answer is actually&hellip; <small>(only change this if the answer key was set wrong)</small></span>
        <select class="quiz-input compact grading-answer-key-select" data-question-id="${question.id}">
          ${options.map((opt, i) => `<option value="${i}" ${i === question.correct_option ? 'selected' : ''}>${escapeHtml(opt.text || opt.label || `Option ${i + 1}`)}</option>`).join('')}
        </select>
      </label>
    `;
  } else if (question.question_type === 'true_false') {
    const selectedLabel = Number(answer.selected_option) === 1 ? 'True' : Number(answer.selected_option) === 0 ? 'False' : 'No answer';
    const correctLabel = question.correct_option === 1 ? 'True' : 'False';
    answerHtml = `
      <p><strong>Student answer:</strong> ${escapeHtml(selectedLabel)} ${isCorrectMatch ? '<span class="grading-verdict correct">Correct</span>' : '<span class="grading-verdict incorrect">Incorrect</span>'}</p>
      <p class="grading-correct-answer"><strong>Correct answer:</strong> ${escapeHtml(correctLabel)}</p>
    `;
    answerKeyControl = `
      <label class="field-group full grading-answer-key">
        <span>Correct answer is actually&hellip; <small>(only change this if the answer key was set wrong)</small></span>
        <select class="quiz-input compact grading-answer-key-select" data-question-id="${question.id}">
          <option value="1" ${question.correct_option === 1 ? 'selected' : ''}>True</option>
          <option value="0" ${question.correct_option === 0 ? 'selected' : ''}>False</option>
        </select>
      </label>
    `;
  } else {
    answerHtml = `<p class="grading-text-answer">${escapeHtml(answer.answer_text || '(No answer submitted)')}</p>`;
  }

  return `
    <div class="grading-question-card" data-question-id="${question.id}">
      <div class="grading-question-top">
        <span class="badge-pill">${QUESTION_TYPE_LABELS[question.question_type] || question.question_type}</span>
        <span class="grading-points-label">${question.points || 0} pt${question.points === 1 ? '' : 's'}</span>
      </div>
      <p class="grading-prompt">${escapeHtml(question.prompt)}</p>
      ${answerHtml}
      <div class="grading-controls">
        ${answerKeyControl}
        <label class="field-group">
          <span>Points awarded</span>
          <input type="number" class="quiz-input compact grading-points-input" min="0" max="${question.points || 0}" step="0.5"
            value="${draftPoints}" data-question-id="${question.id}" />
        </label>
        <label class="field-group full">
          <span>Feedback (optional)</span>
          <textarea class="quiz-input compact grading-feedback-input" rows="2" data-question-id="${question.id}" placeholder="Add a note for the student&hellip;">${escapeHtml(answer.feedback || '')}</textarea>
        </label>
      </div>
    </div>
  `;
}

function recomputeGradingTotal() {
  const overlay = gradingOverlay;
  if (!overlay || !gradingContext) return;
  let total = 0;
  let max = 0;
  gradingContext.questions.forEach((q) => {
    max += Number(q.points) || 0;
    const input = overlay.querySelector(`.grading-points-input[data-question-id="${q.id}"]`);
    const val = input ? parseFloat(input.value) : 0;
    total += Number.isFinite(val) ? val : 0;
  });
  overlay.querySelector('#gradingTotal').textContent = `Total: ${total} / ${max}`;
  return { total, max };
}

async function openGradingOverlay(attemptId) {
  const attempt = state.attempts.find((a) => a.id === attemptId);
  if (!attempt) return;

  const quiz = attempt.__quiz;
  const questions = (state.questionsByQuiz[attempt.quiz_id] || []).slice().sort((a, b) => a.question_order - b.question_order);
  const answersByQuestion = Object.fromEntries(attempt.__answers.map((a) => [a.question_id, a]));

  gradingContext = { attempt, quiz, questions, answersByQuestion };

  const overlay = ensureGradingOverlay();
  overlay.querySelector('#gradingStudentName').textContent = attempt.full_name || 'Unnamed student';
  overlay.querySelector('#gradingQuizMeta').textContent = `${quiz?.title || 'Untitled quiz'} · ${attempt.index_number || 'No index number'} · Attempt #${attempt.attempt_number || 1}`;

  const body = overlay.querySelector('#gradingBody');
  body.innerHTML = questions.map((q) => renderQuestionGradeCard(q, answersByQuestion[q.id] || {})).join('');

  async function handleAnswerKeyChange(event) {
    const select = event.target;
    const questionId = select.dataset.questionId;
    const newCorrectOption = Number(select.value);
    const question = gradingContext.questions.find((q) => q.id === questionId);
    if (!question) return;

    select.disabled = true;
    // This only affects this question going forward and re-scores the
    // attempt currently open — it deliberately does not reach back and
    // silently change grades already published to other students.
    const { error } = await supabase
      .from('quiz_questions')
      .update({ correct_option: newCorrectOption })
      .eq('id', questionId);
    select.disabled = false;

    if (error) {
      console.error('Failed to update answer key:', error);
      showLecturerNotice('Could not update answer key', 'Please try again.', 'error');
      return;
    }

    question.correct_option = newCorrectOption;
    const answer = gradingContext.answersByQuestion[questionId] || {};
    const card = body.querySelector(`.grading-question-card[data-question-id="${questionId}"]`);
    if (card) {
      card.outerHTML = renderQuestionGradeCard(question, answer);
      // Re-wire the fresh card's own listeners since outerHTML replaced it.
      const freshCard = body.querySelector(`.grading-question-card[data-question-id="${questionId}"]`);
      freshCard.querySelector('.grading-points-input')?.addEventListener('input', () => recomputeGradingTotal());
      freshCard.querySelector('.grading-answer-key-select')?.addEventListener('change', handleAnswerKeyChange);
    }
    recomputeGradingTotal();
  }

  body.querySelectorAll('.grading-points-input').forEach((input) => {
    input.addEventListener('input', () => recomputeGradingTotal());
  });

  body.querySelectorAll('.grading-answer-key-select').forEach((select) => {
    select.addEventListener('change', handleAnswerKeyChange);
  });

  recomputeGradingTotal();

  overlay.querySelector('#gradingSaveDraftBtn').onclick = () => saveGrading({ publish: false });
  overlay.querySelector('#gradingPublishBtn').onclick = () => saveGrading({ publish: true });

  overlay.classList.add('visible');
}

async function saveGrading({ publish }) {
  if (!gradingContext) return;
  const overlay = gradingOverlay;
  const { attempt, questions } = gradingContext;

  const publishBtn = overlay.querySelector('#gradingPublishBtn');
  const draftBtn = overlay.querySelector('#gradingSaveDraftBtn');
  publishBtn.disabled = true;
  draftBtn.disabled = true;

  try {
    for (const q of questions) {
      const pointsInput = overlay.querySelector(`.grading-points-input[data-question-id="${q.id}"]`);
      const feedbackInput = overlay.querySelector(`.grading-feedback-input[data-question-id="${q.id}"]`);
      const pointsValue = pointsInput ? parseFloat(pointsInput.value) : null;
      const feedbackValue = feedbackInput ? feedbackInput.value : '';

      const { error } = await supabase
        .from('quiz_answers')
        .update({
          points_awarded: Number.isFinite(pointsValue) ? pointsValue : null,
          is_correct: q.points ? pointsValue >= q.points : null,
          feedback: feedbackValue || null,
          updated_at: new Date().toISOString()
        })
        .eq('attempt_id', attempt.id)
        .eq('question_id', q.id);

      if (error) throw error;
    }

    if (publish) {
      const { total, max } = recomputeGradingTotal();
      const { error: attemptError } = await supabase
        .from('quiz_attempts')
        .update({
          status: 'graded',
          score: total,
          max_score: max,
          graded_at: new Date().toISOString(),
          graded_by: state.profile.id,
          updated_at: new Date().toISOString()
        })
        .eq('id', attempt.id);
      if (attemptError) throw attemptError;

      supabase.from('notifications').insert({
        user_id: attempt.student_id,
        sender_id: state.profile.id,
        type: 'grade_published',
        content: `Your quiz "${gradingContext.quiz?.title || 'quiz'}" has been graded: ${total}/${max}`,
        post_id: attempt.id,
        origin: 'grade'
      }).then(() => {}).catch((err) => console.error('Failed to notify student of grade:', err));

      showLecturerNotice('Grade published', 'The student can now see their score.', 'success');
      closeGradingOverlay();
    } else {
      showLecturerNotice('Draft saved', 'Your grading progress has been saved.', 'success');
    }

    await refreshAndRerender();
  } catch (err) {
    console.error('Grading save failed:', err);
    showLecturerNotice('Could not save', 'Something went wrong saving this grade. Please try again.', 'error');
  } finally {
    publishBtn.disabled = false;
    draftBtn.disabled = false;
  }
}

let activeContainer = null;

async function refreshAndRerender() {
  if (!activeContainer || !state.profile) return;
  await loadData(state.profile);
  activeContainer.innerHTML = renderShell();
  wireShell(activeContainer);
  renderList(activeContainer);
}

async function renderSubmissionsSection(container, profile) {
  if (!container) return;
  activeContainer = container;
  state.profile = profile;

  container.innerHTML = renderSkeleton();

  try {
    await loadData(profile);
  } catch (err) {
    console.error('Failed to load submissions:', err);
  }

  if (!container.isConnected) return;
  container.innerHTML = renderShell();
  wireShell(container);
  renderList(container);
}

export { renderSubmissionsSection };