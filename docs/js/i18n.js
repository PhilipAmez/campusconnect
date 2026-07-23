// Lightweight i18n — covers the languages already listed in Settings
// (English, Spanish, French, German). Not a full framework: elements opt in
// via data-i18n="key" (textContent) or data-i18n-placeholder="key"
// (placeholder attribute). JS-rendered strings call t('key') directly.

export const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'de'];
const DEFAULT_LANGUAGE = 'en';
const STORAGE_KEY = 'peerloom-language';

const DICTIONARIES = {
  en: {
    nav_active_groups: 'Active Groups',
    btn_join_code: 'Join with Code',
    btn_create_group: 'Create New Group',
    sort_recent: 'Recent',
    empty_no_groups_title: 'No Active Groups',
    empty_no_groups_desc: "You haven't joined any groups yet. Start by discovering new groups or create your own.",
    btn_discover_groups: 'Discover Groups',
    modal_create_group_title: 'Create New Group',
    label_group_name: 'Group Name',
    placeholder_group_name: 'Enter group name',
    label_course_subject: 'Course/Subject',
    placeholder_course_subject: 'Enter course or subject',
    label_description: 'Description',
    placeholder_description: "What's this group about?",
    label_privacy: 'Privacy',
    option_public: 'Public - Anyone can join',
    option_private: 'Private - Invite only',
    btn_cancel: 'Cancel',
    btn_create_group_submit: 'Create Group',
    modal_join_group_title: 'Join a Private Group',
    label_invite_code: 'Invite Code',
    btn_join_group_submit: 'Join Group',
    modal_your_progress: 'Your Progress',
    btn_open_chat: 'Open Chat',
    btn_view_group: 'View Group',
    btn_quizzes: 'Quizzes',
    btn_resources: 'Resources',
    btn_leave: 'Leave',
    sidebar_dashboard: 'Dashboard',
    sidebar_course_groups: 'My Course Groups',
    sidebar_quiz_builder: 'Quiz Builder',
    sidebar_published_quizzes: 'Published Quizzes',
    sidebar_draft_quizzes: 'Draft Quizzes',
    sidebar_submissions: 'Submissions',
    sidebar_results: 'Results',
    sidebar_integrity_logs: 'Integrity Logs',
    sidebar_resources: 'Resources',
    sidebar_announcements: 'Announcements',
    sidebar_settings: 'Settings',
    sidebar_logout: 'Log out'
  },
  es: {
    nav_active_groups: 'Grupos Activos',
    btn_join_code: 'Unirse con Código',
    btn_create_group: 'Crear Nuevo Grupo',
    sort_recent: 'Reciente',
    empty_no_groups_title: 'Sin Grupos Activos',
    empty_no_groups_desc: 'Aún no te has unido a ningún grupo. Empieza descubriendo nuevos grupos o crea el tuyo.',
    btn_discover_groups: 'Descubrir Grupos',
    modal_create_group_title: 'Crear Nuevo Grupo',
    label_group_name: 'Nombre del Grupo',
    placeholder_group_name: 'Ingresa el nombre del grupo',
    label_course_subject: 'Curso/Materia',
    placeholder_course_subject: 'Ingresa el curso o materia',
    label_description: 'Descripción',
    placeholder_description: '¿De qué trata este grupo?',
    label_privacy: 'Privacidad',
    option_public: 'Público - Cualquiera puede unirse',
    option_private: 'Privado - Solo con invitación',
    btn_cancel: 'Cancelar',
    btn_create_group_submit: 'Crear Grupo',
    modal_join_group_title: 'Unirse a un Grupo Privado',
    label_invite_code: 'Código de Invitación',
    btn_join_group_submit: 'Unirse al Grupo',
    modal_your_progress: 'Tu Progreso',
    btn_open_chat: 'Abrir Chat',
    btn_view_group: 'Ver Grupo',
    btn_quizzes: 'Cuestionarios',
    btn_resources: 'Recursos',
    btn_leave: 'Salir',
    sidebar_dashboard: 'Panel',
    sidebar_course_groups: 'Mis Grupos de Curso',
    sidebar_quiz_builder: 'Creador de Cuestionarios',
    sidebar_published_quizzes: 'Cuestionarios Publicados',
    sidebar_draft_quizzes: 'Borradores de Cuestionarios',
    sidebar_submissions: 'Entregas',
    sidebar_results: 'Resultados',
    sidebar_integrity_logs: 'Registros de Integridad',
    sidebar_resources: 'Recursos',
    sidebar_announcements: 'Anuncios',
    sidebar_settings: 'Configuración',
    sidebar_logout: 'Cerrar sesión'
  },
  fr: {
    nav_active_groups: 'Groupes Actifs',
    btn_join_code: 'Rejoindre avec un Code',
    btn_create_group: 'Créer un Groupe',
    sort_recent: 'Récent',
    empty_no_groups_title: 'Aucun Groupe Actif',
    empty_no_groups_desc: "Vous n'avez encore rejoint aucun groupe. Découvrez de nouveaux groupes ou créez le vôtre.",
    btn_discover_groups: 'Découvrir des Groupes',
    modal_create_group_title: 'Créer un Nouveau Groupe',
    label_group_name: 'Nom du Groupe',
    placeholder_group_name: 'Entrez le nom du groupe',
    label_course_subject: 'Cours/Matière',
    placeholder_course_subject: 'Entrez le cours ou la matière',
    label_description: 'Description',
    placeholder_description: 'De quoi parle ce groupe ?',
    label_privacy: 'Confidentialité',
    option_public: 'Public - Tout le monde peut rejoindre',
    option_private: 'Privé - Sur invitation uniquement',
    btn_cancel: 'Annuler',
    btn_create_group_submit: 'Créer le Groupe',
    modal_join_group_title: 'Rejoindre un Groupe Privé',
    label_invite_code: "Code d'Invitation",
    btn_join_group_submit: 'Rejoindre le Groupe',
    modal_your_progress: 'Votre Progression',
    btn_open_chat: 'Ouvrir le Chat',
    btn_view_group: 'Voir le Groupe',
    btn_quizzes: 'Quiz',
    btn_resources: 'Ressources',
    btn_leave: 'Quitter',
    sidebar_dashboard: 'Tableau de Bord',
    sidebar_course_groups: 'Mes Groupes de Cours',
    sidebar_quiz_builder: 'Créateur de Quiz',
    sidebar_published_quizzes: 'Quiz Publiés',
    sidebar_draft_quizzes: 'Brouillons de Quiz',
    sidebar_submissions: 'Soumissions',
    sidebar_results: 'Résultats',
    sidebar_integrity_logs: "Journaux d'Intégrité",
    sidebar_resources: 'Ressources',
    sidebar_announcements: 'Annonces',
    sidebar_settings: 'Paramètres',
    sidebar_logout: 'Se déconnecter'
  },
  de: {
    nav_active_groups: 'Aktive Gruppen',
    btn_join_code: 'Mit Code beitreten',
    btn_create_group: 'Neue Gruppe erstellen',
    sort_recent: 'Neueste',
    empty_no_groups_title: 'Keine aktiven Gruppen',
    empty_no_groups_desc: 'Du bist noch keiner Gruppe beigetreten. Entdecke neue Gruppen oder erstelle deine eigene.',
    btn_discover_groups: 'Gruppen entdecken',
    modal_create_group_title: 'Neue Gruppe erstellen',
    label_group_name: 'Gruppenname',
    placeholder_group_name: 'Gruppennamen eingeben',
    label_course_subject: 'Kurs/Fach',
    placeholder_course_subject: 'Kurs oder Fach eingeben',
    label_description: 'Beschreibung',
    placeholder_description: 'Worum geht es in dieser Gruppe?',
    label_privacy: 'Datenschutz',
    option_public: 'Öffentlich - Jeder kann beitreten',
    option_private: 'Privat - Nur mit Einladung',
    btn_cancel: 'Abbrechen',
    btn_create_group_submit: 'Gruppe erstellen',
    modal_join_group_title: 'Privater Gruppe beitreten',
    label_invite_code: 'Einladungscode',
    btn_join_group_submit: 'Gruppe beitreten',
    modal_your_progress: 'Dein Fortschritt',
    btn_open_chat: 'Chat öffnen',
    btn_view_group: 'Gruppe ansehen',
    btn_quizzes: 'Quizze',
    btn_resources: 'Ressourcen',
    btn_leave: 'Verlassen',
    sidebar_dashboard: 'Übersicht',
    sidebar_course_groups: 'Meine Kursgruppen',
    sidebar_quiz_builder: 'Quiz-Ersteller',
    sidebar_published_quizzes: 'Veröffentlichte Quizze',
    sidebar_draft_quizzes: 'Quiz-Entwürfe',
    sidebar_submissions: 'Einreichungen',
    sidebar_results: 'Ergebnisse',
    sidebar_integrity_logs: 'Integritätsprotokolle',
    sidebar_resources: 'Ressourcen',
    sidebar_announcements: 'Ankündigungen',
    sidebar_settings: 'Einstellungen',
    sidebar_logout: 'Abmelden'
  }
};

let currentLanguage = DEFAULT_LANGUAGE;
const listeners = [];

function normalizeLang(lang) {
  return SUPPORTED_LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
}

export function t(key, fallback) {
  const dict = DICTIONARIES[currentLanguage] || DICTIONARIES[DEFAULT_LANGUAGE];
  return dict[key] || DICTIONARIES[DEFAULT_LANGUAGE][key] || fallback || key;
}

export function getCurrentLanguage() {
  return currentLanguage;
}

export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
}

export function onLanguageChange(fn) {
  listeners.push(fn);
}

async function readSavedLanguage(supabase, userId) {
  try {
    const local = localStorage.getItem(STORAGE_KEY);
    if (local) return local;
  } catch { /* ignore */ }

  if (supabase && userId) {
    try {
      const { data } = await supabase.from('profiles').select('notification_preferences').eq('id', userId).maybeSingle();
      return data?.notification_preferences?.language || null;
    } catch (err) {
      console.error('Failed to load language preference:', err);
    }
  }
  return null;
}

export async function initLanguage({ supabase, userId } = {}) {
  const saved = await readSavedLanguage(supabase, userId);
  currentLanguage = normalizeLang(saved);
  applyTranslations();
  return currentLanguage;
}

export async function setLanguage(lang, { supabase, userId } = {}) {
  currentLanguage = normalizeLang(lang);
  try { localStorage.setItem(STORAGE_KEY, currentLanguage); } catch { /* ignore */ }

  if (supabase && userId) {
    try {
      const { data: profile } = await supabase.from('profiles').select('notification_preferences').eq('id', userId).maybeSingle();
      const prefs = { ...(profile?.notification_preferences || {}), language: currentLanguage };
      await supabase.from('profiles').update({ notification_preferences: prefs }).eq('id', userId);
    } catch (err) {
      console.error('Failed to save language preference:', err);
    }
  }

  applyTranslations();
  listeners.forEach((fn) => fn(currentLanguage));
}