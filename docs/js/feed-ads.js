// ============================================================
// Sponsored slide for the For You feed.
// Asks the database for ONE eligible ad (ad_get_eligible_ad). The database
// decides everything: ads switched on, emergency stop, verified advertiser,
// approved image, paid in full, dates, caps and the per-user daily limit.
// If nothing is returned, or anything fails, the feed is left untouched.
// A view is counted only after the slide has been mostly on screen for a
// full second; a click is counted when the button is pressed. Both are
// de-duplicated by a one-off event id.
// ============================================================

const PLACEMENT = 'feed_sponsored_post';
const SHOW_AFTER = 4;          // after the 4th post
const VISIBLE_MS = 1000;       // how long it must stay in view to count

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function isHttps(v) { try { return new URL(v).protocol === 'https:'; } catch { return false; } }
function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let renderToken = 0;

export async function showSponsoredSlide(supabase, feed) {
  const token = ++renderToken;
  feed.querySelectorAll('.sponsored-slide').forEach(el => el.remove());
  try {
    const slides = feed.querySelectorAll('.video-container:not(.sponsored-slide):not(.empty-state-container)');
    if (slides.length < SHOW_AFTER) return;

    const { data, error } = await supabase.rpc('ad_get_eligible_ad', { p_placement_slug: PLACEMENT });
    if (error || !Array.isArray(data) || !data.length) return;
    const ad = data[0];
    if (token !== renderToken) return;                       // feed was re-rendered meanwhile
    if (!isHttps(ad.destination_url) || !isHttps(ad.creative_url)) return;

    const anchor = feed.querySelectorAll('.video-container:not(.sponsored-slide):not(.empty-state-container)')[SHOW_AFTER - 1];
    if (!anchor || !anchor.parentNode) return;

    const slide = document.createElement('section');
    slide.className = 'video-container sponsored-slide';
    slide.setAttribute('aria-label', 'Sponsored');
    slide.innerHTML = `
      <div class="sponsored-bg" style="background-image:url('${esc(ad.creative_url).replace(/'/g, '%27')}')"></div>
      <img class="sponsored-img" src="${esc(ad.creative_url)}" alt="${esc(ad.creative_alt || '')}" referrerpolicy="no-referrer" decoding="async">
      <span class="sponsored-label">Sponsored</span>
      <div class="sponsored-info">
        <div class="sponsored-headline">${esc(ad.headline)}</div>
        ${ad.body ? `<div class="sponsored-body">${esc(ad.body)}</div>` : ''}
        <a class="sponsored-cta" href="${esc(ad.destination_url)}" target="_blank" rel="noopener noreferrer sponsored">${esc(ad.cta_label || 'Learn More')}</a>
      </div>`;
    anchor.insertAdjacentElement('afterend', slide);

    // ---- count one view after VISIBLE_MS of being >= 60% on screen ----
    let timer = null, counted = false;
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (en.isIntersecting && !counted) {
          timer = setTimeout(async () => {
            if (counted) return;
            counted = true; io.disconnect();
            try { await supabase.rpc('ad_record_impression', { p_campaign_id: ad.campaign_id, p_placement_id: ad.placement_id, p_event_id: newId() }); } catch (e) { /* never block the feed */ }
          }, VISIBLE_MS);
        } else if (timer) { clearTimeout(timer); timer = null; }
      });
    }, { root: feed, threshold: 0.6 });
    io.observe(slide);

    // If the image can't be loaded (bad link), drop the slide and never count it.
    slide.querySelector('.sponsored-img').addEventListener('error', () => { io.disconnect(); if (timer) clearTimeout(timer); counted = true; slide.remove(); });

    // ---- count a click (once per press, never blocks navigation) ----
    slide.querySelector('.sponsored-cta').addEventListener('click', () => {
      try { supabase.rpc('ad_record_click', { p_campaign_id: ad.campaign_id, p_placement_id: ad.placement_id, p_event_id: newId() }).then(() => {}, () => {}); } catch (e) { /* ignore */ }
    });
  } catch (e) {
    console.warn('Sponsored slide skipped:', e);
  }
}