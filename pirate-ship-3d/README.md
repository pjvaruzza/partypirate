# Rogue Tides — Pirate Ship 3D

A browser-based naval combat sandbox: sail, broadside cannon combat, collect
gold, upgrade your ship at port. Playable solo or as a small LAN multiplayer
world shared with friends (bots fill the world either way).

## Solo / development

```
npm install
npm run dev
```

This starts the Vite dev server *and* still needs the multiplayer server
running (see below) — the client always connects over WebSocket, even for a
single player.

## Playing with friends (same network)

1. On the host machine, start the authoritative game server:
   ```
   npm run server
   ```
   This listens on `ws://0.0.0.0:8787` and owns all ship movement, combat,
   bots, and each captain's saved progress (`server/data/players.json`).
2. In another terminal, start the client exposed to the LAN:
   ```
   npm run dev -- --host
   ```
3. Everyone on the same network opens `http://<host-machine-LAN-IP>:5173` in
   a browser, types a captain name, and sets sail. The client automatically
   points its WebSocket connection at whatever host it was loaded from, so
   no extra configuration is needed as long as everyone's on the same
   network as the host.

Progress (gold, sail/cannon/hull/powder levels, cannon loadout) is saved
server-side per captain name — reconnect with the same name to pick up where
you left off. There's no password; this is trust-based, meant for a small
group of friends rather than a public server.

If your connection drops mid-session, rejoining with the same name within
60 seconds reclaims your exact ship (position and health included) instead
of respawning you fresh at port.

Press **Enter** anywhere in-game to open a chat box, Enter again to send,
Escape to cancel — messages are visible to everyone in the world.

**PvP is fully open.** Bots are hostile to everyone, and players can damage
each other anywhere outside the home-port sanctuary — a ring of radius
`island radius + 45` around home port in which no damage flows in either
direction, and in which your hold banks automatically. Freshly respawned
ships get 6 seconds of immunity (forfeited the moment you fire), and a ship
whose socket has dropped is immune for its 60-second reconnect window.

Gold earned at sea is **unbanked** — it sits in your hold until you reach
port. Sink and 70% of it spills as floating salvage that any ship can
collect (the other 30% is destroyed); banked gold is never at risk and is
the only currency the shipyard accepts. Sinking another captain pays you
nothing directly — the reward is their spilled hold, which you have to stop
and physically scoop up.

## Production build (client only)

```
npm run build
```

Builds the static client to `dist/`. You still need `npm run server` running
somewhere reachable for the client to connect to.

## Specialist agents

For focused improvement work (graphics, mobile performance, gameplay
balance, touch UX, audio), this repo defines seven on-demand Claude Code
subagents under `.claude/agents/` — `art-director`, `mobile-perf`,
`gameplay-designer`, `mobile-ux`, `sound-design`, `qa-verify`, and
`producer` (a swarm orchestrator for initiatives spanning several of the
above). Every one of them is invoked explicitly by name; none trigger on
their own. See `AGENT_NETWORK_PRD.md` for the full design — roles,
boundaries, mobile-first bar, and how they hand work to each other.
