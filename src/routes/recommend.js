const express = require('express');
const { get } = require('../db');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { wrapAllRoutes } = require('../middleware/asyncHandler');
const { signedFileUrl } = require('../fileAccess');
const { recommendTalentsForJob, recommendJobsForProfile } = require('../recommend');

const router = express.Router();
wrapAllRoutes(router);

// [프리랜서] 내 프로필 기반 맞춤 프로젝트 추천
router.get('/jobs', requireAuth, requireRole('freelancer'), async (req, res) => {
  const p = await get('SELECT * FROM freelancer_profiles WHERE user_id = ?', [req.user.id]);
  if (!p) return res.json({ jobs: [] });

  const profile = { ...p, stack: JSON.parse(p.stack_json) };
  const jobs = await recommendJobsForProfile(profile, 5);
  res.json({ jobs });
});

// [기업] 특정 공고에 맞는 인재 추천. 공고를 지정하지 않으면 가장 최근 등록한 공고 기준.
router.get('/talents', requireAuth, requireRole('company'), async (req, res) => {
  const { jobId } = req.query;

  let job;
  if (jobId) {
    const jid = Number(jobId);
    if (!Number.isInteger(jid)) return res.status(400).json({ error: '올바르지 않은 공고 ID입니다.' });
    job = await get('SELECT * FROM jobs WHERE id = ? AND company_id = ?', [jid, req.user.id]);
    if (!job) return res.status(404).json({ error: '공고를 찾을 수 없습니다.' });
  } else {
    job = await get(
      "SELECT * FROM jobs WHERE company_id = ? AND status = 'open' ORDER BY created_at DESC, id DESC LIMIT 1",
      [req.user.id]
    );
  }
  if (!job) return res.json({ job: null, talents: [] });

  const target = { ...job, stack: JSON.parse(job.stack_json) };
  const talents = await recommendTalentsForJob(target, 5);
  res.json({
    job: { id: job.id, title: job.title },
    talents: talents.map((t) => ({ ...t, resume_url: signedFileUrl(t.resume_filename) })),
  });
});

module.exports = router;
