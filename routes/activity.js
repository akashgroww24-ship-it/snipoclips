const express = require('express');
const { requireUser } = require('../lib/requireUser');
const { heartbeat } = require('../lib/activity');

const router = express.Router();

router.post('/activity/heartbeat', requireUser, async (req, res) => {
  try {
    await heartbeat(req.user.id, req.body && req.body.path);
    res.json({ ok: true });
  } catch (e) {
    console.error('[activity] heartbeat failed:', e.message || e);
    res.status(500).json({ error: 'Activity heartbeat failed' });
  }
});

module.exports = router;
