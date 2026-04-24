export type PlayerId = string;

export type Cell = {
  ownerId: PlayerId | null;
  orbCount: number;
};

export type Grid = Cell[][];

export type Player = {
  id: PlayerId;
  name: string;
  color: string;
  eliminated: boolean;
  hasPlacedAtLeastOnce: boolean;
};

export type GameStatus = "lobby" | "playing" | "finished";

export type GameState = {
  roomId: string;
  rows: number;
  cols: number;
  grid: Grid;
  players: Player[];
  currentPlayerIdx: number;
  status: GameStatus;
  winnerId: PlayerId | null;
  moveNumber: number;
  updatedAt: number;
};

export type GameEvent =
  | { type: "place"; row: number; col: number; playerId: PlayerId; orbCount: number }
  | { type: "burst"; row: number; col: number }
  | { type: "capture"; row: number; col: number; ownerId: PlayerId | null; orbCount: number }
  | { type: "elimination"; playerId: PlayerId }
  | { type: "win"; playerId: PlayerId };

