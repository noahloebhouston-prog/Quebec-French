# Widget notes

How the widget should load, render, grade and track this curriculum. Data files: `schema.json`, `placement/placement-test.json`, `levels/level-NN.json`, `adaptive-rules.json`.

## Flow

1. **First visit:** run the placement test (`placement/placement-test.json`). Bands run in order; stop at the first band below 50%. Always finish with the two production tasks (band `level: 0`). Apply `adaptive-rules.json → placement` to get the start level, tested-out levels with bridge packs, and focus skills.
2. **Course map:** levels in `number` order, lessons in `number` order. A lesson unlocks when the previous one is complete. A level's gate test unlocks when all its lessons (and any bridge or review packs) are complete. A level unlocks when the previous gate test passes or the level is tested out.
3. **After every activity:** save the result, update mastery (per skill and per tag), then evaluate the rules in `adaptive-rules.json`.

## Activity types

| `type` | Render | Grading |
|---|---|---|
| `notes` | Markdown `body`. Make French phrases tappable for TTS. | Complete on open. |
| `flashcards` | Look up `vocabIds` in the level's `vocabulary`. Front: `en`; back: `fr`, `example`, `notes`, and `standardEquivalent` for Québec items. Play TTS on flip. | Self-marked known / not yet. Feeds spaced repetition. |
| `quiz` | Optional `stimulus`, then `items`. If `draw` is set, pick that many items at random. Shuffle MC options (keep track of the correct index). | Auto, see below. |
| `writing` | `prompt` (show `promptEn` under a toggle at A1–A2), a text box with a live word count against `minWords`/`maxWords`. | Rubric, see below. |
| `speaking` | Depends on `mode`, see below. Record audio and transcribe. | Phrase check + rubric, or self-check. |

### Stimulus

- `kind: "text"` shows `text`. `kind: "dialogue"` shows `lines` as chat bubbles.
- `kind: "audio"` plays `lines` (or `text`) with TTS, one voice per speaker if possible, and hides the script until submit when `transcript` is `after-submit`. Respect `maxPlays` in tests.
- `translationEn` and each line's `en` appear only after submit.

### Item kinds

| `kind` | Answer field | Notes |
|---|---|---|
| `multiple_choice` | `answer` = index into `options` | In the placement test, append the `dontKnowOption`. |
| `true_false` | `answer` = boolean | |
| `fill_blank` | `acceptedAnswers` = one array per `___` | All blanks must match for the point (or give partial credit per blank). |
| `short_answer` | `acceptedAnswers` = strings | |
| `dictation` | `acceptedAnswers`, play `audioText` | |
| `matching` | `pairs` | Shuffle the right column. Score = correct pairs / total × `points`. |
| `ordering` | `answer` = correct order of `options` indexes | Display `options` shuffled. |

`points` defaults to 1. Show `explanation` after answering, right or wrong.

### Normalising typed answers

Before comparing to `acceptedAnswers`:

1. Trim, lowercase, collapse whitespace.
2. Turn curly apostrophes (’) into straight ones ('). Turn « » and quotes into nothing.
3. Remove trailing `. ! ?` and commas.
4. Treat hyphens and spaces as equal (`vingt-deux` = `vingt deux`), and `œ` = `oe`.
5. Accents: if `strictAccents` is false (default), compare without accents too; an answer that only matches without accents gets full marks plus a note ("Watch the accent: *êtes*"). In gate-test grammar items, accent-only errors get half marks. If `strictAccents` is true, accents must match.
6. For phone numbers, also compare with every non-digit removed.

## Writing and speaking grading

Rubrics are inline (`rubric`) or referenced (`rubricRef` → the file's `rubrics` map). Score = sum of criterion points / sum of `maxPoints`.

**Recommended: grade with an LLM.** Send the prompt, the learner's text (or transcript), the rubric, `targetStructures`, `modelAnswer` and the level's CEFR, and ask for JSON back. Suggested system prompt:

```
You grade French written or spoken by an adult English-speaking Canadian learning
Québec conversational French at CEFR {cefr}. Québec forms (chu, t'es, pis, je reste à,
bienvenue, fin de semaine, ouin…) are correct, not errors, unless the task asks for
formal French. Grade strictly by the rubric bands. For speaking, you see a speech-
recognition transcript: judge pronunciation from how closely it matches what the
learner evidently meant. Reply with JSON only:
{"criteria":[{"id":"…","points":n,"comment":"one sentence in English"}],
 "corrections":[{"original":"…","corrected":"…","why":"…"}],
 "encouragement":"one sentence",
 "tagsWeak":["grammar:…"]}
```

Use `tagsWeak` to feed tag mastery. Show corrections inline under the learner's text, then the model answer.

**Fallback without an LLM:** check `expectedPhrases` (each entry may hold alternatives separated by ` | `; normalise as above). Score the task criterion as matched entries / total entries × its `maxPoints`, then let the learner self-rate the other criteria from the band descriptors.

### Speaking modes

- `repeat`: play each line of `expectedPhrases` with TTS, record the learner after each one.
- `respond` / `describe`: show (and speak) `prompt`, record up to `maxSeconds`.
- `roleplay`: step through `turns`. Speak each `partner` line; for each `learner` turn show `task` and record. Check each turn's own `expectedPhrases`.

Recording: `MediaRecorder` for audio playback. Transcription: the Web Speech API (`SpeechRecognition` with `lang = "fr-CA"`, Chrome and Safari) or a speech-to-text service. Always let the learner replay their recording next to the model.

When transcription isn't available, show `selfCheck` as a yes/no list; score = yes answers / total, and mark the result as self-assessed.

TTS: use `speechSynthesis`, picking a voice whose `lang` is `fr-CA`, then any `fr-*`. Use `tts.rate` (default 0.9). Prefer `tts.audioUrl` when set.

## Gate tests

Score each section as points earned / points possible across its activities (quiz items drawn plus rubric points). Pass needs `overallPercent` overall and `sectionMinPercent` in every section. On failure, apply the `gate-fail` rule.

## What to store per learner

```json
{
  "placement": { "takenAt": "…", "bands": {"1": 92, "2": 71}, "skills": {"lire": 85, "ecouter": 60, "ecrire": 78, "parler": 40}, "startLevel": 2 },
  "levels": { "L01": { "status": "testedOut", "bridgePackDone": false } },
  "activities": { "1.1-a3": { "attempts": [{ "score": 0.75, "at": "…", "answers": {} }], "best": 0.75 } },
  "mastery": { "skills": {"lire": 0.82}, "tags": {"grammar:etre": 0.9} },
  "flags": { "focusSkills": ["parler"], "weakTags": [], "weakCriteria": [] },
  "srs": { "v01-allo": { "box": 2, "due": "…" } }
}
```

Keep writing and speaking submissions (text, transcript, audio link) so progress over time is visible.
