// ============================================================
// COMMAND CENTER: SUPPORT DESK
// Real tickets only, from support_tickets / support_messages.
// Every change goes through the admin-checked database functions
// (support_admin_reply, support_admin_update). Internal notes and the
// automatic activity log are never visible to the person who wrote in.
// Guests (not logged in) cannot see replies in Peerloom, so for them the
// reply is saved on the ticket AND opened as an email to send.
// ============================================================

export function createSupportModule(ctx) {
  const { supabase, toast, escapeHtml, openModal, closeModal, confirmAction, getAdminId } = ctx;

  const S = {
    loaded: false,
    tickets: [], profiles: {}, admins: [], canned: [],
    status: 'active', scope: 'all', category: 'all', priority: 'all', q: '',
    openId: null, messages: [],
  };

  const $ = id => document.getElementById(id);
  const esc = escapeHtml;
  const errMsg = e => (e && e.message) ? e.message.replace(/^.*?exception:\s*/i, '') : 'Something went wrong';

  const STATUS = { open: ['Open', 'cc-badge-info'], pending: ['Waiting on user', 'cc-badge-warn'], resolved: ['Resolved', 'cc-badge-ok'], closed: ['Closed', 'cc-badge-mute'] };
  const PRIORITY = { urgent: ['Urgent', 'cc-badge-danger'], high: ['High', 'cc-badge-warn'], normal: ['Normal', 'cc-badge-info'], low: ['Low', 'cc-badge-mute'] };
  const CATEGORY = { account: 'Account', payments: 'Payments', groups: 'Groups', quizzes: 'Quizzes', bug: 'Bug', abuse: 'Abuse / safety', feedback: 'Feedback', other: 'Other' };
  const PRIORITY_WEIGHT = { urgent: 0, high: 1, normal: 2, low: 3 };

  const badge = (map, key) => { const m = map[key] || [key, 'cc-badge-mute']; return `<span class="cc-badge ${m[1]}">${esc(m[0])}</span>`; };

  function ago(iso) {
    if (!iso) return '—';
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24); if (d < 30) return d + 'd ago';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const fmtDT = iso => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  function dur(ms) {
    if (!isFinite(ms) || ms < 0) return '—';
    const m = Math.round(ms / 60000);
    if (m < 60) return m + ' min'; const h = m / 60;
    if (h < 48) return h.toFixed(h < 10 ? 1 : 0) + ' h'; return (h / 24).toFixed(1) + ' days';
  }
  const pname = p => p ? (p.full_name || p.username || 'Unnamed') : '';
  const activeStatus = s => s === 'open' || s === 'pending';

  // ---------------- data ----------------
  async function loadTickets() {
    const { data, error } = await supabase.from('support_tickets').select('*').order('last_message_at', { ascending: false }).limit(1000);
    if (error) throw error;
    S.tickets = data || [];
    const ids = [...new Set(S.tickets.map(t => t.user_id).filter(Boolean))];
    const need = ids.filter(id => !S.profiles[id]);
    for (let i = 0; i < need.length; i += 100) {
      const { data: ps } = await supabase.from('profiles')
        .select('id, full_name, username, role, is_lecturer, institution, campus, created_at, account_status, verified')
        .in('id', need.slice(i, i + 100));
      (ps || []).forEach(p => { S.profiles[p.id] = p; });
    }
  }
  async function loadAdmins() {
    const { data: sa } = await supabase.from('super_admins').select('id');
    const ids = (sa || []).map(r => r.id);
    if (!ids.length) { S.admins = []; return; }
    const { data: ps } = await supabase.from('profiles').select('id, full_name, username').in('id', ids);
    S.admins = (ps || []).map(p => ({ id: p.id, name: pname(p) }));
  }
  async function loadCanned() {
    const { data } = await supabase.from('support_canned_replies').select('*').order('created_at');
    S.canned = data || [];
  }
  async function load() {
    try {
      await Promise.all([loadTickets(), loadAdmins(), loadCanned()]);
      S.loaded = true;
    } catch (e) { console.error('Support desk failed to load', e); S.loaded = false; }
  }

  // ---------------- list view ----------------
  function filtered() {
    const me = getAdminId(); const q = S.q.trim().toLowerCase();
    return S.tickets.filter(t => {
      if (S.status === 'active' ? !activeStatus(t.status) : (S.status !== 'all' && t.status !== S.status)) return false;
      if (S.scope === 'mine' && t.assigned_to !== me) return false;
      if (S.scope === 'unassigned' && (t.assigned_to || !activeStatus(t.status))) return false;
      if (S.category !== 'all' && t.category !== S.category) return false;
      if (S.priority !== 'all' && t.priority !== S.priority) return false;
      if (q && !(`${t.ticket_no} ${t.subject} ${t.name} ${t.email}`.toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => {
      if (S.status === 'active') {
        const w = (PRIORITY_WEIGHT[a.priority] ?? 2) - (PRIORITY_WEIGHT[b.priority] ?? 2);
        if (w) return w;
      }
      return new Date(b.last_message_at) - new Date(a.last_message_at);
    });
  }
  function renderStats() {
    const grid = $('ccSupStatGrid'); if (!grid) return;
    const T = S.tickets, now = Date.now();
    const open = T.filter(t => t.status === 'open').length;
    const pending = T.filter(t => t.status === 'pending').length;
    const unassigned = T.filter(t => activeStatus(t.status) && !t.assigned_to).length;
    const hot = T.filter(t => activeStatus(t.status) && (t.priority === 'urgent' || t.priority === 'high')).length;
    const fr = T.filter(t => t.first_response_at && now - new Date(t.created_at) < 30 * 864e5).map(t => new Date(t.first_response_at) - new Date(t.created_at));
    const avgFr = fr.length ? dur(fr.reduce((a, b) => a + b, 0) / fr.length) : '—';
    const solved7 = T.filter(t => t.resolved_at && now - new Date(t.resolved_at) < 7 * 864e5).length;
    const rated = T.filter(t => t.rating);
    const csat = rated.length ? (rated.reduce((a, t) => a + t.rating, 0) / rated.length).toFixed(1) + ' / 5' : '—';
    const cards = [
      ['fa-inbox', '#3b82f6', open, 'Open — need a reply'],
      ['fa-hourglass-half', '#f59e0b', pending, 'Waiting on the user'],
      ['fa-user-slash', '#7c3aed', unassigned, 'Unassigned'],
      ['fa-fire', '#ef4444', hot, 'High / urgent, still active'],
      ['fa-stopwatch', '#14b8a6', avgFr, 'Avg first reply (30 days)'],
      ['fa-circle-check', '#10b981', solved7, 'Resolved this week'],
      ['fa-star', '#f59e0b', csat, `Satisfaction (${rated.length} rating${rated.length === 1 ? '' : 's'})`],
    ];
    grid.innerHTML = cards.map(c => `<div class="cc-stat-card"><div class="cc-stat-top"><div class="cc-stat-icn" style="background:${c[1]}1f;color:${c[1]};"><i class="fa-solid ${c[0]}"></i></div></div><div class="cc-stat-value">${c[2]}</div><div class="cc-stat-label">${c[3]}</div></div>`).join('');
  }
  function updateBadge() {
    const b = $('ccSupportBadge'); if (!b) return;
    const n = S.tickets.filter(t => t.status === 'open').length;
    b.style.display = n ? 'inline-flex' : 'none'; b.textContent = n > 99 ? '99+' : n;
  }
  function renderControls() {
    const cat = $('ccSupCategory');
    if (cat && !cat.dataset.ready) {
      cat.innerHTML = '<option value="all">All categories</option>' + Object.entries(CATEGORY).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
      cat.dataset.ready = '1';
    }
    document.querySelectorAll('[data-sup-status]').forEach(b => b.classList.toggle('active', b.dataset.supStatus === S.status));
    const counts = { active: 0, open: 0, pending: 0, resolved: 0, closed: 0, all: S.tickets.length };
    S.tickets.forEach(t => { counts[t.status]++; if (activeStatus(t.status)) counts.active++; });
    document.querySelectorAll('[data-sup-status]').forEach(b => {
      const n = counts[b.dataset.supStatus]; const base = b.dataset.label || (b.dataset.label = b.textContent.trim());
      b.textContent = `${base} (${n})`;
    });
  }
  function renderTable() {
    const body = $('ccSupTbody'); if (!body) return;
    const rows = filtered();
    const foot = $('ccSupFootCount'); if (foot) foot.textContent = `${rows.length} of ${S.tickets.length} ticket${S.tickets.length === 1 ? '' : 's'}`;
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--ink-mute);padding:40px 12px;">${S.tickets.length ? 'No tickets match these filters.' : 'No support tickets yet. When someone sends a request from the Support page it appears here instantly.'}</td></tr>`;
      return;
    }
    body.innerHTML = rows.map(t => {
      const assignee = S.admins.find(a => a.id === t.assigned_to);
      const guest = !t.user_id;
      return `<tr class="cc-sup-row" data-sup-open="${t.id}" tabindex="0" style="cursor:pointer;">
        <td>${badge(PRIORITY, t.priority)}</td>
        <td><div style="font-weight:700;">${t.status === 'open' ? '<span class="cc-sup-dot" title="Needs a reply"></span>' : ''}${esc(t.subject)}</div>
            <div style="font-size:.74rem;color:var(--ink-mute);">${esc(t.ticket_no)}</div></td>
        <td><div>${esc(t.name)}</div><div style="font-size:.74rem;color:var(--ink-mute);">${esc(t.email)}${guest ? ' · <strong>guest</strong>' : ''}</div></td>
        <td>${esc(CATEGORY[t.category] || t.category)}</td>
        <td>${badge(STATUS, t.status)}</td>
        <td>${assignee ? esc(assignee.name) : '<span style="color:var(--ink-mute);">Unassigned</span>'}</td>
        <td style="white-space:nowrap;color:var(--ink-mute);font-size:.8rem;" title="${esc(fmtDT(t.last_message_at))}">${ago(t.last_message_at)}</td></tr>`;
    }).join('');
  }
  function render() {
    if (!S.loaded) {
      const g = $('ccSupStatGrid'); if (g) g.innerHTML = `<div class="cc-panel" style="grid-column:1/-1;"><p style="margin:0;color:var(--ink-mute);">Support data could not be loaded. Reload the page to try again.</p></div>`;
      return;
    }
    renderStats(); renderControls(); renderTable(); updateBadge();
  }

  // ---------------- ticket detail ----------------
  const ticket = () => S.tickets.find(t => t.id === S.openId);

  async function loadMessages() {
    const { data, error } = await supabase.from('support_messages').select('*').eq('ticket_id', S.openId).order('created_at');
    if (error) throw error;
    S.messages = data || [];
  }
  function threadHtml() {
    if (!S.messages.length) return '<p style="color:var(--ink-mute);">No messages.</p>';
    return S.messages.map(m => {
      if (m.author_type === 'system') return `<div class="cc-sup-sys">${esc(m.body)} · ${esc(fmtDT(m.created_at))}</div>`;
      const cls = m.is_internal ? 'internal' : (m.author_type === 'agent' ? 'agent' : 'user');
      return `<div class="cc-sup-msg ${cls}">
        <div class="cc-sup-meta"><strong>${esc(m.author_name || (m.author_type === 'agent' ? 'Support' : 'User'))}</strong>
          ${m.is_internal ? '<span class="cc-badge cc-badge-warn" style="margin-left:6px;">Internal note</span>' : ''}
          <span>${esc(fmtDT(m.created_at))}</span></div>
        <div class="cc-sup-text">${esc(m.body)}</div></div>`;
    }).join('');
  }
  function sideHtml(t) {
    const p = t.user_id ? S.profiles[t.user_id] : null;
    const opt = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(Array.isArray(v) ? v[0] : v)}</option>`).join('');
    const admins = S.admins.map(a => `<option value="${a.id}" ${a.id === t.assigned_to ? 'selected' : ''}>${esc(a.name)}${a.id === getAdminId() ? ' (me)' : ''}</option>`).join('');
    const fr = t.first_response_at ? dur(new Date(t.first_response_at) - new Date(t.created_at)) : 'Not yet';
    const who = p ? `
        <div class="cc-sup-kv"><span>Account</span><b>${esc(pname(p))}${p.verified ? ' ✓' : ''}</b></div>
        <div class="cc-sup-kv"><span>Role</span><b>${esc(p.is_lecturer || p.role === 'lecturer' ? 'Lecturer' : 'Student')}</b></div>
        <div class="cc-sup-kv"><span>School</span><b>${esc([p.institution, p.campus].filter(Boolean).join(' · ') || '—')}</b></div>
        <div class="cc-sup-kv"><span>Member since</span><b>${esc(fmtDT(p.created_at).split(',')[0])}</b></div>
        ${p.account_status && p.account_status !== 'active' ? `<div class="cc-sup-kv"><span>Status</span><b style="color:var(--danger);">${esc(p.account_status)}</b></div>` : ''}`
      : `<div class="cc-sup-guest"><i class="fa-solid fa-user-slash"></i> Guest: no Peerloom account was logged in. They cannot see replies in the app, so reply by email.</div>`;
    return `
      <div class="cc-field"><label for="ccSupStatus">Status</label><select id="ccSupStatus" data-sup-field="status">${opt(STATUS, t.status)}</select></div>
      <div class="cc-field"><label for="ccSupPriority">Priority</label><select id="ccSupPriority" data-sup-field="priority">${opt(PRIORITY, t.priority)}</select></div>
      <div class="cc-field"><label for="ccSupCat">Category</label><select id="ccSupCat" data-sup-field="category">${opt(CATEGORY, t.category)}</select></div>
      <div class="cc-field"><label for="ccSupAssignee">Assigned to</label>
        <select id="ccSupAssignee" data-sup-field="assigned_to"><option value="">Unassigned</option>${admins}</select></div>
      <div class="cc-sup-card">
        <div class="cc-sup-kv"><span>From</span><b>${esc(t.name)}</b></div>
        <div class="cc-sup-kv"><span>Email</span><b><a href="mailto:${esc(t.email)}" style="color:var(--violet-500);">${esc(t.email)}</a></b></div>
        ${who}
        <div class="cc-sup-kv"><span>Opened</span><b>${esc(fmtDT(t.created_at))}</b></div>
        <div class="cc-sup-kv"><span>First reply</span><b>${esc(fr)}</b></div>
        ${t.resolved_at ? `<div class="cc-sup-kv"><span>Resolved</span><b>${esc(fmtDT(t.resolved_at))}</b></div>` : ''}
        ${t.rating ? `<div class="cc-sup-kv"><span>Rating</span><b>${'★'.repeat(t.rating)}${'☆'.repeat(5 - t.rating)}</b></div>` : ''}
        ${t.rating_comment ? `<div style="font-size:.8rem;color:var(--ink-soft);margin-top:6px;">“${esc(t.rating_comment)}”</div>` : ''}
      </div>`;
  }
  function composerHtml(t) {
    const guest = !t.user_id;
    const canned = S.canned.length ? `<select id="ccSupCanned" aria-label="Insert a saved reply"><option value="">Insert saved reply…</option>${S.canned.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select>` : '';
    return `
      <div class="cc-sup-composer">
        <textarea id="ccSupReply" rows="4" maxlength="5000" placeholder="${guest ? 'Write your reply. It is saved on the ticket, then opened as an email to send.' : 'Write a reply. The user is notified in Peerloom.'}"></textarea>
        <div class="cc-sup-composer-row">
          ${canned}
          <label class="cc-sup-check"><input type="checkbox" id="ccSupInternal"> Internal note (user never sees it)</label>
          <select id="ccSupAfter" aria-label="Ticket status after sending">
            <option value="">After sending: Waiting on user</option>
            <option value="resolved">After sending: Resolved</option>
            <option value="closed">After sending: Closed</option>
            <option value="open">After sending: Keep open</option>
          </select>
          <button class="cc-btn cc-btn-primary" id="ccSupSend"><i class="fa-solid fa-paper-plane"></i> ${guest ? 'Save &amp; email' : 'Send reply'}</button>
        </div>
      </div>`;
  }
  function renderModal() {
    const t = ticket(); const body = $('ccSupBody'); if (!t || !body) return;
    $('ccSupTitle').innerHTML = `<span style="color:var(--ink-mute);font-weight:600;">${esc(t.ticket_no)}</span> ${esc(t.subject)}`;
    body.innerHTML = `
      <div class="cc-sup-layout">
        <div class="cc-sup-main">
          <div class="cc-sup-thread" id="ccSupThread">${threadHtml()}</div>
          ${composerHtml(t)}
        </div>
        <aside class="cc-sup-side">${sideHtml(t)}</aside>
      </div>`;
    const th = $('ccSupThread'); if (th) th.scrollTop = th.scrollHeight;
  }
  async function openTicket(id) {
    S.openId = id; S.messages = [];
    openModal('ccSupModalBackdrop');
    $('ccSupBody').innerHTML = '<p style="color:var(--ink-mute);">Loading…</p>';
    try { await loadMessages(); renderModal(); } catch (e) { toast(errMsg(e), 'err'); closeModal('ccSupModalBackdrop'); }
  }

  async function send() {
    const t = ticket(); if (!t) return;
    const ta = $('ccSupReply'); const text = (ta.value || '').trim();
    if (!text) { toast('Write a message first.', 'err'); return; }
    const internal = $('ccSupInternal').checked;
    const after = $('ccSupAfter').value || null;
    const btn = $('ccSupSend'); btn.disabled = true;
    try {
      const { error } = await supabase.rpc('support_admin_reply', { p_ticket_id: t.id, p_body: text, p_internal: internal, p_new_status: after });
      if (error) throw error;
      toast(internal ? 'Internal note saved.' : (t.user_id ? 'Reply sent. The user has been notified.' : 'Reply saved.'), 'ok');
      const guestEmail = !t.user_id && !internal;
      ta.value = '';
      await Promise.all([loadTickets(), loadMessages()]);
      render(); renderModal();
      if (guestEmail) {
        const subj = encodeURIComponent(`Re: [${t.ticket_no}] ${t.subject}`);
        const mail = encodeURIComponent(`Hi ${t.name.split(' ')[0]},\n\n${text}\n\nPeerloom Support`);
        window.location.href = `mailto:${t.email}?subject=${subj}&body=${mail}`;
      }
    } catch (e) { toast(errMsg(e), 'err'); btn.disabled = false; }
  }
  async function changeField(field, value) {
    const t = ticket(); if (!t) return;
    const args = { p_ticket_id: t.id };
    if (field === 'assigned_to') { args.p_set_assignee = true; args.p_assigned_to = value || null; }
    else args['p_' + field] = value;
    try {
      const { error } = await supabase.rpc('support_admin_update', args);
      if (error) throw error;
      await Promise.all([loadTickets(), loadMessages()]);
      render(); const keep = $('ccSupReply') ? $('ccSupReply').value : ''; renderModal(); if (keep && $('ccSupReply')) $('ccSupReply').value = keep;
      toast('Ticket updated.', 'ok');
    } catch (e) { toast(errMsg(e), 'err'); renderModal(); }
  }

  // ---------------- saved replies ----------------
  function renderCanned() {
    const list = $('ccSupCannedList'); if (!list) return;
    list.innerHTML = S.canned.length ? S.canned.map(c => `
      <div class="cc-sup-card" style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;"><strong>${esc(c.title)}</strong>
          <button class="cc-btn cc-btn-danger" data-sup-canned-del="${c.id}" style="padding:4px 10px;">Delete</button></div>
        <div style="font-size:.84rem;color:var(--ink-soft);margin-top:6px;white-space:pre-wrap;">${esc(c.body)}</div></div>`).join('')
      : '<p style="color:var(--ink-mute);">No saved replies yet.</p>';
  }
  async function addCanned() {
    const title = $('ccSupCannedTitle').value.trim(), body = $('ccSupCannedBody').value.trim();
    if (!title || !body) { toast('Add a title and the reply text.', 'err'); return; }
    const { error } = await supabase.from('support_canned_replies').insert({ title, body, created_by: getAdminId() });
    if (error) { toast(errMsg(error), 'err'); return; }
    $('ccSupCannedTitle').value = ''; $('ccSupCannedBody').value = '';
    await loadCanned(); renderCanned(); toast('Saved reply added.', 'ok');
  }
  async function delCanned(id) {
    const { error } = await supabase.from('support_canned_replies').delete().eq('id', id);
    if (error) { toast(errMsg(error), 'err'); return; }
    await loadCanned(); renderCanned();
  }

  // ---------------- realtime ----------------
  let rt = null;
  function onRealtime(payload) {
    if (payload && payload.eventType === 'INSERT' && payload.table === 'support_tickets' && payload.new) {
      toast(`New support ticket ${payload.new.ticket_no}: ${payload.new.subject}`, 'info');
    }
    clearTimeout(rt);
    rt = setTimeout(async () => {
      try {
        await loadTickets();
        if (S.openId && $('ccSupModalBackdrop')?.classList.contains('open')) {
          await loadMessages();
          const th = $('ccSupThread'); if (th) { th.innerHTML = threadHtml(); th.scrollTop = th.scrollHeight; }
        }
      } catch (e) { /* keep the last good data */ }
      render();
      if (typeof S.onChange === 'function') S.onChange();
    }, 350);
  }

  // ---------------- wiring ----------------
  function init() {
    document.addEventListener('click', e => {
      const f = e.target.closest('[data-sup-status]');
      if (f) { S.status = f.dataset.supStatus; render(); return; }
      const row = e.target.closest('[data-sup-open]'); if (row) { openTicket(row.dataset.supOpen); return; }
      if (e.target.closest('#ccSupSend')) { send(); return; }
      const del = e.target.closest('[data-sup-canned-del]'); if (del) { delCanned(del.dataset.supCannedDel); return; }
      if (e.target.closest('#ccSupCannedOpen')) { renderCanned(); openModal('ccSupCannedBackdrop'); return; }
      if (e.target.closest('#ccSupCannedAdd')) { addCanned(); return; }
    });
    document.addEventListener('keydown', e => {
      if ((e.key === 'Enter') && e.target.closest?.('[data-sup-open]')) { openTicket(e.target.closest('[data-sup-open]').dataset.supOpen); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.id === 'ccSupReply') { send(); }
    });
    document.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'ccSupScope') { S.scope = t.value; render(); }
      else if (t.id === 'ccSupCategory') { S.category = t.value; render(); }
      else if (t.id === 'ccSupPriorityFilter') { S.priority = t.value; render(); }
      else if (t.dataset && t.dataset.supField) changeField(t.dataset.supField, t.value);
      else if (t.id === 'ccSupCanned' && t.value) {
        const c = S.canned.find(x => x.id === t.value), tk = ticket(), ta = $('ccSupReply');
        if (c && ta) { const first = (tk?.name || '').split(' ')[0] || 'there'; ta.value = (ta.value ? ta.value + '\n\n' : '') + c.body.replace(/^Hi,/, `Hi ${first},`); ta.focus(); }
        t.value = '';
      }
    });
    $('ccSupSearch')?.addEventListener('input', e => { S.q = e.target.value; renderTable(); });
  }

  return {
    load, render, init, onRealtime,
    get tickets() { return S.tickets; },
    set onChange(fn) { S.onChange = fn; },
  };
}