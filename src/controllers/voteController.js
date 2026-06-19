const db = require('../config/database');
const { auditLog } = require('../utils/audit');
const dayjs = require('dayjs');

const checkVoteEligibility = (userId, topicId) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM topics WHERE id = ?`, [topicId], (err, topic) => {
      if (err) return reject(err);
      if (!topic) return reject(new Error('议题不存在'));

      if (topic.status !== 'voting') {
        return resolve({ eligible: false, reason: '该议题不在投票中' });
      }

      if (dayjs().isAfter(dayjs(topic.deadline))) {
        return resolve({ eligible: false, reason: '投票已截止' });
      }

      db.get(
        `SELECT v.id FROM votes v WHERE v.topic_id = ? AND v.user_id = ?`,
        [topicId, userId],
        (err, vote) => {
          if (err) return reject(err);
          if (vote) {
            return resolve({ eligible: false, reason: '您已投过票，不能重复投票' });
          }

          db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
            if (err) return reject(err);

            if (topic.eligible_departments) {
              let depts;
              try {
                depts = JSON.parse(topic.eligible_departments);
              } catch (e) {
                depts = null;
              }
              if (depts && depts.length > 0 && !depts.includes(user.department_id)) {
                return resolve({ eligible: false, reason: '您所在部门无此投票权限' });
              }
            }

            if (topic.eligible_positions) {
              let positions;
              try {
                positions = JSON.parse(topic.eligible_positions);
              } catch (e) {
                positions = null;
              }
              if (positions && positions.length > 0 && !positions.includes(user.position)) {
                return resolve({ eligible: false, reason: '您的职级无此投票权限' });
              }
            }

            resolve({ eligible: true, topic, user });
          });
        }
      );
    });
  });
};

const castVote = async (req, res) => {
  const { topic_id, option_id } = req.body;
  const userId = req.user.id;
  const ip = req.ip;

  try {
    const eligibility = await checkVoteEligibility(userId, topic_id);
    
    if (!eligibility.eligible) {
      await auditLog('vote_rejected', 'vote', userId, topic_id, { reason: eligibility.reason }, ip);
      return res.status(403).json({ error: eligibility.reason });
    }

    const optionExists = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id FROM options WHERE id = ? AND topic_id = ?`,
        [option_id, topic_id],
        (err, opt) => {
          if (err) reject(err);
          else resolve(!!opt);
        }
      );
    });

    if (!optionExists) {
      return res.status(400).json({ error: '无效的投票选项' });
    }

    db.run(
      `INSERT INTO votes (topic_id, user_id, option_id, ip_address) VALUES (?, ?, ?, ?)`,
      [topic_id, userId, option_id, ip],
      async function (err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: '您已投过票，不能重复投票' });
          }
          return res.status(500).json({ error: '投票失败' });
        }

        await auditLog('vote_cast', 'vote', userId, topic_id, { option_id }, ip);

        res.json({
          success: true,
          message: '投票成功',
          vote_id: this.lastID,
        });
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getMyVotes = (req, res) => {
  const userId = req.user.id;
  const { page = 1, page_size = 20 } = req.query;
  const offset = (page - 1) * page_size;

  const countSql = `SELECT COUNT(*) as total FROM votes v WHERE v.user_id = ?`;
  const listSql = `
    SELECT v.*, 
           t.title as topic_title,
           t.status as topic_status,
           o.option_text
    FROM votes v
    JOIN topics t ON v.topic_id = t.id
    JOIN options o ON v.option_id = o.id
    WHERE v.user_id = ?
    ORDER BY v.voted_at DESC
    LIMIT ? OFFSET ?
  `;

  db.get(countSql, [userId], (err, countResult) => {
    if (err) return res.status(500).json({ error: '数据库错误' });

    db.all(listSql, [userId, parseInt(page_size), offset], (err, votes) => {
      if (err) return res.status(500).json({ error: '数据库错误' });

      res.json({
        list: votes,
        total: countResult.total,
        page: parseInt(page),
        page_size: parseInt(page_size),
      });
    });
  });
};

module.exports = { castVote, getMyVotes, checkVoteEligibility };
