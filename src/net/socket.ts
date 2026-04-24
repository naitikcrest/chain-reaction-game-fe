import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "../types/socketTypes";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) {
    socket = io(SERVER_URL, { transports: ["websocket"] });
  }
  return socket;
}

