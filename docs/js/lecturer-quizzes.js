import { supabase } from './supabaseClient.js';
import { notifyGroupMembers } from './student-notify.js';
import { showLecturerNotice, showLecturerConfirm } from './lecturer-notify.js';

const QUESTION_TYPE_LABELS = {
  mcq: 'Multiple Choice',
  short_answer: 'Short Answer',
  essay: 'Essay'
};

const QUIZ_TYPE_LABELS = {
  multiple_choice: 'Multiple Choice',
  short_answer: 'Short Answer',
  long_answer: 'Long Answer',
  mixed: 'Mixed Quiz'
};

let quizState = null;
let currentDraftId = null;
let currentPreviewMode = 'desktop';
let lastLoadedProfile = null;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createEmptyQuestion(type = 'mcq') {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    type,
    prompt: '',
    points: 10,
    required: false,
    explanation: '',
    character_limit: 200,
    options: type === 'mcq' ? [{ id: crypto.randomUUID ? crypto.randomUUID() : `opt-${Date.now()}-1`, text: '' }, { id: crypto.randomUUID ? crypto.randomUUID() : `opt-${Date.now()}-2`, text: '' }] : [],
    correct_option: 0,
    shuffle_options: false
  };
}

function createEmptyQuiz() {
  return {
    title: '',
    description: '',
    instructions: '',
    quiz_type: 'mixed',
    time_limit: 30,
    open_date: '',
    close_date: '',
    attempts_allowed: 1,
    allow_review: false,
    visibility: 'institution',
    status: 'draft',
    institution: '',
    target_groups: [],
    questions: [createEmptyQuestion('mcq')]
  };
}

function toInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60000);
  return localDate.toISOString().slice(0, 16);
}

function formatDateLabel(value) {
  if (!value) return 'Open date pending';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getStatusBadge(status) {
  const map = {
    draft: 'Draft',
    published: 'Published',
    archived: 'Archived',
    closed: 'Closed'
  };
  return map[status] || 'Draft';
}

function getQuestionTypeLabel(type) {
  return QUESTION_TYPE_LABELS[type] || 'Question';
}

function getQuizTypeLabel(type) {
  return QUIZ_TYPE_LABELS[type] || 'Mixed Quiz';
}

function ensureState(profile) {
  if (!quizState) {
    quizState = createEmptyQuiz();
  }
  if (profile && !quizState.institution) {
    quizState.institution = profile.institution || 'Your institution';
  }
  return quizState;
}

async function loadGroups(profile) {
  if (!profile?.id) return [];
  const { data, error } = await supabase
    .from('groups')
    .select('id, name, course_code, is_public, is_frozen, member_count')
    .eq('created_by', profile.id)
    .order('name', { ascending: true });

  if (error) {
    console.error('Failed to load groups:', error);
    return [];
  }
  return data || [];
}

async function loadQuizzes(profile, status) {
  if (!profile?.institution) return [];
  const { data, error } = await supabase
    .from('quizzes')
    .select(`id, title, status, quiz_type, time_limit, open_date, close_date, created_at, quiz_questions(id), quiz_groups(group_id, groups(id, name, course_code))`)
    .eq('institution', profile.institution)
    .eq('status', status)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to load quizzes:', error);
    return [];
  }

  return (data || []).map((quiz) => ({
    ...quiz,
    group_names: (quiz.quiz_groups || []).map((entry) => entry.groups?.name || 'Group').join(', ')
  }));
}

async function loadQuizDraft(quizId, profile) {
  if (!quizId) return null;
  const { data, error } = await supabase
    .from('quizzes')
    .select(`*, quiz_questions(*), quiz_groups(group_id)`)
    .eq('id', quizId)
    .maybeSingle();

  if (error || !data) return null;

  const questions = (data.quiz_questions || []).map((question) => ({
    id: question.id,
    type: question.question_type,
    prompt: question.prompt || '',
    points: question.points || 10,
    required: question.required || false,
    explanation: question.explanation || '',
    character_limit: question.character_limit || 200,
    options: Array.isArray(question.options) ? question.options : [],
    correct_option: question.correct_option || 0,
    shuffle_options: question.shuffle_options || false
  }));

  const target_groups = (data.quiz_groups || []).map((entry) => entry.group_id).filter(Boolean);

  quizState = {
    ...createEmptyQuiz(),
    title: data.title || '',
    description: data.description || '',
    instructions: data.instructions || '',
    quiz_type: data.quiz_type || 'mixed',
    time_limit: data.time_limit || 30,
    open_date: data.open_date || '',
    close_date: data.close_date || '',
    attempts_allowed: data.attempts_allowed || 1,
    allow_review: data.allow_review || false,
    visibility: data.visibility || 'institution',
    status: data.status || 'draft',
    institution: data.institution || profile?.institution || 'Your institution',
    target_groups,
    questions: questions.length ? questions : [createEmptyQuestion('mcq')]
  };

  currentDraftId = quizId;
  return quizState;
}

async function saveQuiz(payload, profile, isPublishing = false) {
  const normalized = {
    ...payload,
    institution: profile?.institution || payload.institution || 'Your institution',
    status: isPublishing ? 'published' : payload.status || 'draft',
    updated_at: new Date().toISOString(),
    published_at: isPublishing ? new Date().toISOString() : null,
    closed_at: null
  };

  const quizPayload = {
    title: normalized.title,
    description: normalized.description,
    instructions: normalized.instructions,
    quiz_type: normalized.quiz_type,
    time_limit: normalized.time_limit,
    open_date: normalized.open_date || null,
    close_date: normalized.close_date || null,
    attempts_allowed: normalized.attempts_allowed,
    allow_review: !!normalized.allow_review,
    visibility: normalized.visibility,
    creator_id: profile?.id || null,
    institution: normalized.institution,
    status: normalized.status,
    updated_at: normalized.updated_at,
    published_at: normalized.published_at,
    closed_at: normalized.closed_at,
    is_deleted: false
  };

  let quizId = currentDraftId;

  if (quizId) {
    const { error } = await supabase.from('quizzes').update(quizPayload).eq('id', quizId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase.from('quizzes').insert(quizPayload).select('id').single();
    if (error) throw error;
    quizId = data?.id;
    currentDraftId = quizId;
  }

  await supabase.from('quiz_questions').delete().eq('quiz_id', quizId);
  const questionRows = normalized.questions.map((question, index) => ({
    quiz_id: quizId,
    question_order: index + 1,
    question_type: question.type,
    prompt: question.prompt,
    points: question.points,
    required: question.required,
    explanation: question.explanation,
    character_limit: question.character_limit || null,
    options: question.options || [],
    correct_option: question.correct_option || 0,
    shuffle_options: question.shuffle_options || false
  }));

  if (questionRows.length) {
    const { error: questionError } = await supabase.from('quiz_questions').insert(questionRows);
    if (questionError) throw questionError;
  }

  await supabase.from('quiz_groups').delete().eq('quiz_id', quizId);
  if (normalized.target_groups?.length) {
    const groupRows = normalized.target_groups.map((groupId) => ({ quiz_id: quizId, group_id: groupId }));
    const { error: groupError } = await supabase.from('quiz_groups').insert(groupRows);
    if (groupError) throw groupError;

    if (isPublishing) {
      await notifyGroupMembers(supabase, {
        groupIds: normalized.target_groups,
        type: 'new_quiz',
        content: `New quiz available: "${normalized.title || 'Untitled quiz'}"`,
        postId: quizId,
        origin: 'quiz',
        senderId: profile?.id
      });
    }
  }

  return quizId;
}

async function deleteQuiz(quizId) {
  // Runs as a single atomic transaction on the database side (see
  // 202607210002_delete_quiz_cascade_rpc.sql) instead of a chain of
  // separate client-side deletes — one broken step (quiz_groups was
  // returning a 500) used to leave the quiz half-deleted and stuck.
  const { error } = await supabase.rpc('delete_quiz_cascade', { p_quiz_id: quizId });
  if (error) throw error;
}

function renderQuestionCard(question, index, onUpdate, onDelete, onReorder) {
  const optionsMarkup = question.type === 'mcq'
    ? `
      <div class="option-list" data-question-index="${index}">
        ${question.options.map((option, optionIndex) => `
          <div class="option-row" draggable="true" data-option-index="${optionIndex}">
            <div class="option-handle"><i class="fa-solid fa-grip-lines"></i></div>
            <label class="option-radio">
              <input type="radio" name="correct-${index}" value="${optionIndex}" ${Number(question.correct_option) === optionIndex ? 'checked' : ''}>
            </label>
            <input class="quiz-input" type="text" value="${escapeHtml(option.text)}" data-action="option-text" data-index="${index}" data-option-index="${optionIndex}" placeholder="Option ${optionIndex + 1}" />
            <button class="subtle-action" data-action="delete-option" data-index="${index}" data-option-index="${optionIndex}"><i class="fa-solid fa-xmark"></i></button>
          </div>
        `).join('')}
      </div>
      <div class="quiz-inline-actions">
        <button class="secondary-btn small" data-action="add-option" data-index="${index}">Add option</button>
        <label class="inline-toggle">
          <input type="checkbox" ${question.shuffle_options ? 'checked' : ''} data-action="shuffle-options" data-index="${index}">
          <span>Shuffle options</span>
        </label>
      </div>
    `
    : `
      <div class="quiz-inline-actions">
        <label class="inline-field">
          <span>Character limit</span>
          <input class="quiz-input compact" type="number" min="0" value="${question.character_limit || 200}" data-action="character-limit" data-index="${index}">
        </label>
      </div>
    `;

  return `
    <article class="question-card" draggable="true" data-question-index="${index}">
      <div class="question-card-top">
        <div>
          <span class="badge-pill soft">${getQuestionTypeLabel(question.type)}</span>
          <h4>Question ${index + 1}</h4>
        </div>
        <div class="question-card-actions">
          <button class="subtle-action" data-action="move-question-up" data-index="${index}"><i class="fa-solid fa-arrow-up"></i></button>
          <button class="subtle-action" data-action="move-question-down" data-index="${index}"><i class="fa-solid fa-arrow-down"></i></button>
          <button class="subtle-action danger" data-action="delete-question" data-index="${index}"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
      <div class="question-grid">
        <label class="field-group full">
          <span>Question</span>
          <textarea class="quiz-input" rows="3" data-action="question-prompt" data-index="${index}" placeholder="Compose a thoughtful prompt...">${escapeHtml(question.prompt)}</textarea>
        </label>
        <label class="field-group">
          <span>Type</span>
          <select class="quiz-input" data-action="question-type" data-index="${index}">
            <option value="mcq" ${question.type === 'mcq' ? 'selected' : ''}>Multiple Choice</option>
            <option value="short_answer" ${question.type === 'short_answer' ? 'selected' : ''}>Short Answer</option>
            <option value="essay" ${question.type === 'essay' ? 'selected' : ''}>Essay</option>
          </select>
        </label>
        <label class="field-group">
          <span>Points</span>
          <input class="quiz-input" type="number" min="1" value="${question.points || 10}" data-action="question-points" data-index="${index}">
        </label>
        <label class="field-group">
          <span>Required</span>
          <input type="checkbox" ${question.required ? 'checked' : ''} data-action="question-required" data-index="${index}">
        </label>
        <label class="field-group full">
          <span>Optional explanation</span>
          <textarea class="quiz-input" rows="2" data-action="question-explanation" data-index="${index}" placeholder="Share a concise explanation for learners...">${escapeHtml(question.explanation)}</textarea>
        </label>
        ${optionsMarkup}
      </div>
    </article>
  `;
}

function renderBuilderView(container, profile, onSectionChange) {
  const state = ensureState(profile);
  const groups = quizState.groups || [];
  const filteredGroups = groups.filter((group) => {
    const visibilityMatch = !state.visibilityFilter
      || (state.visibilityFilter === 'public' && group.is_public)
      || (state.visibilityFilter === 'private' && !group.is_public);
    const searchMatch = !state.searchTerm || `${group.name} ${group.course_code}`.toLowerCase().includes(state.searchTerm.toLowerCase());
    return visibilityMatch && searchMatch;
  });

  container.innerHTML = `
    <section class="quiz-shell">
      <div class="quiz-hero glass-card">
        <div>
          <div class="hero-badge"><i class="fa-solid fa-wand-magic-sparkles"></i> Lecturer quiz studio</div>
          <h3>${state.title ? escapeHtml(state.title) : 'Compose a polished assessment'}</h3>
          <p>Create a quiz with a calm, guided workflow tailored for your institution. Drafts stay private until you publish them to your course groups.</p>
        </div>
        <div class="hero-actions">
          <button class="primary-btn" data-action="save-draft"><i class="fa-solid fa-floppy-disk"></i> Save draft</button>
          <button class="secondary-btn" data-action="publish-quiz"><i class="fa-solid fa-paper-plane"></i> Publish</button>
          <button class="secondary-btn" data-action="open-drafts"><i class="fa-solid fa-file-lines"></i> Drafts</button>
        </div>
      </div>

      <div class="quiz-stepper glass-card">
        <div class="step-pill active"><span>1</span> Quiz info</div>
        <div class="step-pill active"><span>2</span> Target audience</div>
        <div class="step-pill active"><span>3</span> Questions</div>
        <div class="step-pill active"><span>4</span> Preview</div>
        <div class="step-pill active"><span>5</span> Publish</div>
      </div>

      <div class="quiz-grid">
        <div class="quiz-main-column">
          <section class="glass-card quiz-section">
            <div class="section-header">
              <div>
                <h4>Quiz information</h4>
                <p>Shape the assessment details and publishing window.</p>
              </div>
              <span class="badge-pill soft">Step 1</span>
            </div>
            <div class="field-grid">
              <label class="field-group full">
                <span>Quiz title</span>
                <input class="quiz-input" type="text" value="${escapeHtml(state.title)}" data-action="quiz-title" placeholder="Midterm review: Algorithms">
              </label>
              <label class="field-group full">
                <span>Description</span>
                <textarea class="quiz-input" rows="3" data-action="quiz-description" placeholder="What should learners expect from this quiz?">${escapeHtml(state.description)}</textarea>
              </label>
              <label class="field-group full">
                <span>Instructions</span>
                <textarea class="quiz-input" rows="3" data-action="quiz-instructions" placeholder="Explain timing, submission, and any expectations.">${escapeHtml(state.instructions)}</textarea>
              </label>
              <label class="field-group">
                <span>Quiz type</span>
                <select class="quiz-input" data-action="quiz-type">
                  <option value="multiple_choice" ${state.quiz_type === 'multiple_choice' ? 'selected' : ''}>Multiple Choice</option>
                  <option value="short_answer" ${state.quiz_type === 'short_answer' ? 'selected' : ''}>Short Answer</option>
                  <option value="long_answer" ${state.quiz_type === 'long_answer' ? 'selected' : ''}>Long Answer</option>
                  <option value="mixed" ${state.quiz_type === 'mixed' ? 'selected' : ''}>Mixed Quiz</option>
                </select>
              </label>
              <label class="field-group">
                <span>Time limit (mins)</span>
                <input class="quiz-input" type="number" min="5" value="${state.time_limit || 30}" data-action="quiz-time-limit">
              </label>
              <label class="field-group">
                <span>Open date</span>
                <input class="quiz-input" type="datetime-local" value="${toInputValue(state.open_date)}" data-action="quiz-open-date">
              </label>
              <label class="field-group">
                <span>Close date</span>
                <input class="quiz-input" type="datetime-local" value="${toInputValue(state.close_date)}" data-action="quiz-close-date">
              </label>
              <label class="field-group">
                <span>Attempts allowed</span>
                <input class="quiz-input" type="number" min="1" value="${state.attempts_allowed || 1}" data-action="quiz-attempts">
              </label>
              <div class="field-group field-group-checkbox full">
                <div class="field-group-checkbox-row">
                  <span>Let students review answers after grading</span>
                  <label class="toggle-switch">
                    <input type="checkbox" data-action="quiz-allow-review" ${state.allow_review ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                  </label>
                </div>
                <small class="field-hint">Students can only see this once you've finished grading their attempt — read-only, and entirely your call.</small>
              </div>
              <label class="field-group">
                <span>Visibility</span>
                <select class="quiz-input" data-action="quiz-visibility">
                  <option value="institution" ${state.visibility === 'institution' ? 'selected' : ''}>Institution</option>
                  <option value="department" ${state.visibility === 'department' ? 'selected' : ''}>Department</option>
                  <option value="group" ${state.visibility === 'group' ? 'selected' : ''}>Selected groups</option>
                </select>
              </label>
              <label class="field-group">
                <span>Status</span>
                <select class="quiz-input" data-action="quiz-status">
                  <option value="draft" ${state.status === 'draft' ? 'selected' : ''}>Draft</option>
                  <option value="published" ${state.status === 'published' ? 'selected' : ''}>Published</option>
                </select>
              </label>
            </div>
          </section>

          <section class="glass-card quiz-section">
            <div class="section-header">
              <div>
                <h4>Target audience</h4>
                <p>Institution is locked to your campus and you can publish to one or multiple course groups.</p>
              </div>
              <span class="badge-pill soft">Step 2</span>
            </div>
            <div class="locked-institution">
              <i class="fa-solid fa-building-columns"></i>
              <div>
                <strong>${escapeHtml(profile?.institution || state.institution || 'Your institution')}</strong>
                <p>Only course groups you created are shown here.</p>
              </div>
            </div>
            <div class="filter-row">
              <label class="field-group">
                <span>Visibility</span>
                <select class="quiz-input" data-action="group-visibility-filter">
                  <option value="">All groups</option>
                  <option value="public" ${state.visibilityFilter === 'public' ? 'selected' : ''}>Public</option>
                  <option value="private" ${state.visibilityFilter === 'private' ? 'selected' : ''}>Private</option>
                </select>
              </label>
              <label class="field-group flex">
                <span>Search</span>
                <input class="quiz-input" type="search" value="${escapeHtml(state.searchTerm || '')}" data-action="group-search-filter" placeholder="Search by name or course code">
              </label>
            </div>
            <div class="group-list">
              ${filteredGroups.length ? filteredGroups.map((group) => `
                <label class="group-chip ${state.target_groups.includes(group.id) ? 'selected' : ''} ${group.is_frozen ? 'disabled' : ''}">
                  <input type="checkbox" value="${group.id}" ${state.target_groups.includes(group.id) ? 'checked' : ''} ${group.is_frozen ? 'disabled' : ''} data-action="target-group">
                  <span>
                    <strong>${escapeHtml(group.name)}</strong>
                    <small>${escapeHtml(group.course_code || 'No course code')} • ${group.member_count ?? 0} members${group.is_frozen ? ' • Frozen' : ''}</small>
                  </span>
                </label>
              `).join('') : '<p class="empty-state">You have not created any course groups yet. Create one from My Course Groups first.</p>'}
            </div>
          </section>

          <section class="glass-card quiz-section">
            <div class="section-header">
              <div>
                <h4>Question builder</h4>
                <p>Mix multiple choice, short answer, and essay prompts in one quiz.</p>
              </div>
              <span class="badge-pill soft">Step 3</span>
            </div>
            <div class="quiz-inline-actions">
              <button class="secondary-btn small" data-action="add-question-mcq"><i class="fa-solid fa-plus"></i> Add MCQ</button>
              <button class="secondary-btn small" data-action="add-question-short"><i class="fa-solid fa-plus"></i> Add short answer</button>
              <button class="secondary-btn small" data-action="add-question-essay"><i class="fa-solid fa-plus"></i> Add essay</button>
            </div>
            <div class="question-stack">
              ${(state.questions || []).map((question, index) => renderQuestionCard(question, index)).join('')}
            </div>
          </section>

          <section class="glass-card quiz-section">
            <div class="section-header">
              <div>
                <h4>Live preview</h4>
                <p>Preview the assessment exactly as learners will experience it.</p>
              </div>
              <span class="badge-pill soft">Step 4</span>
            </div>
            <div class="preview-tabs">
              <button class="preview-tab ${currentPreviewMode === 'desktop' ? 'active' : ''}" data-action="preview-desktop">Desktop</button>
              <button class="preview-tab ${currentPreviewMode === 'tablet' ? 'active' : ''}" data-action="preview-tablet">Tablet</button>
              <button class="preview-tab ${currentPreviewMode === 'mobile' ? 'active' : ''}" data-action="preview-mobile">Mobile</button>
            </div>
            <div class="preview-frame ${currentPreviewMode}">
              <div class="quiz-preview-card">
                <div class="preview-heading">
                  <h5>${escapeHtml(state.title || 'Untitled quiz')}</h5>
                  <p>${escapeHtml(state.description || 'A polished preview will appear here as you build your assessment.')}</p>
                  <div class="preview-meta">
                    <span><i class="fa-solid fa-clock"></i> ${state.time_limit || 30} mins</span>
                    <span><i class="fa-solid fa-users"></i> ${state.target_groups.length ? `${state.target_groups.length} group${state.target_groups.length > 1 ? 's' : ''}` : 'Open to your institution'}</span>
                  </div>
                </div>
                <div class="preview-instructions">
                  <strong>Instructions</strong>
                  <p>${escapeHtml(state.instructions || 'Use the provided instructions to guide learners through the experience.')}</p>
                </div>
                ${(state.questions || []).map((question, index) => `
                  <div class="preview-question">
                    <div class="preview-question-top">
                      <strong>${index + 1}. ${escapeHtml(question.prompt || 'Question prompt goes here')}</strong>
                      <span>${getQuestionTypeLabel(question.type)} • ${question.points || 10} pts</span>
                    </div>
                    ${question.type === 'mcq' ? `
                      <div class="preview-options">
                        ${(question.options || []).map((option) => `<label class="preview-option"><input type="radio" disabled>${escapeHtml(option.text || 'Option')}</label>`).join('')}
                      </div>
                    ` : ''}
                    ${question.type !== 'mcq' ? `<div class="preview-textbox"></div>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
          </section>
        </div>
        <aside class="quiz-sidebar">
          <section class="glass-card quiz-side-card">
            <div class="section-header compact">
              <div>
                <h4>Publishing</h4>
                <p>Save drafts, publish now or archive later.</p>
              </div>
              <span class="badge-pill soft">Step 5</span>
            </div>
            <div class="stacked-actions">
              <button class="primary-btn full" data-action="save-draft"><i class="fa-solid fa-floppy-disk"></i> Save draft</button>
              <button class="secondary-btn full" data-action="update-draft"><i class="fa-solid fa-pen-to-square"></i> Update draft</button>
              <button class="secondary-btn full" data-action="publish-quiz"><i class="fa-solid fa-paper-plane"></i> Publish</button>
              <button class="secondary-btn full" data-action="archive-quiz"><i class="fa-solid fa-box-archive"></i> Archive</button>
              <button class="secondary-btn full danger" data-action="delete-quiz"><i class="fa-solid fa-trash"></i> Delete</button>
            </div>
            <div class="status-box">
              <strong>Current status</strong>
              <p>${escapeHtml(getStatusBadge(state.status || 'draft'))}</p>
              <small>${currentDraftId ? 'Active draft is synced with your saved quiz.' : 'This quiz is still being composed locally.'}</small>
            </div>
          </section>
          <section class="glass-card quiz-side-card">
            <h4>Quick tips</h4>
            <ul class="tips-list">
              <li>Keep questions concise and focused.</li>
              <li>Set a clear open and close date for pacing.</li>
              <li>Publish to one or many groups from your institution.</li>
            </ul>
          </section>
        </aside>
      </div>
    </section>
  `;

  bindBuilderEvents(container, profile, onSectionChange);
}

function renderQuizzesList(container, section, profile, onSectionChange) {
  const status = section === 'draft-quizzes' ? 'draft' : 'published';
  container.innerHTML = `
    <section class="quiz-shell">
      <div class="quiz-hero glass-card">
        <div>
          <div class="hero-badge"><i class="fa-solid fa-square-check"></i> ${section === 'draft-quizzes' ? 'Draft quizzing' : 'Published quizzes'}</div>
          <h3>${section === 'draft-quizzes' ? 'Draft library' : 'Published quiz library'}</h3>
          <p>Browse, refine, and share your assessment library with the elegant pacing of the lecturer studio.</p>
        </div>
        <div class="hero-actions">
          <button class="primary-btn" data-action="open-builder"><i class="fa-solid fa-plus"></i> Create quiz</button>
          ${section !== 'draft-quizzes' ? '<button class="secondary-btn" data-action="open-drafts"><i class="fa-solid fa-file-lines"></i> Drafts</button>' : '<button class="secondary-btn" data-action="open-published"><i class="fa-solid fa-square-check"></i> Published</button>'}
        </div>
      </div>
      <div class="glass-card quiz-section">
        <div class="section-header">
          <div>
            <h4>Search and filter</h4>
            <p>Find the right assessment quickly by title or publication window.</p>
          </div>
        </div>
        <div class="filter-row">
          <label class="field-group flex">
            <span>Search</span>
            <input class="quiz-input" type="search" data-action="quiz-search" placeholder="Search quizzes">
          </label>
          <label class="field-group">
            <span>Status</span>
            <select class="quiz-input" data-action="quiz-status-filter">
              <option value="">All</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="closed">Closed</option>
            </select>
          </label>
          <label class="field-group">
            <span>Course group</span>
            <input class="quiz-input" type="text" data-action="quiz-group-filter" placeholder="Group name">
          </label>
        </div>
      </div>
      <div class="quiz-list-grid" data-quiz-list></div>
    </section>
  `;

  bindListEvents(container, section, profile, onSectionChange);
}

async function populateList(container, section, profile, onSectionChange) {
  const quizzes = await loadQuizzes(profile, section === 'draft-quizzes' ? 'draft' : 'published');
  const list = container.querySelector('[data-quiz-list]');
  if (!list) return;

  list.innerHTML = quizzes.length ? quizzes.map((quiz) => `
    <article class="quiz-card glass-card">
      <div class="quiz-card-head">
        <div>
          <h4>${escapeHtml(quiz.title || 'Untitled quiz')}</h4>
          <p>${escapeHtml(quiz.description || 'A thoughtful assessment for your course groups.')}</p>
        </div>
        <span class="badge-pill soft">${escapeHtml(getStatusBadge(quiz.status))}</span>
      </div>
      <div class="quiz-card-meta">
        <span><i class="fa-solid fa-layer-group"></i> ${escapeHtml(quiz.group_names || 'No groups')}</span>
        <span><i class="fa-solid fa-question"></i> ${quiz.quiz_questions?.length || 0} questions</span>
        <span><i class="fa-solid fa-clock"></i> ${quiz.time_limit || 30} mins</span>
      </div>
      <div class="quiz-card-meta">
        <span><i class="fa-solid fa-door-open"></i> ${formatDateLabel(quiz.open_date)}</span>
        <span><i class="fa-solid fa-door-closed"></i> ${formatDateLabel(quiz.close_date)}</span>
      </div>
      <div class="quiz-card-actions">
        <button class="secondary-btn small" data-action="view-quiz" data-id="${quiz.id}">View</button>
        <button class="secondary-btn small" data-action="edit-quiz" data-id="${quiz.id}">Edit</button>
        <button class="secondary-btn small" data-action="duplicate-quiz" data-id="${quiz.id}">Duplicate</button>
        <button class="secondary-btn small" data-action="archive-quiz" data-id="${quiz.id}">Archive</button>
        <button class="secondary-btn small danger" data-action="delete-quiz" data-id="${quiz.id}">Delete</button>
      </div>
    </article>
  `).join('') : '<div class="empty-state-card">No quizzes match the current filters yet.</div>';

  bindQuizCardEvents(container, section, profile, onSectionChange);
}

function bindQuizCardEvents(container, section, profile, onSectionChange) {
  container.querySelectorAll('[data-quiz-list] [data-action]').forEach((element) => {
    const action = element.getAttribute('data-action');
    if (action === 'view-quiz') {
      element.addEventListener('click', () => {
        showLecturerNotice('Preview not here yet', 'Quiz preview is available from the builder workflow (open it to edit, then use the Preview step).', 'info');
      });
    }
    if (action === 'edit-quiz') {
      element.addEventListener('click', () => {
        currentDraftId = element.dataset.id;
        onSectionChange('quiz-builder');
      });
    }
    if (action === 'duplicate-quiz') {
      element.addEventListener('click', async () => {
        try {
          const quizId = element.dataset.id;
          const { data, error } = await supabase.from('quizzes').select('*').eq('id', quizId).single();
          if (error) throw error;
          const { data: insertedData, error: insertError } = await supabase.from('quizzes').insert({ ...data, id: undefined, title: `${data.title} copy`, status: 'draft', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), published_at: null }).select('id').single();
          if (insertError) throw insertError;
          currentDraftId = insertedData.id;
          onSectionChange('quiz-builder');
        } catch (error) {
          console.error(error);
          showLecturerNotice('Could not duplicate', 'Something went wrong duplicating this quiz. Please try again.', 'error');
        }
      });
    }
    if (action === 'archive-quiz') {
      element.addEventListener('click', async () => {
        const confirmed = await showLecturerConfirm(
          'Archive this quiz?',
          'Students will no longer see it, but you can still view its results later.',
          { confirmText: 'Archive', danger: true }
        );
        if (!confirmed) return;
        try {
          await supabase.from('quizzes').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', element.dataset.id);
          populateList(container, section, profile, onSectionChange);
        } catch (error) {
          console.error(error);
          showLecturerNotice('Could not archive', 'Something went wrong archiving this quiz. Please try again.', 'error');
        }
      });
    }
    if (action === 'delete-quiz') {
      element.addEventListener('click', async () => {
        const confirmed = await showLecturerConfirm(
          'Delete this quiz?',
          'This removes it permanently, including its questions. This cannot be undone.',
          { confirmText: 'Delete', danger: true }
        );
        if (!confirmed) return;
        try {
          await deleteQuiz(element.dataset.id);
          populateList(container, section, profile, onSectionChange);
        } catch (error) {
          console.error(error);
          showLecturerNotice('Could not delete', 'Something went wrong deleting this quiz. Please try again.', 'error');
        }
      });
    }
  });
}

function bindBuilderEvents(container, profile, onSectionChange) {
  const setState = (patch) => {
    quizState = { ...quizState, ...patch };
    renderBuilderView(container, profile, onSectionChange);
  };

  // For plain text/number inputs: the field already shows what the user
  // typed, so re-rendering the whole builder on every keystroke only
  // destroys focus mid-word (which read as "the page refreshing").
  // This just keeps quizState in sync without touching the DOM.
  const mutateState = (patch) => {
    quizState = { ...quizState, ...patch };
  };

  container.querySelectorAll('[data-action]').forEach((element) => {
    const action = element.getAttribute('data-action');
    if (action === 'save-draft') {
      element.addEventListener('click', async () => {
        try {
          const payload = { ...quizState, status: 'draft' };
          await saveQuiz(payload, profile, false);
          element.innerHTML = '<i class="fa-solid fa-check"></i> Saved';
          setTimeout(() => {
            if (element) element.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save draft';
          }, 1200);
        } catch (error) {
          console.error(error);
          showLecturerNotice('Draft not saved', 'Could not save your quiz draft right now. Please try again.', 'error');
        }
      });
    }

    if (action === 'update-draft') {
      element.addEventListener('click', async () => {
        try {
          await saveQuiz(quizState, profile, false);
          showLecturerNotice('Draft updated', 'Your changes have been saved.', 'success');
        } catch (error) {
          console.error(error);
          showLecturerNotice('Update failed', 'Could not update the draft. Please try again.', 'error');
        }
      });
    }

    if (action === 'publish-quiz') {
      element.addEventListener('click', async () => {
        try {
          await saveQuiz({ ...quizState, status: 'published' }, profile, true);
          showLecturerNotice('Quiz published', 'Students in the target groups can now see this quiz.', 'success');
        } catch (error) {
          console.error(error);
          const isPermissionError = error?.message?.toLowerCase().includes('row-level security');
          showLecturerNotice(
            'Could not publish',
            isPermissionError
              ? "Your account isn't recognized as a lecturer by the database yet, so it blocked the write. Try logging out and back in — if that doesn't fix it, your profile may need its lecturer flag set manually."
              : (error?.message || 'Something went wrong publishing this quiz. Please try again.'),
            'error'
          );
        }
      });
    }

    if (action === 'archive-quiz') {
      element.addEventListener('click', async () => {
        if (!currentDraftId) return;
        const confirmed = await showLecturerConfirm(
          'Archive this quiz?',
          'Students will no longer see it, but you can still view its results later.',
          { confirmText: 'Archive', danger: true }
        );
        if (!confirmed) return;
        try {
          await supabase.from('quizzes').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', currentDraftId);
          showLecturerNotice('Quiz archived', 'It has been moved out of your active quizzes.', 'success');
        } catch (error) {
          console.error(error);
          showLecturerNotice('Could not archive', 'Something went wrong archiving this quiz. Please try again.', 'error');
        }
      });
    }

    if (action === 'delete-quiz') {
      element.addEventListener('click', async () => {
        if (!currentDraftId) return;
        const confirmed = await showLecturerConfirm(
          'Delete this quiz?',
          'This removes it permanently, including its questions. This cannot be undone.',
          { confirmText: 'Delete', danger: true }
        );
        if (!confirmed) return;
        try {
          await deleteQuiz(currentDraftId);
          showLecturerNotice('Quiz deleted', 'It has been permanently removed.', 'success');
        } catch (error) {
          console.error(error);
          showLecturerNotice('Could not delete', 'Something went wrong deleting this quiz. Please try again.', 'error');
        }
      });
    }

    if (action === 'open-drafts') {
      element.addEventListener('click', () => onSectionChange('draft-quizzes'));
    }

    if (action === 'preview-desktop') {
      element.addEventListener('click', () => { currentPreviewMode = 'desktop'; renderBuilderView(container, profile, onSectionChange); });
    }

    if (action === 'preview-tablet') {
      element.addEventListener('click', () => { currentPreviewMode = 'tablet'; renderBuilderView(container, profile, onSectionChange); });
    }

    if (action === 'preview-mobile') {
      element.addEventListener('click', () => { currentPreviewMode = 'mobile'; renderBuilderView(container, profile, onSectionChange); });
    }

    if (action === 'quiz-title') {
      element.addEventListener('input', (event) => mutateState({ title: event.target.value }));
    }
    if (action === 'quiz-description') {
      element.addEventListener('input', (event) => mutateState({ description: event.target.value }));
    }
    if (action === 'quiz-instructions') {
      element.addEventListener('input', (event) => mutateState({ instructions: event.target.value }));
    }
    if (action === 'quiz-type') {
      element.addEventListener('change', (event) => setState({ quiz_type: event.target.value }));
    }
    if (action === 'quiz-time-limit') {
      element.addEventListener('input', (event) => mutateState({ time_limit: Number(event.target.value || 0) }));
    }
    if (action === 'quiz-open-date') {
      element.addEventListener('change', (event) => setState({ open_date: event.target.value }));
    }
    if (action === 'quiz-close-date') {
      element.addEventListener('change', (event) => setState({ close_date: event.target.value }));
    }
    if (action === 'quiz-attempts') {
      element.addEventListener('input', (event) => mutateState({ attempts_allowed: Number(event.target.value || 1) }));
    }
    if (action === 'quiz-allow-review') {
      element.addEventListener('change', (event) => setState({ allow_review: event.target.checked }));
    }
    if (action === 'quiz-visibility') {
      element.addEventListener('change', (event) => setState({ visibility: event.target.value }));
    }
    if (action === 'quiz-status') {
      element.addEventListener('change', (event) => setState({ status: event.target.value }));
    }
    if (action === 'group-visibility-filter') {
      element.addEventListener('change', (event) => setState({ visibilityFilter: event.target.value }));
    }
    if (action === 'group-search-filter') {
      element.addEventListener('input', (event) => mutateState({ searchTerm: event.target.value }));
    }
    if (action === 'target-group') {
      element.addEventListener('change', (event) => {
        const groupId = event.target.value;
        const selected = quizState.target_groups || [];
        const next = event.target.checked ? [...selected, groupId] : selected.filter((id) => id !== groupId);
        setState({ target_groups: next });
      });
    }

    if (action === 'add-question-mcq') {
      element.addEventListener('click', () => {
        const questions = [...(quizState.questions || []), createEmptyQuestion('mcq')];
        setState({ questions });
      });
    }
    if (action === 'add-question-short') {
      element.addEventListener('click', () => {
        const questions = [...(quizState.questions || []), createEmptyQuestion('short_answer')];
        setState({ questions });
      });
    }
    if (action === 'add-question-essay') {
      element.addEventListener('click', () => {
        const questions = [...(quizState.questions || []), createEmptyQuestion('essay')];
        setState({ questions });
      });
    }

    if (action === 'question-prompt') {
      element.addEventListener('input', (event) => {
        const index = Number(event.target.dataset.index);
        const questions = [...quizState.questions];
        questions[index] = { ...questions[index], prompt: event.target.value };
        mutateState({ questions });
      });
    }
    if (action === 'question-type') {
      element.addEventListener('change', (event) => {
        const index = Number(event.target.dataset.index);
        const questions = [...quizState.questions];
        const nextType = event.target.value;
        questions[index] = { ...questions[index], type: nextType, options: nextType === 'mcq' ? questions[index].options || [] : [], character_limit: nextType === 'mcq' ? questions[index].character_limit : 200 };
        setState({ questions });
      });
    }
    if (action === 'question-points') {
      element.addEventListener('input', (event) => {
        const index = Number(event.target.dataset.index);
        const questions = [...quizState.questions];
        questions[index] = { ...questions[index], points: Number(event.target.value || 10) };
        mutateState({ questions });
      });
    }
    if (action === 'question-required') {
      element.addEventListener('change', (event) => {
        const index = Number(event.target.dataset.index);
        const questions = [...quizState.questions];
        questions[index] = { ...questions[index], required: event.target.checked };
        setState({ questions });
      });
    }
    if (action === 'question-explanation') {
      element.addEventListener('input', (event) => {
        const index = Number(event.target.dataset.index);
        const questions = [...quizState.questions];
        questions[index] = { ...questions[index], explanation: event.target.value };
        mutateState({ questions });
      });
    }
    if (action === 'character-limit') {
      element.addEventListener('input', (event) => {
        const index = Number(event.target.dataset.index);
        const questions = [...quizState.questions];
        questions[index] = { ...questions[index], character_limit: Number(event.target.value || 200) };
        mutateState({ questions });
      });
    }
    if (action === 'delete-question') {
      element.addEventListener('click', () => {
        const index = Number(element.dataset.index);
        const questions = [...quizState.questions];
        questions.splice(index, 1);
        setState({ questions });
      });
    }
    if (action === 'move-question-up') {
      element.addEventListener('click', () => {
        const index = Number(element.dataset.index);
        if (index <= 0) return;
        const questions = [...quizState.questions];
        [questions[index - 1], questions[index]] = [questions[index], questions[index - 1]];
        setState({ questions });
      });
    }
    if (action === 'move-question-down') {
      element.addEventListener('click', () => {
        const index = Number(element.dataset.index);
        if (index >= quizState.questions.length - 1) return;
        const questions = [...quizState.questions];
        [questions[index], questions[index + 1]] = [questions[index + 1], questions[index]];
        setState({ questions });
      });
    }
    if (action === 'add-option') {
      element.addEventListener('click', () => {
        const index = Number(element.dataset.index);
        const questions = [...quizState.questions];
        const current = questions[index];
        current.options = [...(current.options || []), { id: crypto.randomUUID ? crypto.randomUUID() : `opt-${Date.now()}-${current.options.length + 1}`, text: '' }];
        questions[index] = current;
        setState({ questions });
      });
    }
    if (action === 'delete-option') {
      element.addEventListener('click', () => {
        const index = Number(element.dataset.index);
        const optionIndex = Number(element.dataset.optionIndex);
        const questions = [...quizState.questions];
        const current = questions[index];
        current.options = (current.options || []).filter((_, itemIndex) => itemIndex !== optionIndex);
        questions[index] = current;
        setState({ questions });
      });
    }
    if (action === 'option-text') {
      element.addEventListener('input', (event) => {
        const index = Number(event.target.dataset.index);
        const optionIndex = Number(event.target.dataset.optionIndex);
        const questions = [...quizState.questions];
        const current = questions[index];
        current.options = (current.options || []).map((option, itemIndex) => itemIndex === optionIndex ? { ...option, text: event.target.value } : option);
        questions[index] = current;
        mutateState({ questions });
      });
    }
    if (action === 'shuffle-options') {
      element.addEventListener('change', (event) => {
        const index = Number(event.target.dataset.index);
        const questions = [...quizState.questions];
        questions[index] = { ...questions[index], shuffle_options: event.target.checked };
        setState({ questions });
      });
    }
  });

  container.querySelectorAll('.question-card').forEach((card) => {
    card.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', card.dataset.questionIndex);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('dragover', (event) => event.preventDefault());
    card.addEventListener('drop', (event) => {
      event.preventDefault();
      const fromIndex = Number(event.dataTransfer.getData('text/plain'));
      const toIndex = Number(card.dataset.questionIndex);
      if (Number.isNaN(fromIndex) || Number.isNaN(toIndex) || fromIndex === toIndex) return;
      const questions = [...quizState.questions];
      const [moved] = questions.splice(fromIndex, 1);
      questions.splice(toIndex, 0, moved);
      setState({ questions });
    });
  });

  container.querySelectorAll('.option-row').forEach((row) => {
    row.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', `${row.dataset.optionIndex}`);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (event) => event.preventDefault());
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      const index = Number(row.closest('[data-question-index]').dataset.questionIndex);
      const fromOptionIndex = Number(event.dataTransfer.getData('text/plain'));
      const toOptionIndex = Number(row.dataset.optionIndex);
      if (Number.isNaN(fromOptionIndex) || Number.isNaN(toOptionIndex) || fromOptionIndex === toOptionIndex) return;
      const questions = [...quizState.questions];
      const current = questions[index];
      const reordered = [...(current.options || [])];
      const [moved] = reordered.splice(fromOptionIndex, 1);
      reordered.splice(toOptionIndex, 0, moved);
      current.options = reordered;
      questions[index] = current;
      setState({ questions });
    });
  });
}

function bindListEvents(container, section, profile, onSectionChange) {
  container.querySelectorAll('[data-action]').forEach((element) => {
    const action = element.getAttribute('data-action');
    if (action === 'open-builder') {
      element.addEventListener('click', () => onSectionChange('quiz-builder'));
    }
    if (action === 'open-drafts') {
      element.addEventListener('click', () => onSectionChange('draft-quizzes'));
    }
    if (action === 'open-published') {
      element.addEventListener('click', () => onSectionChange('published-quizzes'));
    }
  });
}

function renderEmptyState(container) {
  container.innerHTML = `
    <section class="quiz-shell">
      <div class="glass-card quiz-section empty-state-card">
        <h3>Quiz management is ready</h3>
        <p>Your lecturer workspace can now create and publish assessments with a calm, guided experience.</p>
      </div>
    </section>
  `;
}

async function renderQuizExperience(container, section, profile, onSectionChange) {
  if (!container) return;
  if (!profile) {
    renderEmptyState(container);
    return;
  }
  lastLoadedProfile = profile;
  const state = ensureState(profile);
  state.groups = await loadGroups(profile);
  quizState = { ...state, groups: state.groups };

  if (section === 'quiz-builder') {
    if (currentDraftId) {
      await loadQuizDraft(currentDraftId, profile);
      quizState = { ...quizState, groups: state.groups };
    }
    renderBuilderView(container, profile, onSectionChange);
    return;
  }

  if (section === 'draft-quizzes' || section === 'published-quizzes') {
    renderQuizzesList(container, section, profile, onSectionChange);
    populateList(container, section, profile, onSectionChange);
    return;
  }

  renderEmptyState(container);
}

export { renderQuizExperience };