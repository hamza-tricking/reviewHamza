// Review timeline for a hand-built composition like src/skill/SkillDesk.tsx (read-only).
// Config (review/review.*.json):  "parser": "skilldesk", "skilldesk": { "file", "time", "ui" }  (defaults below).
//
// What it reads:
//   time.ts      CUTS (speaker cuts) and the source-second -> output-frame mapping F()
//   SkillDesk.tsx
//     scenes          React.FC<{ g }> components that start with  if (!on(g, A, B)) return null;  (title from the /* N. Title */ comment)
//     speaker moves   SPEAKER_KEYS = [[t, "LAYOUT", frames?], ...]   (layout geometry from LAY in ui.tsx)
//     sound effects   SFX = [[t, "file.mp3", vol], ...]
//     titles          <PopTitle at end text ...>
//     screen clips    <ClipWindow src keys end ...>
//     bursts / ticks  <Burst>, <CheckDraw>
//     cards / steps   Things items { at, x, label }, STEPS = [[a, b, "text"]], ELEMENTS chips, <Ref at>, <Tip at end lines>
//     any line        add a trailing comment   // @cue <track> <label>   (track: effects | labels | cards | transitions | support | titles | sfx)
//                     times are read from the same line: win(g, A, B) · on(g, A, B) · typed(g, "..", A, B) · F(A) [+ N] · sp(g, A) · press(g, A)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const FPS = 30;
const TRACKS = new Set(["effects", "labels", "cards", "transitions", "support", "titles", "sfx", "background", "speaker"]);

const mediaDur = (file) => {
  try { return parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString()) || 1; } catch { return 1; }
};
const attr = (line, name) => {
  const m = line.match(new RegExp(`\\b${name}=(?:"([^"]*)"|\\{([^}]*(?:\\{[^}]*\\}[^}]*)*)\\})`));
  return m ? (m[1] !== undefined ? m[1] : m[2]) : undefined;
};
const block = (lines, startRe, endRe = /^\];?\s*$/) => {
  const i = lines.findIndex((l) => startRe.test(l));
  if (i < 0) return { from: -1, rows: [] };
  let j = i + 1;
  while (j < lines.length && !endRe.test(lines[j])) j++;
  return { from: i, rows: lines.slice(i + 1, j).map((text, k) => ({ text, line: i + 2 + k })) };
};

export const buildSkillDeskManifest = (root, cfg) => {
  const o = { file: "src/skill/SkillDesk.tsx", time: "src/skill/time.ts", ui: "src/skill/ui.tsx", ...(cfg.skilldesk || {}) };
  const CLIP = cfg.clipSources || {};
  const SUPPORT = cfg.supportSources || {};
  const rd = (f) => fs.readFileSync(path.join(root, f), "utf8").split(/\r?\n/);
  const L = rd(o.file);
  const T = rd(o.time);
  const U = fs.existsSync(path.join(root, o.ui)) ? rd(o.ui) : [];

  // ---- cuts + time mapping
  const cutsBlk = block(T, /export const CUTS/);
  const CUTS = cutsBlk.rows.map((r) => ({ ...r, ...(() => { const m = r.text.match(/\[([\d.]+),\s*([\d.]+)\]/); return m ? { a: +m[1], b: +m[2] } : {}; })() })).filter((c) => c.a !== undefined);
  const outSec = (s) => {
    let acc = 0;
    for (const c of CUTS) {
      if (s < c.a) return acc;
      if (s <= c.b) return acc + (s - c.a);
      acc += c.b - c.a;
    }
    return acc;
  };
  const F = (s) => Math.round(outSec(+s) * FPS);
  const total = F(CUTS[CUTS.length - 1].b);

  // ---- scenes
  const comp = [];
  L.forEach((l, i) => {
    const m = l.match(/^const (\w+): React\.FC<\{ g: number \}> = \(\{ g \}\) => \{/);
    if (!m) return;
    const on = (L[i + 1] || "").match(/if \(!on\(g, ([\d.]+), ([\d.]+)\)\) return null;/);
    let title = m[1];
    for (let k = i - 1; k >= Math.max(0, i - 4); k--) {
      const c = L[k].match(/^\/\*\s+([\d-]+)\.\s+(.*?)\s*\*\//);
      if (c) { title = `${c[1]} ${c[2]}`; break; }
    }
    comp.push({ name: m[1], line: i + 1, a: on ? +on[1] : null, b: on ? +on[2] : null, title });
  });
  comp.forEach((c, k) => { c.endLine = k + 1 < comp.length ? comp[k + 1].line - 1 : L.length; });
  const scenes = comp.filter((c) => c.a !== null && c.name !== "SkillDesk");
  const segments = scenes.map((c) => ({ id: c.title, clip: "speaker.mp4", from: c.a, to: c.b, startF: F(c.a), endF: F(c.b), line: c.line, view: c.name }));
  const segAt = (f) => segments.find((s) => f >= s.startF && f < s.endF) || segments[segments.length - 1];
  const compAt = (line) => scenes.find((c) => line >= c.line && line <= c.endLine);

  const els = [];
  let n = 0;
  const add = (x) => {
    const startF = Math.max(0, Math.round(x.startF));
    const endF = Math.min(total, Math.max(startF + 1, Math.round(x.endF)));
    els.push({ id: `E${++n}`, file: o.file, seg: segAt(startF).id, ...x, startF, endF });
  };

  // scenes
  segments.forEach((s, i) => add({ track: "scene", type: "scene", label: s.id, detail: `Scene ${i + 1} · component ${s.view} (source ${s.from}–${s.to} s of the speaker video)`, startF: s.startF, endF: s.endF, line: s.line }));

  // cuts (speaker video segments) + removed gaps
  CUTS.forEach((c, i) => {
    add({ track: "cuts", type: "cut", file: o.time, line: c.line, label: `speaker ${c.a}→${c.b}s`, detail: `Speaker cut: public/skill/speaker.mp4 (${CLIP["speaker.mp4"] || "?"}) ${c.a}–${c.b} s · voice normalised to -16 LUFS`, startF: F(c.a), endF: F(c.b) });
    if (i > 0) add({ track: "transitions", type: "transition", file: o.time, line: c.line, label: "jump cut", detail: `Silence removed: source ${CUTS[i - 1].b}→${c.a} s is skipped${cfg.cutNote ? " · " + cfg.cutNote : ""}`, startF: F(c.a), endF: F(c.a) + 4 });
  });

  // background
  const bgLine = L.findIndex((l) => /<LightBg g=\{g\}/.test(l)) + 1;
  add({ track: "background", type: "background", label: "Light bg", detail: "Light animated background: #F3F8FF → #E6F1FF, lime / sky / pink blurred glows, moving dot grid (LightBg in src/skill/ui.tsx). No music in this video.", startF: 0, endF: total, line: bgLine || 1 });

  // speaker layout moves
  const LAYINFO = {};
  U.forEach((l) => {
    const m = l.match(/^\s+(\w+): \{ x: (-?\d+), y: (-?\d+), w: (\d+), h: (\d+), r: (\d+), s: ([\d.]+)/);
    if (m) LAYINFO[m[1]] = `card at x=${m[2]} y=${m[3]} size ${m[4]}×${m[5]}, radius ${m[6]}, zoom ${m[7]}`;
  });
  const keysBlk = block(L, /^const SPEAKER_KEYS/);
  const keys = keysBlk.rows.map((r) => { const m = r.text.match(/\[([\d.]+),\s*"(\w+)"(?:,\s*(\d+))?\]/); return m ? { t: +m[1], name: m[2], d: m[3] ? +m[3] : 10, line: r.line } : null; }).filter(Boolean);
  keys.forEach((k, i) => {
    const end = i + 1 < keys.length ? F(keys[i + 1].t) : total;
    add({ track: "speaker", type: "speaker", label: `Speaker ${k.name}`, detail: `Speaker card layout "${k.name}": ${LAYINFO[k.name] || "see LAY in src/skill/ui.tsx"} (SPEAKER_KEYS, 2nd value is the layout name)`, startF: F(k.t), endF: end, line: k.line });
    if (i > 0) add({ track: "transitions", type: "transition", label: `speaker → ${k.name}`, detail: `Speaker card moves to "${k.name}" over ${k.d} frames (bezier ease)`, startF: F(k.t), endF: F(k.t) + k.d, line: k.line });
  });
  const hs = L.findIndex((l) => /const hs = g >= (\d+) && g < (\d+)/.test(l));
  if (hs >= 0) {
    const m = L[hs].match(/g >= (\d+) && g < (\d+)/);
    add({ track: "effects", type: "effect", label: "Hook camera", detail: `Hook camera: starts zoomed in (layout FULLZ, zoom 1.55) and pulls out fast to FULL at ${keys[1] ? keys[1].t : 0.3} s; decaying shake + 4% overscale over frames ${m[1]}–${m[2]} (SkillDesk component, hs)`, startF: 0, endF: +m[2], line: hs + 1 });
  }

  // sound effects
  const sfxBlk = block(L, /^const SFX/);
  sfxBlk.rows.forEach((r) => {
    const m = r.text.match(/\[([\d.]+),\s*"([^"]+)",\s*([\d.]+)\]/);
    if (!m) return;
    const d = Math.min(mediaDur(path.join(root, "public", "sfx", m[2])), 3);
    add({ track: "sfx", type: "sfx", label: m[2].replace(".mp3", ""), detail: `Sound effect public/sfx/${m[2]} · volume ${m[3]} (× sfxVolume slider) · at source second ${m[1]}`, startF: F(m[1]), endF: F(m[1]) + Math.max(6, Math.round(d * FPS)), line: r.line });
  });

  // titles
  L.forEach((l, i) => {
    if (!/<PopTitle /.test(l)) return;
    const a = attr(l, "at"), b = attr(l, "end"), t = attr(l, "text");
    if (a === undefined || b === undefined) return;
    const hi = attr(l, "hi"), pink = attr(l, "pink");
    add({ track: "titles", type: "title", label: t, detail: `Pop title "${t}" · size ${attr(l, "size") || 120} at y=${attr(l, "y")} · words pop in one by one${hi ? " · lime marker on word index " + hi : ""}${pink ? " · pink marker on word index " + pink : ""} (PopTitle in src/skill/ui.tsx)`, startF: F(a), endF: F(b), line: i + 1 });
  });

  // screen recordings (ClipWindow)
  for (let i = 0; i < L.length; i++) {
    if (!/<ClipWindow\b/.test(L[i])) continue;
    let j = i, txt = L[i];
    while (j < Math.min(L.length - 1, i + 30) && !(L[j].trim() === ">" || /\/>\s*$/.test(L[j]))) { j++; txt += "\n" + L[j]; }
    const src = (txt.match(/\bsrc="([^"]+)"/) || [])[1];
    const url = (txt.match(/\burl="([^"]*)"/) || [])[1];
    const end = (txt.match(/\bend=\{([\d.]+)\}/) || [])[1];
    const kk = [...txt.matchAll(/\{ at: ([\d.]+), src: ([\d.]+) \}/g)].map((x) => ({ at: +x[1], src: +x[2] }));
    if (!src || !end || !kk.length) continue;
    const fname = src.split("/").pop();
    add({ track: "support", type: "support", label: fname, detail: `Browser-window mockup playing public/${src} = "${SUPPORT[fname] || fname}"${url ? ` (address bar "${url}")` : ""} · jump cuts into the recording at ${kk.map((k) => `${k.at}s→clip ${k.src}s`).join(", ")} · zoom/crop moves are in its crop={[...]} (ClipWindow in src/skill/ui.tsx)`, startF: F(kk[0].at), endF: F(end), line: i + 1 });
  }

  // bursts + check marks
  L.forEach((l, i) => {
    if (/<Burst /.test(l)) {
      const m = l.match(/F\(([\d.]+)\)(?:\s*\+\s*(\d+))?/);
      if (m) add({ track: "effects", type: "effect", label: "spark burst", detail: `Burst of lime/pink/ink sparks at (${attr(l, "x")}, ${attr(l, "y")}), radius ${attr(l, "r") || 170}, seed "${attr(l, "seed")}" (Burst in src/skill/ui.tsx)`, startF: F(m[1]), endF: F(m[1]) + (m[2] ? +m[2] : 18), line: i + 1 });
    }
    if (/<CheckDraw\b/.test(l)) {
      let a = null;
      for (let k = i; k >= Math.max(0, i - 12) && a === null; k--) { const m = L[k].match(/F\(([\d.]+)\)/); if (m) a = +m[1]; }
      if (a !== null) add({ track: "effects", type: "effect", label: "check mark", detail: "Check mark: lime circle + ink tick drawn with a stroke animation (CheckDraw in src/skill/ui.tsx)", startF: F(a), endF: F(a) + 16, line: i + 1 });
    }
  });

  // cards: Things items, STEPS, ELEMENTS chips
  L.forEach((l, i) => {
    const m = l.match(/\{ at: ([\d.]+), x: (\d+), label: "([^"]+)".*?bad: ([\d.]+)/);
    if (m) {
      const c = compAt(i + 1);
      add({ track: "cards", type: "card", label: m[3], detail: `Glass card "${m[3]}" springs up at x=${m[2]}; red ✕ stamps on it at ${m[4]} s (if ✕ < 99) · until the end of its scene`, startF: F(m[1]), endF: c ? F(c.b) : total, line: i + 1 });
    }
  });
  block(L, /^const STEPS/).rows.forEach((r) => {
    const m = r.text.match(/\[([\d.]+),\s*([\d.]+),\s*"([^"]+)"\]/);
    if (m) add({ track: "labels", type: "label", label: `step ${m[3]}`, detail: `Lime step badge "${m[3]}" at the top right of the Review Desk mock-up (STEPS)`, startF: F(m[1]), endF: F(m[2]), line: r.line });
  });
  const elLine = L.findIndex((l) => /^const ELEMENTS =/.test(l));
  if (elLine >= 0) {
    const names = [...L[elLine].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    const mapLine = L.findIndex((l) => /ELEMENTS\.map/.test(l));
    let a = null;
    for (let k = mapLine; k >= Math.max(0, mapLine - 3) && a === null; k--) { const m = L[k].match(/F\(([\d.]+)\)/); if (m) a = +m[1]; }
    const c = compAt(mapLine + 1);
    if (a !== null) add({ track: "cards", type: "card", label: `element chips ×${names.length}`, detail: `Chips fly out of the page one by one: ${names.join(", ")} (ELEMENTS)`, startF: F(a), endF: c ? F(c.b) : total, line: elLine + 1 });
  }

  // Ref chips in the prompt, coordinate tips
  L.forEach((l, i) => {
    const c = compAt(i + 1);
    const r = l.match(/<Ref g=\{g\} at=\{([\d.]+)\}>([^<]+)<\/Ref>/);
    if (r) add({ track: "labels", type: "label", label: `ref ${r[2]}`, detail: `Reference chip "${r[2]}" pops into the prompt text box at ${r[1]} s (Ref)`, startF: F(r[1]), endF: c ? F(c.b) : total, line: i + 1 });
    if (/<Tip /.test(l)) {
      const a = attr(l, "at"), b = attr(l, "end");
      const ln = (attr(l, "lines") || "").match(/"([^"]+)"/g) || [];
      if (a !== undefined && b !== undefined) add({ track: "labels", type: "label", label: `coordinates: ${(ln[0] || "").replace(/"/g, "")}`, detail: `Dark coordinates tooltip showing ${ln.map((x) => x.replace(/"/g, "")).join(" · ")} (Tip)`, startF: F(a), endF: F(b), line: i + 1 });
    }
  });

  // ---- generic cues:  // @cue <track> <label>   (in the composition file and every other .tsx/.ts next to it)
  const cueFiles = [o.file, ...fs.readdirSync(path.join(root, path.dirname(o.file))).filter((f) => /\.tsx?$/.test(f)).map((f) => path.posix.join(path.dirname(o.file).split(path.sep).join("/"), f)).filter((f) => f !== o.file)];
  cueFiles.forEach((cf) => { const lines = cf === o.file ? L : rd(cf); lines.forEach((l, i) => cueLine(cf, lines, l, i)); });
  function cueLine(cf, lines, l, i) {
    const m = l.match(/\/\/\s*@cue\s+(?:(\w+)\s+)?(.+?)\s*$/);
    if (!m) return;
    let track = "effects", label = m[2];
    if (m[1] && TRACKS.has(m[1])) track = m[1]; else if (m[1]) label = `${m[1]} ${m[2]}`;
    const code = l.slice(0, l.indexOf("// @cue"));
    const c = cf === o.file ? compAt(i + 1) : null;
    const sceneEnd = c ? F(c.b) : total;
    const press = [...code.matchAll(/press\(g, ([\d.]+)\)/g)].map((x) => +x[1]);
    const typeOf = track === "labels" ? "label" : track === "cards" ? "card" : track === "transitions" ? "transition" : track === "support" ? "support" : track === "titles" ? "title" : "effect";
    const base = { track, type: typeOf, line: i + 1, file: cf };
    if (press.length) { press.forEach((t) => add({ ...base, label: `${label} @${t}s`, detail: `${label}: cursor press at ${t} s (${cf}:${i + 1})`, startF: F(t), endF: F(t) + 10 })); return; }
    let w;
    if ((w = code.match(/(?:win|on)\(g, ([\d.]+), ([\d.]+)/))) { add({ ...base, label, detail: `${label}: ${w[1]}–${w[2]} s (${cf}:${i + 1})`, startF: F(w[1]), endF: F(w[2]) }); return; }
    if ((w = code.match(/\bat: ([\d.]+)/)) && !/press\(|win\(|on\(g/.test(code)) { add({ ...base, label, detail: `${label}: at source second ${w[1]} (${cf}:${i + 1})`, startF: F(w[1]) - 7, endF: F(w[1]) + 10 }); return; }
    if ((w = code.match(/typed\(g, "[^"]*", ([\d.]+), ([\d.]+)\)/))) { add({ ...base, label, detail: `${label}: typed between ${w[1]} and ${w[2]} s (${cf}:${i + 1})`, startF: F(w[1]), endF: F(w[2]) }); return; }
    const f = [...code.matchAll(/F\(([\d.]+)\)(?:\s*\+\s*(\d+))?/g)].map((x) => ({ s: F(x[1]), e: F(x[1]) + (x[2] ? +x[2] : 0) }));
    if (f.length) { const s = Math.min(...f.map((x) => x.s)); const e = Math.max(...f.map((x) => x.e)); add({ ...base, label, detail: `${label}: from ${(s / FPS).toFixed(2)} s of output (${cf}:${i + 1})`, startF: s, endF: e > s ? e : sceneEnd }); return; }
    if ((w = code.match(/sp\(g, ([\d.]+)/))) return add({ ...base, label, detail: `${label}: springs in at source second ${w[1]} (${cf}:${i + 1})`, startF: F(w[1]), endF: Math.max(F(w[1]) + 12, track === "transitions" ? F(w[1]) + 15 : sceneEnd) });
  }

  els.sort((a, b) => a.startF - b.startF || a.endF - b.endF);
  els.forEach((e, i) => (e.id = `E${i + 1}`));
  return {
    project: cfg.project || path.basename(root),
    composition: (cfg.target && cfg.target.id) || "SkillDesk",
    timelineSource: `${o.file} (+ ${o.time})`,
    root,
    fps: FPS,
    width: 1080,
    height: 1920,
    durationInFrames: total,
    segments,
    elements: els,
  };
};
