---
name: reviewHamza
description: Add the Review Desk to a Remotion video project by copying the ready template bundled in this skill's template/ folder (no rebuilding) - a local page with the live player, a clickable timeline of every element (scenes, cuts, speaker, phone videos, titles, labels, cards, effects, transitions, sound FX, music), a prompt box that inserts exact references on click, range selection, comment mode, and "Send to Claude" (writes review/requests/latest.md). Use when the user says "reviewHamza", asks for the review desk / review page / timeline page for a video project, or says "apply review" (then read review/requests/latest.md and apply it).
---

# reviewHamza — Review Desk for a Remotion project

The template is bundled with this skill: the `template/` folder next to this `SKILL.md` (normally `~/.claude/skills/reviewHamza/template`; below, `<skill>` means the folder that contains this file). Read `<skill>/template/README.md` for the project contract. Copy the template; never rebuild the page. The code in `review/` is identical for every project; only `review/review.config.json` changes. Do not change the page's behaviour unless the user asks.

## A. Install into a project

1. **Project folder:** the Remotion root (has `package.json`, `src/Main.tsx`, `src/Segments.tsx`). Ask only if it is not clear.
2. **Check the contract** (from `<skill>/template/README.md`):
   - `src/Main.tsx` exports `Main` and `DEFAULT_MIX` (props optional with defaults). If `DEFAULT_MIX` is missing, add it with the composition's default volumes and make `Main`'s props optional; keep `Root.tsx` defaultProps a plain literal.
   - `src/Segments.tsx` has `SEGS` entries in the one-line form and views as `const XxxView: React.FC`. If the project uses another structure, say so and stop: the parser (`review/manifest.mjs`) reads this form.
   - `node_modules/esbuild` and `node_modules/@remotion/player` exist. If they are missing, ask, then `npm install --save-exact @remotion/player@<same version as remotion>` (and `npm install esbuild` if needed).
3. **Copy** (never overwrite an existing `review/` without asking; requests and comments there are the user's).
   Windows (PowerShell), exit codes 0-7 are success:
   ```powershell
   robocopy '<skill>\template\review' '<project>\review' /E /NFL /NDL /NJH /NJS /NP
   robocopy '<skill>\template\fonts' '<project>\public\fonts' /XC /XN /XO /NFL /NDL /NJH /NJS /NP
   ```
   macOS / Linux:
   ```bash
   cp -R <skill>/template/review <project>/review
   mkdir -p <project>/public/fonts && cp -n <skill>/template/fonts/* <project>/public/fonts/
   ```
4. **Fill `review/review.config.json`:** `project` (short name), `clipSources` (`cXX` -> original speaker file name), `supportSources` (`public/support` file -> original recording name), `extraDetails` (`music`, `WorkPhone` if used). These names only label the references Claude receives.
5. **npm script:** add `"review": "node review/server.mjs"` to `package.json` scripts.
6. **Port:** default 3018. If another desk already uses it, pick a free port and run with `PORT=<port>`. Add a `.claude/launch.json` entry (`runtimeExecutable: "node"`, `runtimeArgs: ["<project>/review/server.mjs"]`, the port; set `PORT` env if not 3018) and start it with `preview_start`.
7. **Verify** (cheap, no render):
   - `node review/manifest.mjs .` prints the frame count and element counts; the frames must equal the composition's `durationInFrames`.
   - In the browser pane: the player loads, no console errors (`read_console_messages` onlyErrors), clicking a timeline block inserts a `[#E.. ...]` token, dragging the ruler inserts `[@T.. a→b]`.
8. **Report** the URL, the counts per track, and how to use it (below).

## A2. Second desk for a hand-built composition (e.g. `src/skill/SkillDesk.tsx`)
The same `review/` code serves several compositions through config files. Copy `review/review.skill.config.example.json` to `review/review.<name>.config.json`, set `slug`, `target` and `parser: "skilldesk"`, add cue comments `// @cue <track> <label>` on the lines that animate things (see `<skill>/template/README.md`), then run `node review/server.mjs --config review/review.<name>.config.json --port <free port>` (add a `.claude/launch.json` entry with the same args). Requests are saved to `review/requests/<slug>/latest.md`.

## B. "apply review"

When the user says "apply review" / "طبّق المراجعة" / pastes a "Remotion edit request" block:
1. Read `<project>/review/requests/latest.md` (or `review/requests/<slug>/latest.md` when the desk uses a config with a `slug`, e.g. the SkillDesk desk on port 3019), or the pasted text.
2. Apply each item. Element ids (`#E42`) are positional and change with the code; trust the `file:line`, the global time/frames and the label over the id.
3. Typecheck (`npx tsc --noEmit`), check the changed moments with stills, and update `review/review.config.json` if new media was added.
4. Tell the user to press "↻ Reload timeline" in the desk. Do not render unless asked.

## How the user works with it
- Prompt mode: click any block -> exact reference inserted at the caret (or at the end); Ctrl/Shift+click multi-select -> "Insert into prompt"; click the ruler = time point, drag = range.
- Comment mode: click a block or ruler -> popup (closes on outside click / Esc / ✕), comments pinned on the timeline and saved to `review/comments.json`.
- "What Claude receives" shows the final markdown; "Send to Claude" saves `review/requests/latest.md` (+ timestamped copy) and copies it to the clipboard.

## Known details
- The page is responsive (desktop 3 columns, tablet side column drops under, phone one scrolling column); keep that when editing `review/app.tsx` / `review/index.html`: layout is in the CSS classes (`.app .mid .pane-*`), not in inline styles.
- The player uses `numberOfSharedAudioTags={0}` (more than 5 simultaneous sounds otherwise crash the preview).
- Arabic labels are wrapped in Unicode isolates so times do not flip.
- The page bundles `src/` live: after code changes, refresh the page or press "↻ Reload timeline".
- The server loads `review/manifest.mjs` once at start: after editing `manifest.mjs` (or `server.mjs`), restart the server. The first page load after a start takes a few seconds (esbuild bundle).
