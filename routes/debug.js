const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');

const router = express.Router();

router.get('/probe', (req, res) => {
  const out = {};

  // 1. Is ffmpeg installed?
  execFile('ffmpeg', ['-version'], (err, stdout) => {
    out.ffmpeg = err ? `FAIL: ${err.message}` : stdout.split('\n')[0];

    // 2. Can it actually make a video?
    execFile('ffmpeg', [
      '-f', 'lavfi',
      '-i', 'testsrc=size=320x240:rate=15',
      '-t', '3',
      '-y', '/tmp/probe.mp4'
    ], (err2, _so, stderr2) => {
      out.encode = err2
        ? `FAIL: ${err2.message} | ${(stderr2 || '').slice(-400)}`
        : 'ok';

      // 3. Did the file land on disk?
      try {
        out.fileSize = fs.statSync('/tmp/probe.mp4').size;
        fs.unlinkSync('/tmp/probe.mp4');
      } catch (err3) {
        out.fileSize = `FAIL: ${err3.message}`;
      }

      // 4. Can we write to /tmp at all?
      try {
        fs.writeFileSync('/tmp/.wtest', '1');
        fs.unlinkSync('/tmp/.wtest');
        out.tmpWritable = true;
      } catch (err4) {
        out.tmpWritable = err4.message;
      }

      // 5. Memory + keys present?
      out.memoryMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
      out.keys = {
        groq: !!process.env.GROQ_API_KEY,
        anthropic: !!process.env.ANTHROPIC_API_KEY,
        supabase: !!process.env.SUPABASE_URL
      };

      res.json(out);
    });
  });
});

module.exports = router;
