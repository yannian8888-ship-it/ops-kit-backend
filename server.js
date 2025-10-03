import express from "express";
import cors from "cors";
import "dotenv/config";
import pino from "pino";
import { execFile } from "child_process";
import { mkdirp, ensureDir } from "fs-extra";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { execFileSync } from "child_process";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors());

const log = pino({ level: process.env.LOG_LEVEL || "info" });

const PORT = process.env.PORT || 8080;
const PUBLIC_BASE = process.env.PUBLIC_BASE || ("http://localhost:" + PORT);
const FILES_DIR = process.env.FILES_DIR || path.join(__dirname, "../public/files");

const jobs = new Map(); // jobId -> { status, videoUrl, audioUrl, text, meta, error }

app.use("/files", express.static(FILES_DIR, { maxAge: "2d", fallthrough: true }));

app.get("/health", (req, res) => res.status(200).send("OK"));

function genId() {
  return crypto.randomBytes(8).toString("hex");
}

function execp(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stdout, stderr }));
      resolve({ stdout, stderr });
    });
  });
}

async function runJob(jobId, url, options) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = "running";

  try {
    await ensureDir(FILES_DIR);

    // 获取元数据（标题、描述等）
    let meta = {};
    try {
      const { stdout } = await execp("yt-dlp", ["-J", url], { maxBuffer: 1024 * 1024 * 20 });
      meta = JSON.parse(stdout);
    } catch (e) {
      log.warn({ err: e.message }, "yt-dlp metadata failed");
    }

    // 下载最佳 mp4（优先 1080p）
    const videoPath = path.join(FILES_DIR, `${jobId}.mp4`);
    const args = [
      "-f", "bv*[ext=mp4]+ba/b[ext=mp4]/best",
      "-S", "res:1080,codec:h264",
      "-o", videoPath,
      url
    ];
    await execp("yt-dlp", args, { maxBuffer: 1024 * 1024 * 50 });

    // 可选：提取音频（m4a）
    let audioPath = "";
    if (options?.audioOnly) {
      audioPath = path.join(FILES_DIR, `${jobId}.m4a`);
      try {
        await execp("ffmpeg", ["-y", "-i", videoPath, "-vn", "-acodec", "aac", audioPath], { maxBuffer: 1024 * 1024 * 50 });
      } catch (e) {
        log.warn({ err: e.message }, "ffmpeg audio extract failed");
        audioPath = "";
      }
    }

    // 文本：标题 + 描述（后续可接 ASR）
    let text = "";
    if (options?.extractText) {
      const title = meta?.title || "";
      const desc = meta?.description || meta?.fulltitle || "";
      text = [title, desc].filter(Boolean).join("\n\n").trim();
      if (!text) text = "（未获取到可用文本，稍后可重试或仅使用视频/音频）";
    }

    const width = meta?.width || meta?.requested_formats?.[0]?.width || null;
    const height = meta?.height || meta?.requested_formats?.[0]?.height || null;

    Object.assign(job, {
      status: "done",
      videoUrl: `${PUBLIC_BASE}/files/${path.basename(videoPath)}`,
      audioUrl: audioPath ? `${PUBLIC_BASE}/files/${path.basename(audioPath)}` : "",
      text,
      meta: { width, height }
    });
  } catch (e) {
    log.error({ err: e.message }, "job failed");
    Object.assign(job, {
      status: "failed",
      error: e.message || "PROCESS_FAILED",
      audioUrl: "",
      text: job.text || ""
    });
  }
}

app.post("/process", async (req, res) => {
  const { url, options } = req.body || {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "INVALID_URL" });
  }
  const jobId = genId();
  jobs.set(jobId, { status: "queued", text: "", meta: {} });
  res.json({ jobId });
  runJob(jobId, url, options || { extractText: true, audioOnly: true }).catch(() => {});
});

app.get("/status", (req, res) => {
  const { jobId } = req.query;
  const job = jobId && jobs.get(jobId);
  if (!job) return res.status(404).json({ status: "not_found" });
  if (job.status === "done") {
    return res.json({
      status: "done",
      videoUrl: job.videoUrl || "",
      audioUrl: job.audioUrl || "",
      text: job.text || "",
      meta: job.meta || {}
    });
  }
  if (job.status === "failed") {
    return res.json({
      status: "failed",
      message: job.error || "failed",
      audioUrl: job.audioUrl || "",
      text: job.text || ""
    });
  }
  return res.json({ status: job.status });
});

app.listen(PORT, async () => {
  await mkdirp(FILES_DIR);
  console.log(`OK on :${PORT}`);
});
