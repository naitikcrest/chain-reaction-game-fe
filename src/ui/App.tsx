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

  const lastEventsAtRef = useRef<number>(0);
  const stateRef = useRef<GameState | null>(null);
  const lastTurnPlayerIdRef = useRef<string | null>(null);
  const overlayTimeoutRef = useRef<number | null>(null);
  const flashTimeoutRef = useRef<number | null>(null);

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

  return (
    <div className="layout">
      <div className="panel">
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
            });
          }}
          onJoin={() => {
            setError(null);
            socket.emit("room:join", { roomId, name: myName || "Player" }, (res) => {
              if (!res.ok) return setError(res.reason);
              setMyPlayerId(res.playerId);
              setState(res.state);
              setChat([]);
            });
          }}
          onStart={() => {
            if (!state) return;
            socket.emit("game:start", { roomId: state.roomId }, (res) => {
              if (!res.ok) setError(res.reason);
            });
          }}
          onRestart={() => {
            if (!state) return;
            socket.emit("game:restart", { roomId: state.roomId }, (res) => {
              if (!res.ok) setError(res.reason);
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
      </div>

      <div className="canvasWrap">
        <div className={`canvasCard ${turnColor ? "turnTheme" : ""} ${turnFlash ? "turnFlash" : ""}`} style={themeVars}>
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
    </div>
  );
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

