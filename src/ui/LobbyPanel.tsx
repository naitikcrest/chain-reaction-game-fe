import type { GameState } from "../shared/types";
import React from "react";

export function LobbyPanel(props: {
  myName: string;
  roomId: string;
  state: GameState | null;
  error: string | null;
  onMyNameChange: (v: string) => void;
  onRoomIdChange: (v: string) => void;
  onCreate: () => void;
  onJoin: () => void;
  onStart: () => void;
  onRestart: () => void;
}) {
  const status = props.state?.status ?? "none";

  return (
    <div className="stack" style={{ marginBottom: 12 }}>
      <div className="row">
        <input
          className="input"
          value={props.myName}
          placeholder="Your name"
          onChange={(e) => props.onMyNameChange(e.target.value)}
        />
      </div>

      <div className="row">
        <button className="btn" onClick={props.onCreate} disabled={props.myName.trim().length === 0}>
          Create room
        </button>
        <button className="btn" onClick={props.onJoin} disabled={props.roomId.trim().length === 0 || props.myName.trim().length === 0}>
          Join room
        </button>
      </div>

      <div className="row">
        <input
          className="input"
          value={props.roomId}
          placeholder="Room id"
          onChange={(e) => props.onRoomIdChange(e.target.value)}
        />
      </div>

      <div className="row">
        <button className="btn" onClick={props.onStart} disabled={!props.state || props.state.players.length < 2}>
          Start
        </button>
        <button className="btn" onClick={props.onRestart} disabled={!props.state}>
          Restart
        </button>
      </div>

      <div className="hint">
        <div>
          <strong>Status:</strong> {status}
        </div>
        {props.error ? (
          <div style={{ color: "var(--danger)", marginTop: 6 }}>
            <strong>Error:</strong> {props.error}
          </div>
        ) : null}
        {props.state ? (
          <div style={{ marginTop: 6 }}>
            <strong>Players:</strong> {props.state.players.length} · <strong>Moves:</strong> {props.state.moveNumber}
          </div>
        ) : null}
      </div>
    </div>
  );
}

