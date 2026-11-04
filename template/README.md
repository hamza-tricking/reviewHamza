# Review Desk — template

Master copy of the Review Desk (built for `E:\setup editing\remotion`, 2026-11-04).
Do not edit the files in `review/` per project; only `review/review.config.json` changes.

## What it is
A local page (http://localhost:3018) that plays the live Remotion composition with `@remotion/player`,
shows a clickable timeline of every element read from `src/Segments.tsx` (scenes, cuts, background,
speaker, phone videos, titles, labels, motion cards, effects, transitions, sound FX, music),
a prompt box that inserts exact references (time, frames, scene, `file:line`) on click,
range selection on the ruler, a comment mode with popups, and "Send to Claude", which writes
`review/requests/latest.md` (and copies it). In the chat: "apply review".

## Files
- `review/server.mjs` — node http server: bundles `review/app.tsx` with esbuild on request, serves `public/` under `/public` (Range support), `/api/manifest`, `/api/comments`, `/api/request`.
- `review/manifest.mjs` — reads `src/Segments.tsx` (+ the music line in `src/Main.tsx`) and builds the timeline.
- `review/app.tsx`, `review/base.ts`, `review/index.html` — the page (light glass design).
- `review/review.config.json` — per project: name, original clip names, screen-recording names, extra details.
- `fonts/` — Inter / InterTight for the page (copy into `public/fonts` if missing).

## Project contract (what the project must look like)
- Remotion project from `E:\remotion setup` (has `esbuild` and `@remotion/player` 4.0.536 in node_modules).
- `src/Main.tsx` exports `Main` (props optional) and `DEFAULT_MIX`.
- `src/Segments.tsx` exports `SEGS`, one entry per line:
  `{ id: "02 setup", clip: "c02", from: 0, to: 6.8, View: SetupView,` then `sfx: [[t, "file.mp3", vol], ...] },`
- Views are `const XxxView: React.FC...` (or `export const`), and each JSX element sits on one line:
  `<At from={a} to={b}>`, `<TitleAt from={a} to={b} ...>`, `<Title kind=".." text=".." small="..">`, `<Chip text="..">`,
  `<Phone src="support/x.mp4" ...>`, `<XxxCard dur=..>`, `<Slide from="top" ...>`, `<Speaker clip=".." phases={[...]}>`,
  `<SpeakerCut ...>`, `<DarkBg>`/`<LightBg>`, `<FrameBreak>`, `<CouchWall>`, `<GreenHook ...>`, `<HookCardOut />`, `<CamShake>`, `<WorkPhone />`.
- Media under `public/` (`clips/`, `alpha/`, `support/`, `sfx/`, `music/bg.mp3`).

## Responsive
The page adapts to the window: wide screens use the 3-column desk (player | message | inspector + comments); below 1260 px the inspector and comments drop under the player and message; below 860 px (or windows shorter than 640 px) it becomes one scrolling column (header, player, message, inspector, comments, timeline) with a taller timeline, larger touch targets and icon-only track labels under 640 px. Styles live in the `/* layout (responsive) */` block of `review/index.html`, the markup uses the classes `.app .hdr .mid .pane-*`.

## Two kinds of composition
1. **Segments style (default)**: `src/Segments.tsx` + `src/Main.tsx` as described above. Config: `review/review.config.json`.
2. **Hand-built composition (`parser: "skilldesk"`)**: one file like `src/skill/SkillDesk.tsx` + `src/skill/time.ts` (CUTS) + `src/skill/ui.tsx` (LAY).
   Copy `review/review.skill.config.example.json` to `review/review.<name>.config.json` and set `slug` (separate requests/comments),
   `target` (module / component / mix export / id) and `parser`. The parser reads: scenes (`React.FC<{ g }>` with `if (!on(g, A, B)) return null;`),
   `SPEAKER_KEYS`, `SFX`, `<PopTitle>`, `<ClipWindow>`, `<Burst>`, `<CheckDraw>`, `STEPS`, `Things` cards, `ELEMENTS`, `<Ref>`, `<Tip>`,
   and any line (in the composition file or any .ts/.tsx next to it) that ends with a cue comment `// @cue <track> <label>` (tracks: effects, labels, cards, transitions, support, titles, sfx; times are read from
   `win(g,A,B)`, `on(g,A,B)`, `typed(g,"..",A,B)`, `F(A)` / `F(A)+N`, `sp(g,A)`, `press(g,A)`, `at: A` on the same line). Optional `cutNote` in the config is appended to every jump-cut entry.

## Run
Second desk for another composition: `node review/server.mjs --config review/review.skill.config.json --port 3019`
(requests then go to `review/requests/<slug>/latest.md`, comments to `review/comments.<slug>.json`).

`npm run review` (script `node review/server.mjs`), or `PORT=3019 node review/server.mjs`.
