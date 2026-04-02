// api/tailor.js
// Place this file at: /api/tailor.js in your GitHub repository

// ============================================================
// RATE LIMITING
// Simple in-memory store - resets on each cold start.
// For production at scale, replace with Vercel KV or Upstash Redis.
// This limits each IP to 5 requests per 10 minutes.
// ============================================================
const rateLimitStore = new Map();
const RATE_LIMIT_MAX      = 5;
const RATE_LIMIT_WINDOW   = 10 * 60 * 1000; // 10 minutes in ms

function isRateLimited(ip) {
  const now  = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    // New window
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return false;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return true;
  }

  entry.count++;
  return false;
}

// ============================================================
// ALLOWED MIME TYPES
// Only accept resume-like file types
// ============================================================
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
];

// Max base64 payload size for a file (5MB original = ~6.8MB base64)
const MAX_FILE_B64_LENGTH = 6.8 * 1024 * 1024;

// Max job description characters
const MAX_JOB_DESC_LENGTH = 10000;

// Max total request body size (10MB)
const MAX_BODY_BYTES = 10 * 1024 * 1024;

// ============================================================
// MAIN HANDLER
// ============================================================
export default async function handler(req, res) {

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get client IP for rate limiting
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown';

  // Check rate limit
  if (isRateLimited(ip)) {
    return res.status(429).json({
      error: 'Too many requests. Please wait a few minutes and try again.'
    });
  }

  // Check body exists
  const { messages, system } = req.body || {};

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Missing or invalid messages.' });
  }

  // ============================================================
  // VALIDATE FILE CONTENT if present
  // Checks MIME type and size of any uploaded document or image
  // ============================================================
  for (const msg of messages) {
    if (!msg.content || !Array.isArray(msg.content)) continue;

    for (const block of msg.content) {

      // Check document blocks (PDFs)
      if (block.type === 'document' && block.source) {
        const mime = block.source.media_type || '';
        const data = block.source.data || '';

        if (!ALLOWED_MIME_TYPES.includes(mime) && mime !== 'application/pdf') {
          return res.status(400).json({
            error: 'Unsupported file type. Please upload a PDF, Word document, or image.'
          });
        }

        if (data.length > MAX_FILE_B64_LENGTH) {
          return res.status(400).json({
            error: 'File is too large. Please upload a file under 5MB.'
          });
        }
      }

      // Check image blocks
      if (block.type === 'image' && block.source) {
        const mime = block.source.media_type || '';
        const data = block.source.data || '';

        if (!ALLOWED_MIME_TYPES.includes(mime)) {
          return res.status(400).json({
            error: 'Unsupported image type. Please upload a PNG or JPG.'
          });
        }

        if (data.length > MAX_FILE_B64_LENGTH) {
          return res.status(400).json({
            error: 'Image is too large. Please upload a file under 5MB.'
          });
        }
      }

      // Check text blocks for excessive length
      if (block.type === 'text' && typeof block.text === 'string') {
        if (block.text.length > MAX_JOB_DESC_LENGTH) {
          return res.status(400).json({
            error: 'Job description is too long. Please trim it to under 10,000 characters.'
          });
        }
      }
    }
  }

  // ============================================================
  // VALIDATE SYSTEM PROMPT
  // Prevent excessively large system prompts
  // ============================================================
  if (system && typeof system === 'string' && system.length > 5000) {
    return res.status(400).json({ error: 'Invalid request.' });
  }

  // ============================================================
  // CALL ANTHROPIC API
  // ============================================================
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: system || undefined,
        messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic error:', data);
      return res.status(response.status).json({
        error: data.error?.message || 'Service error. Please try again.'
      });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({
      error: 'An unexpected error occurred. Please try again.'
    });
  }
}
