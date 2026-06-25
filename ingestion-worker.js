import express from 'express';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { execFile } from 'child_process';
import { createWriteStream, createReadStream, existsSync, unlinkSync } from 'fs';
import { promisify } from 'util';
import { pipeline } from 'stream/promises';
import path from 'path';
import https from 'https';
import http from 'http';

const execFileAsync = promisify(execFile);
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;

function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function isDiscordCdn(url) {
  try {
    const { hostname, pathname } = new URL(url);
    return hostname === 'cdn.discordapp.com' && pathname.startsWith('/attachments/');
  } catch {
    return false;
  }
}

async function downloadDirect(url, destPath) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const file = createWriteStream(destPath);
    mod.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        reject(new Error(`Direct download failed: HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function downloadYtDlp(url, destPath) {
  await execFileAsync('yt-dlp', [
    '--no-playlist',
    '--max-filesize', '100m',
    '-o', destPath,
    url,
  ], { timeout: 120_000 });
}

async function uploadToR2(filePath, key) {
  const accountId = requireEnv('R2_ACCOUNT_ID');
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    },
  });

  const bucket = requireEnv('R2_BUCKET_NAME');
  const body = createReadStream(filePath);
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
}

app.post('/api/ingest', async (req, res) => {
  const ingestSecret = process.env.INGEST_SECRET;
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!ingestSecret || token !== ingestSecret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { url, job_id } = req.body;
  if (!url || !job_id) {
    return res.status(400).json({ error: 'url and job_id are required' });
  }

  const destPath = path.join('/tmp', `${job_id}.mp4`);
  const r2Key = `clips/${job_id}.mp4`;

  try {
    if (isDiscordCdn(url)) {
      await downloadDirect(url, destPath);
    } else {
      await downloadYtDlp(url, destPath);
    }

    await uploadToR2(destPath, r2Key);

    return res.json({ key: r2Key });
  } catch (err) {
    console.error(`[ingest] job_id=${job_id} error:`, err.message);
    return res.status(502).json({ error: err.message || 'ingestion_failed' });
  } finally {
    try {
      if (existsSync(destPath)) unlinkSync(destPath);
    } catch {
      // best-effort cleanup
    }
  }
});

app.listen(PORT, () => {
  console.log(`Skept ingest worker listening on port ${PORT}`);
});
