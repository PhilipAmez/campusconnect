// ============================================================
// COMMAND CENTER: ADVERTISEMENTS (admin side)
// Real data only, straight from the ad_* tables. Every status change
// goes through the admin-checked, audit-logged database functions
// (ad_campaign_set_status, ad_advertiser_set_status, ad_creative_set_status,
// ad_settings_update). Nothing here records a payment: a campaign with a
// price only becomes active once the payment provider has written
// SUCCESS transactions for the full amount (the database enforces this).
// ============================================================

export function createAdsModule(ctx) {
  const { supabase, toast, escapeHtml, formatDate, reasonAction, confirmAction, openModal, closeModal, getAdminId } = ctx;

  const ads = {
    loaded: false,
    settings: null,
    advertisers: [], campaigns: [], creatives: [], placements: [], transactions: [],
    impressionsByCampaign: {}, clicksByCampaign: {},
    totalImpressions: 0, totalClicks: 0,
    tab: 'campaigns',
    campaignFilter: 'all',
  };

  const money = (n, cur = 'GHS') => `${cur} ${Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const num = n => Number(n || 0).toLocaleString('en-GB');
  const $ = id => document.getElementById(id);
  const isHttps = v => { try { return new URL(v).protocol === 'https:'; } catch { return false; } };
  const IMG_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const MAX_IMG = 5 * 1024 * 1024;
  function checkImage(file) {
    if (!file) return 'Choose an image file.';
    if (!IMG_TYPES[file.type]) return 'The image must be a JPG, PNG or WebP file.';
    if (file.size > MAX_IMG) return 'The image is larger than 5 MB.';
    return null;
  }
  async function uploadImage(file) {
    const name = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)) + '.' + IMG_TYPES[file.type];
    const path = getAdminId() + '/' + name;
    const { error } = await supabase.storage.from('ad-creatives').upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' });
    if (error) throw error;
    const { data } = supabase.storage.from('ad-creatives').getPublicUrl(path);
    if (!data || !isHttps(data.publicUrl)) throw new Error('Could not get a public link for the image');
    return data.publicUrl;
  }
  function wirePreview() {
    const f = $('adfFile'), p = $('adfPreview'); if (!f || !p) return;
    f.addEventListener('change', () => {
      const file = f.files && f.files[0];
      if (file && IMG_TYPES[file.type]) { p.src = URL.createObjectURL(file); p.style.display = 'block'; } else { p.style.display = 'none'; p.removeAttribute('src'); }
    });
  }
  const errMsg = e => (e && e.message) ? e.message.replace(/^.*?exception:\s*/i, '') : 'Something went wrong';

  // ---------------- data ----------------
  async function load() {
    const q = (t, cols = '*', order = 'created_at') => supabase.from(t).select(cols).order(order, { ascending: false });
    const [adv, camp, cre, pl, set, tx, imp, clk] = await Promise.all([
      q('ad_advertisers'), q('ad_campaigns'), q('ad_creatives'),
      supabase.from('ad_placements').select('*').order('name'),
      supabase.from('ad_settings').select('*').eq('id', 1).maybeSingle(),
      q('ad_transactions'),
      supabase.from('ad_impression_events').select('campaign_id').eq('valid', true).limit(50000),
      supabase.from('ad_click_events').select('campaign_id').eq('valid', true).limit(50000),
    ]);
    const firstErr = [adv, camp, cre, pl, set, tx, imp, clk].find(r => r.error);
    if (firstErr) throw firstErr.error;
    ads.advertisers = adv.data || []; ads.campaigns = camp.data || []; ads.creatives = cre.data || [];
    ads.placements = pl.data || []; ads.settings = set.data; ads.transactions = tx.data || [];
    ads.impressionsByCampaign = {}; ads.clicksByCampaign = {};
    (imp.data || []).forEach(r => { ads.impressionsByCampaign[r.campaign_id] = (ads.impressionsByCampaign[r.campaign_id] || 0) + 1; });
    (clk.data || []).forEach(r => { ads.clicksByCampaign[r.campaign_id] = (ads.clicksByCampaign[r.campaign_id] || 0) + 1; });
    ads.totalImpressions = (imp.data || []).length; ads.totalClicks = (clk.data || []).length;
    ads.loaded = true;
  }
  async function reload() {
    try { await load(); } catch (e) { toast('Could not refresh ads: ' + errMsg(e), 'err'); }
    render();
  }

  const advName = id => ads.advertisers.find(a => a.id === id)?.business_name || 'Unknown advertiser';
  const placeName = id => ads.placements.find(p => p.id === id)?.name || '—';
  const funded = id => ads.transactions.filter(t => t.campaign_id === id && t.status === 'SUCCESS').reduce((s, t) => s + Number(t.amount || 0), 0);

  // ---------------- badges ----------------
  const CAMPAIGN_BADGE = {
    draft: ['mute', 'Draft'], pending_review: ['warn', 'Needs review'], approved: ['info', 'Approved'],
    scheduled: ['info', 'Scheduled'], active: ['ok', 'Active'], paused: ['warn', 'Paused'],
    rejected: ['danger', 'Rejected'], completed: ['mute', 'Completed'], terminated: ['danger', 'Terminated'],
  };
  const ADV_BADGE = {
    pending_verification: ['warn', 'Awaiting verification'], active: ['ok', 'Active'],
    suspended: ['danger', 'Suspended'], rejected: ['danger', 'Rejected'], closed: ['mute', 'Closed'],
  };
  const CRE_BADGE = { pending: ['warn', 'Pending'], approved: ['ok', 'Approved'], rejected: ['danger', 'Rejected'] };
  const badge = (map, key) => { const [c, l] = map[key] || ['mute', key || '—']; return `<span class="cc-badge cc-badge-${c}">${escapeHtml(l)}</span>`; };

  // ---------------- stats + controls ----------------
  function renderStats() {
    const grid = $('ccAdsStatGrid'); if (!grid) return;
    const live = ads.campaigns.filter(c => c.status === 'active').length;
    const review = ads.campaigns.filter(c => c.status === 'pending_review').length + ads.creatives.filter(c => c.status === 'pending').length;
    const revenue = ads.transactions.filter(t => t.status === 'SUCCESS').reduce((s, t) => s + Number(t.amount || 0), 0);
    const ctr = ads.totalImpressions ? ((ads.totalClicks / ads.totalImpressions) * 100).toFixed(2) + '%' : '—';
    const cards = [
      ['fa-building', '#7c3aed', `${ads.advertisers.filter(a => a.status === 'active').length} / ${ads.advertisers.length}`, 'Active advertisers'],
      ['fa-bullhorn', '#10b981', num(live), 'Live campaigns'],
      ['fa-hourglass-half', '#f59e0b', num(review), 'Waiting for review'],
      ['fa-eye', '#3b82f6', num(ads.totalImpressions), 'Valid impressions'],
      ['fa-arrow-pointer', '#ec4899', `${num(ads.totalClicks)} <small style="font-size:.8rem;color:var(--ink-mute);font-weight:600">CTR ${ctr}</small>`, 'Valid clicks'],
      ['fa-coins', '#14b8a6', money(revenue), 'Collected from advertisers'],
    ];
    grid.innerHTML = cards.map(c => `
      <div class="cc-stat-card"><div class="cc-stat-top"><div class="cc-stat-icn" style="background:${c[1]}1f;color:${c[1]};"><i class="fa-solid ${c[0]}"></i></div></div>
      <div class="cc-stat-value">${c[2]}</div><div class="cc-stat-label">${c[3]}</div></div>`).join('');
  }

  function renderControls() {
    const el = $('ccAdsControls'); if (!el) return;
    const s = ads.settings;
    if (!s) { el.innerHTML = `<p style="color:var(--ink-mute);margin:0;">Ad settings row not found.</p>`; return; }
    const delivering = s.global_enabled && !s.emergency_stop;
    el.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;">
        <div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <strong style="font-size:1rem;">Ads are ${delivering ? 'live for users' : 'OFF for everyone'}</strong>
            ${s.emergency_stop ? '<span class="cc-badge cc-badge-danger">Emergency stop on</span>' : ''}
            ${s.moderation_required ? '<span class="cc-badge cc-badge-mute">Moderation required</span>' : ''}
            ${s.full_funding_required ? '<span class="cc-badge cc-badge-mute">Full payment required</span>' : ''}
          </div>
          <p style="margin:6px 0 0;font-size:.8rem;color:var(--ink-mute);">Nothing is shown to students or lecturers unless this switch is on, the campaign is active, its advertiser is verified, and a creative is approved.</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="cc-btn ${s.global_enabled ? 'cc-btn-ghost' : 'cc-btn-primary'}" id="ccAdsToggleGlobal"><i class="fa-solid fa-power-off"></i> ${s.global_enabled ? 'Turn ads off' : 'Turn ads on'}</button>
          <button class="cc-btn ${s.emergency_stop ? 'cc-btn-primary' : 'cc-btn-danger'}" id="ccAdsToggleStop"><i class="fa-solid fa-hand"></i> ${s.emergency_stop ? 'Clear emergency stop' : 'Emergency stop'}</button>
        </div>
      </div>`;
    $('ccAdsToggleGlobal').addEventListener('click', () => changeSettings({ global_enabled: !s.global_enabled }));
    $('ccAdsToggleStop').addEventListener('click', () => changeSettings({ emergency_stop: !s.emergency_stop }));
  }

  function changeSettings(patch) {
    const next = Object.assign({ global_enabled: ads.settings.global_enabled, emergency_stop: ads.settings.emergency_stop }, patch);
    const what = 'emergency_stop' in patch ? (next.emergency_stop ? 'Turn on the emergency stop' : 'Clear the emergency stop') : (next.global_enabled ? 'Turn ads on for all users' : 'Turn ads off for all users');
    reasonAction({
      title: what, subtitle: 'This is recorded in the audit log with your name.', label: 'Reason',
      placeholder: 'Why are you making this change?', icon: 'fa-power-off', policyRequired: false,
      run: async (reason) => {
        const { error } = await supabase.rpc('ad_settings_update', { p_global_enabled: next.global_enabled, p_emergency_stop: next.emergency_stop, p_reason: reason });
        if (error) { toast(errMsg(error), 'err'); return; }
        toast('Ad settings updated', 'ok'); await reload();
      },
    });
  }

  // ---------------- tables ----------------
  function setTab(t) { ads.tab = t; render(); }

  function renderTabs() {
    const el = $('ccAdsTabs'); if (!el) return;
    const tabs = [['campaigns', 'Campaigns', ads.campaigns.length], ['advertisers', 'Advertisers', ads.advertisers.length], ['creatives', 'Creatives', ads.creatives.length], ['placements', 'Placements', ads.placements.length]];
    el.innerHTML = tabs.map(([k, l, n]) => `<button class="cc-filter-pill ${ads.tab === k ? 'active' : ''}" data-ads-tab="${k}">${l} (${n})</button>`).join('');
    el.querySelectorAll('[data-ads-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.adsTab)));
    const f = $('ccAdsFilterWrap');
    if (f) {
      f.style.display = ads.tab === 'campaigns' ? '' : 'none';
      const sel = $('ccAdsCampaignFilter');
      if (sel && !sel.dataset.bound) {
        sel.dataset.bound = '1';
        sel.addEventListener('change', () => { ads.campaignFilter = sel.value; renderTable(); });
      }
    }
  }

  const empty = (cols, text) => `<tr><td colspan="${cols}" style="text-align:center;color:var(--ink-mute);padding:24px;">${text}</td></tr>`;
  const btn = (attr, id, label, cls = 'cc-btn-ghost') => `<button class="cc-btn ${cls} cc-btn-sm" ${attr}="${id}">${label}</button>`;

  function renderTable() {
    const head = $('ccAdsThead'), body = $('ccAdsTbody'); if (!head || !body) return;
    if (ads.tab === 'campaigns') {
      head.innerHTML = '<tr><th>Campaign</th><th>Advertiser</th><th>Status</th><th>Runs</th><th>Delivery</th><th>Payment</th><th></th></tr>';
      const rows = ads.campaigns.filter(c => ads.campaignFilter === 'all' || c.status === ads.campaignFilter);
      body.innerHTML = rows.length ? rows.map(c => {
        const imp = ads.impressionsByCampaign[c.id] || 0, clk = ads.clicksByCampaign[c.id] || 0;
        const paid = funded(c.id), price = Number(c.package_price || 0);
        const pay = price === 0 ? '<span class="cc-badge cc-badge-mute">Free</span>' : paid >= price ? '<span class="cc-badge cc-badge-ok">Paid in full</span>' : `<span class="cc-badge cc-badge-warn">${money(paid, c.currency)} of ${money(price, c.currency)}</span>`;
        const a = [];
        if (c.status === 'draft') a.push(btn('data-camp-submit', c.id, 'Submit for review', 'cc-btn-primary'));
        if (c.status === 'pending_review') { a.push(btn('data-camp-act', c.id + '|approve', 'Approve', 'cc-btn-primary')); a.push(btn('data-camp-act', c.id + '|request_edits', 'Request edits')); a.push(btn('data-camp-act', c.id + '|reject', 'Reject', 'cc-btn-danger')); }
        if (c.status === 'approved') { a.push(btn('data-camp-act', c.id + '|activate', 'Activate', 'cc-btn-primary')); a.push(btn('data-camp-act', c.id + '|reject', 'Reject', 'cc-btn-danger')); }
        if (c.status === 'active') { a.push(btn('data-camp-act', c.id + '|pause', 'Pause')); a.push(btn('data-camp-act', c.id + '|terminate', 'Terminate', 'cc-btn-danger')); }
        if (c.status === 'paused') { a.push(btn('data-camp-act', c.id + '|resume', 'Resume', 'cc-btn-primary')); a.push(btn('data-camp-act', c.id + '|terminate', 'Terminate', 'cc-btn-danger')); }
        if (c.status === 'scheduled') { a.push(btn('data-camp-act', c.id + '|pause', 'Pause')); a.push(btn('data-camp-act', c.id + '|terminate', 'Terminate', 'cc-btn-danger')); }
        const why = c.status === 'rejected' && c.rejection_reason ? `<div style="font-size:.72rem;color:var(--danger);margin-top:3px;">${escapeHtml(c.rejection_reason)}</div>` : '';
        return `<tr><td><strong>${escapeHtml(c.name)}</strong><div style="font-size:.76rem;color:var(--ink-mute);">${escapeHtml(c.headline)} · ${escapeHtml(placeName(c.placement_id))}</div></td>
          <td>${escapeHtml(advName(c.advertiser_id))}</td><td>${badge(CAMPAIGN_BADGE, c.status)}${why}</td>
          <td style="font-size:.78rem;">${c.start_at ? formatDate(c.start_at) : 'Any time'} → ${c.end_at ? formatDate(c.end_at) : 'open'}</td>
          <td style="font-size:.78rem;">${num(imp)} views · ${num(clk)} clicks</td><td>${pay}</td>
          <td style="white-space:nowrap;display:flex;gap:6px;flex-wrap:wrap;">${a.join('')}</td></tr>`;
      }).join('') : empty(7, ads.campaigns.length ? 'No campaigns with this status.' : 'No campaigns yet. Create an advertiser first, then a campaign.');
    } else if (ads.tab === 'advertisers') {
      head.innerHTML = '<tr><th>Business</th><th>Contact</th><th>Status</th><th>Added</th><th></th></tr>';
      body.innerHTML = ads.advertisers.length ? ads.advertisers.map(a => {
        const acts = [];
        if (a.status === 'pending_verification') { acts.push(btn('data-adv-act', a.id + '|active', 'Verify', 'cc-btn-primary')); acts.push(btn('data-adv-act', a.id + '|rejected', 'Reject', 'cc-btn-danger')); }
        if (a.status === 'active') acts.push(btn('data-adv-act', a.id + '|suspended', 'Suspend', 'cc-btn-danger'));
        if (a.status === 'suspended') acts.push(btn('data-adv-act', a.id + '|active', 'Reinstate', 'cc-btn-primary'));
        if (a.status !== 'closed') acts.push(btn('data-adv-act', a.id + '|closed', 'Close'));
        const why = (a.status === 'suspended' && a.suspended_reason) || (a.status === 'rejected' && a.rejection_reason);
        return `<tr><td><strong>${escapeHtml(a.business_name)}</strong></td>
          <td style="font-size:.8rem;">${escapeHtml(a.contact_name || '')}<div style="color:var(--ink-mute);">${escapeHtml(a.contact_email)}${a.contact_phone ? ' · ' + escapeHtml(a.contact_phone) : ''}</div></td>
          <td>${badge(ADV_BADGE, a.status)}${why ? `<div style="font-size:.72rem;color:var(--danger);margin-top:3px;">${escapeHtml(why)}</div>` : ''}</td>
          <td>${formatDate(a.created_at)}</td><td style="display:flex;gap:6px;flex-wrap:wrap;">${acts.join('')}</td></tr>`;
      }).join('') : empty(5, 'No advertisers yet. Use “New advertiser” to add the first one.');
    } else if (ads.tab === 'creatives') {
      head.innerHTML = '<tr><th>Creative</th><th>Campaign</th><th>Status</th><th></th></tr>';
      body.innerHTML = ads.creatives.length ? ads.creatives.map(c => {
        const camp = ads.campaigns.find(x => x.id === c.campaign_id);
        const thumb = c.asset_type === 'image' && isHttps(c.asset_url)
          ? `<img src="${escapeHtml(c.asset_url)}" alt="${escapeHtml(c.alt_text || '')}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--border);" referrerpolicy="no-referrer" loading="lazy">` : '';
        const acts = [];
        if (c.status !== 'approved') acts.push(btn('data-cre-act', c.id + '|approved', 'Approve', 'cc-btn-primary'));
        if (c.status !== 'rejected') acts.push(btn('data-cre-act', c.id + '|rejected', 'Reject', 'cc-btn-danger'));
        acts.push(btn('data-cre-replace', c.id, 'Replace image'));
        return `<tr><td><div style="display:flex;gap:10px;align-items:center;">${thumb}<div><a href="${escapeHtml(isHttps(c.asset_url) ? c.asset_url : '#')}" target="_blank" rel="noopener noreferrer" style="font-size:.8rem;">Open file</a><div style="font-size:.72rem;color:var(--ink-mute);">${escapeHtml(c.alt_text || 'No description')}</div></div></div></td>
          <td>${escapeHtml(camp ? camp.name : '—')}</td><td>${badge(CRE_BADGE, c.status)}${c.rejection_reason ? `<div style="font-size:.72rem;color:var(--danger);margin-top:3px;">${escapeHtml(c.rejection_reason)}</div>` : ''}</td>
          <td style="display:flex;gap:6px;flex-wrap:wrap;">${acts.join('')}</td></tr>`;
      }).join('') : empty(4, 'No creatives yet. They are added with each campaign.');
    } else {
      head.innerHTML = '<tr><th>Placement</th><th>Slug</th><th>Status</th><th>Recommended size</th><th>Per-user daily cap</th></tr>';
      body.innerHTML = ads.placements.length ? ads.placements.map(p => `<tr><td><strong>${escapeHtml(p.name)}</strong><div style="font-size:.76rem;color:var(--ink-mute);">${escapeHtml(p.description || '')}</div></td>
        <td><code>${escapeHtml(p.slug)}</code></td><td>${p.status === 'enabled' ? '<span class="cc-badge cc-badge-ok">Enabled</span>' : '<span class="cc-badge cc-badge-mute">Disabled</span>'}</td>
        <td>${p.recommended_width && p.recommended_height ? p.recommended_width + ' × ' + p.recommended_height : '—'}</td><td>${p.frequency_cap_per_user_per_day}</td></tr>`).join('') : empty(5, 'No placements configured.');
    }
    wireTable(body);
  }

  function wireTable(body) {
    body.querySelectorAll('[data-camp-submit]').forEach(b => b.addEventListener('click', () => submitForReview(b.dataset.campSubmit)));
    body.querySelectorAll('[data-camp-act]').forEach(b => b.addEventListener('click', () => { const [id, act] = b.dataset.campAct.split('|'); campaignAction(id, act); }));
    body.querySelectorAll('[data-adv-act]').forEach(b => b.addEventListener('click', () => { const [id, st] = b.dataset.advAct.split('|'); advertiserAction(id, st); }));
    body.querySelectorAll('[data-cre-replace]').forEach(b => b.addEventListener('click', () => openForm('replace', b.dataset.creReplace)));
    body.querySelectorAll('[data-cre-act]').forEach(b => b.addEventListener('click', () => { const [id, st] = b.dataset.creAct.split('|'); creativeAction(id, st); }));
  }

  // ---------------- actions ----------------
  async function submitForReview(id) {
    const { error } = await supabase.from('ad_campaigns').update({ status: 'pending_review' }).eq('id', id);
    if (error) { toast(errMsg(error), 'err'); return; }
    toast('Submitted for review', 'ok'); await reload();
  }

  const CAMPAIGN_MAP = {
    approve:       { to: 'approved',   action: 'approve',       reason: false, title: 'Approve this campaign?', body: 'It becomes approved. It still needs a verified advertiser, an approved creative and (if it has a price) full payment before it can go live.', icon: 'fa-circle-check' },
    activate:      { to: 'active',     action: 'resume',        reason: false, title: 'Activate this campaign?', body: 'It will start showing to users if ads are turned on and all checks pass. If payment is missing the system will refuse.', icon: 'fa-play' },
    resume:        { to: 'active',     action: 'resume',        reason: false, title: 'Resume this campaign?', body: 'It goes back to being eligible to show.', icon: 'fa-play' },
    pause:         { to: 'paused',     action: 'pause',         reason: false, title: 'Pause this campaign?', body: 'It stops showing straight away and can be resumed later.', icon: 'fa-pause' },
    request_edits: { to: 'draft',      action: 'request_edits', reason: true,  title: 'Ask for changes', body: 'The campaign goes back to draft.', icon: 'fa-pen' },
    reject:        { to: 'rejected',   action: 'reject',        reason: true,  title: 'Reject this campaign', body: 'Give a clear reason. The advertiser can fix it and resubmit.', icon: 'fa-ban' },
    terminate:     { to: 'terminated', action: 'terminate',     reason: true,  title: 'Terminate this campaign', body: 'This ends the campaign permanently and cannot be undone.', icon: 'fa-circle-stop' },
  };
  function campaignAction(id, key) {
    const m = CAMPAIGN_MAP[key]; if (!m) return;
    const run = async (reason) => {
      const { error } = await supabase.rpc('ad_campaign_set_status', { p_campaign_id: id, p_new_status: m.to, p_action: m.action, p_reason: reason || null });
      if (error) { toast(errMsg(error), 'err'); return; }
      toast('Campaign updated', 'ok'); await reload();
    };
    if (m.reason) reasonAction({ title: m.title, subtitle: m.body, label: 'Reason', placeholder: 'What should be changed or why is this being ended?', icon: m.icon, policyRequired: false, run });
    else confirmAction({ title: m.title, body: m.body, icon: m.icon, danger: false, run: () => run(null) });
  }

  function advertiserAction(id, status) {
    const needsReason = ['suspended', 'rejected', 'closed'].includes(status);
    const titles = { active: 'Mark advertiser as verified', suspended: 'Suspend this advertiser', rejected: 'Reject this advertiser', closed: 'Close this advertiser' };
    const run = async (reason) => {
      const { error } = await supabase.rpc('ad_advertiser_set_status', { p_advertiser_id: id, p_new_status: status, p_reason: reason || null });
      if (error) { toast(errMsg(error), 'err'); return; }
      toast('Advertiser updated', 'ok'); await reload();
    };
    if (needsReason) reasonAction({ title: titles[status], subtitle: 'This is kept in the audit log.', label: 'Reason', placeholder: 'Why?', icon: 'fa-building', policyRequired: false, run });
    else confirmAction({ title: titles[status], body: 'Only verify a business after checking who they are. Their campaigns can then be approved.', icon: 'fa-circle-check', danger: false, run: () => run(null) });
  }

  function creativeAction(id, status) {
    const run = async (reason) => {
      const { error } = await supabase.rpc('ad_creative_set_status', { p_creative_id: id, p_new_status: status, p_reason: reason || null });
      if (error) { toast(errMsg(error), 'err'); return; }
      toast('Creative updated', 'ok'); await reload();
    };
    if (status === 'rejected') reasonAction({ title: 'Reject this creative', subtitle: 'Say what is wrong with the image or text.', label: 'Reason', placeholder: 'e.g. Image is too blurry, or contains content we do not allow.', icon: 'fa-ban', policyRequired: false, run });
    else confirmAction({ title: 'Approve this creative?', body: 'Check the image carefully. Once approved it can be shown to students and lecturers.', icon: 'fa-image', danger: false, run: () => run(null) });
  }

  // ---------------- create forms ----------------
  function openForm(kind, id) {
    ads.replaceId = id || null;
    const body = $('ccAdFormBody'), title = $('ccAdFormTitle'), err = $('ccAdFormError');
    err.style.display = 'none'; err.textContent = '';
    if (kind === 'advertiser') {
      title.textContent = 'New advertiser';
      body.innerHTML = `
        <div class="cc-field"><label for="adfBusiness">Business name *</label><input id="adfBusiness" maxlength="120"></div>
        <div class="cc-field"><label for="adfContact">Contact person</label><input id="adfContact" maxlength="120"></div>
        <div class="cc-field"><label for="adfEmail">Contact email *</label><input id="adfEmail" type="email" maxlength="160"></div>
        <div class="cc-field"><label for="adfPhone">Contact phone</label><input id="adfPhone" maxlength="40"></div>
        <p style="font-size:.76rem;color:var(--ink-mute);margin:0;">New advertisers start as “awaiting verification”. Nothing of theirs can run until you verify them.</p>`;
      ads.formKind = 'advertiser';
    } else if (kind === 'replace') {
      title.textContent = 'Replace image';
      body.innerHTML = `
        <div class="cc-field"><label for="adfFile">New image * (JPG, PNG or WebP, up to 5 MB)</label><input id="adfFile" type="file" accept="image/jpeg,image/png,image/webp"><img id="adfPreview" alt="" style="display:none;margin-top:8px;max-width:140px;max-height:140px;border-radius:8px;border:1px solid var(--border);"></div>
        <div class="cc-field"><label for="adfAlt">Image description (for screen readers) *</label><input id="adfAlt" maxlength="160" value="${escapeHtml(ads.creatives.find(c => c.id === ads.replaceId)?.alt_text || '')}"></div>
        <p style="font-size:.76rem;color:var(--ink-mute);margin:0;">The new image goes back to “pending” and must be approved again before it can be shown.</p>`;
      ads.formKind = 'replace';
    } else {
      const verified = ads.advertisers.filter(a => a.status === 'active');
      if (!verified.length) { toast('Add and verify an advertiser first.', 'info'); return; }
      const enabled = ads.placements.filter(p => p.status === 'enabled');
      title.textContent = 'New campaign';
      body.innerHTML = `
        <div class="cc-field"><label for="adfAdv">Advertiser *</label><select id="adfAdv">${verified.map(a => `<option value="${a.id}">${escapeHtml(a.business_name)}</option>`).join('')}</select></div>
        <div class="cc-field"><label for="adfPlace">Where it shows *</label><select id="adfPlace">${enabled.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</select></div>
        <div class="cc-field"><label for="adfName">Campaign name (internal) *</label><input id="adfName" maxlength="120"></div>
        <div class="cc-field"><label for="adfHead">Headline shown to users *</label><input id="adfHead" maxlength="90"></div>
        <div class="cc-field"><label for="adfBodyTxt">Short text</label><textarea id="adfBodyTxt" rows="2" maxlength="240"></textarea></div>
        <div class="cc-field"><label for="adfCta">Button label *</label><input id="adfCta" value="Learn More" maxlength="24"></div>
        <div class="cc-field"><label for="adfUrl">Where the button goes (https only) *</label><input id="adfUrl" placeholder="https://"></div>
        <div class="cc-field"><label for="adfFile">Image * (JPG, PNG or WebP, up to 5 MB; square 1080 × 1080 works best)</label><input id="adfFile" type="file" accept="image/jpeg,image/png,image/webp"><img id="adfPreview" alt="" style="display:none;margin-top:8px;max-width:140px;max-height:140px;border-radius:8px;border:1px solid var(--border);"></div>
        <div class="cc-field"><label for="adfAlt">Image description (for screen readers) *</label><input id="adfAlt" maxlength="160"></div>
        <div class="cc-field"><label for="adfStart">Starts</label><input id="adfStart" type="datetime-local"></div>
        <div class="cc-field"><label for="adfEnd">Ends</label><input id="adfEnd" type="datetime-local"></div>
        <div class="cc-field"><label for="adfPrice">Package price (GHS)</label><input id="adfPrice" type="number" min="0" step="0.01" value="0"></div>
        <div class="cc-field"><label for="adfMaxImp">Maximum views (optional)</label><input id="adfMaxImp" type="number" min="1" step="1"></div>
        <div class="cc-field"><label for="adfMaxClk">Maximum clicks (optional)</label><input id="adfMaxClk" type="number" min="1" step="1"></div>
        <p style="font-size:.76rem;color:var(--ink-mute);margin:0;">The campaign is saved as a draft. A price above zero must be paid in full by the advertiser before it can go live; this page never marks anything as paid.</p>`;
      ads.formKind = 'campaign';
    }
    wirePreview();
    openModal('ccAdFormBackdrop');
  }

  async function saveForm() {
    const err = $('ccAdFormError'), btnEl = $('ccAdFormSave');
    const fail = m => { err.textContent = m; err.style.display = 'block'; };
    err.style.display = 'none';
    const v = id => ($(id)?.value || '').trim();
    const adminId = getAdminId();
    btnEl.disabled = true;
    try {
      if (ads.formKind === 'advertiser') {
        if (!v('adfBusiness')) return fail('Business name is required.');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v('adfEmail'))) return fail('Enter a valid contact email.');
        const { error } = await supabase.from('ad_advertisers').insert({ business_name: v('adfBusiness'), contact_name: v('adfContact') || null, contact_email: v('adfEmail'), contact_phone: v('adfPhone') || null, created_by: adminId });
        if (error) return fail(errMsg(error));
        toast('Advertiser added', 'ok');
      } else if (ads.formKind === 'replace') {
        const imgProblem = checkImage($('adfFile')?.files?.[0]);
        if (imgProblem) return fail(imgProblem);
        if (!v('adfAlt')) return fail('Describe the image for screen readers.');
        let imageUrl;
        try { imageUrl = await uploadImage($('adfFile').files[0]); } catch (e) { return fail('Image upload failed: ' + errMsg(e)); }
        const { error } = await supabase.from('ad_creatives').update({ asset_url: imageUrl, alt_text: v('adfAlt'), status: 'pending', rejection_reason: null }).eq('id', ads.replaceId);
        if (error) return fail(errMsg(error));
        toast('Image replaced. Approve it again to put it live.', 'ok');
      } else {
        if (!v('adfName') || !v('adfHead') || !v('adfCta')) return fail('Name, headline and button label are required.');
        if (!isHttps(v('adfUrl'))) return fail('The button link must start with https://');
        const imgProblem = checkImage($('adfFile')?.files?.[0]);
        if (imgProblem) return fail(imgProblem);
        if (!v('adfAlt')) return fail('Describe the image for screen readers.');
        const s = v('adfStart') ? new Date(v('adfStart')) : null, e = v('adfEnd') ? new Date(v('adfEnd')) : null;
        if (s && e && e <= s) return fail('The end must be after the start.');
        const price = Number(v('adfPrice') || 0);
        if (!(price >= 0)) return fail('Price cannot be negative.');
        const placement = ads.placements.find(p => p.id === v('adfPlace'));
        let imageUrl;
        try { imageUrl = await uploadImage($('adfFile').files[0]); } catch (e) { return fail('Image upload failed: ' + errMsg(e)); }
        const { data: camp, error } = await supabase.from('ad_campaigns').insert({
          advertiser_id: v('adfAdv'), placement_id: v('adfPlace') || null, name: v('adfName'), headline: v('adfHead'), body: v('adfBodyTxt') || null,
          cta_label: v('adfCta'), destination_url: v('adfUrl'), objective: (placement?.eligible_objectives || ['awareness'])[0],
          start_at: s ? s.toISOString() : null, end_at: e ? e.toISOString() : null, package_price: price, currency: 'GHS',
          max_impressions: v('adfMaxImp') ? parseInt(v('adfMaxImp'), 10) : null, max_clicks: v('adfMaxClk') ? parseInt(v('adfMaxClk'), 10) : null,
          created_by: adminId,
        }).select('id').single();
        if (error) return fail(errMsg(error));
        const { error: cErr } = await supabase.from('ad_creatives').insert({ campaign_id: camp.id, asset_url: imageUrl, asset_type: 'image', alt_text: v('adfAlt') });
        if (cErr) { toast('Campaign saved, but the image failed: ' + errMsg(cErr), 'err'); } else { toast('Campaign saved as a draft', 'ok'); }
      }
      closeModal('ccAdFormBackdrop');
      await reload();
    } finally { btnEl.disabled = false; }
  }

  // ---------------- render + init ----------------
  function render() {
    if (!ads.loaded) {
      const c = $('ccAdsControls'); if (c) c.innerHTML = `<p style="color:var(--ink-mute);margin:0;">Ad data could not be loaded. Reload the page to try again.</p>`;
      return;
    }
    renderStats(); renderControls(); renderTabs(); renderTable();
  }
  function init() {
    $('ccAdsNewAdvertiser')?.addEventListener('click', () => openForm('advertiser'));
    $('ccAdsNewCampaign')?.addEventListener('click', () => openForm('campaign'));
    $('ccAdFormSave')?.addEventListener('click', saveForm);
  }

  return { load, render, init };
}