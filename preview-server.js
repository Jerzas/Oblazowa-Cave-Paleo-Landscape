const http = require("http");
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const port = Number(process.env.PORT || 8000);
const host = "127.0.0.1";
const dataFile = path.join(root, "data.js");

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function formatNumber(value) {
  return Number(value.toFixed(15)).toString();
}

function saveStartView(sceneId, parameters) {
  if (typeof sceneId !== "string" || !sceneId) {
    throw new Error("Missing scene ID");
  }

  const yaw = Number(parameters && parameters.yaw);
  const pitch = Number(parameters && parameters.pitch);
  const fov = Number(parameters && parameters.fov);

  if (![yaw, pitch, fov].every(Number.isFinite)) {
    throw new Error("Invalid view parameters");
  }
  if (pitch < -Math.PI / 2 || pitch > Math.PI / 2 || fov <= 0 || fov > Math.PI) {
    throw new Error("View parameters are outside the allowed range");
  }

  const source = fs.readFileSync(dataFile, "utf8");
  const idNeedle = `"id": ${JSON.stringify(sceneId)}`;
  const sceneStart = source.indexOf(idNeedle);
  const duplicate = source.indexOf(idNeedle, sceneStart + idNeedle.length);

  if (sceneStart === -1 || duplicate !== -1) {
    throw new Error("Scene ID was not found uniquely in data.js");
  }

  const nextScene = source.indexOf('\n    {\n      "id":', sceneStart + idNeedle.length);
  const sceneEnd = nextScene === -1 ? source.length : nextScene;
  const sceneSource = source.slice(sceneStart, sceneEnd);
  const viewPattern = /"initialViewParameters"\s*:\s*\{\s*"yaw"\s*:\s*[-+0-9.eE]+\s*,\s*"pitch"\s*:\s*[-+0-9.eE]+\s*,\s*"fov"\s*:\s*[-+0-9.eE]+\s*\}/;

  if (!viewPattern.test(sceneSource)) {
    throw new Error("Initial view parameters were not found for this scene");
  }

  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const replacement = [
    '"initialViewParameters": {',
    `        "yaw": ${formatNumber(yaw)},`,
    `        "pitch": ${formatNumber(pitch)},`,
    `        "fov": ${formatNumber(fov)}`,
    "      }",
  ].join(newline);
  const updatedScene = sceneSource.replace(viewPattern, replacement);
  const updatedSource = source.slice(0, sceneStart) + updatedScene + source.slice(sceneEnd);
  const appDataMatch = updatedSource.match(/var\s+APP_DATA\s*=\s*(\{[\s\S]*\});\s*$/);

  if (!appDataMatch) {
    throw new Error("Updated data.js has an invalid wrapper");
  }
  JSON.parse(appDataMatch[1]);
  fs.writeFileSync(dataFile, updatedSource, "utf8");

  return { yaw, pitch, fov };
}

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");

      if (req.method === "POST" && url.pathname === "/__dev/save-start-view") {
        const body = await readJsonBody(req);
        const saved = saveStartView(body.sceneId, body.initialViewParameters);
        sendJson(res, 200, { ok: true, sceneId: body.sceneId, initialViewParameters: saved });
        return;
      }

      let file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);

      if (!file.toLowerCase().startsWith(root.toLowerCase())) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
        file = path.join(file, "index.html");
      }

      if (!fs.existsSync(file)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      res.writeHead(200, {
        "Content-Type": types[path.extname(file).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      fs.createReadStream(file).pipe(res);
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  })
  .listen(port, host, () => {
    console.log(`Preview: http://localhost:${port}`);
  });
