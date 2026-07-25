// group-quizzes.js
// Student Quiz Hub — Phase 3, Part 3
// Built standalone (does not reuse lecturer-quizzes.js).

import { supabase } from './js/supabaseClient.js';
import { getCurrentUserContext } from './js/campusDiscovery.js';
import { initGlobalTheme } from './js/themeManager.js';

// ------------------------------------------------------------
// State
// ------------------------------------------------------------
const params = new URLSearchParams(window.location.search);
const groupId = params.get('group');

let currentUser = null;
let currentProfile = null;
let groupInfo = null;
let allQuizzes = [];   // enriched quiz objects
let activeFilter = 'all';
let activeSort = 'newest';
let searchTerm = '';
let searchDebounce = null;

const els = {};

function cacheEls() {
    els.backButton = document.getElementById('backButton');
    els.navTitle = document.getElementById('navTitle');
    els.heroTitle = document.getElementById('heroTitle');
    els.heroMeta = document.getElementById('heroMeta');
    els.statAvailable = document.getElementById('statAvailable');
    els.statUpcoming = document.getElementById('statUpcoming');
    els.statCompleted = document.getElementById('statCompleted');
    els.statAverage = document.getElementById('statAverage');
    els.searchInput = document.getElementById('searchInput');
    els.filterControl = document.getElementById('filterControl');
    els.sortSelect = document.getElementById('sortSelect');
    els.quizList = document.getElementById('quizList');
    els.toast = document.getElementById('toast');
}

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showToast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add('show');
    setTimeout(() => els.toast.classList.remove('show'), 2600);
}

function formatDate(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en', { month: 'short', day: 'numeric' }) +
        ' · ' + d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
}

function formatDueLabel(closeDate) {
    if (!closeDate) return null;
    const now = new Date();
    const close = new Date(closeDate);
    const diffMs = close - now;
    if (diffMs < 0) return 'Closed';
    const diffHrs = diffMs / (1000 * 60 * 60);
    if (diffHrs < 24) return 'Due Today';
    if (diffHrs < 48) return 'Due Tomorrow';
    return `Due ${close.toLocaleDateString('en', { month: 'short', day: 'numeric' })}`;
}

// ------------------------------------------------------------
// Data loading
// ------------------------------------------------------------
async function init() {
    cacheEls();
    await initGlobalTheme({ supabase });

    els.backButton.addEventListener('click', () => {
        window.location.href = 'active-groups.html';
    });

    if (!groupId) {
        renderError('No group selected. Go back and pick a group first.');
        return;
    }

    const { user, profile } = await getCurrentUserContext(supabase, { force: true });
    if (!user) {
        window.location.href = 'login.html';
        return;
    }
    currentUser = user;
    currentProfile = profile;

    // Confirm membership before doing anything else. RLS backs this up server-side,
    // but checking here lets us show a clean message instead of an empty list.
    const { data: membership, error: membershipError } = await supabase
        .from('group_members')
        .select('group_id, role')
        .eq('group_id', groupId)
        .eq('user_id', user.id)
        .maybeSingle();

    if (membershipError) {
        console.error('Membership check failed:', membershipError);
    }
    if (!membership) {
        renderError("You're not a member of this group, so its quizzes aren't visible here.");
        return;
    }

    await loadGroupInfo();
    await loadQuizzes();

    wireControls();
    renderAll();
    subscribeToQuizChanges();
}

// ------------------------------------------------------------
// Realtime (Part 10) — reflect lecturer publish/edit/close instantly
// ------------------------------------------------------------
function subscribeToQuizChanges() {
    const channel = supabase
        .channel(`quiz-hub-${groupId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'quizzes' }, async (payload) => {
            // A brand-new quiz becoming visible to this group arrives via the
            // quiz_groups subscription below; here we only need to catch edits
            // (publish/close/archive/content changes) on quizzes already listed.
            const affectedId = payload.new?.id;
            if (!allQuizzes.some(q => q.id === affectedId)) return;
            await loadQuizzes();
            renderAll();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_groups', filter: `group_id=eq.${groupId}` }, async () => {
            await loadQuizzes();
            renderAll();
        })
        .subscribe();

    window.addEventListener('beforeunload', () => {
        supabase.removeChannel(channel);
    });
}

async function loadGroupInfo() {
    const { data: group, error } = await supabase
        .from('groups')
        .select('id, name, course_code, institution, created_by')
        .eq('id', groupId)
        .single();

    if (error || !group) {
        console.error('Failed to load group:', error);
        groupInfo = { id: groupId, name: 'Your Group', course_code: '' };
        return;
    }

    const { count: memberCount } = await supabase
        .from('group_members')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', groupId);

    let professorName = null;
    if (group.created_by) {
        const { data: creatorProfile } = await supabase
            .from('profiles')
            .select('full_name, username, is_lecturer, role, level, custom_level')
            .eq('id', group.created_by)
            .maybeSingle();

        const isLecturer = creatorProfile && (
            creatorProfile.is_lecturer === true ||
            creatorProfile.role === 'lecturer' ||
            creatorProfile.level === 'lecturer' ||
            creatorProfile.custom_level === 'lecturer'
        );
        if (isLecturer) {
            professorName = creatorProfile.full_name || creatorProfile.username || null;
        }
    }

    groupInfo = {
        ...group,
        memberCount: memberCount || 0,
        professorName
    };
}

async function loadQuizzes() {
    // quizzes joined through quiz_groups, scoped to this group.
    // RLS additionally enforces: published + not deleted + membership.
    const { data: links, error: linksError } = await supabase
        .from('quiz_groups')
        .select('quiz_id')
        .eq('group_id', groupId);

    if (linksError) {
        console.error('Failed to load quiz_groups:', linksError);
        allQuizzes = [];
        return;
    }

    const quizIds = (links || []).map(l => l.quiz_id);
    if (quizIds.length === 0) {
        allQuizzes = [];
        return;
    }

    const { data: quizzes, error: quizzesError } = await supabase
        .from('quizzes')
        .select('id, title, description, instructions, quiz_type, time_limit, open_date, close_date, attempts_allowed, visibility, institution, status, allow_review, created_at')
        .in('id', quizIds)
        .eq('status', 'published')
        .eq('is_deleted', false);

    if (quizzesError) {
        console.error('Failed to load quizzes:', quizzesError);
        allQuizzes = [];
        return;
    }

    // Question counts + max score per quiz
    const { data: questions } = await supabase
        .from('quiz_questions')
        .select('id, quiz_id, points')
        .in('quiz_id', quizIds);

    const questionStats = {};
    (questions || []).forEach(q => {
        if (!questionStats[q.quiz_id]) questionStats[q.quiz_id] = { count: 0, maxScore: 0 };
        questionStats[q.quiz_id].count += 1;
        questionStats[q.quiz_id].maxScore += Number(q.points) || 0;
    });

    // This student's attempts for these quizzes
    const { data: attempts, error: attemptsError } = await supabase
        .from('quiz_attempts')
        .select('id, quiz_id, status, attempt_number, score, max_score, submitted_at')
        .eq('student_id', currentUser.id)
        .in('quiz_id', quizIds);

    if (attemptsError) {
        console.error('Failed to load quiz_attempts:', attemptsError);
    }

    const attemptsByQuiz = {};
    (attempts || []).forEach(a => {
        if (!attemptsByQuiz[a.quiz_id]) attemptsByQuiz[a.quiz_id] = [];
        attemptsByQuiz[a.quiz_id].push(a);
    });

    allQuizzes = (quizzes || []).map(q => {
        const stats = questionStats[q.id] || { count: 0, maxScore: 0 };
        const myAttempts = attemptsByQuiz[q.id] || [];
        const submittedAttempts = myAttempts.filter(a => a.status === 'submitted' || a.status === 'graded');
        const inProgressAttempt = myAttempts.find(a => a.status === 'in_progress') || null;
        // Only a submitted/graded attempt actually spends one of the
        // student's tries. An in_progress row is created the moment the
        // quiz page is opened (so it can be resumed later) — counting it
        // here used to burn a student's only attempt just for opening the
        // quiz, before they'd answered a single question.
        const attemptsUsed = submittedAttempts.length;
        const attemptsRemaining = Math.max((q.attempts_allowed || 1) - attemptsUsed, 0);

        const gradedAttempts = submittedAttempts.filter(a => a.status === 'graded');
        const latestGradedAttempt = gradedAttempts.length
            ? gradedAttempts.reduce((best, a) => (!best || new Date(a.submitted_at) > new Date(best.submitted_at) ? a : best), null)
            : null;

        return {
            ...q,
            questionCount: stats.count,
            maxScore: stats.maxScore,
            attemptsUsed,
            attemptsRemaining,
            submittedAttempts,
            inProgressAttempt,
            // Review is entirely the lecturer's call (quiz.allow_review) and
            // only unlocks once the attempt has actually been graded — not
            // merely submitted.
            reviewableAttempt: q.allow_review && latestGradedAttempt ? latestGradedAttempt : null,
            bestScore: submittedAttempts.length
                ? Math.max(...submittedAttempts.map(a => (a.score != null ? Number(a.score) : -Infinity)))
                : null,
            derivedStatus: deriveStatus(q, attemptsRemaining, submittedAttempts.length > 0)
        };
    });
}

function deriveStatus(quiz, attemptsRemaining, hasSubmitted) {
    const now = new Date();
    // A quiz the student already submitted should read as Completed, even if
    // the lecturer has since closed it or its deadline has passed — otherwise
    // finished quizzes disappear into "Closed" and never show up as Completed.
    if (hasSubmitted && attemptsRemaining <= 0) return 'completed';
    if (quiz.status === 'closed') return 'closed';
    if (quiz.open_date && now < new Date(quiz.open_date)) return 'upcoming';
    if (quiz.close_date && now > new Date(quiz.close_date)) return 'closed';
    return 'available';
}

// ------------------------------------------------------------
// Rendering
// ------------------------------------------------------------
function renderAll() {
    renderHero();
    renderStats();
    renderList();
}

function renderHero() {
    els.navTitle.textContent = groupInfo.name ? `${groupInfo.name} · Quizzes` : 'Quizzes';
    els.heroTitle.textContent = `${groupInfo.name || 'Group'} Quizzes`;

    const chips = [];
    if (groupInfo.course_code) {
        chips.push(`<div class="hero-meta-item"><i class="fas fa-graduation-cap"></i><span><strong>${escapeHtml(groupInfo.course_code)}</strong></span></div>`);
    }
    chips.push(`<div class="hero-meta-item"><i class="fas fa-users"></i><span><strong>${groupInfo.memberCount || 0}</strong> members</span></div>`);
    chips.push(`<div class="hero-meta-item"><i class="fas fa-clipboard-list"></i><span><strong>${allQuizzes.length}</strong> quizzes</span></div>`);
    if (groupInfo.professorName) {
        chips.push(`<div class="hero-meta-item"><i class="fas fa-chalkboard-teacher"></i><span>${escapeHtml(groupInfo.professorName)}</span></div>`);
    }
    els.heroMeta.innerHTML = chips.join('');
}

function renderStats() {
    const available = allQuizzes.filter(q => q.derivedStatus === 'available').length;
    const upcoming = allQuizzes.filter(q => q.derivedStatus === 'upcoming').length;
    const completed = allQuizzes.filter(q => q.derivedStatus === 'completed').length;

    const scored = allQuizzes.flatMap(q => q.submittedAttempts)
        .filter(a => a.score != null && a.max_score);
    let avgLabel = '—';
    if (scored.length) {
        const pct = scored.reduce((sum, a) => sum + (Number(a.score) / Number(a.max_score)) * 100, 0) / scored.length;
        avgLabel = `${Math.round(pct)}%`;
    }

    els.statAvailable.textContent = available;
    els.statUpcoming.textContent = upcoming;
    els.statCompleted.textContent = completed;
    els.statAverage.textContent = avgLabel;
}

function getFilteredSortedQuizzes() {
    let list = [...allQuizzes];

    if (activeFilter !== 'all') {
        list = list.filter(q => q.derivedStatus === activeFilter);
    }

    if (searchTerm.trim()) {
        const term = searchTerm.trim().toLowerCase();
        list = list.filter(q =>
            (q.title || '').toLowerCase().includes(term) ||
            (q.description || '').toLowerCase().includes(term)
        );
    }

    switch (activeSort) {
        case 'closing_soon':
            list.sort((a, b) => {
                if (!a.close_date) return 1;
                if (!b.close_date) return -1;
                return new Date(a.close_date) - new Date(b.close_date);
            });
            break;
        case 'highest_marks':
            list.sort((a, b) => b.maxScore - a.maxScore);
            break;
        case 'alphabetical':
            list.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
            break;
        case 'newest':
        default:
            list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            break;
    }

    return list;
}

function renderList() {
    const list = getFilteredSortedQuizzes();

    if (list.length === 0) {
        els.quizList.innerHTML = `
            <div class="empty-state animate-fade-in">
                <i class="fas fa-inbox"></i>
                <h3>No quizzes here</h3>
                <p>${allQuizzes.length === 0
                    ? "Your lecturer hasn't published any quizzes for this group yet."
                    : 'Try a different filter or search term.'}</p>
            </div>`;
        return;
    }

    els.quizList.innerHTML = list.map((q, i) => renderQuizCard(q, i)).join('');

    els.quizList.querySelectorAll('.start-quiz-btn[data-quiz-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            const quizId = btn.dataset.quizId;
            // quiz-session.html (Phase 3, Part 4/5) ships in the next stage of this build.
            // Using replace (not href) here means the quiz session takes over
            // this history slot instead of adding a new one. Combined with the
            // replace()-based redirects at the end of the quiz (quiz-session.js
            // and quiz-submit.html), the entire start -> submit -> return trip
            // collapses into a single history entry, so pressing Back
            // afterwards goes straight to the page the student was on before
            // starting the quiz — not back into the quiz itself.
            window.location.replace(`quiz-session.html?quiz=${quizId}&group=${groupId}`);
        });
    });

    els.quizList.querySelectorAll('[data-review-attempt-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            window.location.href = `quiz-review.html?attempt=${btn.dataset.reviewAttemptId}&group=${groupId}`;
        });
    });
}

function renderQuizCard(q, index) {
    const statusLabel = {
        available: 'Available',
        upcoming: 'Upcoming',
        completed: 'Completed',
        closed: 'Closed'
    }[q.derivedStatus];

    const dueLabel = q.derivedStatus === 'upcoming'
        ? `Opens ${formatDate(q.open_date) || 'soon'}`
        : (formatDueLabel(q.close_date) || 'No due date');

    const chips = [
        `<div class="detail-chip"><i class="fas fa-clock"></i>${q.time_limit || 30} mins</div>`,
        `<div class="detail-chip"><i class="fas fa-list-ol"></i>${q.questionCount} question${q.questionCount === 1 ? '' : 's'}</div>`,
        `<div class="detail-chip"><i class="fas fa-star"></i>${q.maxScore} pts max</div>`,
        `<div class="detail-chip"><i class="fas fa-shapes"></i>${escapeHtml(quizTypeLabel(q.quiz_type))}</div>`
    ];
    if (q.close_date) {
        chips.push(`<div class="detail-chip"><i class="fas fa-calendar"></i>${formatDate(q.close_date) || ''}</div>`);
    }

    const disabled = q.derivedStatus !== 'available' || q.attemptsRemaining <= 0;
    const btnLabel = q.derivedStatus === 'completed' ? 'Completed'
        : q.derivedStatus === 'upcoming' ? 'Not Open Yet'
        : q.derivedStatus === 'closed' ? 'Closed'
        : q.inProgressAttempt ? 'Resume Quiz'
        : 'Start Quiz';

    return `
        <article class="quiz-card animate-fade-in" style="animation-delay:${index * 0.06}s">
            <div class="quiz-card-top">
                <div class="quiz-title-row">
                    <div class="quiz-title">${escapeHtml(q.title || 'Untitled Quiz')}</div>
                    <div class="quiz-visibility">${(() => {
                      const schoolName = q.institution || groupInfo.institution;
                      return schoolName ? `${escapeHtml(schoolName)} · ${escapeHtml(groupInfo.name || '')}` : escapeHtml(groupInfo.name || '');
                    })()}</div>
                </div>
                <span class="status-badge ${q.derivedStatus}">${statusLabel} · ${escapeHtml(dueLabel)}</span>
            </div>

            ${q.description ? `<p class="quiz-description">${escapeHtml(q.description)}</p>` : ''}

            <div class="quiz-detail-chips">${chips.join('')}</div>

            <div class="quiz-card-bottom">
                <div class="attempts-remaining">
                    Attempts left: <strong>${q.attemptsRemaining} / ${q.attempts_allowed || 1}</strong>
                    ${q.bestScore != null ? ` · Best: <strong>${q.bestScore}/${q.maxScore}</strong>` : ''}
                </div>
                <div class="quiz-card-actions">
                    ${q.reviewableAttempt ? `
                        <button class="start-quiz-btn secondary" data-review-attempt-id="${q.reviewableAttempt.id}">
                            <i class="fas fa-magnifying-glass"></i> Review Answers
                        </button>` : ''}
                    <button class="start-quiz-btn" data-quiz-id="${q.id}" ${disabled ? 'disabled' : ''}>
                        <i class="fas ${q.derivedStatus === 'completed' ? 'fa-check' : q.inProgressAttempt ? 'fa-rotate-right' : 'fa-play'}"></i>
                        ${btnLabel}
                    </button>
                </div>
            </div>
        </article>`;
}

function quizTypeLabel(type) {
    return { mcq: 'MCQ', essay: 'Essay', mixed: 'Mixed' }[type] || 'Mixed';
}

function renderError(message) {
    els.quizList.innerHTML = `
        <div class="empty-state animate-fade-in">
            <i class="fas fa-triangle-exclamation"></i>
            <h3>Can't show quizzes</h3>
            <p>${escapeHtml(message)}</p>
        </div>`;
    els.heroTitle.textContent = 'Quizzes';
}

// ------------------------------------------------------------
// Controls
// ------------------------------------------------------------
function wireControls() {
    els.searchInput.addEventListener('input', (e) => {
        clearTimeout(searchDebounce);
        const value = e.target.value;
        searchDebounce = setTimeout(() => {
            searchTerm = value;
            renderList();
        }, 200);
    });

    els.filterControl.querySelectorAll('.segment-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            els.filterControl.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeFilter = btn.dataset.filter;
            renderList();
        });
    });

    els.sortSelect.addEventListener('change', (e) => {
        activeSort = e.target.value;
        renderList();
    });
}

const loadingTimeout = setTimeout(() => {
    if (!allQuizzes || els.quizList.querySelector('.skeleton-card')) {
        renderError("This is taking longer than expected. Check your connection and try again.");
    }
}, 12000);

init().then(() => clearTimeout(loadingTimeout)).catch(err => {
    clearTimeout(loadingTimeout);
    console.error('Quiz hub failed to initialize:', err);
    renderError('Something went wrong loading quizzes. Please go back and try again.');
    showToast('Something went wrong loading quizzes.');
});