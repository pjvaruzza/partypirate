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

Bots are hostile to all players; players can't damage each other (no PvP
yet — see `ROADMAP.md`).

## Production build (client only)

```
npm run build
```

Builds the static client to `dist/`. You still need `npm run server` running
somewhere reachable for the client to connect to.
