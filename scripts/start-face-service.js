// Runs face-service locally in Docker for `npm start`.
//
// face-service is Python (InsightFace) with pinned deps that need Python 3.10,
// so instead of a local venv it runs from its own Dockerfile — the same image
// UAT/prod use. Exposed on localhost:8000, matching FACE_SERVICE_URL in
// employee-service/.env. The container is removed on Ctrl+C / exit.
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const NAME = "zodu-face-service";
const IMAGE = "zodu-face-service";
const DIR = path.join(__dirname, "..", "face-service");
const EMPLOYEE_ENV = path.join(__dirname, "..", "employee-service", ".env");

/** One KEY's value from a dotenv file, or undefined. */
function readEnvValue(file, key) {
  if (!fs.existsSync(file)) return undefined;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith(`${key}=`)) continue;
    return line.slice(key.length + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return undefined;
}

// face-service only answers employee-service, which proves itself with its
// INTERNAL_TOKEN (X-Internal-Token). The container must hold the same value as
// INTERNAL_TOKEN_EMPLOYEE, or every /embedding call is a 401 and the app shows
// "Face recognition is unavailable".
const employeeToken =
  process.env.INTERNAL_TOKEN_EMPLOYEE || readEnvValue(EMPLOYEE_ENV, "INTERNAL_TOKEN");
if (!employeeToken || employeeToken.length < 32) {
  console.error(
    "[face-service] No INTERNAL_TOKEN (32+ chars) in employee-service/.env — " +
      "face-service would reject every request. Set it, or export INTERNAL_TOKEN_EMPLOYEE.",
  );
  process.exit(1);
}

const docker = (args, opts = {}) => spawnSync("docker", args, { stdio: "inherit", ...opts });

// `npm start` often runs before Docker Desktop has finished starting: wait for it
// instead of exiting, or face attendance stays down until the next `npm start`.
const dockerUp = () => spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
for (let waited = 0; !dockerUp(); waited += 5) {
  if (waited % 30 === 0) console.warn("[face-service] waiting for Docker — start Docker Desktop. Face attendance is unavailable until then.");
  sleepSync(5000);
}

// A previous run killed without cleanup would still hold the name and port 8000.
docker(["rm", "-f", NAME], { stdio: "ignore" });

console.log("[face-service] building image (first build downloads the ~300 MB model)...");
if (docker(["build", "-q", "-t", IMAGE, DIR]).status !== 0) process.exit(1);

// `-e NAME` (no value) copies it from this process's env, so the token never
// appears in the command line / process list.
const run = spawn(
  "docker",
  ["run", "--rm", "--name", NAME, "-p", "8000:8000", "-e", "INTERNAL_TOKEN_EMPLOYEE", IMAGE],
  { stdio: "inherit", env: { ...process.env, INTERNAL_TOKEN_EMPLOYEE: employeeToken } },
);

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
