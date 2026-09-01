"use client";

import { useEffect, useRef, useState } from "react";
import { wsUrl } from "./token";
import type { Tile } from "./types";

// Subscribes to /ws/tiles, the daemon's once-a-second snapshot of every
// session. Reconnects on drop; returns the latest tiles and a link state.
export function useTiles(): { tiles: Tile[]; connected: boolean } {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [connected, setConnected] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;

    function open() {
      ws = new WebSocket(wsUrl("/ws/tiles"));
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => {
        try {
          setTiles(JSON.parse(e.data) as Tile[]);
        } catch {
          /* ignore a malformed frame; the next tick corrects it */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) timer.current = window.setTimeout(open, 1000);
      };
      ws.onerror = () => ws?.close();
    }
    open();

    return () => {
      closed = true;
      if (timer.current) window.clearTimeout(timer.current);
      ws?.close();
    };
  }, []);

  return { tiles, connected };
}
