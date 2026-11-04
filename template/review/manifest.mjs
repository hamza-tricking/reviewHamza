// Builds the review timeline from src/Segments.tsx (read-only):
// every scene, cut, background, speaker move, phone/support video, title, label, card, effect,
// transition and sound effect, with absolute frames and the exact source line.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildSkillDeskManifest } from "./manifest.skilldesk.mjs";

const FPS = 30;
const sec = (s) => Math.round(s * FPS);

// Project-specific names live in review/review.config.json (the only file that changes per project).
const loadConfig = (root) => {
  const f = path.join(root, "review", "review.config.json");
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return {}; }
};

const durCache = new Map();
const mediaDur = (file) => {
  if (durCache.has(file)) return durCache.get(file);
  let d = 1;
  try {
    d = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString()) || 1;
  } catch {}
  durCache.set(file, d);
  return d;
};

const num = (expr, consts) => {
  // evaluates simple numeric expressions like 1.3, sec(4.7) + 12, C01[1]
  let e = String(expr).trim();
  e = e.replace(/\b([A-Z][A-Z0-9_]*)\[(\d)\]/g, (_, n, i) => (consts[n] ? consts[n][+i] : "NaN"));
  e = e.replace(/sec\(([^)]+)\)/g, (_, v) => `(${v})*30/30`); // keep seconds
  if (!/^[\d\s.+\-*/()]+$/.test(e)) return NaN;
  try { return Function(`return (${e})`)(); } catch { return NaN; }
};
const attr = (line, name) => {
  const m = line.match(new RegExp(`\\b${name}=(?:"([^"]*)"|\\{([^}]*(?:\\{[^}]*\\}[^}]*)*)\\})`));
  return m ? (m[1] !== undefined ? m[1] : m[2]) : undefined;
};

export const buildManifest = (root, cfgIn) => {
  const cfg = cfgIn || loadConfig(root);
  if (cfg.parser === "skilldesk") return buildSkillDeskManifest(root, cfg);
  const CLIP_SOURCES = cfg.clipSources || {};
  const SUPPORT_SOURCES = cfg.supportSources || {};
  const EXTRA = cfg.extraDetails || {};
  const file = path.join(root, "src", "Segments.tsx");
  const rel = "src/Segments.tsx";
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);

  // constants like  const C01: [number, number] = [0, 4.43];
  const consts = {};
  lines.forEach((l) => {
    const m = l.match(/^const (\w+): \[number, number\] = \[([\d.]+),\s*([\d.]+)\]/);
    if (m) consts[m[1]] = [+m[2], +m[3]];
  });

  // view blocks
  const views = {};
  let cur = null;
  lines.forEach((l, i) => {
    const m = l.match(/^(?:export )?const (\w+View): React\.FC/);
    if (m) { cur = m[1]; views[cur] = { start: i, end: lines.length - 1 }; }
    if (/^export const SEGS/.test(l) && cur) { views[cur].end = i - 1; cur = null; }
  });
  const names = Object.keys(views);
  names.forEach((n, k) => { if (k + 1 < names.length) views[n].end = Math.min(views[n].end, views[names[k + 1]].start - 1); });

  // SEGS entries
  const segs = [];
  lines.forEach((l, i) => {
    const m = l.match(/\{ id: "([^"]+)", clip: "(\w+)", from: ([^,]+), to: ([^,]+), View: (\w+)/);
    if (!m) return;
    const seg = { id: m[1], clip: m[2], from: num(m[3], consts), to: num(m[4], consts), view: m[5], line: i + 1, sfx: [] };
    // sfx triples on this and following lines until the closing "},"
    for (let j = i; j < Math.min(lines.length, i + 6); j++) {
      const re = /\[([\d.]+),\s*"([^"]+)",\s*([\d.]+)\]/g;
      let s;
      while ((s = re.exec(lines[j]))) seg.sfx.push({ t: +s[1], file: s[2], vol: +s[3], line: j + 1 });
      if (j > i && /\},\s*$/.test(lines[j])) break;
      if (j === i && /\},\s*$/.test(lines[j]) && !/sfx:\s*\[\s*$/.test(lines[j])) break;
    }
    segs.push(seg);
  });

  const els = [];
  let start = 0;
  let n = 0;
  const add = (o) => els.push({ id: `E${++n}`, file: rel, ...o });
  const fmtClip = (c, a, b) => `${c}.mp4 (${CLIP_SOURCES[c] || "?"}) ${a.toFixed(2)}–${b.toFixed(2)} s`;

  segs.forEach((s, si) => {
    const dur = sec(s.to) - sec(s.from);
    s.start = start; s.end = start + dur; s.index = si + 1;
    const segRange = { a: 0, b: dur / FPS };
    const abs = (t) => start + sec(t);
    add({ track: "scene", type: "scene", label: s.id, detail: `Scene ${si + 1} · view ${s.view}`, startF: s.start, endF: s.end, line: s.line, seg: s.id });
    add({ track: "cuts", type: "cut", label: `${s.clip} ${s.from.toFixed(2)}→${s.to.toFixed(2)}s`, detail: `Speaker cut: ${fmtClip(s.clip, s.from, s.to)} · voice from public/clips/${s.clip}.mp4, cut-out from public/alpha/${s.clip}.webm`, startF: s.start, endF: s.end, line: s.line, seg: s.id });
    if (si > 0) add({ track: "transitions", type: "transition", label: "cut", detail: `Hard cut from "${segs[si - 1].id}" to "${s.id}"`, startF: s.start, endF: s.start + 4, line: s.line, seg: s.id });

    // walk the view block
    const v = views[s.view];
    if (v) {
      const stack = [segRange];
      for (let i = v.start; i <= v.end; i++) {
        const l = lines[i];
        const top = stack[stack.length - 1];
        const ln = i + 1;
        const atM = l.match(/<(TitleAt|At) from=\{([^}]+)\} to=\{([^}]+)\}/);
        if (atM) {
          const a = num(atM[2], consts), b = num(atM[3], consts);
          stack.push({ a: top.a + a, b: Math.min(top.a + b, top.b) });
        }
        const r = stack[stack.length - 1];
        const range = { startF: abs(r.a), endF: abs(r.b) };
        const base = { seg: s.id, line: ln };
        if (/<(DarkBg|LightBg)/.test(l)) {
          const kind = l.includes("LightBg") ? "light studio (#EFF8FF)" : `dark ink #0D0303, glow ${attr(l, "accent") || "both"}`;
          add({ ...base, track: "background", type: "background", label: l.includes("LightBg") ? "Light bg" : `Dark bg${attr(l, "accent") ? " · " + attr(l, "accent") : ""}`, detail: `Background: ${kind} (src/components/Bg.tsx)`, startF: s.start, endF: s.end });
        }
        if (/<CouchWall/.test(l)) add({ ...base, track: "background", type: "effect", label: "Couch Wall", detail: "X2 Couch wall: tiled collage of public/wall/*.jpg (src/components/Effects.tsx)", startF: s.start, endF: s.end });
        if (/<Speaker clip=|<SpeakerCut |<HookSpeaker /.test(l)) {
          const ph = l.match(/phases=\{\[(.*)\]\}/);
          const fr = attr(l, "frame");
          add({ ...base, track: "speaker", type: "speaker", label: `Speaker ${s.clip}`, detail: `Cut-out speaker layer${l.includes("HookSpeaker") ? " · smooth zoom-out 0.96→0.88, 5 px down (HookSpeaker)" : ""}${fr ? " frame " + fr : ""}${ph ? " · moves at " + ph[1] : ""} (positions from src/layout.ts, face kept clear)`, startF: s.start, endF: s.end });
          if (ph) {
            const times = [...ph[1].matchAll(/\[([\d.]+),/g)].map((x) => +x[1]).filter((t) => t > 0);
            times.forEach((t) => add({ ...base, track: "transitions", type: "transition", label: "speaker move", detail: `Speaker scale/position change (7 frames ease) at local ${t}s`, startF: abs(t), endF: abs(t) + 7 }));
          }
        }
        if (/<WorkPhone/.test(l)) add({ ...base, track: "support", type: "support", label: "work.mp4 (corner)", detail: EXTRA.WorkPhone || "Corner phone mockup (WorkPhone)", startF: s.start + 11, endF: s.end });
        if (/<CamShake>/.test(l)) add({ ...base, track: "effects", type: "effect", label: "Hook camera", detail: "Hook camera: push-in 1.55→1.8 (f0–9), fast pull-back to 1.0 with motion blur (f9–21), decaying shake (f19–38), 5 px drift down (useHookCam)", startF: s.start, endF: s.start + 38 });
        if (/<FrameBreak/.test(l)) add({ ...base, track: "effects", type: "effect", label: "Frame Break", detail: "X4 Frame break: shot shrinks into a rounded frame, head pops out over the top edge (src/components/Effects.tsx)", startF: s.start, endF: s.end });
        if (/<GreenHook/.test(l)) add({ ...base, track: "titles", type: "title", label: `Hook: ${attr(l, "pill")} / ${attr(l, "line2")} / ${attr(l, "bigWord")}`, detail: `Green hook (blue reference rebuilt in lime): pill "${attr(l, "pill")}", typed "${attr(l, "line2")}", big word "${attr(l, "bigWord")}" (src/components/Hook.tsx)`, startF: s.start, endF: s.end });
        if (/<HookCardOut/.test(l)) add({ ...base, track: "transitions", type: "transition", label: "card-stack out", detail: "Previous scene (hook) shrinks into a tilted card and flies out (HookCardOut)", startF: s.start, endF: s.start + 20 });
        if (/<Title kind=/.test(l)) {
          const t = attr(l, "text"), sm = attr(l, "small"), k = attr(l, "kind");
          add({ ...base, track: "titles", type: "title", label: `${sm ? sm + " · " : ""}${t}`, detail: `Title "${t}"${sm ? ` (small line "${sm}")` : ""} · animation "${k}" (src/components/Titles.tsx)`, anim: k, ...range });
        }
        if (/<Chip text=/.test(l)) add({ ...base, track: "labels", type: "label", label: attr(l, "text"), detail: `Label chip "${attr(l, "text")}"${attr(l, "color") ? " colour " + attr(l, "color") : " (lime)"} (src/components/Effects.tsx Chip)`, ...range });
        const card = l.match(/<(\w+Card) dur/);
        if (card) add({ ...base, track: "cards", type: "card", label: card[1], detail: `Motion-graphic card ${card[1]} (src/components/Cards.tsx)`, ...range });
        if (/<Phone src=/.test(l)) {
          const src = attr(l, "src");
          const fname = src.split("/").pop();
          add({ ...base, track: "support", type: "support", label: `${fname}`, detail: `Phone mockup (${attr(l, "orientation")}) playing public/${src} = "${SUPPORT_SOURCES[fname] || fname}"${attr(l, "playbackRate") ? " at " + attr(l, "playbackRate") + "x" : ""}${attr(l, "startFrom") ? " from " + attr(l, "startFrom") : ""} (src/components/Phone.tsx)`, ...range });
        }
        if (/<Slide /.test(l)) {
          const from = attr(l, "from") || "top";
          add({ ...base, track: "transitions", type: "transition", label: `slide in (${from})`, detail: `Slide-in from ${from} (spring), slide-out over the last 7 frames (src/parts.tsx Slide)`, startF: range.startF, endF: range.startF + 12 });
        }
        if (/<\/(TitleAt|At)>/.test(l) && stack.length > 1) stack.pop();
      }
    }
    // sound effects
    s.sfx.forEach((x) => {
      const d = Math.min(mediaDur(path.join(root, "public", "sfx", x.file)), 3);
      add({ seg: s.id, line: x.line, track: "sfx", type: "sfx", label: x.file.replace(".mp3", ""), detail: `Sound effect public/sfx/${x.file} · volume ${x.vol} · at local ${x.t}s of scene "${s.id}"`, startF: abs(x.t), endF: abs(x.t) + Math.max(6, Math.round(d * FPS)) });
    });
    start += dur;
  });

  // background music (src/Main.tsx)
  const mainLines = fs.readFileSync(path.join(root, "src", "Main.tsx"), "utf8").split(/\r?\n/);
  const mLine = mainLines.findIndex((l) => l.includes('music/bg.mp3')) + 1;
  if (mLine > 0) add({ file: "src/Main.tsx", line: mLine, seg: segs[0].id, track: "music", type: "music", label: "music: " + (mainLines[mLine - 1].match(/music\/([^"]+)/) || [, "bg"])[1], detail: (EXTRA.music || "Background music") + " · volume from DEFAULT_MIX.musicVolume in src/Main.tsx · fades in/out", startF: 0, endF: start });
  return {
    project: cfg.project || path.basename(root),
    composition: "Main",
    timelineSource: "src/Segments.tsx (SEGS)",
    root,
    fps: FPS,
    width: 1080,
    height: 1920,
    durationInFrames: start,
    segments: segs.map((s) => ({ id: s.id, clip: s.clip, from: s.from, to: s.to, startF: s.start, endF: s.end, line: s.line, view: s.view })),
    elements: els,
  };
};

if (process.argv[1] && process.argv[1].endsWith("manifest.mjs")) {
  const root = process.argv[2] || process.cwd();
  const cfgFile = process.env.REVIEW_CONFIG ? path.resolve(root, process.env.REVIEW_CONFIG) : null;
  const m = buildManifest(root, cfgFile ? JSON.parse(fs.readFileSync(cfgFile, "utf8")) : undefined);
  const by = {};
  m.elements.forEach((e) => (by[e.track] = (by[e.track] || 0) + 1));
  console.log("frames", m.durationInFrames, "scenes", m.segments.length, by);
}
