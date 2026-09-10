import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve(".");
const port = Number(process.env.PORT || 4173);

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"]
]);

function resolveRequestPath(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath.split("?")[0]); } catch { return null; }
  // Preview serves only the distributable app, never development files/secrets.
  if (decoded !== "/" && decoded !== "/index.html") return null;
  const safePath = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(root, safePath === "/" ? "index.html" : safePath));
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    return null;
  }
  return filePath;
}

createServer((request, response) => {
  const filePath = resolveRequestPath(request.url || "/");
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": contentTypes.get(extname(filePath)) || "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(filePath).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Serving ${root} on http://127.0.0.1:${port}`);
});
