import { readFileSync, writeFileSync } from "node:fs";
import { textIcon } from "../assets/art.ts";
import { PNG } from "pngjs";
const ids = (process.argv[2] ?? "").split(",");
const K = 6, W = 32;
const out = new PNG({ width: ids.length * (W*K+12), height: W*K });
for (let i = 0; i < out.data.length; i += 4) out.data.set([30,28,40,255], i);
ids.forEach((id, n) => {
  const p = textIcon(readFileSync("assets/icons/"+id+".txt","utf8"), W, W, id);
  for (let y=0;y<W;y++) for (let x=0;x<W;x++) { const i=(y*W+x)*4; if (!p.data[i+3]) continue;
    for (let dy=0;dy<K;dy++) for (let dx=0;dx<K;dx++) out.data.set(p.data.subarray(i,i+4), ((y*K+dy)*out.width + n*(W*K+12)+x*K+dx)*4); }
});
writeFileSync("/private/tmp/claude-502/-Users-daofeng-wu-Projects-jev-rogue/93384fd7-a6b9-4b94-9d83-f96dbe406040/scratchpad/icons2.png", PNG.sync.write(out));
