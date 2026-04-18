#!/usr/bin/env node
/**
 * Runs `gradlew assembleDebug` with a JDK Gradle supports (17–23).
 * Default `java` on PATH is often JDK 25+, which breaks Gradle 8.14 / AGP 8.13.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const androidDir = path.join(root, "android");

/** Gradle 8.14 + AGP 8.13: run the build with JDK 17–23 (JDK 25 on PATH breaks the daemon). */
const MIN_JAVA = 17;
const MAX_JAVA = 23;

function dirExists(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function javaMajorFromHome(home) {
  const javaExe = path.join(home, "bin", process.platform === "win32" ? "java.exe" : "java");
  if (!fs.existsSync(javaExe)) return null;
  const out = spawnSync(javaExe, ["-version"], { encoding: "utf8" });
  const s = `${out.stderr || ""}${out.stdout || ""}`;
  const m = s.match(/version "(\d+)/);
  if (!m) return null;
  return Number(m[1]);
}

function isUsableJdk(home) {
  if (!home || !dirExists(home)) return false;
  const major = javaMajorFromHome(home);
  return major != null && major >= MIN_JAVA && major <= MAX_JAVA;
}

function pickJavaHome() {
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Java\\jdk-23",
          "C:\\Program Files\\Java\\jdk-21",
          "C:\\Program Files\\Java\\jdk-17",
          "C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.13.11-hotspot",
          "C:\\Program Files\\Microsoft\\jdk-17.0.13.11-hotspot",
        ]
      : ["/usr/lib/jvm/java-17-openjdk-amd64", "/usr/lib/jvm/java-21-openjdk-amd64", "/opt/homebrew/opt/openjdk@17"];
  for (const p of candidates) {
    if (isUsableJdk(p)) return p;
  }
  if (process.env.JAVA_HOME && isUsableJdk(process.env.JAVA_HOME)) {
    return process.env.JAVA_HOME;
  }
  return null;
}

const javaHome = pickJavaHome();
if (!javaHome) {
  console.error(
    "No suitable JDK found. Install JDK 17–23 and set JAVA_HOME, or on Windows install to C:\\\\Program Files\\\\Java\\\\jdk-23",
  );
  process.exit(1);
}

const ext = process.platform === "win32" ? ".bat" : "";
const gradlew = path.join(androidDir, `gradlew${ext}`);
if (!fs.existsSync(gradlew)) {
  console.error("Missing", gradlew);
  process.exit(1);
}

const sep = path.delimiter;
const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  PATH: `${path.join(javaHome, "bin")}${sep}${process.env.PATH || ""}`,
};

console.info("Using JAVA_HOME=", javaHome);
const r = spawnSync(gradlew, ["assembleDebug"], { cwd: androidDir, env, stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status ?? 1);
