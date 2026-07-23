const FILE_TYPE_META = {
  pdf: { label: 'PDF', icon: 'fas fa-file-pdf', previewable: true },
  word: { label: 'Word', icon: 'fas fa-file-word', previewable: false },
  powerpoint: { label: 'PowerPoint', icon: 'fas fa-file-powerpoint', previewable: false },
  image: { label: 'Image', icon: 'fas fa-file-image', previewable: true },
  zip: { label: 'ZIP', icon: 'fas fa-file-archive', previewable: false },
  audio: { label: 'Audio', icon: 'fas fa-file-audio', previewable: true },
  video: { label: 'Video', icon: 'fas fa-file-video', previewable: true }
};

const LINK_TYPE_META = {
  google_drive: { label: 'Google Drive', icon: 'fab fa-google-drive', previewable: true },
  onedrive: { label: 'OneDrive', icon: 'fab fa-microsoft', previewable: true },
  github: { label: 'GitHub', icon: 'fab fa-github', previewable: true },
  youtube_playlist: { label: 'YouTube Playlist', icon: 'fab fa-youtube', previewable: true },
  website: { label: 'Website', icon: 'fas fa-globe', previewable: true },
  external_link: { label: 'Link', icon: 'fas fa-link', previewable: true }
};

function typeMeta(resourceType) {
  return FILE_TYPE_META[resourceType] || LINK_TYPE_META[resourceType] || { label: resourceType, icon: 'fas fa-file', previewable: false };
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatFileSize(bytes) {
  if (window.formatFileSize) return window.formatFileSize(bytes);
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Renders a resource card into `container` for a chat message whose
 * `content` field holds a resources.id (matches the poll-message convention
 * already used elsewhere in chatroom.html).
 */
export async function loadResourceCard(message, container, { supabase, user }) {
  const resourceId = message.content;
  if (!resourceId) {
    container.innerHTML = '<p>Invalid resource</p>';
    return;
  }

  const { data: resource, error } = await supabase
    .from('resources')
    .select('*')
    .eq('id', resourceId)
    .maybeSingle();

  if (error || !resource) {
    container.innerHTML = '<p>This resource is no longer available.</p>';
    return;
  }

  const { data: poster } = await supabase
    .from('profiles')
    .select('full_name, verified, lecturer_badge')
    .eq('id', resource.created_by)
    .maybeSingle();

  const { data: bookmark } = await supabase
    .from('resource_bookmarks')
    .select('id')
    .eq('resource_id', resourceId)
    .eq('user_id', user.id)
    .maybeSingle();

  const meta = typeMeta(resource.resource_type);
  const url = resource.file_url || resource.external_url;
  const isDownloadAllowed = resource.download_permission !== 'view_only' && !!resource.file_url;

  container.innerHTML = `
    <div class="resource-card" data-resource-id="${resourceId}">
      <div class="resource-card-top">
        <span class="resource-card-eyebrow"><i class="fas fa-book"></i> Lecture Resource</span>
      </div>
      <h4 class="resource-card-title">${escapeHtml(resource.title || 'Untitled resource')}</h4>
      ${resource.topic ? `<p class="resource-card-topic">${escapeHtml(resource.topic)}</p>` : ''}
      <div class="resource-card-meta">
        <span>Uploaded by <strong>${escapeHtml(poster?.full_name || 'Your lecturer')}</strong>${poster?.verified || poster?.lecturer_badge ? ' <i class="fas fa-check-circle resource-verified"></i>' : ''}</span>
      </div>
      <div class="resource-card-type-row">
        <span class="resource-type-chip"><i class="${meta.icon}"></i> ${meta.label}</span>
        ${resource.file_size_bytes ? `<span class="resource-size-chip">${formatFileSize(resource.file_size_bytes)}</span>` : ''}
        ${resource.week ? `<span class="resource-size-chip">Week ${resource.week}</span>` : ''}
      </div>
      <div class="resource-card-actions">
        ${meta.previewable ? `<button class="resource-action-btn" data-action="preview"><i class="fas fa-eye"></i> Preview</button>` : ''}
        ${isDownloadAllowed ? `<button class="resource-action-btn" data-action="download"><i class="fas fa-download"></i> Download</button>` : ''}
        <button class="resource-action-btn ${bookmark ? 'active' : ''}" data-action="bookmark"><i class="fa-${bookmark ? 'solid' : 'regular'} fa-bookmark"></i> Save</button>
        <button class="resource-action-btn" data-action="share"><i class="fas fa-share"></i> Share</button>
      </div>
    </div>
  `;

  const card = container.querySelector('.resource-card');

  card.querySelector('[data-action="preview"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (url) window.open(url, '_blank', 'noopener');
  });

  card.querySelector('[data-action="download"]')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!url) return;
    try {
      await supabase.from('resource_downloads').insert({ resource_id: resourceId, user_id: user.id });
      if (resource.created_by && resource.created_by !== user.id) {
        await supabase.from('notifications').insert({
          user_id: resource.created_by,
          sender_id: user.id,
          type: 'resource_downloaded',
          content: `Someone downloaded "${resource.title}"`,
          post_id: resourceId,
          origin: 'resources'
        });
      }
    } catch (err) {
      console.error('Failed to log resource download:', err);
    }
    const link = document.createElement('a');
    link.href = url;
    link.download = resource.file_name || resource.title || 'resource';
    link.target = '_blank';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  });

  card.querySelector('[data-action="bookmark"]')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    const icon = btn.querySelector('i');
    try {
      if (btn.classList.contains('active')) {
        await supabase.from('resource_bookmarks').delete().eq('resource_id', resourceId).eq('user_id', user.id);
        btn.classList.remove('active');
        icon.className = 'fa-regular fa-bookmark';
      } else {
        await supabase.from('resource_bookmarks').upsert({ resource_id: resourceId, user_id: user.id }, { onConflict: 'resource_id,user_id' });
        btn.classList.add('active');
        icon.className = 'fa-solid fa-bookmark';
      }
    } catch (err) {
      console.error('Failed to toggle bookmark:', err);
    }
  });

  card.querySelector('[data-action="share"]')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(url || window.location.href);
      if (window.toast) window.toast('Link copied to clipboard', { type: 'success' });
    } catch (err) {
      console.error('Failed to copy resource link:', err);
    }
  });
}