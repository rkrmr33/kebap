import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const fixturePath = fileURLToPath(new URL("./fixture.html", import.meta.url));
const port = Number(process.env.KEBAP_FIXTURE_PORT || 4173);

const server = createServer((request, response) => {
  if (request.url === "/favicon.ico") {
    response.writeHead(204).end();
    return;
  }
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  createReadStream(fixturePath).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Kebap fixture: http://127.0.0.1:${port}/?account=secret#/checkout?token=secret\n`);
});
