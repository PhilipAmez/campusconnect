# PeerLoom (CampusConnect)

A campus social and academic platform that brings course communities, live class chat, quizzes, and learning resources into one place — built for universities that want their students actually talking to each other, not just logging in to check a portal.

Students join course groups, chat in real time, take quizzes with academic-integrity monitoring, and get notified the moment something new is posted. Lecturers get a dedicated studio to build assessments, grade submissions, publish announcements and resources, and see exactly how their classes are doing — all without needing a separate LMS.

---

## What's in the box

### For students
- **Campus feed & profiles** — a social layer for the student body, not just a course tool.
- **Course groups** — join publicly, or privately with a 6-character invite code. Real-time chat with text, images, video, voice notes, file sharing, and polls.
- **Quizzes** — timed, multiple question types (multiple choice, true/false, short answer, essay), autosave, and a resume-if-disconnected flow. A quiet academic-integrity layer logs tab switches, copy/paste, and fullscreen exits during an attempt without interrupting the student.
- **Announcements & resources** — lecturer posts appear as pinned cards in the group chat (not lost in the message scroll) and in a dedicated per-group library, with reactions, comments, bookmarks, and downloads.
- **Notifications** — new quizzes, new resources, new announcements, and grades, pushed in real time.
- **Personalization** — light/dark theme and a language preference (English, Spanish, French, German), both synced across devices.

### For lecturers — the Lecturer Studio
- **Course Groups** — roster view, invite codes, per-group activity at a glance.
- **Quiz Builder** — compose mixed-format assessments, publish to specific groups, schedule availability windows.
- **Submissions & Grading** — objective questions score themselves; essays and short answers get a focused grading view with per-question feedback.
- **Results** — average/median/high/low scores, pass rate, completion rate, and a question-by-question difficulty breakdown, exportable to CSV/Excel/PDF.
- **Integrity Logs** — a severity-coded timeline of every flagged event per student, per attempt — signal, not noise.
- **Announcements & Resources** — the same composer either fans out to students instantly.
- **Notifications** — a real-time bell for submissions, downloads, reactions, and integrity events.
- **Settings** — profile, notification preferences, theme, and language, all genuinely persisted.

### Under the hood
- **Frontend:** plain HTML/CSS/JavaScript (ES modules) — no build step, easy to read and extend.
- **Backend:** [Supabase](https://supabase.com) — Postgres, Auth, Realtime, and Storage.
- **Security model:** Row Level Security (RLS) on every table that holds user data. Students and lecturers each see exactly what they're entitled to see, enforced at the database layer, not just hidden in the UI.
- **Design language:** an Apple-inspired "liquid glass" aesthetic — frosted cards, soft depth, and motion that feels intentional rather than decorative.

---

## Getting started

### Prerequisites
- A [Supabase](https://supabase.com) project (free tier is enough to start)
- Node.js (only needed if you're running the included local dev server)

### Setup
1. **Clone the repository** and open the `supabase/migrations` folder — run each migration against your Supabase project's SQL editor, in order, oldest first.
2. **Configure your client keys** in `docs/js/supabaseClient.js` — your project URL and anon key (the anon key is meant to be public; access control lives in RLS, not in hiding this key).
3. **Serve the `docs/` folder** — this is a static site. Open `docs/index.html` in a local server (or deploy `docs/` directly to any static host — it's already set up for GitHub Pages).
4. **Create your first lecturer account** via the sign-up flow, create a course group, and publish a quiz to see the full loop end-to-end.

### Project structure
```
docs/                   Static site — every page students and lecturers use
  js/                    Shared modules (auth, theming, i18n, notifications, lecturer studio)
  *.html                 One file per page (chat, quizzes, resources, dashboards, settings...)
supabase/
  migrations/            SQL migrations, applied in filename order
  functions/             Edge functions (e.g. thumbnail generation, video tokens)
```

---

## A note on how this was built

This project has grown feature by feature, with real users testing real classes along the way — which means some of the most valuable fixes in its history came from things breaking in practice: a recursive security policy, a schema mismatch, a false-positive integrity flag. Where that happened, the fix addressed the actual root cause rather than papering over the symptom, and the reasoning is preserved in the migration comments for the next person who touches that code.

If you're extending this project, the same standard applies: prefer the real fix over the quick one, and prefer telling users the truth about what isn't built yet over quietly faking it.

---

## License

Internal / institutional use. Contact the maintainers before external distribution.