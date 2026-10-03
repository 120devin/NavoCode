// Capture the real illustrative demo, without simulating an assistant response.
// From the repository root: node docs/promotion/capture-demo.mjs
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const assets = join(root, 'docs/promotion/assets');
const recordings = join(assets, '.recording');
mkdirSync(recordings, { recursive: true });
const cli = (...args) => execFileSync('python3', [join(root, 'bin/navocode.py'), ...args], { cwd: root, encoding: 'utf8' });
const demo = JSON.parse(cli('demo'));
const session = JSON.parse(readFileSync(demo.session, 'utf8'));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    recordVideo: { dir: recordings, size: { width: 1440, height: 1080 } },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(demo.url);
  await page.getByRole('heading', { name: 'Delegated billing ownership', exact: true }).waitFor();
  await page.screenshot({ path: join(assets, 'workspace.png') });
  await page.waitForTimeout(6500);
  await page.getByRole('link', { name: 'Architecture', exact: true }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(assets, 'architecture.png') });
  await page.waitForTimeout(5500);
  await page.getByRole('button', { name: 'Before', exact: true }).click();
  await page.waitForTimeout(5500);
  await page.getByRole('button', { name: 'Intended', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect Billing service', exact: true }).click();
  await page.getByLabel('Describe a question or architectural change').pressSequentially(
    'Should billing own eligibility policy while account management only exposes ownership facts?',
    { delay: 60 },
  );
  await page.waitForTimeout(5500);
  await page.getByRole('link', { name: 'Decisions', exact: true }).click();
  await page.waitForTimeout(7500);
  if (errors.length) throw new Error(errors.join('\n'));
  const video = page.video();
  await context.close();
  const videoPath = await video.path();
  // Keep the demo label visible throughout the video, including when scrolling.
  execFileSync('ffmpeg', ['-y', '-i', videoPath, '-vf',
    "drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf:text='Illustrative demo - no AI agent running':x=w-tw-24:y=h-th-18:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.8:boxborderw=10",
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    join(assets, 'workspace-walkthrough.mp4')], { stdio: 'ignore' });
  console.log('Captured two screenshots and an illustrative workspace walkthrough. No browser errors.');
} finally {
  if (browser) await browser.close();
  cli('stop', '--session', demo.session);
  rmSync(recordings, { recursive: true, force: true });
  rmSync(session.repo, { recursive: true, force: true });
  rmSync(dirname(demo.session), { recursive: true, force: true });
}
