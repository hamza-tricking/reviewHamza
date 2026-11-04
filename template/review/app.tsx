import "./base";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Player, PlayerRef } from "@remotion/player";
import { Component, COMPOSITION, MIX } from "review-target"; // resolved by server.mjs from review.config.json (default: Main + DEFAULT_MIX)

// ---------------- types ----------------
type El = { id: string; track: string; type: string; label: string; detail: string; startF: number; endF: number; line: number; file: string; seg: string; anim?: string };
type Seg = { id: string; clip: string; from: number; to: number; startF: number; endF: number; line: number; view: string };
type Manifest = { project: string; root: string; fps: number; width: number; height: number; durationInFrames: number; segments: Seg[]; elements: El[]; composition?: string; timelineSource?: string };
type TimeRef = { id: string; a: number; b: number };
type Target = { kind: "el"; id: string } | { kind: "time"; a: number; b: number };
type Comment = { id: string; targets: Target[]; text: string; created: string };

const TRACKS: { key: string; name: string; icon: string; bg: string; fg: string }[] = [
  { key: "scene", name: "Scenes", icon: "▦", bg: "#ECE9FF", fg: "#4B3CC9" },
  { key: "cuts", name: "Cuts · voice", icon: "✂", bg: "#FFEBDB", fg: "#B4570F" },
  { key: "background", name: "Background", icon: "◐", bg: "#E6EDF5", fg: "#3E556C" },
  { key: "speaker", name: "Speaker", icon: "◉", bg: "#DFF1FD", fg: "#0A6597" },
  { key: "support", name: "Phone videos", icon: "▯", bg: "#DDF7E6", fg: "#167340" },
  { key: "titles", name: "Titles", icon: "T", bg: "#EEFBC4", fg: "#4D6406" },
  { key: "labels", name: "Labels", icon: "◖", bg: "#FFF3C4", fg: "#94600A" },
  { key: "cards", name: "Motion cards", icon: "▤", bg: "#FCE6F1", fg: "#B0185A" },
  { key: "effects", name: "Effects", icon: "✦", bg: "#FFE0EA", fg: "#E0004B" },
  { key: "transitions", name: "Transitions", icon: "⇄", bg: "#EEEAFE", fg: "#6A3FD8" },
  { key: "sfx", name: "Sound FX", icon: "♪", bg: "#E3E8FF", fg: "#3B3FC2" },
  { key: "music", name: "Music", icon: "♫", bg: "#FFE8D9", fg: "#A4470E" },
];
const trackOf = (k: string) => TRACKS.find((t) => t.key === k) || TRACKS[0];

const fmt = (f: number, fps = 30) => {
  const s = f / fps;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, "0")}:${r.toFixed(2).padStart(5, "0")}`;
};

const short = (e: El) => `${e.type}: ${e.label}`.slice(0, 48);

// ---------------- prompt builder ----------------
const buildMarkdown = (m: Manifest, text: string, times: Record<string, TimeRef>, comments: Comment[], includeComments: boolean) => {
  const els = Object.fromEntries(m.elements.map((e) => [e.id, e]));
  const segAt = (f: number) => m.segments.find((s) => f >= s.startF && f < s.endF) || m.segments[m.segments.length - 1];
  const loc = (e: El) => {
    const s = m.segments.find((x) => x.id === e.seg)!;
    return `scene "${s.id}" local ${((e.startF - s.startF) / m.fps).toFixed(2)}–${((e.endF - s.startF) / m.fps).toFixed(2)} s`;
  };
  const elLine = (e: El) =>
    `- **#${e.id}** [${e.type}] ${e.label}\n  - ${e.detail}\n  - global ${fmt(e.startF)}–${fmt(e.endF)} (frames ${e.startF}–${e.endF}) · ${loc(e)}\n  - source: \`${e.file}:${e.line}\``;
  const active = (a: number, b: number) =>
    m.elements.filter((e) => e.track !== "scene" && e.track !== "cuts" && e.startF < Math.max(b, a + 1) && e.endF > a).map((e) => `#${e.id} ${e.type} "${e.label}"`);
  const timeLine = (t: TimeRef) => {
    const s1 = segAt(t.a), s2 = segAt(Math.max(t.a, t.b - 1));
    const point = t.a === t.b;
    const scenes = s1.id === s2.id ? `scene "${s1.id}" local ${((t.a - s1.startF) / m.fps).toFixed(2)}${point ? "" : "–" + ((t.b - s1.startF) / m.fps).toFixed(2)} s` : `scenes "${s1.id}" → "${s2.id}"`;
    return `- **@${t.id}** [${point ? "time point" : "time range"}] ${fmt(t.a)}${point ? "" : "–" + fmt(t.b)} (frame${point ? " " + t.a : "s " + t.a + "–" + t.b}) · ${scenes}\n  - on screen: ${active(t.a, t.b).join(", ") || "speaker only"}`;
  };

  const usedEl = [...new Set([...text.matchAll(/\[#(E\d+)[^\]]*\]/g)].map((x) => x[1]))].filter((id) => els[id]);
  const usedT = [...new Set([...text.matchAll(/\[@(T\d+)[^\]]*\]/g)].map((x) => x[1]))].filter((id) => times[id]);
  const cm = includeComments ? comments : [];

  let md = `# Remotion edit request — ${m.project}\n\n`;
  md += `Project: \`${m.root}\` · composition **${m.composition || COMPOSITION}** · ${m.width}x${m.height} · ${m.fps} fps · ${m.durationInFrames} frames (${fmt(m.durationInFrames)})\n`;
  md += `Timeline is defined in \`${m.timelineSource || "src/Segments.tsx"}\`. Times are global unless marked local. Change only what is asked; do not render.\n\n`;
  if (text.trim()) md += `## What I want\n\n${text.trim()}\n\n`;
  if (usedEl.length || usedT.length) {
    md += `## References\n\n`;
    usedEl.forEach((id) => (md += elLine(els[id]) + "\n"));
    usedT.forEach((id) => (md += timeLine(times[id]) + "\n"));
    md += "\n";
  }
  if (cm.length) {
    md += `## Comments on the timeline\n\n`;
    cm.forEach((c, i) => {
      const tg = c.targets
        .map((t) => (t.kind === "el" ? (els[t.id] ? `#${t.id} ${els[t.id].type} "${els[t.id].label}" at ${fmt(els[t.id].startF)}–${fmt(els[t.id].endF)} (\`${els[t.id].file}:${els[t.id].line}\`)` : `#${t.id} (missing)`) : `time ${fmt(t.a)}${t.a === t.b ? "" : "–" + fmt(t.b)} (frames ${t.a}${t.a === t.b ? "" : "–" + t.b}, scene "${segAt(t.a).id}")`))
        .join("; ");
      md += `${i + 1}. On ${tg}\n   > ${c.text.replace(/\n/g, "\n   > ")}\n`;
      c.targets.forEach((t) => { if (t.kind === "el" && els[t.id] && !usedEl.includes(t.id)) md += `   ${elLine(els[t.id]).replace(/\n/g, "\n   ")}\n`; });
    });
  }
  return md;
};

// ---------------- popover (closes on outside click + Escape) ----------------
const CommentPopover: React.FC<{ x: number; y: number; title: string; initial?: string; onSave: (t: string) => void; onClose: () => void }> = ({ x, y, title, initial = "", onSave, onClose }) => {
  const [t, setT] = useState(initial);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const W = Math.min(360, window.innerWidth - 24);
  const left = Math.max(12, Math.min(x - W / 2, window.innerWidth - W - 12));
  const top = Math.max(12, Math.min(y - 230, window.innerHeight - 300));
  return (
    <div onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(242,244,248,0.25)" }}>
      <div className="glass" onMouseDown={(e) => e.stopPropagation()} style={{ position: "absolute", left, top, width: W, padding: 16, background: "rgba(255,255,255,0.86)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>💬 Comment</div>
          <button className="btn ghost" style={{ padding: "4px 8px" }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ fontSize: 12, color: "var(--ink2)", marginBottom: 10, lineHeight: 1.4 }}>{title}</div>
        <textarea autoFocus value={t} onChange={(e) => setT(e.target.value)} placeholder="e.g. I don't like this sound effect, use whoosh_motion.mp3 instead"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && t.trim()) onSave(t.trim()); }}
          style={{ width: "100%", height: 110, resize: "none", border: "1px solid var(--line)", borderRadius: 12, padding: 12, fontSize: 13.5, outline: "none", background: "rgba(255,255,255,0.9)" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
          <span className="token-hint">Ctrl+Enter to save · Esc to close</span>
          <button className="btn primary" disabled={!t.trim()} onClick={() => onSave(t.trim())}>Save comment</button>
        </div>
      </div>
    </div>
  );
};

// ---------------- timeline ----------------
const COMPACT = typeof window !== "undefined" && window.innerWidth < 640; // phones: icon-only track labels
const LABEL_W = COMPACT ? 78 : 150;
const ROW_H = 32;

const layoutLanes = (els: El[]) => {
  const sorted = [...els].sort((a, b) => a.startF - b.startF || b.endF - a.endF);
  const lanes: number[] = [];
  const lane: Record<string, number> = {};
  sorted.forEach((e) => {
    let i = lanes.findIndex((end) => end <= e.startF);
    if (i < 0) { i = lanes.length; lanes.push(0); }
    lanes[i] = e.endF;
    lane[e.id] = i;
  });
  return { lane, count: Math.max(1, lanes.length) };
};

const Timeline: React.FC<{
  m: Manifest;
  frame: number;
  pxf: number;
  selected: Set<string>;
  commentCount: Record<string, number>;
  commentTimes: Comment[];
  hidden: Set<string>;
  onElClick: (e: El, ev: React.MouseEvent) => void;
  onTime: (a: number, b: number, ev: { clientX: number; clientY: number }) => void;
  onHover: (e: El | null) => void;
}> = ({ m, frame, pxf, selected, commentCount, commentTimes, hidden, onElClick, onTime, onHover }) => {
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const width = m.durationInFrames * pxf;
  const byTrack = useMemo(() => {
    const o: Record<string, { els: El[]; lane: Record<string, number>; count: number }> = {};
    TRACKS.forEach((t) => {
      const els = m.elements.filter((e) => e.track === t.key);
      o[t.key] = { els, ...layoutLanes(els) };
    });
    return o;
  }, [m]);

  // keep the playhead visible while playing
  useEffect(() => {
    const s = scroller.current;
    if (!s) return;
    const x = frame * pxf;
    if (x < s.scrollLeft || x > s.scrollLeft + s.clientWidth - LABEL_W - 40) s.scrollLeft = Math.max(0, x - 120);
  }, [frame, pxf]);

  const frameAt = (clientX: number) => {
    const r = scroller.current!.getBoundingClientRect();
    const x = clientX - r.left - LABEL_W + scroller.current!.scrollLeft;
    return Math.max(0, Math.min(m.durationInFrames, Math.round(x / pxf)));
  };
  const onRulerDown = (ev: React.PointerEvent<HTMLDivElement>) => {
    ev.preventDefault();
    const el = ev.currentTarget;
    el.setPointerCapture(ev.pointerId);
    const a = frameAt(ev.clientX);
    setDrag({ a, b: a });
    const move = (e: PointerEvent) => setDrag({ a, b: frameAt(e.clientX) });
    const up = (e: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      const b = frameAt(e.clientX);
      setDrag(null);
      const lo = Math.min(a, b), hi = Math.max(a, b);
      onTime(lo, hi - lo < 3 ? lo : hi, { clientX: e.clientX, clientY: e.clientY });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const step = pxf * 30 >= 40 ? 1 : pxf * 30 >= 16 ? 2 : 5;
  const ticks = [];
  for (let s = 0; s <= m.durationInFrames / 30; s += step) ticks.push(s);

  return (
    <div ref={scroller} style={{ overflow: "auto", height: "100%", position: "relative" }}>
      <div style={{ width: width + LABEL_W + 40, position: "relative", minHeight: "100%" }}>
        {/* ruler */}
        <div style={{ position: "sticky", top: 0, zIndex: 6, display: "flex", height: 34 }}>
          <div style={{ position: "sticky", left: 0, width: LABEL_W, flex: "none", zIndex: 7, background: "rgba(255,255,255,0.9)", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", paddingLeft: COMPACT ? 8 : 14, fontSize: 11, color: "var(--mute)", fontWeight: 600, letterSpacing: 0.4 }}>
            {COMPACT ? "↔" : "TIME ↔ drag"}
          </div>
          <div onPointerDown={onRulerDown} style={{ position: "relative", width, cursor: "crosshair", userSelect: "none", touchAction: "none", background: "rgba(255,255,255,0.75)", borderBottom: "1px solid var(--line)" }}>
            {ticks.map((s) => (
              <div key={s} style={{ position: "absolute", left: s * 30 * pxf, top: 0, height: "100%", borderLeft: `1px solid ${s % 5 === 0 ? "rgba(20,18,28,0.25)" : "rgba(20,18,28,0.1)"}` }}>
                {(s % 5 === 0 || step >= 2) && <span style={{ position: "absolute", left: 4, top: 8, fontSize: 10.5, color: "var(--ink2)", fontWeight: 600 }}>{fmt(s * 30).slice(0, 5)}</span>}
              </div>
            ))}
            {commentTimes.flatMap((c) => c.targets.filter((t) => t.kind === "time").map((t, i) => (t.kind === "time" ? <div key={c.id + i} title={c.text} style={{ position: "absolute", left: t.a * pxf, width: Math.max(8, (t.b - t.a) * pxf), bottom: 2, height: 6, borderRadius: 3, background: "var(--pink)" }} /> : null)))}
            {drag && <div style={{ position: "absolute", left: Math.min(drag.a, drag.b) * pxf, width: Math.max(2, Math.abs(drag.b - drag.a) * pxf), top: 0, bottom: 0, background: "rgba(187,239,31,0.55)", borderLeft: "2px solid var(--lime-ink)", borderRight: "2px solid var(--lime-ink)" }} />}
          </div>
        </div>

        {/* tracks */}
        {TRACKS.filter((t) => !hidden.has(t.key)).map((t) => {
          const tr = byTrack[t.key];
          const h = tr.count * ROW_H + 8;
          return (
            <div key={t.key} style={{ display: "flex", height: h, borderBottom: "1px solid var(--line)" }}>
              <div style={{ position: "sticky", left: 0, zIndex: 5, width: LABEL_W, flex: "none", background: "rgba(255,255,255,0.86)", display: "flex", alignItems: "center", gap: COMPACT ? 6 : 10, paddingLeft: COMPACT ? 8 : 14, fontSize: 12.5, fontWeight: 600, color: "var(--ink2)", borderRight: "1px solid var(--line)" }}>
                <span style={{ width: 24, height: 24, borderRadius: 8, background: t.bg, color: t.fg, display: "grid", placeItems: "center", fontSize: 12 }}>{t.icon}</span>
                {!COMPACT && t.name}
                <span style={{ marginLeft: "auto", marginRight: COMPACT ? 6 : 10, fontSize: 10.5, color: "var(--mute)" }}>{tr.els.length}</span>
              </div>
              <div style={{ position: "relative", width }}>
                {tr.els.map((e) => {
                  const w = Math.max(t.key === "transitions" ? 14 : 10, (e.endF - e.startF) * pxf - 2);
                  const cc = commentCount[e.id] || 0;
                  return (
                    <div key={e.id} className={`tl-el${selected.has(e.id) ? " sel" : ""}`}
                      onMouseDown={(ev) => ev.stopPropagation()}
                      onClick={(ev) => onElClick(e, ev)}
                      onMouseEnter={() => onHover(e)} onMouseLeave={() => onHover(null)}
                      style={{ left: e.startF * pxf + 1, top: 4 + tr.lane[e.id] * ROW_H, width: w, background: t.bg, color: t.fg, borderColor: `${t.fg}33`, direction: /[؀-ۿ]/.test(e.label) ? "rtl" : "ltr", fontFamily: /[؀-ۿ]/.test(e.label) ? "DARK, Inter" : undefined }}>
                      {w > 40 && e.label}
                      {cc > 0 && <span style={{ position: "absolute", right: 3, top: 3, minWidth: 16, height: 16, borderRadius: 8, background: "var(--pink)", color: "#fff", fontSize: 10, display: "grid", placeItems: "center", fontFamily: "Inter" }}>{cc}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* playhead */}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: LABEL_W + frame * pxf, width: 2, background: "var(--pink)", zIndex: 8, pointerEvents: "none", boxShadow: "0 0 10px rgba(255,0,85,0.5)" }}>
          <div style={{ position: "absolute", top: 0, left: -6, width: 14, height: 14, borderRadius: 7, background: "var(--pink)" }} />
        </div>
      </div>
    </div>
  );
};

// ---------------- app ----------------
const App: React.FC = () => {
  const [m, setM] = useState<Manifest | null>(null);
  const [frame, setFrame] = useState(0);
  const [mode, setMode] = useState<"prompt" | "comment">("prompt");
  const [text, setText] = useState(() => { try { return localStorage.getItem("rd-text") || ""; } catch { return ""; } });
  const [times, setTimes] = useState<Record<string, TimeRef>>(() => { try { return JSON.parse(localStorage.getItem("rd-times") || "{}"); } catch { return {}; } });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<El | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [pop, setPop] = useState<{ x: number; y: number; targets: Target[]; title: string } | null>(null);
  const [pxf, setPxf] = useState(5);
  const [toast, setToast] = useState<string | null>(null);
  const [includeComments, setIncludeComments] = useState(true);
  const [autoTime, setAutoTime] = useState(true);
  const [showMd, setShowMd] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const player = useRef<PlayerRef>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  const keepCaret = (e: React.SyntheticEvent<HTMLTextAreaElement>) => { caret.current = e.currentTarget.selectionStart; };

  const load = useCallback(() => fetch("/api/manifest").then((r) => r.json()).then(setM), []);
  useEffect(() => { load(); fetch("/api/comments").then((r) => r.json()).then(setComments); }, [load]);
  useEffect(() => { try { localStorage.setItem("rd-text", text); localStorage.setItem("rd-times", JSON.stringify(times)); } catch {} }, [text, times]);
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const h = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    p.addEventListener("frameupdate", h);
    p.addEventListener("seeked", h);
    return () => { p.removeEventListener("frameupdate", h); p.removeEventListener("seeked", h); };
  }, [m]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); } }, [toast]);

  const saveComments = (c: Comment[]) => { setComments(c); fetch("/api/comments", { method: "POST", body: JSON.stringify(c) }); };
  const seek = (f: number) => { player.current?.seekTo(f); setFrame(f); };

  const insert = (snippet: string) => {
    const el = ta.current;
    const pos = caret.current === null ? text.length : Math.min(caret.current, text.length);
    const before = text.slice(0, pos);
    const pad = before && !/\s$/.test(before) ? " " : "";
    const next = before + pad + snippet + " " + text.slice(pos);
    setText(next);
    const c = pos + pad.length + snippet.length + 1;
    caret.current = c;
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(c, c); } });
  };
  const tokenFor = (e: El) => `[#${e.id} ⁨${short(e)}⁩ @${fmt(e.startF)}]`;

  const onElClick = (e: El, ev: React.MouseEvent) => {
    seek(e.startF);
    if (ev.ctrlKey || ev.metaKey || ev.shiftKey) {
      const s = new Set(selected);
      s.has(e.id) ? s.delete(e.id) : s.add(e.id);
      setSelected(s);
      return;
    }
    setSelected(new Set([e.id]));
    if (mode === "prompt") insert(tokenFor(e));
    else setPop({ x: ev.clientX, y: ev.clientY, targets: [{ kind: "el", id: e.id }], title: `${e.type} · ⁨${e.label}⁩ · ${fmt(e.startF)}–${fmt(e.endF)}` });
  };
  const onTime = (a: number, b: number, ev: { clientX: number; clientY: number }) => {
    seek(a);
    if (mode === "comment") {
      setPop({ x: ev.clientX, y: ev.clientY, targets: [{ kind: "time", a, b }], title: a === b ? `Time point ${fmt(a)} (frame ${a})` : `Time range ${fmt(a)}–${fmt(b)} (frames ${a}–${b})` });
      return;
    }
    if (!autoTime) return;
    const id = `T${Object.keys(times).length + 1}`;
    setTimes({ ...times, [id]: { id, a, b } });
    insert(a === b ? `[@${id} ${fmt(a)}]` : `[@${id} ${fmt(a)}→${fmt(b)}]`);
  };
  const insertSelected = () => {
    if (!m) return;
    const els = m.elements.filter((e) => selected.has(e.id)).sort((a, b) => a.startF - b.startF);
    if (mode === "prompt") insert(els.map(tokenFor).join(" "));
    else setPop({ x: window.innerWidth / 2, y: window.innerHeight / 2, targets: els.map((e) => ({ kind: "el", id: e.id }) as Target), title: `${els.length} elements: ${els.map((e) => "⁨" + e.label + "⁩").join(", ")}` });
  };

  const md = useMemo(() => (m ? buildMarkdown(m, text, times, comments, includeComments) : ""), [m, text, times, comments, includeComments]);
  const refEls = useMemo(() => (m ? [...new Set([...text.matchAll(/\[#(E\d+)[^\]]*\]/g)].map((x) => x[1]))].map((id) => m.elements.find((e) => e.id === id)).filter(Boolean) as El[] : []), [m, text]);
  const refTimes = useMemo(() => [...new Set([...text.matchAll(/\[@(T\d+)[^\]]*\]/g)].map((x) => x[1]))].map((id) => times[id]).filter(Boolean), [text, times]);
  const commentCount = useMemo(() => {
    const o: Record<string, number> = {};
    comments.forEach((c) => c.targets.forEach((t) => { if (t.kind === "el") o[t.id] = (o[t.id] || 0) + 1; }));
    return o;
  }, [comments]);

  const send = async () => {
    const r = await fetch("/api/request", { method: "POST", body: JSON.stringify({ markdown: md }) }).then((x) => x.json());
    try { await navigator.clipboard.writeText(md); } catch {}
    setToast(`Saved for Claude → ${r.latest}  ·  also copied to clipboard. In the chat just say: "apply review"`);
  };

  if (!m) return <div style={{ padding: 40, fontWeight: 600 }}>Loading the timeline…</div>;
  const inspect = hover || (selected.size === 1 ? m.elements.find((e) => selected.has(e.id)) || null : null);
  const curSeg = m.segments.find((s) => frame >= s.startF && frame < s.endF);
  const nothing = !text.trim() && !(includeComments && comments.length);

  return (
    <div className="app">
      {/* header */}
      <div className="glass hdr">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 11, background: "linear-gradient(135deg, var(--lime), #e8ff9a)", display: "grid", placeItems: "center", fontFamily: "InterTight", fontWeight: 800, boxShadow: "0 4px 14px rgba(187,239,31,0.6)" }}>R</div>
          <div>
            <div style={{ fontFamily: "InterTight", fontWeight: 800, fontSize: 16, letterSpacing: -0.2 }}>Review Desk</div>
            <div style={{ fontSize: 11.5, color: "var(--mute)" }}>{m.project} · {m.composition || COMPOSITION} · {m.segments.length} scenes · {m.elements.length} elements</div>
          </div>
        </div>
        <div className="seg hdr-seg">
          <button className={mode === "prompt" ? "on" : ""} onClick={() => setMode("prompt")}>✍️ Prompt mode</button>
          <button className={mode === "comment" ? "on" : ""} onClick={() => setMode("comment")}>💬 Comment mode</button>
        </div>
        <div className="hint">
          {mode === "prompt" ? "Click an element or the time ruler to insert it into the prompt · drag the ruler for a range" : "Click an element or the ruler to pin a comment on it"}
        </div>
        <div className="hdr-right">
          <span style={{ fontFamily: "InterTight", fontWeight: 800, fontSize: 18, fontVariantNumeric: "tabular-nums" }}>{fmt(frame)}</span>
          <span className="kbd hide-sm">frame {frame}</span>
          {curSeg && <span className="kbd" style={{ background: "#ECE9FF", color: "#4B3CC9" }}>{curSeg.id}</span>}
          <button className="btn" onClick={load} title="Re-read src/Segments.tsx">↻ Reload timeline</button>
        </div>
      </div>

      {/* middle */}
      <div className="mid">
        <div className="glass pane-player">
          <div className="player-box">
            <Player ref={player} component={Component} inputProps={MIX} durationInFrames={m.durationInFrames} fps={m.fps}
              compositionWidth={m.width} compositionHeight={m.height} style={{ width: "100%", height: "100%" }} controls clickToPlay spaceKeyToPlayOrPause numberOfSharedAudioTags={0} acknowledgeRemotionLicense />
          </div>
        </div>

        {/* composer */}
        <div className="glass pane-composer">
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontFamily: "InterTight", fontWeight: 800, fontSize: 15 }}>Message to Claude</div>
            <label style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink2)", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={autoTime} onChange={(e) => setAutoTime(e.target.checked)} /> Ruler click inserts time
            </label>
          </div>
          <textarea ref={ta} value={text} onChange={(e) => { setText(e.target.value); keepCaret(e); }} onSelect={keepCaret} onClick={keepCaret} onKeyUp={keepCaret} dir="auto"
            placeholder={"Explain what to change. Click any block in the timeline to insert its exact reference here, e.g.\n\"Make the title [#E49 title: الألوان @00:16.23] slower and swap [#E120 sfx: whoosh_light @00:16.20] for a softer whoosh.\"\nDrag on the time ruler to point at a range."}
            className="composer-ta" style={{ resize: "none", border: "1px solid var(--line)", borderRadius: 16, padding: 16, fontSize: 14.5, lineHeight: 1.6, outline: "none", background: "rgba(255,255,255,0.75)", color: "var(--ink)" }} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 74, overflow: "auto" }}>
            {refEls.map((e) => {
              const t = trackOf(e.track);
              return <span key={e.id} onClick={() => seek(e.startF)} title={e.detail} style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 600, padding: "5px 10px", borderRadius: 999, background: t.bg, color: t.fg }}>#{e.id} {e.label.slice(0, 26)} · {fmt(e.startF)}</span>;
            })}
            {refTimes.map((t) => <span key={t.id} onClick={() => seek(t.a)} style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 600, padding: "5px 10px", borderRadius: 999, background: "rgba(187,239,31,0.45)", color: "var(--lime-ink)" }}>@{t.id} {fmt(t.a)}{t.a !== t.b ? "→" + fmt(t.b) : ""}</span>)}
            {!refEls.length && !refTimes.length && <span className="token-hint">No references yet — they appear here as you click the timeline.</span>}
          </div>
          <div className="comp-actions">
            <label style={{ fontSize: 12, color: "var(--ink2)", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={includeComments} onChange={(e) => setIncludeComments(e.target.checked)} /> Include {comments.length} comment{comments.length === 1 ? "" : "s"}
            </label>
            <button className="btn ghost" onClick={() => setShowMd(true)}>👁 What Claude receives</button>
            <button className="btn ghost" onClick={() => { setText(""); setTimes({}); caret.current = null; }}>Clear</button>
            <button className="btn primary" style={{ marginLeft: "auto" }} disabled={nothing} onClick={send}>➤ Send to Claude</button>
          </div>
        </div>

        {/* inspector + comments */}
        <div className="pane-side">
          <div className="glass pane-inspector">
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--mute)", letterSpacing: 0.5, marginBottom: 8 }}>INSPECTOR</div>
            {inspect ? (
              <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <span style={{ padding: "3px 9px", borderRadius: 999, background: trackOf(inspect.track).bg, color: trackOf(inspect.track).fg, fontWeight: 600, fontSize: 11 }}>{inspect.type}</span>
                  <span style={{ fontWeight: 600 }} dir="auto">{inspect.label}</span>
                </div>
                <div style={{ color: "var(--ink2)" }}>{inspect.detail}</div>
                <div style={{ marginTop: 6, color: "var(--mute)", fontVariantNumeric: "tabular-nums" }}>{fmt(inspect.startF)} → {fmt(inspect.endF)} · frames {inspect.startF}–{inspect.endF} · <code>{inspect.file}:{inspect.line}</code></div>
              </div>
            ) : <div className="token-hint">Hover a block in the timeline to see exactly what it is and where it lives in the code.</div>}
          </div>
          <div className="glass pane-comments">
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--mute)", letterSpacing: 0.5 }}>COMMENTS · {comments.length}</div>
              {comments.length > 0 && <button className="btn ghost" style={{ marginLeft: "auto", padding: "4px 8px", fontSize: 12 }} onClick={() => saveComments([])}>Clear all</button>}
            </div>
            <div className="comments-list">
              {comments.length === 0 && <div className="token-hint">Switch to 💬 Comment mode and click any element (or drag on the ruler) to pin a note.</div>}
              {comments.map((c) => {
                const first = c.targets[0];
                const f = first.kind === "el" ? m.elements.find((e) => e.id === first.id)?.startF ?? 0 : first.a;
                const name = c.targets.map((t) => (t.kind === "el" ? m.elements.find((e) => e.id === t.id)?.label || t.id : `${fmt(t.a)}${t.a !== t.b ? "→" + fmt(t.b) : ""}`)).join(", ");
                return (
                  <div key={c.id} onClick={() => seek(f)} style={{ cursor: "pointer", padding: 10, borderRadius: 14, background: "rgba(255,255,255,0.7)", border: "1px solid var(--line)" }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, color: "var(--mute)" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--pink)" }} />
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(f)}</span>
                      <span dir="auto" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "min(180px, 40vw)" }}>{name}</span>
                      <button className="btn ghost" style={{ marginLeft: "auto", padding: "2px 6px", fontSize: 11 }} onClick={(ev) => { ev.stopPropagation(); saveComments(comments.filter((x) => x.id !== c.id)); }}>✕</button>
                    </div>
                    <div dir="auto" style={{ fontSize: 13, marginTop: 4 }}>{c.text}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* timeline */}
      <div className="glass pane-tl">
        <div className="tl-bar">
          <div style={{ fontFamily: "InterTight", fontWeight: 800, fontSize: 14 }}>Timeline</div>
          <div className="tl-chips">
            {TRACKS.map((t) => (
              <button key={t.key} onClick={() => { const s = new Set(hidden); s.has(t.key) ? s.delete(t.key) : s.add(t.key); setHidden(s); }}
                style={{ border: 0, fontSize: 11, fontWeight: 600, padding: "4px 9px", borderRadius: 999, background: hidden.has(t.key) ? "rgba(20,18,28,0.05)" : t.bg, color: hidden.has(t.key) ? "var(--mute)" : t.fg, textDecoration: hidden.has(t.key) ? "line-through" : "none" }}>
                {t.icon} {t.name}
              </button>
            ))}
          </div>
          {selected.size > 1 && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "4px 6px 4px 12px", borderRadius: 999, background: "var(--ink)", color: "#fff", fontSize: 12 }}>
              {selected.size} selected
              <button className="btn lime" style={{ padding: "5px 10px", borderRadius: 999 }} onClick={insertSelected}>{mode === "prompt" ? "Insert into prompt" : "Comment on all"}</button>
              <button className="btn" style={{ padding: "5px 10px", borderRadius: 999 }} onClick={() => setSelected(new Set())}>✕</button>
            </div>
          )}
          <div className="tl-tools">
            <span className="kbd hide-sm">Ctrl/Shift+click = multi-select</span>
            Zoom
            <input type="range" min={1} max={16} step={0.5} value={pxf} onChange={(e) => setPxf(+e.target.value)} />
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <Timeline m={m} frame={frame} pxf={pxf} selected={selected} commentCount={commentCount} commentTimes={comments} hidden={hidden} onElClick={onElClick} onTime={onTime} onHover={setHover} />
        </div>
      </div>

      {pop && (
        <CommentPopover x={pop.x} y={pop.y} title={pop.title} onClose={() => setPop(null)}
          onSave={(t) => { saveComments([...comments, { id: `C${Date.now()}`, targets: pop.targets, text: t, created: new Date().toISOString() }]); setPop(null); setSelected(new Set()); }} />
      )}

      {showMd && (
        <div onMouseDown={() => setShowMd(false)} onKeyDown={(e) => e.key === "Escape" && setShowMd(false)} tabIndex={-1} ref={(d) => d?.focus()} style={{ position: "fixed", inset: 0, zIndex: 45, background: "rgba(242,244,248,0.55)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center" }}>
          <div className="glass" onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(860px, 92vw)", maxHeight: "80vh", display: "flex", flexDirection: "column", background: "rgba(255,255,255,0.9)" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ fontFamily: "InterTight", fontWeight: 800 }}>What Claude receives</div>
              <button className="btn ghost" style={{ marginLeft: "auto" }} onClick={() => setShowMd(false)}>✕</button>
            </div>
            <pre dir="auto" style={{ margin: 0, padding: 18, overflow: "auto", fontSize: 12.5, lineHeight: 1.55, whiteSpace: "pre-wrap", fontFamily: "Consolas, monospace" }}>{md}</pre>
          </div>
        </div>
      )}

      {toast && <div className="glass toast" style={{ background: "rgba(255,255,255,0.92)" }}>✅ {toast}</div>}
    </div>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
