import type { GameEvent, GameState } from "../shared/types";

export type ClientToServerEvents = {
  "room:create": (
    payload: { name: string; rows?: number; cols?: number },
    cb: (res: { ok: true; roomId: string; state: GameState; playerId: string } | { ok: false; reason: string }) => void
  ) => void;
  "room:join": (payload: { roomId: string; name: string }, cb: (res: { ok: true; state: GameState; playerId: string } | { ok: false; reason: string }) => void) => void;
  "game:start": (payload: { roomId: string }, cb: (res: { ok: true; state: GameState } | { ok: false; reason: string }) => void) => void;
  "game:move": (payload: { roomId: string; row: number; col: number }, cb: (res: { ok: true } | { ok: false; reason: string }) => void) => void;
  "game:restart": (payload: { roomId: string }, cb: (res: { ok: true; state: GameState } | { ok: false; reason: string }) => void) => void;
  "chat:send": (payload: { roomId: string; message: string }, cb: (res: { ok: true } | { ok: false; reason: string }) => void) => void;
};

export type ServerToClientEvents = {
  "room:state": (payload: { state: GameState }) => void;
  "room:players": (payload: { state: GameState }) => void;
  "game:events": (payload: { state: GameState; events: GameEvent[] }) => void;
  "chat:message": (payload: { roomId: string; playerId: string; name: string; message: string; at: number }) => void;
  "room:leaderboard": (payload: { roomId: string; entries: Array<{ playerId: string; name: string; wins: number }> }) => void;
};

