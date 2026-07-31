// quiz-session.js
// Phase 4: full quiz-taking session — validation, confirmation,
// sidebar navigator, flag-for-review, autosave, anti-cheat,
// submission, realtime. Built standalone.

import { supabase } from './js/supabaseClient.js';
import { getCurrentUserContext } from './js/campusDiscovery.js';
import { initGlobalTheme } from './js/themeManager.js';

const params = new URLSearchParams(window.location.search);
const quizId = params.get('quiz') || params.get('quiz_id');
const groupIdParam = params.get('group');

let currentUser = null;
let currentProfile = null;
let quiz = null;
let groupInfo = null;
let questions = [];
let attempt = null;

let answers = {};              // questionId -> { selected_option, answer_text, flagged }
let currentIndex = 0;
let timerInterval = null;
let autosaveInterval = null;
let timeRemaining = 0;
let submitting = false;
let integrityEventCount = 0;
let realtimeChannel = null;
let pendingSaveQueue = new Set();

const els = {};

function cacheEls() {
    [
        'loadingScreen', 'accessDeniedScreen', 'deniedTitle', 'deniedMessage', 'deniedReturnBtn',
        'confirmScreen', 'confirmQuizName', 'confirmDetailGrid', 'fullNameInput', 'indexNumberInput', 'levelInput', 'confirmStartBtn',
        'sessionScreen', 'exitBtn', 'topbarQuizName', 'questionCounter', 'autosaveStatus',
        'ringFill', 'ringLabel', 'timerPill', 'timerText', 'sidebarToggleBtn',
        'navigatorSidebar', 'navigatorStats', 'navigatorGrid', 'sidebarBackdrop', 'questionArea',
        'prevBtn', 'nextBtn', 'flagBtn', 'submitBtn',
        'submitModal', 'modalAnswered', 'modalUnanswered', 'modalTimeLeft', 'modalIntegrityEvents', 'modalCancelBtn', 'modalConfirmBtn',
        'processingScreen', 'processingText',
        'realtimeBanner', 'realtimeBannerText'
    ].forEach(id => els[id] = document.getElementById(id));
}

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function show(el) { el?.classList.remove('hidden'); }
function hide(el) { el?.classList.add('hidden'); }

function localKey() {
    return `quiz-answers:${attempt?.id || quizId || 'pending'}`;
}

function saveLocal() {
    try {
        localStorage.setItem(localKey(), JSON.stringify({ answers, timeRemaining, savedAt: Date.now() }));
    } catch (e) { /* storage might be unavailable; server autosave still runs */ }
}

function loadLocal() {
    try {
        const raw = localStorage.getItem(localKey());
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

// ------------------------------------------------------------
// Init
// ------------------------------------------------------------
async function init() {
    cacheEls();
    await initGlobalTheme({ supabase });

    if (!quizId) {
        return denyAccess('No quiz selected', "We couldn't tell which quiz to open. Please go back and pick a quiz again.");
    }

    // These two don't depend on each other — running them together instead
    // of one after another shaves a full round trip off every quiz load.
    const [{ user, profile }, quizResult] = await Promise.all([
        getCurrentUserContext(supabase, { force: true }),
        fetchQuizRow()
    ]);
    if (!user) { window.location.href = 'login.html'; return; }
    currentUser = user;
    currentProfile = profile;

    if (!quizResult.ok) {
        return denyAccess(quizResult.title, quizResult.message);
    }
    quiz = quizResult.quiz;

    const validation = await validateAccess();
    if (!validation.ok) {
        return denyAccess(validation.title, validation.message);
    }

    const ok = await loadOrCreateAttempt();
    if (!ok.success) {
        return denyAccess(ok.title || "Can't start this quiz", ok.message);
    }

    hide(els.loadingScreen);
    setupConfirmScreen();
    wireGlobalEvents();
}

function denyAccess(title, message) {
    hide(els.loadingScreen);
    els.deniedTitle.textContent = title;
    els.deniedMessage.textContent = message;
    show(els.accessDeniedScreen);
    const backGroupId = groupIdParam || '';
    els.deniedReturnBtn.onclick = () => {
        window.location.replace(backGroupId ? `group-quizzes.html?group=${encodeURIComponent(backGroupId)}` : 'active-groups.html');
    };
}

// ------------------------------------------------------------
// Validation: group membership, published, open/close window, attempts
// ------------------------------------------------------------
async function fetchQuizRow() {
    const { data: quizData, error } = await supabase
        .from('quizzes')
        .select('id, title, description, quiz_type, time_limit, open_date, close_date, attempts_allowed, status, creator_id')
        .eq('id', quizId)
        .maybeSingle();

    if (error || !quizData) {
        return { ok: false, title: "Quiz not found", message: "This quiz doesn't exist, or you don't have access to it." };
    }
    return { ok: true, quiz: quizData };
}

async function validateAccess() {
    if (quiz.status !== 'published') {
        return { ok: false, title: 'Not available yet', message: "This quiz hasn't been published by your lecturer." };
    }

    const now = new Date();
    if (quiz.open_date && now < new Date(quiz.open_date)) {
        return { ok: false, title: "This quiz hasn't opened yet", message: `It opens on ${new Date(quiz.open_date).toLocaleString()}.` };
    }
    if (quiz.close_date && now > new Date(quiz.close_date)) {
        return { ok: false, title: 'This quiz is closed', message: `It closed on ${new Date(quiz.close_date).toLocaleString()}.` };
    }

    // Group links, the question list, and the lecturer's profile don't
    // depend on each other — fetching them together instead of one after
    // another is what used to make every quiz take so long to open.
    const [linksRes, questionsRes, lecturerRes] = await Promise.all([
        supabase.from('quiz_groups').select('group_id').eq('quiz_id', quizId),
        supabase
            .from('quiz_questions')
            .select('id, question_order, question_type, prompt, points, character_limit, options, correct_option')
            .eq('quiz_id', quizId)
            .order('question_order', { ascending: true }),
        supabase.from('profiles').select('institution, campus, custom_campus, full_name').eq('id', quiz.creator_id).maybeSingle()
    ]);

    const { data: links, error: linksError } = linksRes;
    if (linksError || !links || links.length === 0) {
        return { ok: false, title: "Can't access this quiz", message: "This quiz isn't assigned to any of your groups." };
    }
    const linkedGroupIds = links.map(l => l.group_id);

    const { data: questionRows, error: qError } = questionsRes;
    if (qError || !questionRows || questionRows.length === 0) {
        return { ok: false, title: 'No questions yet', message: 'This quiz has no questions to answer yet.' };
    }
    questions = questionRows;

    const { data: lecturerProfile } = lecturerRes;

    // Group membership: the quiz must be linked to a group the student belongs to.
    const { data: memberships, error: membershipError } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', currentUser.id)
        .in('group_id', linkedGroupIds);
    if (membershipError || !memberships || memberships.length === 0) {
        return { ok: false, title: "Can't access this quiz", message: "You're not a member of the group this quiz belongs to." };
    }

    const resolvedGroupId = groupIdParam && linkedGroupIds.includes(groupIdParam) ? groupIdParam : memberships[0].group_id;
    const { data: group } = await supabase.from('groups').select('id, name, course_code').eq('id', resolvedGroupId).maybeSingle();
    groupInfo = group || { id: resolvedGroupId, name: 'Your group', course_code: '' };

    // Institution check: a student can join a group and use its chat/resources
    // even if they're not enrolled at that school, but quizzes are reserved
    // for students actually enrolled at the lecturer's institution/campus.
    const lecturerSchool = (lecturerProfile?.institution || lecturerProfile?.campus || lecturerProfile?.custom_campus || '').trim().toLowerCase();
    const studentSchool = (currentProfile?.institution || currentProfile?.campus || currentProfile?.custom_campus || '').trim().toLowerCase();

    if (lecturerSchool && studentSchool && lecturerSchool !== studentSchool) {
        return {
            ok: false,
            title: 'Quiz not available to you',
            message: `This quiz is only for students enrolled at ${lecturerProfile.institution || lecturerProfile.campus || lecturerProfile.custom_campus}. You can still use this group's chat and resources, but quizzes are reserved for that school's students.`,
            notEnrolled: true
        };
    }

    return { ok: true };
}

async function loadOrCreateAttempt() {
    const { data: existing, error } = await supabase
        .from('quiz_attempts')
        .select('*')
        .eq('quiz_id', quizId)
        .eq('student_id', currentUser.id)
        .order('attempt_number', { ascending: false });

    if (error) {
        return { success: false, message: 'Could not load your attempt history. Please try again.' };
    }

    const inProgress = (existing || []).find(a => a.status === 'in_progress');
    if (inProgress) {
        attempt = inProgress;
        return { success: true };
    }

    const submittedCount = (existing || []).filter(a => a.status !== 'in_progress').length;
    const allowed = quiz.attempts_allowed || 1;
    if (submittedCount >= allowed) {
        return { success: false, title: 'No attempts remaining', message: "You've used all your attempts for this quiz." };
    }

    const { data: created, error: createError } = await supabase
        .from('quiz_attempts')
        .insert({
            quiz_id: quizId,
            student_id: currentUser.id,
            group_id: groupInfo?.id || null,
            attempt_number: submittedCount + 1,
            status: 'in_progress',
            time_limit_seconds: (quiz.time_limit || 30) * 60,
            time_remaining_seconds: (quiz.time_limit || 30) * 60
        })
        .select()
        .single();

    if (createError || !created) {
        return { success: false, message: 'Could not start a new attempt. Please try again.' };
    }
    attempt = created;
    return { success: true };
}

// ------------------------------------------------------------
// Part 4: Confirmation screen
// ------------------------------------------------------------
function setupConfirmScreen() {
    els.confirmQuizName.textContent = quiz.title || 'Quiz';

    const existing = JSON.parse(localStorage.getItem(`attempt-count:${quizId}:${currentUser.id}`) || '0');
    const attemptsUsed = attempt.attempt_number ? attempt.attempt_number - 1 : existing;
    const attemptsRemaining = Math.max((quiz.attempts_allowed || 1) - attemptsUsed, 0);

    const details = [
        { label: 'Course', value: groupInfo?.course_code || '—' },
        { label: 'Group', value: groupInfo?.name || '—' },
        { label: 'Duration', value: `${quiz.time_limit || 30} mins` },
        { label: 'Questions', value: String(questions.length) },
        { label: 'Attempts Remaining', value: `${attemptsRemaining} / ${quiz.attempts_allowed || 1}` },
        { label: 'Available Until', value: quiz.close_date ? new Date(quiz.close_date).toLocaleString('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No deadline' }
    ];
    els.confirmDetailGrid.innerHTML = details.map(d => `
        <div class="confirm-detail-item">
            <div class="cd-label">${escapeHtml(d.label)}</div>
            <div class="cd-value">${escapeHtml(d.value)}</div>
        </div>`).join('');

    const fullName = attempt.full_name || currentProfile?.full_name || '';
    const level = attempt.level || currentProfile?.level || currentProfile?.custom_level || '';
    const indexNumber = attempt.index_number || '';

    els.fullNameInput.value = fullName;
    els.indexNumberInput.value = indexNumber;
    els.levelInput.value = level;

    if (fullName) els.fullNameInput.disabled = true;
    if (level) els.levelInput.disabled = true;
    if (indexNumber) els.indexNumberInput.disabled = true;

    const checkComplete = () => {
        const complete = els.fullNameInput.value.trim() && els.indexNumberInput.value.trim() && els.levelInput.value.trim();
        els.confirmStartBtn.disabled = !complete;
    };
    [els.fullNameInput, els.indexNumberInput, els.levelInput].forEach(input => {
        input.addEventListener('input', checkComplete);
    });
    checkComplete();

    els.confirmStartBtn.addEventListener('click', beginSession);
    show(els.confirmScreen);
}

async function beginSession() {
    const full_name = els.fullNameInput.value.trim();
    const index_number = els.indexNumberInput.value.trim();
    const level = els.levelInput.value.trim();

    const updates = { full_name, index_number, level };
    if (!attempt.started_at) updates.started_at = new Date().toISOString();

    const { data: updated, error: updateError } = await supabase
        .from('quiz_attempts')
        .update(updates)
        .eq('id', attempt.id)
        .select()
        .single();

    if (updateError) {
        console.error('Failed to save student info before starting quiz:', updateError);
        alert("We couldn't save your details (name / index number / level). Please try again — if this keeps happening, contact your lecturer.");
        return;
    }
    if (updated) attempt = updated;

    const local = loadLocal();
    if (local?.answers) answers = local.answers;

    const { data: savedAnswers } = await supabase
        .from('quiz_answers')
        .select('question_id, selected_option, answer_text, flagged')
        .eq('attempt_id', attempt.id);
    (savedAnswers || []).forEach(a => {
        if (!answers[a.question_id]) {
            answers[a.question_id] = { selected_option: a.selected_option, answer_text: a.answer_text, flagged: !!a.flagged };
        }
    });

    timeRemaining = local?.timeRemaining ?? attempt.time_remaining_seconds ?? (quiz.time_limit || 30) * 60;

    hide(els.confirmScreen);
    show(els.sessionScreen);
    els.topbarQuizName.textContent = quiz.title || 'Quiz';

    requestFullscreen();
    renderQuestion(0);
    startTimer();
    startAutosave();
    setupAntiCheat();
    subscribeToQuizUpdates();
    window.addEventListener('beforeunload', flushOnUnload);
    window.addEventListener('online', handleReconnect);
}

// ------------------------------------------------------------
// Part 5: Session rendering
// ------------------------------------------------------------
function computeStats() {
    const answeredIds = questions.filter(q => isAnswered(q.id));
    const flaggedIds = questions.filter(q => answers[q.id]?.flagged);
    return {
        answered: answeredIds.length,
        remaining: questions.length - answeredIds.length,
        flagged: flaggedIds.length,
        pct: Math.round((answeredIds.length / questions.length) * 100)
    };
}

function isAnswered(questionId) {
    const a = answers[questionId];
    if (!a) return false;
    return a.selected_option != null || (a.answer_text && a.answer_text.trim().length > 0);
}

function renderNavigatorStats() {
    const stats = computeStats();
    els.navigatorStats.innerHTML = `
        <div class="nav-stat answered"><div class="ns-value">${stats.answered}</div><div class="ns-label">Answered</div></div>
        <div class="nav-stat"><div class="ns-value">${stats.remaining}</div><div class="ns-label">Remaining</div></div>
        <div class="nav-stat flagged"><div class="ns-value">${stats.flagged}</div><div class="ns-label">Flagged</div></div>
        <div class="nav-stat"><div class="ns-value">${stats.pct}%</div><div class="ns-label">Complete</div></div>
    `;
    updateProgressRing(stats.pct);
}

function updateProgressRing(pct) {
    const circumference = 119.4;
    const offset = circumference - (circumference * pct) / 100;
    els.ringFill.style.strokeDashoffset = offset;
    els.ringLabel.textContent = `${pct}%`;
}

function renderNavigatorGrid() {
    els.navigatorGrid.innerHTML = questions.map((q, i) => `
        <div class="nav-dot ${isAnswered(q.id) ? 'answered' : ''} ${i === currentIndex ? 'current' : ''} ${answers[q.id]?.flagged ? 'flagged' : ''}" data-index="${i}">
            ${i + 1}
        </div>`).join('');

    els.navigatorGrid.querySelectorAll('.nav-dot').forEach(dot => {
        dot.addEventListener('click', () => renderQuestion(Number(dot.dataset.index)));
    });
}

function renderQuestion(index) {
    flushCurrentAnswerToServer();

    currentIndex = Math.max(0, Math.min(index, questions.length - 1));
    const q = questions[currentIndex];
    const saved = answers[q.id] || {};

    els.questionCounter.textContent = `Question ${currentIndex + 1} of ${questions.length}`;
    els.prevBtn.disabled = currentIndex === 0;
    els.nextBtn.innerHTML = currentIndex === questions.length - 1
        ? '<span class="nav-btn-label">Review</span>'
        : '<span class="nav-btn-label">Next</span> <i class="fas fa-arrow-right"></i>';
    els.flagBtn.classList.toggle('flagged', !!saved.flagged);
    els.flagBtn.innerHTML = saved.flagged
        ? '<i class="fa-solid fa-star"></i> <span class="flag-btn-label">Flagged</span>'
        : '<i class="fa-regular fa-star"></i> <span class="flag-btn-label">Flag for Review</span>';

    let bodyHtml = '';
    switch (q.question_type) {
        case 'mcq':
            bodyHtml = `<div class="option-list" role="radiogroup" aria-label="Answer options">${(q.options || []).map((opt, i) => `
                <div class="option-card ${saved.selected_option === i ? 'selected' : ''}" data-option="${i}" role="radio" tabindex="0" aria-checked="${saved.selected_option === i}">
                    <div class="option-radio"></div>
                    <div class="option-text">${escapeHtml(opt.text || `Option ${i + 1}`)}</div>
                </div>`).join('')}</div>`;
            break;
        case 'true_false':
            bodyHtml = `<div class="tf-grid" role="radiogroup" aria-label="True or false">
                <div class="tf-card ${saved.selected_option === 0 ? 'selected' : ''}" data-option="0" role="radio" tabindex="0" aria-checked="${saved.selected_option === 0}">True</div>
                <div class="tf-card ${saved.selected_option === 1 ? 'selected' : ''}" data-option="1" role="radio" tabindex="0" aria-checked="${saved.selected_option === 1}">False</div>
            </div>`;
            break;
        case 'short_answer': {
            const limit = q.character_limit || 200;
            const text = saved.answer_text || '';
            bodyHtml = `
                <input class="short-answer-input" id="shortAnswerInput" type="text" maxlength="${limit}"
                    placeholder="Type your answer" value="${escapeHtml(text)}" aria-label="Your answer">
                <div class="short-answer-counter" id="shortAnswerCounter">${text.length} / ${limit} characters</div>`;
            break;
        }
        case 'essay':
        default: {
            const limit = q.character_limit || 2000;
            const text = saved.answer_text || '';
            bodyHtml = `
                <textarea class="essay-textarea" id="essayInput" aria-label="Your answer" placeholder="Write your answer here...">${escapeHtml(text)}</textarea>
                <div class="essay-counters">
                    <span id="wordCount">${countWords(text)} words</span>
                    <span id="charCount">${text.length} / ${limit} characters</span>
                </div>`;
            break;
        }
    }

    els.questionArea.innerHTML = `
        <div class="question-card animate-fade-in">
            <div class="question-meta">
                <span class="question-index">Question ${currentIndex + 1} of ${questions.length}</span>
                <span class="question-points">${q.points || 10} pts</span>
            </div>
            <div class="question-prompt">${escapeHtml(q.prompt || '')}</div>
            ${bodyHtml}
        </div>`;

    wireQuestionInputs(q);
    renderNavigatorGrid();
    renderNavigatorStats();
    closeMobileSidebar();
}

function countWords(text) {
    return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function markSaving() {
    els.autosaveStatus.classList.add('saving');
    els.autosaveStatus.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> <span>Saving&hellip;</span>';
}
function markSaved() {
    els.autosaveStatus.classList.remove('saving');
    els.autosaveStatus.innerHTML = '<i class="fas fa-check"></i> <span>Saved just now</span>';
    els.autosaveStatus.classList.remove('pulse');
    void els.autosaveStatus.offsetWidth;
    els.autosaveStatus.classList.add('pulse');
}

function wireQuestionInputs(q) {
    const selectOption = (index) => {
        answers[q.id] = { ...(answers[q.id] || {}), selected_option: index, answer_text: null };
        saveLocal();
        renderNavigatorGrid();
        renderNavigatorStats();
        saveAnswerToServer(q.id);
    };

    if (q.question_type === 'mcq' || q.question_type === 'true_false') {
        els.questionArea.querySelectorAll('[data-option]').forEach(el => {
            el.addEventListener('click', () => selectOption(Number(el.dataset.option)));
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectOption(Number(el.dataset.option)); }
            });
        });
        // Re-render selection state visually without a full re-render.
        const refresh = () => {
            const saved = answers[q.id] || {};
            els.questionArea.querySelectorAll('[data-option]').forEach(el => {
                const isSel = saved.selected_option === Number(el.dataset.option);
                el.classList.toggle('selected', isSel);
                el.setAttribute('aria-checked', isSel);
            });
        };
        els.questionArea.querySelectorAll('[data-option]').forEach(el => el.addEventListener('click', refresh));
    } else if (q.question_type === 'short_answer') {
        const input = document.getElementById('shortAnswerInput');
        const counter = document.getElementById('shortAnswerCounter');
        const limit = q.character_limit || 200;
        input.addEventListener('input', () => {
            answers[q.id] = { ...(answers[q.id] || {}), selected_option: null, answer_text: input.value };
            counter.textContent = `${input.value.length} / ${limit} characters`;
            saveLocal();
            renderNavigatorGrid();
            renderNavigatorStats();
            debounceSave(q.id);
        });
    } else {
        const textarea = document.getElementById('essayInput');
        const wordCountEl = document.getElementById('wordCount');
        const charCountEl = document.getElementById('charCount');
        const limit = q.character_limit || 2000;

        textarea.addEventListener('input', () => {
            let value = textarea.value;
            if (value.length > limit) {
                value = value.slice(0, limit);
                textarea.value = value;
            }
            wordCountEl.textContent = `${countWords(value)} words`;
            charCountEl.textContent = `${value.length} / ${limit} characters`;
            answers[q.id] = { ...(answers[q.id] || {}), selected_option: null, answer_text: value };
            saveLocal();
            renderNavigatorGrid();
            renderNavigatorStats();
            debounceSave(q.id);
        });
    }
}

const debounceTimers = {};
function debounceSave(questionId) {
    clearTimeout(debounceTimers[questionId]);
    debounceTimers[questionId] = setTimeout(() => saveAnswerToServer(questionId), 700);
}

function flushCurrentAnswerToServer() {
    // Called right before navigating away from a question — Phase 4 requires
    // an immediate autosave on every question change, not just the interval.
    if (!questions[currentIndex]) return;
    saveAnswerToServer(questions[currentIndex].id);
}

// ------------------------------------------------------------
// Flag for review
// ------------------------------------------------------------
function toggleFlag() {
    const q = questions[currentIndex];
    const current = answers[q.id] || {};
    answers[q.id] = { ...current, flagged: !current.flagged };
    saveLocal();
    renderQuestion(currentIndex);
    saveAnswerToServer(q.id);
}

// ------------------------------------------------------------
// Part 6: Autosave
// ------------------------------------------------------------
async function saveAnswerToServer(questionId) {
    const a = answers[questionId];
    if (!a) return;
    markSaving();
    try {
        await supabase.from('quiz_answers').upsert({
            attempt_id: attempt.id,
            question_id: questionId,
            selected_option: a.selected_option ?? null,
            answer_text: a.answer_text ?? null,
            flagged: !!a.flagged,
            word_count: a.answer_text ? countWords(a.answer_text) : null,
            character_count: a.answer_text ? a.answer_text.length : null,
            updated_at: new Date().toISOString()
        }, { onConflict: 'attempt_id,question_id' });
        markSaved();
    } catch (e) {
        console.error('Autosave failed (kept in local backup):', e);
        els.autosaveStatus.classList.remove('saving');
        els.autosaveStatus.innerHTML = '<i class="fas fa-triangle-exclamation"></i> <span>Saved locally</span>';
    }
}

function startAutosave() {
    autosaveInterval = setInterval(async () => {
        const ids = Object.keys(answers);
        if (ids.length) {
            markSaving();
            const rows = ids.map((qId) => {
                const a = answers[qId];
                return {
                    attempt_id: attempt.id,
                    question_id: qId,
                    selected_option: a.selected_option ?? null,
                    answer_text: a.answer_text ?? null,
                    flagged: !!a.flagged,
                    word_count: a.answer_text ? countWords(a.answer_text) : null,
                    character_count: a.answer_text ? a.answer_text.length : null,
                    updated_at: new Date().toISOString()
                };
            });
            try {
                await supabase.from('quiz_answers').upsert(rows, { onConflict: 'attempt_id,question_id' });
                markSaved();
            } catch (e) {
                console.error('Autosave failed (kept in local backup):', e);
                els.autosaveStatus.classList.remove('saving');
                els.autosaveStatus.innerHTML = '<i class="fas fa-triangle-exclamation"></i> <span>Saved locally</span>';
            }
        }
        try {
            await supabase.from('quiz_attempts')
                .update({ time_remaining_seconds: timeRemaining, updated_at: new Date().toISOString() })
                .eq('id', attempt.id);
        } catch (e) { /* connection issue; local backup still holds state */ }
        saveLocal();
    }, 15000);
}

function flushOnUnload() {
    // Best-effort synchronous-ish flush when the student leaves the page.
    saveLocal();
    try {
        const payload = JSON.stringify({
            attempt_id: attempt?.id,
            time_remaining_seconds: timeRemaining
        });
        navigator.sendBeacon?.('about:blank', payload); // no-op transport; local + interval remain source of truth
    } catch (e) { /* ignore */ }
}

function handleReconnect() {
    // Part: "connection restored" — flush everything once back online.
    for (const qId of Object.keys(answers)) {
        saveAnswerToServer(qId);
    }
}

// ------------------------------------------------------------
// Timer
// ------------------------------------------------------------
function startTimer() {
    updateTimerDisplay();
    timerInterval = setInterval(() => {
        timeRemaining -= 1;
        if (timeRemaining <= 0) {
            timeRemaining = 0;
            updateTimerDisplay();
            clearInterval(timerInterval);
            submitQuiz(true);
            return;
        }
        updateTimerDisplay();
    }, 1000);
}

function updateTimerDisplay() {
    const m = Math.floor(timeRemaining / 60);
    const s = timeRemaining % 60;
    els.timerText.textContent = `${m}:${String(s).padStart(2, '0')}`;
    els.timerPill.classList.toggle('low', timeRemaining <= 60);
}

// ------------------------------------------------------------
// Part 7: Anti-cheating (tracking only, never blocking)
// ------------------------------------------------------------
function logProctorEvent(eventType, metadata = {}) {
    if (!attempt) return;
    integrityEventCount += 1;
    const q = questions[currentIndex];
    supabase.from('quiz_proctor_events').insert({
        attempt_id: attempt.id,
        quiz_id: quizId,
        student_id: currentUser.id,
        question_id: q?.id || null,
        question_number: currentIndex + 1,
        event_type: eventType,
        metadata
    }).then(() => {}).catch(() => {});

    // Notify the lecturer immediately for higher-severity events only, so
    // this doesn't spam a notification for every text selection.
    if (['copy', 'paste', 'fullscreen_exit'].includes(eventType) && quiz?.creator_id) {
        const studentName = currentProfile?.full_name || 'A student';
        supabase.from('notifications').insert({
            user_id: quiz.creator_id,
            sender_id: currentUser.id,
            type: 'integrity_event',
            content: `${studentName} triggered a "${eventType.replace('_', ' ')}" event during ${quiz.title || 'a quiz'}`,
            post_id: attempt.id,
            origin: 'integrity'
        }).then(() => {}).catch(() => {});
    }
}

async function notifyLecturerOfSubmission() {
    if (!quiz?.creator_id || !attempt) return;
    const studentName = currentProfile?.full_name || attempt.full_name || 'A student';

    try {
        const { error } = await supabase.rpc('notify_user', {
            p_user_id: quiz.creator_id,
            p_sender_id: currentUser.id,
            p_type: 'new_submission',
            p_content: `${studentName} submitted "${quiz.title || 'a quiz'}"`,
            p_post_id: attempt.id,
            p_origin: 'submissions'
        });
        if (error) console.error('Failed to notify lecturer of submission:', error);
    } catch (e) {
        console.error('Failed to notify lecturer of submission:', e);
    }

    // If this was the last assigned student to submit, let the lecturer know
    // the whole group is done. Best-effort only — not a hard guarantee this
    // fires exactly once if attempts arrive concurrently, but it's a
    // convenience notification, not a source of truth.
    try {
        const targetGroupId = groupInfo?.id || groupIdParam;
        if (!targetGroupId) return;
        const [{ count: memberCount }, { count: submittedCount }] = await Promise.all([
            supabase.from('group_members').select('*', { count: 'exact', head: true }).eq('group_id', targetGroupId),
            supabase.from('quiz_attempts').select('*', { count: 'exact', head: true }).eq('quiz_id', quizId).eq('group_id', targetGroupId).in('status', ['submitted', 'graded'])
        ]);
        if (memberCount != null && submittedCount != null && submittedCount === memberCount) {
            const { error } = await supabase.rpc('notify_user', {
                p_user_id: quiz.creator_id,
                p_sender_id: currentUser.id,
                p_type: 'quiz_completed',
                p_content: `Every student in the group has now submitted "${quiz.title || 'the quiz'}"`,
                p_post_id: quizId,
                p_origin: 'results'
            });
            if (error) console.error('Failed to notify lecturer of quiz completion:', error);
        }
    } catch (e) {
        console.error('Failed to check quiz completion:', e);
    }
}

function setupAntiCheat() {
    document.addEventListener('copy', () => logProctorEvent('copy'));
    document.addEventListener('paste', () => logProctorEvent('paste'));
    document.addEventListener('visibilitychange', () => {
        // Only log the moment the tab is actually hidden — logging on both
        // hide and return double-counted every single tab switch.
        if (document.hidden) {
            logProctorEvent('tab_switch', { visible: false });
        }
    });
}

function requestFullscreen() {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
}

// ------------------------------------------------------------
// Part 10: Realtime
// ------------------------------------------------------------
function subscribeToQuizUpdates() {
    realtimeChannel = supabase
        .channel(`quiz-session-${quizId}-${attempt.id}`)
        .on('postgres_changes', {
            event: 'UPDATE', schema: 'public', table: 'quizzes', filter: `id=eq.${quizId}`
        }, (payload) => {
            const updated = payload.new;
            if (!updated) return;
            if (updated.status === 'closed' || (updated.close_date && new Date(updated.close_date) < new Date())) {
                showRealtimeBanner('This quiz has been closed by your lecturer. Submitting your current work now\u2026');
                setTimeout(() => submitQuiz(true), 2500);
            } else {
                showRealtimeBanner('Your instructor updated this quiz. Your answers so far are safe.');
            }
        })
        .subscribe();
}

function showRealtimeBanner(message) {
    if (!els.realtimeBanner) return;
    els.realtimeBannerText.textContent = message;
    show(els.realtimeBanner);
}

// ------------------------------------------------------------
// Mobile sidebar drawer
// ------------------------------------------------------------
function openMobileSidebar() {
    els.navigatorSidebar.classList.add('open');
    show(els.sidebarBackdrop);
}
function closeMobileSidebar() {
    els.navigatorSidebar.classList.remove('open');
    hide(els.sidebarBackdrop);
}

// ------------------------------------------------------------
// Part 8: Submission
// ------------------------------------------------------------
function wireGlobalEvents() {
    els.prevBtn.addEventListener('click', () => renderQuestion(currentIndex - 1));
    els.nextBtn.addEventListener('click', () => {
        if (currentIndex === questions.length - 1) {
            // The button relabels to "Review" on the last question, but
            // previously did nothing when clicked — renderQuestion just
            // clamped back to the same question, a confusing dead end.
            // Now it opens the actual submit/review modal, matching what
            // the label says.
            openSubmitModal();
        } else {
            renderQuestion(currentIndex + 1);
        }
    });
    els.flagBtn.addEventListener('click', toggleFlag);
    els.submitBtn.addEventListener('click', openSubmitModal);
    els.modalCancelBtn.addEventListener('click', () => hide(els.submitModal));
    els.modalConfirmBtn.addEventListener('click', () => submitQuiz(false));
    els.sidebarToggleBtn.addEventListener('click', () => {
        if (els.navigatorSidebar.classList.contains('open')) closeMobileSidebar();
        else openMobileSidebar();
    });
    els.sidebarBackdrop.addEventListener('click', closeMobileSidebar);
    els.exitBtn.addEventListener('click', async () => {
        const confirmed = await showExitConfirmModal();
        if (!confirmed) return;
        flushCurrentAnswerToServer();
        saveLocal();
        cleanupSession();
        window.location.replace(groupIdParam ? `group-quizzes.html?group=${encodeURIComponent(groupIdParam)}` : 'active-groups.html');
    });
}

function showExitConfirmModal() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-card">
                <h2>Exit the quiz?</h2>
                <p>Your progress is saved and you can resume later.</p>
                <div class="modal-actions">
                    <button class="modal-cancel" id="exitConfirmCancelBtn">Keep Going</button>
                    <button class="modal-confirm" id="exitConfirmOkBtn">Exit</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const cleanup = (result) => {
            overlay.remove();
            resolve(result);
        };

        overlay.querySelector('#exitConfirmCancelBtn').addEventListener('click', () => cleanup(false));
        overlay.querySelector('#exitConfirmOkBtn').addEventListener('click', () => cleanup(true));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    });
}

function openSubmitModal() {
    flushCurrentAnswerToServer();
    const stats = computeStats();
    els.modalAnswered.textContent = stats.answered;
    els.modalUnanswered.textContent = stats.remaining;
    els.modalTimeLeft.textContent = els.timerText.textContent;
    els.modalIntegrityEvents.textContent = integrityEventCount;
    show(els.submitModal);
}

function cleanupSession() {
    clearInterval(timerInterval);
    clearInterval(autosaveInterval);
    if (realtimeChannel) supabase.removeChannel(realtimeChannel);
    window.removeEventListener('beforeunload', flushOnUnload);
    window.removeEventListener('online', handleReconnect);
}

async function submitQuiz(autoSubmitted) {
    if (submitting) return;
    submitting = true;
    hide(els.submitModal);
    cleanupSession();

    hide(els.sessionScreen);
    els.processingText.textContent = autoSubmitted ? 'Time\u2019s up \u2014 submitting your quiz\u2026' : 'Submitting your quiz...';
    show(els.processingScreen);

    // Final flush of all answers, and correctness for objective questions
    // (a convenience for the lecturer's grading view — the attempt's own
    // score/status stays null/submitted regardless; score is only ever set
    // once a lecturer grades it, per spec). This used to be two separate
    // loops that each awaited one row at a time — for a 20-question quiz
    // that's up to 40 sequential network round trips before submission
    // even started. Batched into a single upsert call instead.
    const rows = questions.map((q) => {
        const a = answers[q.id];
        const isObjective = q.question_type === 'mcq' || q.question_type === 'true_false';
        const row = {
            attempt_id: attempt.id,
            question_id: q.id,
            selected_option: a?.selected_option ?? null,
            answer_text: a?.answer_text ?? null,
            flagged: !!a?.flagged,
            word_count: a?.answer_text ? countWords(a.answer_text) : null,
            character_count: a?.answer_text ? a.answer_text.length : null,
            updated_at: new Date().toISOString()
        };
        if (isObjective) {
            // Coerced to numbers before comparing: selected_option is set
            // client-side as a real number, but if the stored column type
            // ever differs (this table isn't in tracked migration history,
            // so its exact type can't be guaranteed), a strict === between
            // a number and a string silently fails — marking a genuinely
            // correct answer as wrong with no visible error anywhere.
            const isCorrect = a?.selected_option != null && Number(a.selected_option) === Number(q.correct_option);
            row.is_correct = a ? isCorrect : false;
            row.points_awarded = a && isCorrect ? (q.points || 10) : 0;
        }
        return row;
    }).filter((row) => answers[row.question_id] || row.is_correct !== undefined);

    let maxScore = 0;
    questions.forEach(q => { maxScore += q.points || 10; });

    // If every question is objective (mcq/true_false), there's nothing left
    // for a lecturer to manually grade — the score is already fully known
    // the moment the quiz is submitted. Previously every quiz sat at
    // score: null and status: 'submitted' regardless, meaning a student
    // who answered an all-multiple-choice quiz had to wait on a lecturer
    // to open it and click "grade" before ever seeing their result — an
    // unnecessary delay, and a real accuracy gap since the correct score
    // was already computable instantly.
    const hasSubjectiveQuestion = questions.some(
        (q) => q.question_type !== 'mcq' && q.question_type !== 'true_false'
    );
    const autoScore = rows.reduce((sum, r) => sum + (r.points_awarded || 0), 0);

    const attemptUpdate = hasSubjectiveQuestion
        ? { status: 'submitted', score: null }
        : { status: 'graded', score: autoScore, graded_at: new Date().toISOString() };

    const [answersResult, attemptResult] = await Promise.allSettled([
        rows.length
            ? supabase.from('quiz_answers').upsert(rows, { onConflict: 'attempt_id,question_id' })
            : Promise.resolve(),
        supabase
            .from('quiz_attempts')
            .update({
                ...attemptUpdate,
                submitted_at: new Date().toISOString(),
                time_remaining_seconds: timeRemaining,
                max_score: maxScore
            })
            .eq('id', attempt.id)
            .select()
            .single()
    ]);

    if (answersResult.status === 'rejected' || answersResult.value?.error) {
        console.error('Failed to save answers on submit:', answersResult.reason || answersResult.value.error);
    }
    if (attemptResult.status === 'fulfilled' && attemptResult.value?.data) {
        attempt = attemptResult.value.data;
    } else {
        console.error('Failed to finalize attempt submission:', attemptResult.reason || attemptResult.value?.error);
    }

    notifyLecturerOfSubmission();

    try { localStorage.removeItem(localKey()); } catch (e) { /* ignore */ }
    if (document.fullscreenElement) {
        try { await document.exitFullscreen(); } catch (e) { /* ignore */ }
    }

    const groupQuery = groupIdParam ? `&group=${encodeURIComponent(groupIdParam)}` : (groupInfo?.id ? `&group=${encodeURIComponent(groupInfo.id)}` : '');
    setTimeout(() => {
        window.location.replace(`quiz-submit.html?attempt=${attempt.id}${groupQuery}`);
    }, 250);
}

init().catch(err => {
    console.error('Quiz session failed to initialize:', err);
    denyAccess('Something went wrong', "We couldn't load this quiz. Please go back and try again.");
});