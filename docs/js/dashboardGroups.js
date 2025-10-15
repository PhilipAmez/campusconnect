/* dashboardGroups.js – Active vs. Suggested lists */
import { supabase } from './supabaseClient.js'
import '../js/toast.js'

/* ─────────────────────────────  DOM shortcuts  ───────────────────────────── */
const activeEl    = document.getElementById('groupList')        // “Active Study Groups”
const suggestedEl = document.getElementById('suggestedGroups')  // “Suggested Groups”
const nameInput   = document.getElementById('groupName')
const courseInput = document.getElementById('groupCourse')

const esc = (s = '') => s.replace(/[&<>'"]/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))

/* ─────────────────────────────  Load & render  ───────────────────────────── */
export async function loadGroups () {
  /* 1. signed‑in user & memberships */
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) { window.location = 'login.html'; return }

  const { data: memberships, error: mErr } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', user.id)

  if (mErr) { console.error(mErr); return }

  const myGroupIds = memberships.map(m => m.group_id)

  /* 2. fetch the two sets in parallel */
  const [activeRes, suggestedRes] = await Promise.all([
    // Active (= member)
    supabase.from('groups')
            .select('id, name, course_code')
            .in('id', myGroupIds)
            .order('created_at', { ascending: false }),

    // Suggested : public AND not in myGroupIds
    supabase.from('groups')
            .select('id, name, course_code')
            .eq('is_public', true)
            .not('id', 'in', `(${myGroupIds.join(',')})`)   // 0 → empty list safe‑guard
            .order('created_at', { ascending: false })
  ])

  const { data: active,   error: aErr } = activeRes
  const { data: suggest,  error: sErr } = suggestedRes
  if (aErr || sErr) { console.error(aErr || sErr); return }

  /* 3. render helpers */
  const render = (parent, list, btnLabel) => {
    parent.innerHTML = list.length
      ? ''
      : `<p class="text-gray-500">Nothing to show yet.</p>`

    list.forEach(g => {
      const div = document.createElement('div')
      div.className =
        'group-item flex items-center gap-4 px-2 py-2 rounded-lg hover:bg-purple-50'
      div.innerHTML = `
        <div class="avatar">${esc(g.name[0].toUpperCase())}</div>
        <div class="min-w-0">
           <p class="font-semibold text-gray-800 truncate">${esc(g.name)}</p>
           <p class="text-gray-600 text-sm">${esc(g.course_code)}</p>
        </div>
        <button class="btn ml-auto"
                onclick="${btnLabel === 'Open'
                   ? `openGroup('${g.id}')`
                   : `joinGroup('${g.id}')`}">
          ${btnLabel}
        </button>`
      parent.appendChild(div)
    })
  }

  render(activeEl,    active,   'Open')
  render(suggestedEl, suggest,  'Join')
}

/* ───────────────────────────  Create new group  ─────────────────────────── */
window.createGroup = async () => {
  const name   = nameInput.value.trim()
  const course = courseInput.value
  if (!name || !course) return alert('Fill in both fields')

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return alert('Not signed in')

  const { data: grp, error } = await supabase
        .from('groups')
        .insert({
          name,
          course_code : course,
          created_by  : user.id,
          is_public   : true
        })
        .select()
        .single()

  if (error) { console.error(error); return alert(error.message) }

  // Make creator admin‑member
  await supabase.from('group_members')
                .insert({ group_id: grp.id, user_id: user.id, role: 'admin' })

  nameInput.value   = ''
  courseInput.value = ''
  loadGroups()
}

/* ───────────────────────────  Join & Open group  ─────────────────────────── */
window.joinGroup = async (groupId) => {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return alert('Please log in')
  console.log('about to member inserted')
  await supabase
        .from('group_members')
        .insert(
          { group_id: groupId, user_id: user.id, role: 'member' },
          { onConflict: 'group_id,user_id', ignoreDuplicates: false }
        )
        alert('member inserted')
  window.location = `chatroom.html?groupId=${groupId}`
}

window.openGroup = (groupId) =>
  window.location = `chatroom.html?groupId=${groupId}`

/* ───────────────────────────  Live refresh  ─────────────────────────────── */
loadGroups()  // initial

supabase
  .channel('dash-groups')
  .on('postgres_changes',
      { event:'*', schema:'public', table:'groups'       }, loadGroups)
  .on('postgres_changes',
      { event:'*', schema:'public', table:'group_members'}, loadGroups)
  .subscribe()
