/**
 * **The debug harness**: one long-lived game server and headless browser on
 * this machine, and a client any session drives it with.
 *
 *     pnpm dbg serve                        # once, in your own terminal
 *     pnpm dbg open "lab=fight&foes=tank,tank:armored"
 *     pnpm dbg eval "__lab.freeze(); __lab.set(0, { poise: 12 })"
 *     pnpm dbg shot --around 0 --scale 3 --out local/dbg/tank.png
 *
 * It exists because looking at a change in the real renderer cost more than
 * making it. Every session started a Vite server of its own and left it
 * running; a browser pane that was not on screen stopped drawing, so its
 * screenshots were of an old frame; the file watcher did not see edits made
 * from inside the sandbox; and every scene was reached by clicking through
 * the sound choice, the title and the style. So there is one server, started
 * by a person, on fixed ports: the client never starts one, it says so when
 * none is up. The browser is headless, so it draws whether or not anyone is
 * looking. The page is reached by URL (`?lab=fight`, see `enterFightLab`),
 * and posed through `window.__lab` (`PlayScene.labApi`).
 *
 * Commands (the client prints JSON):
 *
 * - `serve` — the server: Vite on `DBG_GAME_PORT` (5198), control on
 *   `DBG_PORT` (5199), both on localhost only.
 * - `open <query>` — loads `/?<query>` and waits until `__lab.ready()`.
 * - `eval <js>` — runs an expression, or a function body with `return`, in
 *   the page; `await` works. `__lab` is in scope as `lab` too.
 * - `shot [--around i] [--pad px] [--world x,y,w,h] [--scale n] [--out file]`
 *   — a PNG of the page, or of a world rectangle (around body `i`, padded),
 *   blown up by whole pixels. Written by the client, so the file lands where
 *   the caller can read it (default `local/dbg/shot.png`).
 * - `state` — the bodies and the player. `logs [--errors] [--clear]` — the
 *   page's console. `reload`. `stop` — closes the server.
 */
import { createServer as createHttp, request as httpRequest } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PNG } from "pngjs";

const PORT = Number(process.env.DBG_PORT ?? 5199);
const GAME_PORT = Number(process.env.DBG_GAME_PORT ?? 5198);
const ROOT = resolve(import.meta.dirname, "../../../..");
const VIEWPORT = { width: 1280, height: 800 };
const LOG_KEEP = 300;

interface Cmd { cmd: string; [k: string]: unknown }
interface LogLine { type: string; text: string; at: number }

// ---------------------------------------------------------------- server

async function serve(): Promise<void> {
  const { createServer: createVite } = await import("vite");
  const { chromium } = await import("playwright-core");
  const vite = await createVite({
    configFile: resolve(ROOT, "packages/game/vite.config.ts"),
    server: { port: GAME_PORT, strictPort: true, host: "127.0.0.1" },
    clearScreen: false,
  });
  await vite.listen();
  const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: VIEWPORT });
  const logs: LogLine[] = [];
  const log = (type: string, text: string): void => {
    logs.push({ type, text, at: Date.now() });
    if (logs.length > LOG_KEEP) logs.splice(0, logs.length - LOG_KEEP);
  };
  page.on("console", (m) => log(m.type(), m.text()));
  page.on("pageerror", (e) => log("pageerror", String(e.stack ?? e)));
  const base = `http://127.0.0.1:${GAME_PORT}/`;

  const waitReady = (): Promise<unknown> =>
    page.waitForFunction(() => (window as unknown as { __lab?: { ready(): boolean } }).__lab?.ready() === true, null, { timeout: 30_000 });
  const state = (): Promise<unknown> => page.evaluate(() => {
    const lab = (window as unknown as { __lab?: { ready(): boolean; bodies(): unknown; player(): unknown } }).__lab;
    return lab?.ready() ? { url: location.search, player: lab.player(), bodies: lab.bodies() } : { url: location.search, ready: false };
  });

  const run = async (c: Cmd): Promise<unknown> => {
    switch (c.cmd) {
      case "open": {
        const q = String(c["query"] ?? "").replace(/^\?/, "");
        logs.length = 0;
        await page.goto(`${base}?${q}`);
        await waitReady();
        return state();
      }
      case "reload": logs.length = 0; await page.reload(); await waitReady(); return state();
      case "state": return state();
      case "eval": {
        const src = String(c["js"] ?? "");
        return page.evaluate(async (code) => {
          const AsyncFn = Object.getPrototypeOf(async () => {}).constructor as new (...a: string[]) => (lab: unknown) => Promise<unknown>;
          let fn: (lab: unknown) => Promise<unknown>;
          try { fn = new AsyncFn("lab", `return (${code}\n);`); } catch { fn = new AsyncFn("lab", code); }
          const out = await fn((window as unknown as { __lab?: unknown }).__lab);
          return out === undefined ? null : JSON.parse(JSON.stringify(out));
        }, src);
      }
      case "shot": {
        const clip = await page.evaluate(({ around, pad, rect }) => {
          const lab = (window as unknown as { __lab?: {
            bodies(): { x: number; y: number; radius: number }[];
            toScreen(x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number };
          } }).__lab;
          if (!lab) return null;
          if (rect) return lab.toScreen(rect[0]!, rect[1]!, rect[2]!, rect[3]!);
          if (around === null) return null;
          const b = lab.bodies()[around];
          if (!b) throw new Error(`no body ${around}`);
          const half = b.radius + pad;
          // Taller than wide, and more of it below the centre: a body is drawn up from its feet, and the bars are under them.
          return lab.toScreen(b.x - half * 1.4, b.y - half * 2, half * 2.8, half * 3);
        }, {
          around: c["around"] === undefined ? null : Number(c["around"]),
          pad: Number(c["pad"] ?? 24),
          rect: c["world"] ? String(c["world"]).split(",").map(Number) : null,
        });
        const shot = await page.screenshot(clip ? {
          clip: { x: Math.max(0, clip.x), y: Math.max(0, clip.y), width: Math.max(1, clip.w), height: Math.max(1, clip.h) },
        } : {});
        const scale = Math.max(1, Math.floor(Number(c["scale"] ?? 1)));
        return { png: (scale > 1 ? upscale(shot, scale) : shot).toString("base64") };
      }
      case "logs": {
        const out = c["errors"] ? logs.filter((l) => l.type === "error" || l.type === "pageerror") : [...logs];
        if (c["clear"]) logs.length = 0;
        return out;
      }
      case "stop":
        setTimeout(() => { void browser.close().finally(() => vite.close()).finally(() => process.exit(0)); }, 50);
        return { stopped: true };
      default: throw new Error(`unknown command "${c.cmd}"`);
    }
  };

  const ctl = createHttp((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (d: Buffer) => chunks.push(d));
    req.on("end", () => {
      void (async () => {
        let status = 200, body: unknown;
        try { body = await run(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Cmd); }
        catch (e) { status = 500; body = { error: String((e as Error).message ?? e) }; }
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body ?? null));
      })();
    });
  });
  ctl.listen(PORT, "127.0.0.1", () => {
    console.log(`dbg: game on ${base}, control on http://127.0.0.1:${PORT}/ (browser ${browser.version()})`);
    console.log("dbg: every session drives this one; `pnpm dbg stop` or Ctrl-C closes it.");
  });
  const quit = (): void => { void browser.close().finally(() => vite.close()).finally(() => process.exit(0)); };
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
}

/** Nearest-neighbour, by a whole factor: art pixels stay square and sharp. */
function upscale(buf: Buffer, k: number): Buffer {
  const src = PNG.sync.read(buf);
  const out = new PNG({ width: src.width * k, height: src.height * k });
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const s = ((((y / k) | 0) * src.width) + ((x / k) | 0)) * 4, d = (y * out.width + x) * 4;
      out.data[d] = src.data[s]!; out.data[d + 1] = src.data[s + 1]!; out.data[d + 2] = src.data[s + 2]!; out.data[d + 3] = src.data[s + 3]!;
    }
  }
  return PNG.sync.write(out);
}

// ---------------------------------------------------------------- client

function send(c: Cmd): Promise<{ status: number; body: unknown }> {
  return new Promise((done, fail) => {
    const payload = JSON.stringify(c);
    const req = httpRequest({
      host: "127.0.0.1", port: PORT, method: "POST", path: "/",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (d: Buffer) => chunks.push(d));
      res.on("end", () => done({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "null") }));
    });
    req.on("error", fail);
    req.end(payload);
  });
}

function flags(args: string[]): { rest: string[]; opts: Record<string, string | true> } {
  const rest: string[] = [], opts: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("--")) { rest.push(a); continue; }
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith("--")) { opts[a.slice(2)] = next; i++; } else opts[a.slice(2)] = true;
  }
  return { rest, opts };
}

async function client(cmd: string, args: string[]): Promise<void> {
  const { rest, opts } = flags(args);
  const c: Cmd = { cmd, ...opts };
  if (cmd === "open") c["query"] = rest.join("&");
  if (cmd === "eval") c["js"] = rest.join(" ");
  let reply: { status: number; body: unknown };
  try { reply = await send(c); }
  catch {
    console.error(`dbg: no debug server on 127.0.0.1:${PORT}. Ask the user to run \`pnpm dbg serve\` in their own terminal`
      + " (one per machine, shared by every session). Do not start a Vite server of your own.");
    process.exit(2);
  }
  if (reply.status !== 200) { console.error(JSON.stringify(reply.body)); process.exit(1); }
  if (cmd === "shot") {
    const out = resolve(String(opts["out"] ?? "local/dbg/shot.png"));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from((reply.body as { png: string }).png, "base64"));
    console.log(JSON.stringify({ wrote: out }));
    return;
  }
  console.log(JSON.stringify(reply.body, null, 1));
}

const [cmd = "help", ...args] = process.argv.slice(2);
if (cmd === "serve") await serve();
else if (cmd === "help" || cmd === "--help") console.log("pnpm dbg serve | open <query> | eval <js> | shot [--around i] [--pad px] [--world x,y,w,h] [--scale n] [--out file] | state | logs [--errors] [--clear] | reload | stop");
else await client(cmd, args);
