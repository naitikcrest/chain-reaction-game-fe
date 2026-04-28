import type { GameEvent, GameState, Grid } from "../shared/types";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { getSocket } from "../net/socket";
import { playTurnCue } from "../util/sfx";
import { GameCanvas } from "./GameCanvas";
import { LobbyPanel } from "./LobbyPanel";
import { SidePanel } from "./SidePanel";

type ChatMsg = { roomId: string; playerId: string; name: string; message: string; at: number };

export function App() {
  const socket = useMemo(() => getSocket(), []);

  const [myName, setMyName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [leaderboard, setLeaderboard] = useState<Array<{ playerId: string; name: string; wins: number }>>([]);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastEventBatch, setLastEventBatch] = useState<{ moveNumber: number; events: GameEvent[] } | null>(null);
  const [transition, setTransition] = useState<{ moveNumber: number; from: Grid; to: Grid } | null>(null);
  const [fastForward, setFastForward] = useState(false);
  const [replayToken, setReplayToken] = useState(0);
  const [turnOverlayToken, setTurnOverlayToken] = useState(0);
  const [turnOverlay, setTurnOverlay] = useState<{ text: string; color: string } | null>(null);
  const [turnFlash, setTurnFlash] = useState(false);
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const [isFabOpen, setFabOpen] = useState(false);

  const lastEventsAtRef = useRef<number>(0);
  const stateRef = useRef<GameState | null>(null);
  const lastTurnPlayerIdRef = useRef<string | null>(null);
  const overlayTimeoutRef = useRef<number | null>(null);
  const flashTimeoutRef = useRef<number | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const playersAccordionRef = useRef<HTMLDetailsElement | null>(null);
  const chatAccordionRef = useRef<HTMLDetailsElement | null>(null);
  const topBarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onState(payload: { state: GameState }) {
      setState(payload.state);
      stateRef.current = payload.state;
      setRoomId(payload.state.roomId);
    }
    function onPlayers(payload: { state: GameState }) {
      setState(payload.state);
      stateRef.current = payload.state;
    }
    function onEvents(payload: { state: GameState; events: GameEvent[] }) {
      const prev = stateRef.current;
      setState(payload.state);
      stateRef.current = payload.state;
      lastEventsAtRef.current = Date.now();
      setLastEventBatch({ moveNumber: payload.state.moveNumber, events: payload.events });
      if (prev && prev.roomId === payload.state.roomId) {
        setTransition({ moveNumber: payload.state.moveNumber, from: prev.grid, to: payload.state.grid });
      }
    }
    function onChatMsg(payload: ChatMsg) {
      setChat((prev) => [...prev.slice(-199), payload]);
    }
    function onLb(payload: { roomId: string; entries: Array<{ playerId: string; name: string; wins: number }> }) {
      if (payload.roomId === roomId || roomId === "") setLeaderboard(payload.entries);
    }

    socket.on("room:state", onState);
    socket.on("room:players", onPlayers);
    socket.on("game:events", onEvents);
    socket.on("chat:message", onChatMsg);
    socket.on("room:leaderboard", onLb);

    return () => {
      socket.off("room:state", onState);
      socket.off("room:players", onPlayers);
      socket.off("game:events", onEvents);
      socket.off("chat:message", onChatMsg);
      socket.off("room:leaderboard", onLb);
    };
  }, [socket, roomId]);

  const currentPlayer = useMemo(() => {
    if (!state) return null;
    return state.players[state.currentPlayerIdx] ?? null;
  }, [state]);

  const canInteract = Boolean(state && myPlayerId && state.status === "playing" && currentPlayer?.id === myPlayerId);
  const canReplay = Boolean(transition && state && state.status !== "lobby");
  const turnColor = state && state.status === "playing" ? (currentPlayer?.color ?? null) : null;
  const turnWatermarkText =
    state && state.status === "playing" && currentPlayer ? `${currentPlayer.name.toUpperCase()}'S TURN` : null;
  const themeVars = useMemo(() => {
    if (!turnColor) return undefined;
    return {
      ["--player-color" as string]: turnColor,
      ["--player-color-soft" as string]: hexToRgba(turnColor, 0.22),
      ["--player-color-soft2" as string]: hexToRgba(turnColor, 0.14)
    } as React.CSSProperties;
  }, [turnColor]);

  const isMobile = useMediaQuery("(max-width: 767px)");
  const boardCols = state?.cols ?? 6;
  const boardRows = state?.rows ?? 9;
  const boardAspect = `${boardCols} / ${boardRows}`;
  // Compute an optimal board width for *all* screen sizes (mobile/tablet/desktop).
  // This makes the grid as large as possible without clipping.
  const boardWidthPx = useBoardWidthPx({
    headerRef: topBarRef,
    cols: boardCols,
    rows: boardRows,
    sidebarPx: isMobile ? 0 : 412,
    bottomUiPx: isMobile ? 118 : 32
  });

  // Turn overlay on actual turn changes (prevents spam).
  useEffect(() => {
    if (!state || state.status !== "playing") return;
    const player = state.players[state.currentPlayerIdx];
    if (!player) return;
    if (player.eliminated) return;

    if (lastTurnPlayerIdRef.current === player.id) return;
    lastTurnPlayerIdRef.current = player.id;

    const text = `${player.name.toUpperCase()}'S TURN`;
    setTurnOverlayToken((x) => x + 1);
    setTurnOverlay({ text, color: player.color });

    // brief background intensity boost synced with overlay
    setTurnFlash(true);

    // optional cues
    playTurnCue();
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      (navigator as unknown as { vibrate?: (pattern: number | number[]) => boolean }).vibrate?.(18);
    }

    if (overlayTimeoutRef.current) window.clearTimeout(overlayTimeoutRef.current);
    overlayTimeoutRef.current = window.setTimeout(() => setTurnOverlay(null), 1850);

    if (flashTimeoutRef.current) window.clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = window.setTimeout(() => setTurnFlash(false), 650);
  }, [state?.currentPlayerIdx, state?.status]);

  // Close drawer on route state changes / join / start, etc (small UX nicety).
  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) setFabOpen(false);
  }, [isMobile]);

  // Drawer: ESC to close + focus trap.
  useEffect(() => {
    if (!isDrawerOpen) return;
    closeBtnRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setDrawerOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const root = drawerRef.current;
      if (!root) return;
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isDrawerOpen]);

  // Swipe-to-close (optional): swipe left on drawer panel.
  useEffect(() => {
    if (!isDrawerOpen) return;
    const el = drawerRef.current;
    if (!el) return;
    let startX = 0;
    let startY = 0;
    let active = false;

    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      active = true;
    }
    function onTouchMove(e: TouchEvent) {
      if (!active) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dy) > 60) active = false;
      if (dx < -70) {
        active = false;
        setDrawerOpen(false);
      }
    }
    function onTouchEnd() {
      active = false;
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [isDrawerOpen]);

  const sidebarContent = (
    <>
      <h2>Room</h2>
      <LobbyPanel
        myName={myName}
        roomId={roomId}
        state={state}
        error={error}
        onMyNameChange={(v) => setMyName(v)}
        onRoomIdChange={(v) => setRoomId(v)}
        onCreate={() => {
          setError(null);
          socket.emit("room:create", { name: myName || "Player" }, (res) => {
            if (!res.ok) return setError(res.reason);
            setRoomId(res.roomId);
            setMyPlayerId(res.playerId);
            setState(res.state);
            setChat([]);
            setDrawerOpen(false);
          });
        }}
        onJoin={() => {
          setError(null);
          socket.emit("room:join", { roomId, name: myName || "Player" }, (res) => {
            if (!res.ok) return setError(res.reason);
            setMyPlayerId(res.playerId);
            setState(res.state);
            setChat([]);
            setDrawerOpen(false);
          });
        }}
        onStart={() => {
          if (!state) return;
          socket.emit("game:start", { roomId: state.roomId }, (res) => {
            if (!res.ok) setError(res.reason);
            setDrawerOpen(false);
          });
        }}
        onRestart={() => {
          if (!state) return;
          socket.emit("game:restart", { roomId: state.roomId }, (res) => {
            if (!res.ok) setError(res.reason);
            setDrawerOpen(false);
          });
        }}
      />

      <SidePanel
        state={state}
        myPlayerId={myPlayerId}
        leaderboard={leaderboard}
        fastForward={fastForward}
        onFastForwardChange={setFastForward}
        canReplay={canReplay}
        onReplayLast={() => setReplayToken((x) => x + 1)}
      />

      <div className="stack">
        <h2>Chat</h2>
        <ChatPanel
          disabled={!state || !myPlayerId}
          chat={chat}
          onSend={(message) => {
            if (!state) return;
            socket.emit("chat:send", { roomId: state.roomId, message }, (res) => {
              if (!res.ok) setError(res.reason);
            });
          }}
        />
      </div>

      <div className="hint" style={{ marginTop: 12 }}>
        Tip: share the room id with friends. Server is authoritative and broadcasts state after every move.
      </div>
    </>
  );

  function openDrawerSection(section: "players" | "chat") {
    setDrawerOpen(true);
    setFabOpen(false);
    window.setTimeout(() => {
      const el = section === "players" ? playersAccordionRef.current : chatAccordionRef.current;
      if (!el) return;
      el.open = true;
      el.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 80);
  }

  return (
    <div className={`layout ${isDrawerOpen ? "drawerOpen" : ""}`}>
      {isMobile ? (
        <div className="mobileTopBar" ref={topBarRef}>
          <button className="iconBtn" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
            ☰
          </button>
          <div className="mobileTopBarCenter">
            {state?.status === "playing" ? (
              <span className="pill" style={{ borderColor: turnColor ?? "var(--border)" }}>
                <span className="dot" style={{ background: turnColor ?? "transparent" }} />
                <span style={{ fontWeight: 750 }}>{currentPlayer?.name ?? "-"}</span>
                <span style={{ color: "var(--muted)" }}>turn</span>
              </span>
            ) : (
              <span className="hint">{state ? `Status: ${state.status}` : "Create or join a room"}</span>
            )}
          </div>
          <button className="iconBtn" onClick={() => setDrawerOpen((v) => !v)} aria-label="Toggle menu">
            ⋯
          </button>
        </div>
      ) : (
        <div className="panel sidebarDesktop">{sidebarContent}</div>
      )}

      {isMobile ? (
        <>
          <div
            className={`drawerBackdrop ${isDrawerOpen ? "open" : ""}`}
            onMouseDown={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div
            className={`drawerPanel ${isDrawerOpen ? "open" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            ref={drawerRef}
          >
            <div className="drawerHeader">
              <div className="drawerTitle">Menu</div>
              <button className="iconBtn" onClick={() => setDrawerOpen(false)} aria-label="Close menu" ref={closeBtnRef}>
                ✕
              </button>
            </div>

            <div className="drawerScroll">
              <details className="accordion" open>
                <summary>Room</summary>
                <div className="accordionBody">
                  <LobbyPanel
                    myName={myName}
                    roomId={roomId}
                    state={state}
                    error={error}
                    onMyNameChange={(v) => setMyName(v)}
                    onRoomIdChange={(v) => setRoomId(v)}
                    onCreate={() => {
                      setError(null);
                      socket.emit("room:create", { name: myName || "Player" }, (res) => {
                        if (!res.ok) return setError(res.reason);
                        setRoomId(res.roomId);
                        setMyPlayerId(res.playerId);
                        setState(res.state);
                        setChat([]);
                        setDrawerOpen(false);
                      });
                    }}
                    onJoin={() => {
                      setError(null);
                      socket.emit("room:join", { roomId, name: myName || "Player" }, (res) => {
                        if (!res.ok) return setError(res.reason);
                        setMyPlayerId(res.playerId);
                        setState(res.state);
                        setChat([]);
                        setDrawerOpen(false);
                      });
                    }}
                    onStart={() => {
                      if (!state) return;
                      socket.emit("game:start", { roomId: state.roomId }, (res) => {
                        if (!res.ok) setError(res.reason);
                        setDrawerOpen(false);
                      });
                    }}
                    onRestart={() => {
                      if (!state) return;
                      socket.emit("game:restart", { roomId: state.roomId }, (res) => {
                        if (!res.ok) setError(res.reason);
                        setDrawerOpen(false);
                      });
                    }}
                  />
                </div>
              </details>

              <details className="accordion" open ref={playersAccordionRef}>
                <summary>Players / Leaderboard / Animation</summary>
                <div className="accordionBody">
                  <SidePanel
                    state={state}
                    myPlayerId={myPlayerId}
                    leaderboard={leaderboard}
                    fastForward={fastForward}
                    onFastForwardChange={setFastForward}
                    canReplay={canReplay}
                    onReplayLast={() => setReplayToken((x) => x + 1)}
                  />
                </div>
              </details>

              <details className="accordion" open ref={chatAccordionRef}>
                <summary>Chat</summary>
                <div className="accordionBody">
                  <ChatPanel
                    disabled={!state || !myPlayerId}
                    chat={chat}
                    onSend={(message) => {
                      if (!state) return;
                      socket.emit("chat:send", { roomId: state.roomId, message }, (res) => {
                        if (!res.ok) setError(res.reason);
                      });
                    }}
                  />
                </div>
              </details>

              <div className="hint" style={{ marginTop: 8 }}>
                Tap outside or press ESC to close.
              </div>
            </div>
          </div>
        </>
      ) : null}

      <div className="canvasWrap">
        <div
          className={`canvasCard ${turnColor ? "turnTheme" : ""} ${turnFlash ? "turnFlash" : ""}`}
          style={{
            ...themeVars,
            ["--board-aspect" as string]: boardAspect,
            ...(boardWidthPx ? { width: `${boardWidthPx}px` } : null)
          }}
        >
          {turnWatermarkText ? (
            <div key={`wm-${turnOverlayToken}`} className="turnWatermark" aria-hidden="true">
              {turnWatermarkText}
            </div>
          ) : null}
          {turnOverlay ? (
            <div
              key={turnOverlayToken}
              className="turnOverlay"
              style={
                {
                  ["--player-color" as string]: turnOverlay.color
                } as React.CSSProperties
              }
              aria-live="polite"
            >
              <div className="turnOverlayBackdrop" />
              <div className="turnOverlayText">{turnOverlay.text}</div>
            </div>
          ) : null}
          <GameCanvas
            state={state}
            myPlayerId={myPlayerId}
            canInteract={canInteract}
            lastEventsAt={lastEventsAtRef.current}
            eventBatch={lastEventBatch}
            transition={transition}
            speed={fastForward ? 3 : 1}
            replayToken={replayToken}
            onCellClick={(r, c) => {
              if (!state) return;
              socket.emit("game:move", { roomId: state.roomId, row: r, col: c }, (res) => {
                if (!res.ok) setError(res.reason);
              });
            }}
          />
        </div>
      </div>

      {/* Mobile floating quick actions */}
      {isMobile ? (
        <div className="fabWrap" aria-label="Quick actions">
          <div className={`fabMenu ${isFabOpen ? "open" : ""}`}>
            <button
              className="fabItem"
              disabled={!state}
              onClick={() => {
                if (!state) return;
                setFabOpen(false);
                socket.emit("game:restart", { roomId: state.roomId }, (res) => {
                  if (!res.ok) setError(res.reason);
                });
              }}
            >
              Restart
            </button>
            <button className="fabItem" onClick={() => openDrawerSection("chat")}>
              Chat
            </button>
            <button className="fabItem" onClick={() => openDrawerSection("players")}>
              Players
            </button>
          </div>
          <button
            className={`fabMain ${isFabOpen ? "open" : ""}`}
            onClick={() => setFabOpen((v) => !v)}
            aria-expanded={isFabOpen}
            aria-label="Open quick actions"
          >
            {isFabOpen ? "×" : "+"}
          </button>
          {state ? <div className="fabHint">{state.players.length} players</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function useBoardWidthPx(opts: {
  headerRef?: React.RefObject<HTMLElement | null>;
  cols: number;
  rows: number;
  sidebarPx: number;
  bottomUiPx: number;
}) {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    let t: number | null = null;

    const recalc = () => {
      const vv = window.visualViewport;
      const vw = Math.floor(vv?.width ?? window.innerWidth);
      const vh = Math.floor(vv?.height ?? window.innerHeight);

      // Fit board by aspect ratio inside available viewport space.
      const headerHeight = Math.ceil(opts.headerRef?.current?.getBoundingClientRect().height ?? 0);
      const layoutPad = 32; // layout padding/gap safety
      const availableWidth = Math.max(0, vw - opts.sidebarPx - layoutPad);
      const availableHeight = Math.max(0, vh - headerHeight - opts.bottomUiPx - layoutPad);

      const ratio = opts.cols / Math.max(1, opts.rows); // width/height
      // Max width that fits both width and height constraints.
      const maxWFromH = Math.floor(availableHeight * ratio);
      const maxW = Math.floor(Math.min(availableWidth, maxWFromH) * 0.98);
      const clampedW = clampNumber(240, maxW, 1400);

      // Pixel-perfect fit: ensure width maps to an integer cell size (avoid rounding cut-off).
      const cellPx = Math.max(1, Math.floor(clampedW / opts.cols));
      const finalW = cellPx * opts.cols;
      setWidth(finalW);

      // Debug (uncomment if needed)
      // console.log({ vw, vh, availableWidth, availableHeight, boardW: finalW, cellPx });
    };

    const debounced = () => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(recalc, 100);
    };

    recalc();
    window.addEventListener("resize", debounced);
    window.addEventListener("orientationchange", debounced);
    window.visualViewport?.addEventListener("resize", debounced);

    return () => {
      window.removeEventListener("resize", debounced);
      window.removeEventListener("orientationchange", debounced);
      window.visualViewport?.removeEventListener("resize", debounced);
      if (t) window.clearTimeout(t);
    };
  }, [opts.cols, opts.rows, opts.sidebarPx, opts.bottomUiPx, opts.headerRef]);

  return width;
}

function clampNumber(min: number, v: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function hexToRgba(hex: string, alpha: number) {
  if (!hex.startsWith("#") || hex.length !== 7) return `rgba(255,255,255,${alpha})`;
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function ChatPanel(props: {
  disabled: boolean;
  chat: ChatMsg[];
  onSend: (message: string) => void;
}) {
  const [msg, setMsg] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [props.chat.length]);

  return (
    <div className="stack">
      <div className="chatBox" ref={ref}>
        {props.chat.length === 0 ? (
          <div className="hint">Messages appear here.</div>
        ) : (
          props.chat.map((m, idx) => (
            <p className="chatMsg" key={`${m.at}-${idx}`}>
              <span className="chatMeta">{m.name}:</span>
              <span>{m.message}</span>
            </p>
          ))
        )}
      </div>
      <div className="row">
        <input
          className="input"
          disabled={props.disabled}
          placeholder={props.disabled ? "Join a room to chat" : "Say something…"}
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const trimmed = msg.trim();
            if (!trimmed) return;
            props.onSend(trimmed);
            setMsg("");
          }}
        />
        <button
          className="btn"
          disabled={props.disabled || msg.trim().length === 0}
          onClick={() => {
            const trimmed = msg.trim();
            if (!trimmed) return;
            props.onSend(trimmed);
            setMsg("");
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

