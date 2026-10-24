# Québécois Conversational French: Self-Paced Curriculum

**Use it:** https://noahloebhouston-prog.github.io/Quebec-French/ (once GitHub Pages is on, see below)

A numbered, self-paced path from zero to confident conversation in Québec French. There are no deadlines. You move forward when you pass a level's **gate test**, not when a calendar says so.

Files in this folder:

| File | What it is |
|---|---|
| `README.md` | This overview: how the course works and the full level map |
| `schema.json` | JSON Schema that every level file follows (for the widget) |
| `placement/placement-test.json` | Placement test that finds your starting level and weak skills |
| `adaptive-rules.json` | Rules that adjust the plan to your results as you go |
| `levels/level-01.json` | Level 1, fully built: lessons, activities, gate test |
| `levels/level-02.json` | Level 2, fully built: family, work, likes, negation, days and time, conversation |
| `WIDGET-NOTES.md` | How the widget should render, grade and track each activity type |
| `index.html`, `app/` | The web app itself: no build step, no server, it reads the JSON files above |
| `levels/index.json` | The list of levels the app shows; a new level goes live when its `file` is filled in |

Later levels are added as `levels/level-02.json`, `levels/level-03.json`, and so on, all in the same shape.

---

## How the course works

**Structure.** Course → Levels (1, 2, 3 …) → Lessons (1.1, 1.2 …) → Activities. Every level ends with a gate test.

**Four skills in every lesson.** Each lesson has at least one activity for each of:

- **Lire** (reading comprehension): short dialogues, texts, signs, messages, with questions.
- **Écrire** (writing): from fill-in-the-blank up to free writing graded with a rubric.
- **Écouter** (listening): audio played with a `fr-CA` voice, with questions. The transcript is hidden until you answer.
- **Parler** (speaking): prompts you answer aloud. The widget records you and either scores the transcript or has you self-assess against a checklist.

**Unlocking.** Lessons inside a level unlock in order. You finish a lesson when you have completed all of its required activities (score doesn't matter here; practice is practice). Once every lesson in a level is done, the gate test opens.

**Gate tests.** A gate test has a section for each skill. To pass you need **80% overall** and **at least 70% in every section**, so you can't skip a weak skill. If you don't pass, the widget shows which sections were weak and points you back to the lessons that cover them. You can retake as often as you want; questions are drawn from a pool so retakes aren't identical.

**Placement and adapting to you.** The first time you open the widget you take a placement test. It climbs one level at a time (Levels 1 to 5) and stops when questions get too hard, then ends with a short writing task and a short speaking task. From that it sets:

- your **start level**. Levels below it are marked *tested out*, with a short **bridge pack** (Québec forms and speaking practice from those levels) so you don't miss what Duolingo doesn't teach;
- your **focus skills**, any skill well below your best one, which get extra practice in every lesson.

After that the plan keeps adjusting (full rules in `adaptive-rules.json`): a low activity score means a retry; a lesson you ace becomes fast-track; a grammar point you keep missing triggers a short review; a rubric criterion you keep losing points on (spelling, pronunciation…) gets a targeted drill; an excellent gate test lets you test out of the next level; and a run of weak lessons suggests a checkpoint on the previous level.

**Ongoing review.** Vocabulary from every lesson goes into a spaced-repetition deck that keeps running across levels, so earlier material keeps coming back.

**Québécois focus.** Lessons teach what people actually say in Québec (e.g. *chu* for *je suis*, *t'es-tu correct?*, *icitte*, *char*, *blonde/chum*, *magasiner*, *fin de semaine*, *déjeuner/dîner/souper*). Each such item is tagged `register: "québécois"` with its standard-French equivalent next to it, so you can recognise both and switch to standard French when you need to (formal writing, France, exams). Writing activities accept both forms unless the prompt says otherwise.

---

## Level map

Levels track the CEFR scale (A1 → C1) so you can compare against official exams such as the TEFaQ or TCF if you ever want to.

| # | Level | CEFR | Conversation goal | Key grammar | Québec focus |
|---|---|---|---|---|---|
| 1 | **Allô! Premiers contacts** | A1.1 | Greet, introduce yourself, say where you're from, numbers 0–69, spell your name | *être*, *avoir*, *s'appeler*; subject pronouns; *tu* vs *vous*; gender and articles | *Allô*, *Bonne journée!*, *tu* used widely, *chu/t'es* in speech |
| 2 | **Ma vie, ma famille** | A1.2 | Family, work, likes and dislikes, days and time | -er verbs in present, negation *ne…pas* (and dropped *ne*), possessives | *ma blonde / mon chum*, *ça me tente (pas)*, *pantoute* |
| 3 | **En ville** | A1.3 | Directions, transit, ordering at a café or dépanneur, prices | *aller*, *vouloir*, *pouvoir*; *il y a* → *y'a*; numbers to 1000 | *dépanneur*, *un café, s'il vous plaît*, *c'est combien?*, *tu-tu* question particle |
| 4 | **Au quotidien** | A2.1 | Daily routine, weather, making plans | reflexive verbs; *futur proche*; questions with *est-ce que* / intonation | *fin de semaine*, *il fait frette*, *il mouille*, *on se voit-tu?* |
| 5 | **Ce qui s'est passé** | A2.2 | Telling what happened, weekend stories | *passé composé* with *avoir/être* | *pis* (and then), *genre*, storytelling fillers |
| 6 | **Autrefois** | A2.3 | Describing the past, childhood, habits | *imparfait* vs *passé composé* | Québec childhood: *cabane à sucre*, hockey, *la Saint-Jean* |
| 7 | **Au travail et au service** | B1.1 | Workplace talk, phone calls, appointments, complaints | object pronouns *le/la/lui/y/en*; polite *conditionnel* | *courriel*, *fin de semaine*, Québec workplace register |
| 8 | **Mes opinions** | B1.2 | Agreeing, disagreeing, giving reasons | *subjonctif* (common triggers), connectors | *c'est plate*, *c'est l'fun*, *être tanné*, *capoter* |
| 9 | **Les médias québécois** | B1.3 | Following news, radio, TV clips | relative pronouns, *futur simple* | Radio-Canada, Québec accent features (diphthongs, *tsé*, affrication *t/d → ts/dz*) |
| 10 | **Débattre** | B2.1 | Discussing social topics, persuading | *plus-que-parfait*, hypotheses with *si* | Joual vs standard; *sacres* (recognise, not required to use) |
| 11 | **La culture** | B2.2 | Music, film, literature from Québec | passive, *gérondif*, nuance | Michel Tremblay, Les Cowboys Fringants, *Les Boys*, regional accents (Saguenay, Gaspésie, Acadie) |
| 12 | **Aisance** | C1 | Fluid, spontaneous conversation on any topic | register shifts, idioms | Fast speech, humour, regional expressions |

After Level 12 the course continues as an open-ended **Conversation Lab**: themed packs (travel, cooking, sports, politics, a news story of the week) using the same activity types, with no gate tests.

---

## Level 1 at a glance (fully built in `levels/level-01.json`)

| Lesson | Title | You'll be able to |
|---|---|---|
| 1.1 | Allô! Bonjour! | Greet people and say goodbye, choose *tu* or *vous* |
| 1.2 | Je m'appelle… | Give your name, ask someone's, spell with the French alphabet |
| 1.3 | Je viens de… | Say where you're from and where you live, Canadian cities and provinces |
| 1.4 | Les nombres | Count 0–69, give your age and phone number |
| 1.5 | Comment ça va? | Ask and answer how someone is, Québec spoken forms (*chu*, *t'es*) |
| 1.6 | Une première conversation | Put it all together in a full first-meeting conversation |
| Gate | Test du niveau 1 | Reading, writing, listening, speaking sections; 80% overall, 70% each |

---

## The web app

`index.html` and `app/` are a complete static app: placement test, lessons, auto-graded quizzes, writing with rubric grading, speaking with your microphone, flashcards with spaced repetition, gate tests, and the adaptive rules from `adaptive-rules.json`.

- **Progress** is saved in your browser. Use *Réglages → Export* to back it up or move it to another device.
- **Listening** uses your device's French voices. For Québec French, install a *French (Canada)* voice (iPhone: Settings → Accessibility → Spoken Content → Voices; Windows/Android: language settings).
- **Speaking** records you and, in Chrome or Safari, transcribes what you said to check for the key phrases. Elsewhere it falls back to the self-check list.
- **Writing** can be graded by Claude: the app builds a grading prompt you copy into a Claude chat, then you paste the reply back and the scores fill in. Or rate yourself with the rubric.

### Turning on GitHub Pages (one time)

Repo **Settings → Pages → Build and deployment**: Source *Deploy from a branch*, Branch *main*, folder */ (root)*, **Save**. After a minute the app is live at the link at the top of this file.

### Running it locally

From this folder: `python3 -m http.server`, then open http://localhost:8000. (Opening `index.html` directly from disk won't work, because browsers block loading the JSON files that way.)
