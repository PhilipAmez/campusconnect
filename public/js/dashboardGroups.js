/*  dashboardGroups.js  */
import { supabase } from './supabaseClient.js'

/* ────────────────────────────────────────────────────────────── */
/* Helpers                                                       */
/* ────────────────────────────────────────────────────────────── */

const groupListEl  = document.getElementById('groupList')
const createBtn    = document.querySelector('button[onclick="createGroup()"]')  // already in HTML
const groupNameEl  = document.getElementById('groupName')
const groupCourseEl= document.getElementById('groupCourse')

function escapeHTML (str = '') {
  return str.replace(/[&<>'"]/g, c => (
    { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]
  ))
}

/* ────────────────────────────────────────────────────────────── */
/* Load & render public groups                                   */
/* ────────────────────────────────────────────────────────────── */

export async function loadGroups () {
  const { data: groups, error } = await supabase
      .from('groups')
      .select('id, name, course_code')
      .order('created_at', { ascending: false })

  if (error) {
    console.error(error)
    groupListEl.innerHTML = `<p class="text-red-600">Error loading groups</p>`
    return
  }

  // clear and rebuild
  groupListEl.innerHTML = ''
  groups.forEach(g => {
    const div = document.createElement('div')
    div.className = 'group-item flex items-center gap-4 rounded-lg hover:bg-purple-50 px-2 py-2'

    div.innerHTML = `
      <div class="avatar">${escapeHTML(g.name.charAt(0).toUpperCase())}</div>
      <div class="min-w-0">
        <p class="font-semibold text-gray-800 truncate">${escapeHTML(g.name)}</p>
        <p class="text-gray-600 text-sm">${escapeHTML(g.course_code)}</p>
      </div>
      <button class="btn ml-auto" onclick="joinGroup('${g.id}')">Join</button>
    `
    groupListEl.appendChild(div)
  })
}

/* ────────────────────────────────────────────────────────────── */
/* Create a public group (single admin)                          */
/* ────────────────────────────────────────────────────────────── */

window.createGroup = async function createGroup () {
  const name   = groupNameEl.value.trim()
  const course = groupCourseEl.value.trim()
  if (!name || !course) return alert('Please supply both a group name and course.')

  const user   = (await supabase.auth.getUser()).data.user
  if (!user)   return alert('Not signed in')

  // 1) create group
  const { data: g, error: err1 } = await supabase
        .from('groups')
        .insert({
          name,
          course_code: course,
          created_by: user.id,
          is_public : true
        })
        .select()
        .single()

  if (err1) {
    console.error(err1)
    return alert(err1.message)
  }

  // 2) insert admin membership
  const { error: err2 } = await supabase
        .from('group_members')
        .insert({
          group_id : g.id,
          user_id  : user.id,
          role     : 'admin'
        })

  if (err2) {               // rare, but roll back if needed
    await supabase.from('groups').delete().eq('id', g.id)
    console.error(err2)
    return alert(err2.message)
  }

  // UI feedback
  groupNameEl.value = ''
  groupCourseEl.value = ''
  alert('Group created!')
  loadGroups()
}

/* ────────────────────────────────────────────────────────────── */
/* Join (or open) group                                          */
/* ────────────────────────────────────────────────────────────── */

window.joinGroup = async function joinGroup (groupId) {
  const user = (await supabase.auth.getUser()).data.user
  if (!user) return alert('Please log in')

  /* Insert membership; ignore “duplicate‑key” error if already a member */
//   const { error } = await supabase
//         .from('group_members')
//         .insert({ group_id: groupId, user_id: user.id, role: 'member' }, { onConflict: 'group_id,user_id' })

//   if (error && error.code !== '23505') {   // 23505 = unique_violation
//     console.error(error)
//     return alert(error.message)
//   }

  // Redirect to chatroom
  window.location = `chatroom.html?groupId=${groupId}`
}

/* ────────────────────────────────────────────────────────────── */
/* Live refresh using Realtime                                   */
/* ────────────────────────────────────────────────────────────── */

loadGroups()   // initial load

supabase
  .channel('public-groups')
  .on(
     'postgres_changes',
     { event: '*', schema: 'public', table: 'groups' },
     payload => loadGroups()             // re‑render on insert/update/delete
  )
  .subscribe()
