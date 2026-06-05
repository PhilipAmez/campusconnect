import { supabase } from './supabaseClient.js'
import { enrichGroupsWithInstitution, getCurrentUserContext, renderCampusIndicator } from './campusDiscovery.js'
import '../js/toast.js'

const activeEl = document.getElementById('groupList')
const suggestedEl = document.getElementById('suggestedGroups')
const nameInput = document.getElementById('groupName')
const courseInput = document.getElementById('groupCourse')

const esc = (s = '') => s.replace(/[&<>'"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

async function fetchGroupsWithInstitution(builderWithInstitution, builderFallback) {
  const primary = await builderWithInstitution()
  if (!primary.error) {
    return {
      data: await enrichGroupsWithInstitution(supabase, primary.data || []),
      error: null
    }
  }

  const fallback = await builderFallback()
  if (fallback.error) return { data: [], error: fallback.error }

  return {
    data: await enrichGroupsWithInstitution(supabase, fallback.data || []),
    error: null
  }
}

export async function loadGroups() {
  const { user, profile } = await getCurrentUserContext(supabase, { force: true })
  if (!user) { window.location = 'login.html'; return }

  const { data: memberships, error: membershipError } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('user_id', user.id)

  if (membershipError) { console.error(membershipError); return }

  const myGroupIds = (memberships || []).map(m => m.group_id)

  const activePromise = myGroupIds.length
    ? fetchGroupsWithInstitution(
      () => supabase.from('groups')
        .select('id, name, course_code, institution, created_by')
        .in('id', myGroupIds)
        .order('created_at', { ascending: false }),
      () => supabase.from('groups')
        .select('id, name, course_code, created_by')
        .in('id', myGroupIds)
        .order('created_at', { ascending: false })
    )
    : Promise.resolve({ data: [], error: null })

  const suggestedPromise = fetchGroupsWithInstitution(
    () => {
      let query = supabase.from('groups')
        .select('id, name, course_code, institution, created_by')
        .eq('is_public', true)
        .order('created_at', { ascending: false })
      if (myGroupIds.length > 0) query = query.not('id', 'in', `(${myGroupIds.join(',')})`)
      return query
    },
    () => {
      let query = supabase.from('groups')
        .select('id, name, course_code, created_by')
        .eq('is_public', true)
        .order('created_at', { ascending: false })
      if (myGroupIds.length > 0) query = query.not('id', 'in', `(${myGroupIds.join(',')})`)
      return query
    }
  )

  const [activeRes, suggestedRes] = await Promise.all([activePromise, suggestedPromise])

  if (activeRes.error || suggestedRes.error) {
    console.error(activeRes.error || suggestedRes.error)
    return
  }

  const render = (parent, list, btnLabel) => {
    parent.innerHTML = list.length
      ? ''
      : `<p class="text-gray-500">Nothing to show yet.</p>`

    list.forEach(group => {
      const div = document.createElement('div')
      div.className = 'group-item flex items-center gap-4 px-2 py-2 rounded-lg hover:bg-purple-50'
      div.innerHTML = `
        <div class="avatar">${esc((group.name || 'G')[0].toUpperCase())}</div>
        <div class="min-w-0">
           <p class="font-semibold text-gray-800 truncate">${esc(group.name || 'Untitled Group')}</p>
           <p class="text-gray-600 text-sm">${esc(group.course_code || 'General')}</p>
           ${renderCampusIndicator(profile, group)}
        </div>
        <button class="btn ml-auto"
                onclick="${btnLabel === 'Open' ? `openGroup('${group.id}')` : `joinGroup('${group.id}')`}">
          ${btnLabel}
        </button>`
      parent.appendChild(div)
    })
  }

  render(activeEl, activeRes.data || [], 'Open')
  render(suggestedEl, suggestedRes.data || [], 'Join')
}

window.createGroup = async () => {
  const name = nameInput.value.trim()
  const course = courseInput.value
  if (!name || !course) return alert('Fill in both fields')

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return alert('Not signed in')
  const { profile } = await getCurrentUserContext(supabase, { force: true })

  let { data: grp, error } = await supabase
    .from('groups')
    .insert({
      name,
      course_code: course,
      created_by: user.id,
      is_public: true,
      institution: profile?.institution || null
    })
    .select()
    .single()

  if (error) {
    const fallbackInsert = await supabase
      .from('groups')
      .insert({
        name,
        course_code: course,
        created_by: user.id,
        is_public: true
      })
      .select()
      .single()

    grp = fallbackInsert.data
    error = fallbackInsert.error
  }

  if (error) { console.error(error); return alert(error.message) }

  await supabase.from('group_members')
    .insert({ group_id: grp.id, user_id: user.id, role: 'admin' })

  nameInput.value = ''
  courseInput.value = ''
  loadGroups()
}

window.joinGroup = async (groupId) => {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return alert('Please log in')

  const { error } = await supabase
    .from('group_members')
    .insert({ group_id: groupId, user_id: user.id, role: 'member' }, { onConflict: 'group_id,user_id', ignoreDuplicates: false })

  if (error && error.code !== '23505') {
    console.error(error)
    return alert(error.message)
  }

  window.location = `chatroom.html?groupId=${groupId}`
}

window.openGroup = (groupId) => {
  window.location = `chatroom.html?groupId=${groupId}`
}

loadGroups()

supabase
  .channel('dash-groups')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, loadGroups)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, loadGroups)
  .subscribe()
