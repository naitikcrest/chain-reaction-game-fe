import type { GameState } from "../shared/types";
import React, { useMemo } from "react";

export function SidePanel(props: {
  state: GameState | null;
  myPlayerId: string | null;
  leaderboard: Array<{ playerId: string; name: string; wins: number }>;
  fastForward: boolean;
  onFastForwardChange: (v: boolean) => void;
  onReplayLast: () => void;
  canReplay: boolean;
}) {
  const current = useMemo(() => {
    if (!props.state) return null;
    return props.state.players[props.state.currentPlayerIdx] ?? null;
  }, [props.state]);

  return (
    <div className="stack" style={{ marginTop: 12 }}>
      <h2>Players</h2>
      <div className="stack">
        {props.state?.players.map((p) => {
          const isCurrent = current?.id === p.id && props.state?.status === "playing";
          const isMe = props.myPlayerId === p.id;
          return (
            <div
              key={p.id}
              className="pill"
              style={{
                borderColor: isCurrent ? p.color : "var(--border)",
                color: p.eliminated ? "rgba(255,255,255,0.45)" : "var(--text)"
              }}
              title={p.id}
            >
              <span className="dot" style={{ background: p.color, opacity: p.eliminated ? 0.35 : 1 }} />
              <span style={{ fontWeight: 650 }}>
                {p.name}
                {isMe ? " (you)" : ""}
              </span>
              <span style={{ marginLeft: "auto", color: "var(--muted)" }}>
                {p.eliminated ? "eliminated" : isCurrent ? "turn" : "waiting"}
              </span>
            </div>
          );
        }) ?? <div className="hint">Create or join a room.</div>}
      </div>

      <h2>Leaderboard</h2>
      <div className="stack">
        {props.leaderboard.length === 0 ? (
          <div className="hint">No games yet.</div>
        ) : (
          props.leaderboard
            .slice()
            .sort((a, b) => b.wins - a.wins)
            .map((e) => (
              <div key={e.playerId} className="pill">
                <span style={{ fontWeight: 650 }}>{e.name}</span>
                <span style={{ marginLeft: "auto", color: "var(--muted)" }}>{e.wins} wins</span>
              </div>
            ))
        )}
      </div>

      <h2>Animation</h2>
      <div className="stack">
        <label className="pill" style={{ gap: 10, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={props.fastForward}
            onChange={(e) => props.onFastForwardChange(e.target.checked)}
          />
          <span style={{ color: "var(--muted)" }}>Fast-forward</span>
          <span style={{ marginLeft: "auto", color: "var(--muted)" }}>{props.fastForward ? "3×" : "1×"}</span>
        </label>
        <button className="btn" disabled={!props.canReplay} onClick={props.onReplayLast}>
          Replay last move
        </button>
        <div className="hint">Animations are played step-by-step (100–200ms) instead of jumping to the final grid.</div>
      </div>
    </div>
  );
}

