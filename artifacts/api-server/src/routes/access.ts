import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  VerifyAccessKeyBody,
  VerifyAccessKeyResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attemptsByIp = new Map<string, { count: number; resetAt: number }>();

function matchesConfiguredKey(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return (
    candidateBuffer.length === expectedBuffer.length &&
    timingSafeEqual(candidateBuffer, expectedBuffer)
  );
}

router.post("/access/verify", (req, res): void => {
  const parsed = VerifyAccessKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter an access key." });
    return;
  }

  const viewerKey = process.env.VIEWER_ACCESS_KEY;
  const adminKey = process.env.VIDEO_ADMIN_KEY;
  if (!viewerKey || !adminKey || viewerKey === adminKey) {
    req.log.error("Video library access keys are missing or incorrectly configured");
    res.status(503).json({ error: "Access is not configured. Ask the app owner for help." });
    return;
  }

  const now = Date.now();
  const ip = req.ip || "unknown";
  const attempt = attemptsByIp.get(ip);
  if (attempt && attempt.resetAt > now && attempt.count >= MAX_ATTEMPTS) {
    res.status(429).json({ error: "Too many attempts. Please wait a few minutes and try again." });
    return;
  }

  const role = matchesConfiguredKey(parsed.data.key, adminKey)
    ? "admin"
    : matchesConfiguredKey(parsed.data.key, viewerKey)
      ? "viewer"
      : null;

  if (!role) {
    if (!attempt || attempt.resetAt <= now) {
      attemptsByIp.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    } else {
      attempt.count += 1;
    }
    res.status(401).json({ error: "That key isn't recognized. Check it and try again." });
    return;
  }

  attemptsByIp.delete(ip);
  res.json(VerifyAccessKeyResponse.parse({ role }));
});

export default router;
