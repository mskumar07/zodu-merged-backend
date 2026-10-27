// Runs face-service locally in Docker for `npm start`.
//
// face-service is Python (InsightFace) with pinned deps that need Python 3.10,
// so instead of a local venv it runs from its own Dockerfile — the same image
// UAT/prod use. Exposed on localhost:8000, matching FACE_SERVICE_URL in
// employee-service/.env. The container is removed on Ctrl+C / exit.
const { spawn, spawnSync } = require("child_process");
const path = require("path");

const NAME = "zodu-face-service";
const IMAGE = "zodu-face-service";
const DIR = path.join(__dirname, "..", "face-service");

const docker = (args, opts = {}) => spawnSync("docker", args, { stdio: "inherit", ...opts });

if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
  console.error("[face-service] Docker is not running — start Docker Desktop. Face attendance will be unavailable.");
  process.exit(1);
}

// A previous run killed without cleanup would still hold the name and port 8000.
docker(["rm", "-f", NAME], { stdio: "ignore" });

console.log("[face-service] building image (first build downloads the ~300 MB model)...");
if (docker(["build", "-q", "-t", IMAGE, DIR]).status !== 0) process.exit(1);

const run = spawn("docker", ["run", "--rm", "--name", NAME, "-p", "8000:8000", IMAGE], { stdio: "inherit" });

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  docker(["rm", "-f", NAME], { stdio: "ignore" });
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
run.on("exit", (code) => process.exit(stopping ? 0 : code ?? 1));
