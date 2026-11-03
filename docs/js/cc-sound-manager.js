/*
 * Command Centre notification sounds — centralized, so no component plays
 * audio on its own. Call window.ccPlaySound(type) from a realtime handler;
 * everything else (which file, the on/off setting, autoplay restrictions,
 * not stacking duplicate sounds) is handled here, once.
 *
 * Files are matched by name to what they're for, using exactly what's in
 * docs/sounds/ — nothing invented beyond that:
 *   prophanity-alert.mp3 -> a moderation event (profanity/harassment/threat)
 *   report-alert.mp3     -> someone filed a report
 *   new-user.mp3         -> a new account just signed up
 *   notification.mp3     -> everything else (this is the same generic sound
 *                           chatroom/dashboard/profile/feed already use) —
 *                           there's no file named for "user warned",
 *                           "suspended", "banned", "group suspended", or a
 *                           general "system/security alert" specifically,
 *                           so those all fall back to this one for now.
 *                           Give me distinctly-named files for any of those
 *                           and this map is the only place that needs to
 *                           change.
 */
(function () {
  'use strict';

  const SOUND_MAP = {
    moderation: 'sounds/prophanity-alert.mp3',
    report: 'sounds/report-alert.mp3',
    new_user: 'sounds/new-user.mp3',
    default: 'sounds/notification.mp3',
  };

  // One <audio> element per sound, reused (not a new Audio() per play) —
  // cheaper, and avoids a pile of half-loaded objects during a burst of
  // realtime events.
  const players = {};
  Object.keys(SOUND_MAP).forEach(type => {
    const a = new Audio(SOUND_MAP[type]);
    a.preload = 'auto';
    players[type] = a;
  });

  // Prevents one realtime event from triggering the same sound twice if two
  // handlers both react to it (e.g. a batched payload processed in a loop),
  // and keeps a fast burst of events from turning into an overlapping wall
  // of noise — not a rate limit on the EVENTS themselves, only on the SOUND.
  const lastPlayedAt = {};
  const MIN_GAP_MS = 1200;

  let autoplayBlocked = false;
  function warmUpOnFirstInteraction() {
    if (!autoplayBlocked) return;
    autoplayBlocked = false;
    document.removeEventListener('click', warmUpOnFirstInteraction);
    document.removeEventListener('keydown', warmUpOnFirstInteraction);
  }
  document.addEventListener('click', warmUpOnFirstInteraction);
  document.addEventListener('keydown', warmUpOnFirstInteraction);

  function soundEnabled() {
    return localStorage.getItem('cc_sound') === 'on';
  }

  window.ccPlaySound = function ccPlaySound(type) {
    if (!soundEnabled()) return;

    const key = Object.prototype.hasOwnProperty.call(SOUND_MAP, type) ? type : 'default';
    const now = Date.now();
    if (lastPlayedAt[key] && now - lastPlayedAt[key] < MIN_GAP_MS) return;
    lastPlayedAt[key] = now;

    const player = players[key];
    try {
      player.currentTime = 0;
      const p = player.play();
      if (p && typeof p.catch === 'function') {
        p.catch(err => {
          // Most common cause: the browser blocked audio because nothing on
          // the page has been clicked yet this session. Not an error to
          // surface loudly — it resolves itself the moment the admin
          // interacts with the page at all, since every click/keydown is
          // itself a sound-unlocking gesture in the browser's eyes too.
          autoplayBlocked = true;
          console.warn(`Command Centre: "${key}" sound could not autoplay yet (${err.name}). It will work once you click anywhere on the page.`);
        });
      }
    } catch (err) {
      console.warn(`Command Centre: could not play the "${key}" sound.`, err);
    }
  };
})();