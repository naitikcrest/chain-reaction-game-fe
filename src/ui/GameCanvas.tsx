import type { GameEvent, GameState, Grid } from "../shared/types";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { playExplosion, playPlace } from "../util/sfx";

type Props = {
  state: GameState | null;
  myPlayerId: string | null;
  canInteract: boolean;
  lastEventsAt: number;
  eventBatch: { moveNumber: number; events: GameEvent[] } | null;
  transition: { moveNumber: number; from: Grid; to: Grid } | null;
  speed: number;
  replayToken: number;
  onCellClick: (row: number, col: number) => void;
};

type AnimCell = {
  pulseUntil: number;
  shakeUntil: number;
};

type Particle = {
  from: { row: number; col: number };
  to: { row: number; col: number };
  startAt: number;
  durationMs: number;
  color: string;
  // slight orbit offset so particles don't stack perfectly
  lane: number;
};

type Ripple = {
  row: number;
  col: number;
  startAt: number;
  durationMs: number;
  color: string;
};

type ScheduledAction =
  | { at: number; type: "cell"; row: number; col: number; ownerId: string | null; orbCount: number; bounce?: boolean }
  | { at: number; type: "particle"; fromRow: number; fromCol: number; toRow: number; toCol: number; color: string; lane: number }
  | { at: number; type: "ripple"; row: number; col: number; color: string }
  | { at: number; type: "boardShake"; intensity: number; durationMs: number };

export function GameCanvas(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [size, setSize] = useState({ w: 840, h: 560 });
  const animRef = useRef<Map<string, AnimCell>>(new Map());
  const lastMoveAtRef = useRef<number>(0);

  // Visual grid is animated progressively to match server event stream.
  const visualGridRef = useRef<Grid | null>(null);

  const scheduledRef = useRef<ScheduledAction[]>([]);
  const scheduleIdxRef = useRef<number>(0);
  const scheduleStartAtRef = useRef<number>(0);

  const particlesRef = useRef<Particle[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const boardShakeRef = useRef<{ until: number; intensity: number }>({ until: 0, intensity: 0 });

  const dims = useMemo(() => {
    const rows = props.state?.rows ?? 9;
    const cols = props.state?.cols ?? 6;
    return { rows, cols };
  }, [props.state?.rows, props.state?.cols]);

  const DEBUG_CELL_BORDERS = false;

  // Capture authoritative grid for smooth transitions / resets.
  useEffect(() => {
    if (!props.state) {
      visualGridRef.current = null;
      scheduledRef.current = [];
      scheduleIdxRef.current = 0;
      particlesRef.current = [];
      ripplesRef.current = [];
      return;
    }
    if (!visualGridRef.current) {
      visualGridRef.current = cloneGrid(props.state.grid);
    }
  }, [props.state]);

  function startDiffQueue(from: Grid, to: Grid) {
    // Reset visual grid to the previous authoritative state, then apply steps gradually.
    visualGridRef.current = cloneGrid(from);
    particlesRef.current = [];
    ripplesRef.current = [];
    scheduledRef.current = buildScheduleFromDiff(from, to, props.speed);
    scheduleIdxRef.current = 0;
    scheduleStartAtRef.current = performance.now();
  }

  function applyAction(action: ScheduledAction, now: number) {
    if (action.type === "cell") {
      if (!visualGridRef.current) return;
      const cell = visualGridRef.current[action.row]?.[action.col];
      if (!cell) return;
      cell.ownerId = action.ownerId;
      cell.orbCount = action.orbCount;
      if (action.bounce) {
        animRef.current.set(`${action.row},${action.col}`, { pulseUntil: now + 260, shakeUntil: now + 160 });
      }
      return;
    }
    if (action.type === "particle") {
      particlesRef.current.push({
        from: { row: action.fromRow, col: action.fromCol },
        to: { row: action.toRow, col: action.toCol },
        startAt: now,
        durationMs: 180,
        color: action.color,
        lane: action.lane
      });
      return;
    }
    if (action.type === "ripple") {
      ripplesRef.current.push({ row: action.row, col: action.col, startAt: now, durationMs: 260, color: action.color });
      // explosion sound (bonus)
      playExplosion();
      return;
    }
    if (action.type === "boardShake") {
      const intensity = Math.max(boardShakeRef.current.intensity, action.intensity);
      boardShakeRef.current = { until: now + action.durationMs, intensity };
    }
  }

  // Diff-driven queue: backend sends final state, frontend animates the transition.
  useEffect(() => {
    if (!props.transition) return;
    if (!props.state) return;
    // On replayToken change, replay the last transition too.
    startDiffQueue(props.transition.from, props.transition.to);
  }, [props.transition?.moveNumber, props.replayToken, props.speed]);

  // Build an animation schedule from the server event stream.
  useEffect(() => {
    if (!props.state || !props.eventBatch) return;
    const events = props.eventBatch.events;
    if (events.length === 0) return;

    // Start from current visual grid (or authoritative if missing).
    if (!visualGridRef.current) visualGridRef.current = cloneGrid(props.state.grid);

    const schedule: ScheduledAction[] = [];
    const burstScaleMs = 110 / props.speed;
    const particleDelayMs = 70 / props.speed;
    const travelMs = 180 / props.speed;
    const burstSpacingMs = 150 / props.speed; // 100–200ms propagation

    let timeCursor = 0;
    let lastBurst: { row: number; col: number; at: number; color: string } | null = null;

    const playerColorById = new Map(props.state.players.map((p) => [p.id, p.color] as const));

    for (const ev of events) {
      if (ev.type === "place") {
        schedule.push({ at: timeCursor, type: "cell", row: ev.row, col: ev.col, ownerId: ev.playerId, orbCount: ev.orbCount, bounce: true });
      } else if (ev.type === "burst") {
        const color = (() => {
          const currentOwner = props.state?.grid[ev.row]?.[ev.col]?.ownerId ?? null;
          return currentOwner ? (playerColorById.get(currentOwner) ?? "#ffffff") : "#ffffff";
        })();
        lastBurst = { row: ev.row, col: ev.col, at: timeCursor, color };
        schedule.push({ at: timeCursor, type: "ripple", row: ev.row, col: ev.col, color });
        schedule.push({ at: timeCursor, type: "boardShake", intensity: 1, durationMs: 140 });
        timeCursor += burstSpacingMs;
      } else if (ev.type === "capture") {
        if (lastBurst && ev.row === lastBurst.row && ev.col === lastBurst.col && ev.ownerId === null && ev.orbCount === 0) {
          // Source clears right after scale+fade.
          schedule.push({ at: lastBurst.at + burstScaleMs, type: "cell", row: ev.row, col: ev.col, ownerId: null, orbCount: 0 });
        } else if (lastBurst) {
          // Particle flies to neighbor; apply capture on arrival with a pop.
          const lane = ((ev.row * 31 + ev.col * 17 + lastBurst.row * 7 + lastBurst.col) % 3) - 1;
          schedule.push({
            at: lastBurst.at + particleDelayMs,
            type: "particle",
            fromRow: lastBurst.row,
            fromCol: lastBurst.col,
            toRow: ev.row,
            toCol: ev.col,
            color: lastBurst.color,
            lane
          });
          schedule.push({
            at: lastBurst.at + particleDelayMs + travelMs,
            type: "cell",
            row: ev.row,
            col: ev.col,
            ownerId: ev.ownerId,
            orbCount: ev.orbCount,
            bounce: true
          });
        } else {
          // Fallback (should be rare): update immediately.
          schedule.push({ at: timeCursor, type: "cell", row: ev.row, col: ev.col, ownerId: ev.ownerId, orbCount: ev.orbCount, bounce: false });
        }
      }
    }

    // Big chain: a bit more shake.
    const burstCount = events.filter((e) => e.type === "burst").length;
    if (burstCount >= 4) schedule.push({ at: 0, type: "boardShake", intensity: 2, durationMs: 220 });

    schedule.sort((a, b) => a.at - b.at);
    // If we have an explicit transition diff, prefer diff-queue for "storytelling".
    // Otherwise, fall back to server events.
    if (!props.transition) {
      scheduledRef.current = schedule;
      scheduleIdxRef.current = 0;
      scheduleStartAtRef.current = performance.now();
    }
    scheduleIdxRef.current = 0;
    scheduleStartAtRef.current = performance.now();
  }, [props.eventBatch, props.state, props.speed, props.transition]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      // Square board that fits its container (responsive)
      const s = Math.floor(Math.min(rect.width, rect.height));
      const ss = Math.max(240, s);
      setSize({ w: ss, h: ss });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = Math.floor(size.w * devicePixelRatio);
    c.height = Math.floor(size.h * devicePixelRatio);
    c.style.width = `${size.w}px`;
    c.style.height = `${size.h}px`;
  }, [size]);

  useEffect(() => {
    let raf = 0;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    const loop = () => {
      draw(ctx);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [props.state, props.myPlayerId, props.canInteract, dims.rows, dims.cols]);

  useEffect(() => {
    // Basic sfx + a small pulse animation on any state update attributed to events.
    if (!props.lastEventsAt) return;
    if (!props.state) return;
    if (props.lastEventsAt <= lastMoveAtRef.current) return;
    lastMoveAtRef.current = props.lastEventsAt;

    const now = performance.now();
    // Pulse every non-empty cell for a short moment; cheap but effective.
    for (let r = 0; r < props.state.rows; r++) {
      for (let c = 0; c < props.state.cols; c++) {
        const cell = props.state.grid[r]![c]!;
        if (cell.orbCount > 0) {
          animRef.current.set(`${r},${c}`, { pulseUntil: now + 220, shakeUntil: now + 140 });
        }
      }
    }
    playExplosion();
  }, [props.lastEventsAt, props.state]);

  function draw(ctx: CanvasRenderingContext2D) {
    // High-DPI correctness: canvas width/height are already multiplied by DPR.
    // Use DPR transform but clear using CSS-pixel coordinates to avoid clipping.
    const dpr = devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const rows = dims.rows;
    const cols = dims.cols;
    const pad = Math.max(10, Math.floor(Math.min(size.w, size.h) * 0.02));
    const boardW = Math.floor(size.w - pad * 2);
    const boardH = Math.floor(size.h - pad * 2);
    const cellW = boardW / cols;
    const cellH = boardH / rows;
    const cellSize = Math.min(cellW, cellH);
    // Keep orbs fully inside the cell.
    // Requirement: orbSize (diameter) = cellSize * 0.3 => radius = cellSize * 0.15
    const orbR = cellSize * 0.15;
    // Smooth orbit rotation: ~3s per full turn (within 2–4s requirement)
    const orbitPeriodMs = 3000;
    const orbitOmega = (Math.PI * 2) / orbitPeriodMs;

    // Background
    ctx.fillStyle = "rgba(0,0,0,0.20)";
    roundRect(ctx, pad, pad, boardW, boardH, 14);
    ctx.fill();

    const now = performance.now();
    const state = props.state;
    const isSmallScreen = Math.min(size.w, size.h) < 420;
    const particleStride = isSmallScreen ? 2 : 1; // performance: draw fewer particles on small screens

    // Apply scheduled animation actions.
    const scheduleElapsed = now - scheduleStartAtRef.current;
    while (scheduleIdxRef.current < scheduledRef.current.length) {
      const action = scheduledRef.current[scheduleIdxRef.current]!;
      if (action.at > scheduleElapsed) break;
      applyAction(action, now);
      scheduleIdxRef.current += 1;
    }

    // Board shake (screen shake bonus).
    let boardShakeX = 0;
    let boardShakeY = 0;
    if (now < boardShakeRef.current.until) {
      const t = (boardShakeRef.current.until - now) / 1000;
      const intensity = boardShakeRef.current.intensity;
      boardShakeX = Math.sin(now / 17) * (2.6 * intensity) * Math.min(1, t * 3);
      boardShakeY = Math.cos(now / 19) * (2.6 * intensity) * Math.min(1, t * 3);
    }

    // Grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    for (let r = 0; r <= rows; r++) {
      const y = pad + r * cellH;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(pad + boardW, y);
      ctx.stroke();
    }
    for (let c = 0; c <= cols; c++) {
      const x = pad + c * cellW;
      ctx.beginPath();
      ctx.moveTo(x, pad);
      ctx.lineTo(x, pad + boardH);
      ctx.stroke();
    }

    if (DEBUG_CELL_BORDERS) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,0,0,0.55)";
      ctx.lineWidth = 1;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          ctx.strokeRect(pad + c * cellW, pad + r * cellH, cellW, cellH);
        }
      }
      ctx.restore();
    }

    // Turn highlight
    if (state && state.status === "playing") {
      const p = state.players[state.currentPlayerIdx];
      if (p) {
        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = p.color;
        roundRect(ctx, pad + 3 + boardShakeX, pad + 3 + boardShakeY, boardW - 6, boardH - 6, 12);
        ctx.fill();
        ctx.restore();
      }
    }

    // Draw ripple effects (explosion bonus).
    for (const rip of ripplesRef.current) {
      const dt = now - rip.startAt;
      if (dt < 0 || dt > rip.durationMs) continue;
      const p = dt / rip.durationMs;
      const { x, y } = cellCenter(rip.row, rip.col, pad, cellW, cellH, boardShakeX, boardShakeY);
      ctx.save();
      ctx.globalAlpha = 0.35 * (1 - p);
      ctx.strokeStyle = rip.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, (Math.min(cellW, cellH) * 0.12) + p * (Math.min(cellW, cellH) * 0.55), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ripplesRef.current = ripplesRef.current.filter((r) => now - r.startAt <= r.durationMs);

    // Cells content
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = pad + c * cellW;
        const y0 = pad + r * cellH;
        const cx = x0 + cellW / 2 + boardShakeX;
        const cy = y0 + cellH / 2 + boardShakeY;

        const key = `${r},${c}`;
        const anim = animRef.current.get(key);
        const pulse = anim ? clamp01((anim.pulseUntil - now) / 220) : 0;
        const shake = anim ? clamp01((anim.shakeUntil - now) / 140) : 0;
        const sx = shake > 0 ? (Math.sin(now / 18 + r * 3 + c) * 2.2 * shake) : 0;
        const sy = shake > 0 ? (Math.cos(now / 19 + r + c * 2) * 2.2 * shake) : 0;

        const grid = visualGridRef.current ?? state?.grid ?? null;
        const cell = grid?.[r]?.[c] ?? { ownerId: null, orbCount: 0 };
        if (cell.orbCount <= 0 || !cell.ownerId || !state) continue;

        const owner = state.players.find((p) => p.id === cell.ownerId);
        const color = owner?.color ?? "#ffffff";

        // Glowing "energy" based on how close this cell is to bursting.
        const cap = cellCapacity(rows, cols, r, c);
        const closeness = clamp01((cell.orbCount - 1) / Math.max(1, cap)); // 0..1
        const nearBurst = closeness > 0.72;
        const energy = 0.15 + 0.95 * closeness;

        // Extra local shake when near bursting (in addition to event bounce).
        const preBurstShake = nearBurst ? (0.75 + 0.25 * Math.sin(now / 60)) : 0;
        const psxRaw = preBurstShake > 0 ? Math.sin(now / 13 + r * 1.7 + c * 2.1) * 1.8 * preBurstShake : 0;
        const psyRaw = preBurstShake > 0 ? Math.cos(now / 11 + r * 1.2 + c * 2.7) * 1.8 * preBurstShake : 0;
        const psx = clamp(psxRaw, -orbR * 0.35, orbR * 0.35);
        const psy = clamp(psyRaw, -orbR * 0.35, orbR * 0.35);

        // Soft glow -> intense glow as it nears explosion
        const glow = 0.18 + 1.25 * energy + 0.35 * (1 - pulse);
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 10 + 18 * glow;
        ctx.fillStyle = color;

        const count = cell.orbCount;

        // Energy aura (cheap, looks great): faint radial glow behind the orbs.
        {
        const auraR = cellSize * (0.18 + 0.22 * energy);
          const grad = ctx.createRadialGradient(cx + psx, cy + psy, 1, cx + psx, cy + psy, auraR);
          grad.addColorStop(0, withAlpha(color, 0.22 + 0.22 * energy));
          grad.addColorStop(1, withAlpha(color, 0));
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(cx + psx, cy + psy, auraR, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        const safeDist = Math.max(0, cellSize / 2 - orbR * 1.05);
        const d1 = 0;
        const d2 = safeDist * 0.62;
        const d3 = safeDist * 0.68;
        const d4x = safeDist * 0.6;
        const d4y = safeDist * 0.6;
        const basePositions: Array<[number, number]> =
          count === 1
            ? [[d1, d1]]
            : count === 2
              ? [[-d2, 0], [d2, 0]]
              : count === 3
                ? [
                    [0, -d3],
                    [-d3 * 0.86, d3 * 0.74],
                    [d3 * 0.86, d3 * 0.74]
                  ]
                : [
                    [-d4x, -d4y],
                    [d4x, -d4y],
                    [-d4x, d4y],
                    [d4x, d4y]
                  ];

        // Rotate/orbit each orb smoothly with slight per-orb phase offset so
        // multi-orb cells don't overlap perfectly.
        const baseAngle = now * orbitOmega + (r * 13 + c * 17) * 0.03;
        const pulseScale = 1 + 0.06 * Math.sin(now / 180 + r * 0.7 + c * 0.9);
        const energyScale = 1 + 0.08 * energy * (0.5 + 0.5 * Math.sin(now / 90));

        for (let i = 0; i < basePositions.length; i++) {
          const [dx0, dy0] = basePositions[i]!;
          const a = baseAngle + i * 0.85; // offset pattern between orbs
          const dx = dx0 * Math.cos(a) - dy0 * Math.sin(a);
          const dy = dx0 * Math.sin(a) + dy0 * Math.cos(a);

          ctx.beginPath();
          ctx.arc(
            cx + dx + sx + psx,
            cy + dy + sy + psy,
            orbR * (0.98 + 0.18 * (1 - pulse)) * pulseScale * energyScale,
            0,
            Math.PI * 2
          );
          ctx.fill();

          // Subtle inner highlight for a nicer "orb" feel.
          ctx.save();
          ctx.globalAlpha = 0.22;
          ctx.shadowBlur = 0;
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.beginPath();
          ctx.arc(
            cx + dx + sx + psx - orbR * 0.18,
            cy + dy + sy + psy - orbR * 0.18,
            orbR * 0.33,
            0,
            Math.PI * 2
          );
          ctx.fill();
          ctx.restore();
        }
        ctx.restore();
      }
    }

    // Draw traveling particles toward neighbors.
    const remaining: Particle[] = [];
    for (let idx = 0; idx < particlesRef.current.length; idx++) {
      const part = particlesRef.current[idx]!;
      const t = (now - part.startAt) / part.durationMs;
      if (t < 0) {
        remaining.push(part);
        continue;
      }
      if (t >= 1) continue;
      if (particleStride > 1 && idx % particleStride !== 0) {
        // still keep particle alive, just skip drawing this frame
        remaining.push(part);
        continue;
      }

      const from = cellCenter(part.from.row, part.from.col, pad, cellW, cellH, boardShakeX, boardShakeY);
      const to = cellCenter(part.to.row, part.to.col, pad, cellW, cellH, boardShakeX, boardShakeY);
      // Curved movement using a quadratic bezier curve.
      const eased = easeOutCubic(t);
      const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      const nx = -dy / len;
      const ny = dx / len;
      const curve = (14 + 8 * Math.sin(now / 180)) * part.lane;
      const ctrl = { x: mid.x + nx * curve, y: mid.y + ny * curve };
      const p = bezier2(from, ctrl, to, eased);
      const x = p.x;
      const y = p.y;

      ctx.save();
      ctx.shadowColor = part.color;
      ctx.shadowBlur = isSmallScreen ? 8 : 12;
      ctx.globalAlpha = 0.9 * (1 - t * 0.4);
      ctx.fillStyle = part.color;
      ctx.beginPath();
      ctx.arc(x, y, orbR * (0.55 + 0.25 * Math.sin(now / 120)), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      remaining.push(part);
    }
    particlesRef.current = remaining;

    // Status overlay
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.font = "600 12px ui-sans-serif, system-ui, -apple-system, Segoe UI";
    const statusText = state
      ? state.status === "finished" && state.winnerId
        ? `Winner: ${state.players.find((p) => p.id === state.winnerId)?.name ?? state.winnerId}`
        : state.status === "playing"
          ? `Turn: ${state.players[state.currentPlayerIdx]?.name ?? "-"}`
          : "Lobby: waiting for players"
      : "Create or join a room";
    ctx.fillText(statusText, pad + 10, pad + 18);
    ctx.restore();
  }

  function handlePointer(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!props.state) return;
    if (!props.canInteract) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const pad = 16;
    const boardW = size.w - pad * 2;
    const boardH = size.h - pad * 2;
    if (x < pad || y < pad || x > pad + boardW || y > pad + boardH) return;

    const col = Math.floor(((x - pad) / boardW) * props.state.cols);
    const row = Math.floor(((y - pad) / boardH) * props.state.rows);

    // Touch feedback: pop the tapped cell immediately (before server ack).
    const now = performance.now();
    animRef.current.set(`${row},${col}`, { pulseUntil: now + 180, shakeUntil: now + 90 });

    playPlace();
    props.onCellClick(row, col);
  }

  return (
    <>
      <div className="boardStage" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          style={{ touchAction: "manipulation", display: "block", width: "100%", height: "100%" }}
          onPointerDown={handlePointer}
        />
      </div>
      <div className="hint boardBelow">
        {props.state?.status === "playing"
          ? props.canInteract
            ? "Your turn: tap a valid cell."
            : "Waiting for other player…"
          : "Start the game once at least 2 players joined."}
      </div>
    </>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => row.map((c) => ({ ownerId: c.ownerId, orbCount: c.orbCount })));
}

function cellCenter(
  row: number,
  col: number,
  pad: number,
  cellW: number,
  cellH: number,
  shakeX: number,
  shakeY: number
): { x: number; y: number } {
  return { x: pad + col * cellW + cellW / 2 + shakeX, y: pad + row * cellH + cellH / 2 + shakeY };
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function bezier2(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, t: number) {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * b.x + t * t * c.x,
    y: u * u * a.y + 2 * u * t * b.y + t * t * c.y
  };
}

function withAlpha(hex: string, alpha: number) {
  // expects #rrggbb
  if (!hex.startsWith("#") || hex.length !== 7) return `rgba(255,255,255,${alpha})`;
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function cellCapacity(rows: number, cols: number, row: number, col: number) {
  const isTop = row === 0;
  const isBottom = row === rows - 1;
  const isLeft = col === 0;
  const isRight = col === cols - 1;
  const edges = Number(isTop) + Number(isBottom) + Number(isLeft) + Number(isRight);
  return edges === 2 ? 1 : edges === 1 ? 2 : 3;
}

function buildScheduleFromDiff(from: Grid, to: Grid, speed: number): ScheduledAction[] {
  const rows = Math.min(from.length, to.length);
  const cols = Math.min(from[0]?.length ?? 0, to[0]?.length ?? 0);

  const changes: Array<{ row: number; col: number; fromCount: number; toCount: number; toOwner: string | null }> = [];
  const burstSources: Array<{ row: number; col: number }> = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = from[r]![c]!;
      const b = to[r]![c]!;
      if (a.orbCount === b.orbCount && a.ownerId === b.ownerId) continue;
      changes.push({ row: r, col: c, fromCount: a.orbCount, toCount: b.orbCount, toOwner: b.ownerId });
      if (a.orbCount > 0 && b.orbCount === 0) burstSources.push({ row: r, col: c });
    }
  }

  const baseDelay = 150 / Math.max(1, speed); // 100–200ms-ish
  const schedule: ScheduledAction[] = [];

  // Step 1: bursts (sources clearing) + ripple.
  for (const s of burstSources) {
    schedule.push({ at: 0, type: "ripple", row: s.row, col: s.col, color: "rgba(255,255,255,0.85)" });
    schedule.push({ at: 110 / Math.max(1, speed), type: "cell", row: s.row, col: s.col, ownerId: null, orbCount: 0 });
  }

  // Propagation: group remaining changes by distance to nearest burst (gives step-by-step feel).
  const dist = (r1: number, c1: number, r2: number, c2: number) => Math.abs(r1 - r2) + Math.abs(c1 - c2);
  const buckets = new Map<number, Array<{ row: number; col: number; ownerId: string | null; orbCount: number; fromRow: number; fromCol: number }>>();

  const nonBurst = changes.filter((ch) => !(ch.fromCount > 0 && ch.toCount === 0));
  for (const ch of nonBurst) {
    const d =
      burstSources.length === 0
        ? 1
        : Math.min(...burstSources.map((s) => dist(ch.row, ch.col, s.row, s.col)));
    const fromSrc = burstSources.length === 0 ? { row: ch.row, col: ch.col } : burstSources.reduce((best, s) => (dist(ch.row, ch.col, s.row, s.col) < dist(ch.row, ch.col, best.row, best.col) ? s : best), burstSources[0]!);
    const arr = buckets.get(d) ?? [];
    arr.push({ row: ch.row, col: ch.col, ownerId: ch.toOwner, orbCount: ch.toCount, fromRow: fromSrc.row, fromCol: fromSrc.col });
    buckets.set(d, arr);
  }

  const maxD = Math.max(0, ...buckets.keys());
  for (let d = 1; d <= maxD; d++) {
    const items = buckets.get(d);
    if (!items || items.length === 0) continue;
    const at = baseDelay * d;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      // Particle visuals + apply cell update on "arrival"
      schedule.push({
        at: at,
        type: "particle",
        fromRow: it.fromRow,
        fromCol: it.fromCol,
        toRow: it.row,
        toCol: it.col,
        color: "rgba(255,255,255,0.85)",
        lane: (i % 3) - 1
      });
      schedule.push({ at: at + 180 / Math.max(1, speed), type: "cell", row: it.row, col: it.col, ownerId: it.ownerId, orbCount: it.orbCount, bounce: true });
    }
    if (items.length >= 6) schedule.push({ at, type: "boardShake", intensity: 2, durationMs: 160 });
  }

  return schedule.sort((a, b) => a.at - b.at);
}

