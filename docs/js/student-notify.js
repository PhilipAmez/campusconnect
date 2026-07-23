/**
 * Notifies every member of the given group(s), so students hear about new
 * quizzes/resources/announcements the moment they're published.
 *
 * This calls the notify_group_members database function (security definer)
 * instead of inserting rows directly. Direct client-side inserts here are
 * always cross-user (a lecturer notifying their students), which silently
 * failed whenever the notifications table's RLS insert policy didn't allow
 * that — running server-side avoids depending on getting that policy exactly
 * right. Silently no-ops on failure — a notification fan-out should never
 * block or break the actual publish action it's attached to.
 */
export async function notifyGroupMembers(supabase, { groupIds, type, content, postId, origin, senderId }) {
  const ids = (Array.isArray(groupIds) ? groupIds : [groupIds]).filter(Boolean);
  if (!ids.length) return;

  const { error } = await supabase.rpc('notify_group_members', {
    p_group_ids: ids,
    p_sender_id: senderId || null,
    p_type: type,
    p_content: content,
    p_post_id: postId || null,
    p_origin: origin || null
  });

  if (error) {
    // Previously a blocked insert was silently dropped, so it looked
    // identical to everything working — the publish action would succeed
    // with no visible sign that no one was ever notified.
    console.error('Notification fan-out failed:', error);
  }
}