# reviewHamza

A Claude Code skill that adds a **Review Desk** to a Remotion video project: a local page with the live player, a clickable timeline of every element, a prompt box that inserts exact references, comment mode, and "Send to Claude".

## Install (one command)

macOS / Linux / Git Bash:

```bash
git clone https://github.com/hamza-tricking/reviewHamza ~/.claude/skills/reviewHamza
```

Windows PowerShell:

```powershell
git clone https://github.com/hamza-tricking/reviewHamza $env:USERPROFILE\.claude\skills\reviewHamza
```

Update later with `git pull` inside that folder.

## Use

Open your Remotion project in Claude Code and say `reviewHamza`. After you review in the desk, say `apply review`.

## Requirements

- Node.js and a Remotion project with `src/Main.tsx` (exports `Main` and `DEFAULT_MIX`) and `src/Segments.tsx` (see `template/README.md` for the exact contract).
- `esbuild` and `@remotion/player` in the project's `node_modules`.

## Layout

- `SKILL.md` — the skill instructions
- `template/` — the Review Desk template the skill copies into your project (`review/`, `fonts/`, `README.md`)
