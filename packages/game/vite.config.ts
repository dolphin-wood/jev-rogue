import { defineConfig, loadEnv } from "vite";
import type { Plugin } from "vite";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { handle } from "../../server/worker.ts";

const root = resolve(import.meta.dirname, "../..");

/**
 * Dev only: `/api/decide` runs the hosted proxy's own handler in the dev
 * server, so development forwards exactly as production does — the key from
 * `.env.local` and the model are added server-side and never reach the
 * browser, and TypeSafe's CORS allowlist is sidestepped (doc 009).
 *
 * `/api/invite/verify` is the same handler on its other path, so the invite
 * dialog answers here too — with no `INVITE_CODES` it reports `needed: false`,
 * which is what makes the dialog say a code is not needed locally.
 */
function decideProxy(key: string | undefined): Plugin {
  return {
    name: "jr-decide-proxy",
    configureServer(server) {
      for (const path of ["/api/decide", "/api/invite/verify"]) {
        server.middlewares.use(path, async (req, res) => {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const origin = req.headers.origin ?? "";
          const request = new Request(`http://dev.local${path}`, {
            method: req.method ?? "POST",
            headers: Object.fromEntries(Object.entries(req.headers).flatMap(([k, v]) =>
              typeof v === "string" ? [[k, v]] : [])),
            ...(req.method === "POST" ? { body: Buffer.concat(chunks).toString("utf8") } : {}),
          });
          // On the developer's own machine: no invite gate.
          const reply = await handle(request, { TYPESAFE_API_KEY: key ?? "", ALLOWED_ORIGIN: origin });
          res.statusCode = reply.status;
          reply.headers.forEach((v, k) => { res.setHeader(k, v); });
          res.end(await reply.text());
        });
      }
    },
  };
}

/**
 * Build only: `publicDir` is the whole of `assets/`, and most of
 * `assets/source/` is art the asset scripts build *from* (tens of MB the game
 * never loads). The hall sheets are the one part the game reads at runtime
 * (`scenes/hall-art.ts`), so they stay and the rest leaves the bundle.
 */
const SHIPPED_SOURCE = new Set(["halls"]);

function pruneSourceArt(outDir: string): Plugin {
  return {
    name: "jr-prune-source-art",
    apply: "build",
    closeBundle() {
      const dir = resolve(outDir, "source");
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir)) {
        if (!SHIPPED_SOURCE.has(entry)) rmSync(resolve(dir, entry), { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // The repository root holds `.env.local`; the Vite root is the game package.
  const env = loadEnv(mode, root, "");
  const outDir = resolve(root, "dist");
  return {
    root: resolve(root, "packages/game"),
    envDir: root,
    publicDir: resolve(root, "assets"),
    base: process.env.VITE_BASE ?? "/",
    plugins: [decideProxy(env["TYPESAFE_API_KEY"]), pruneSourceArt(outDir)],
    resolve: {
      alias: {
        "@jr/core": resolve(root, "packages/core/src/index.ts"),
        "@jr/director": resolve(root, "packages/director/src/index.ts"),
      },
    },
    build: { outDir, emptyOutDir: true, target: "es2022" },
  };
});
