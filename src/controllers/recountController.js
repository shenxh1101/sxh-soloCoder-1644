const db = require('../config/database');
const { auditLog } = require('../utils/audit');
const { countVotes, generateReport } = require('./resultController');
const dayjs = require('dayjs');

const recountVotes = async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  try {
    const topic = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM topics WHERE id = ?`, [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!topic) {
      return res.status(404).json({ error: '议题不存在' });
    }

    if (topic.status !== 'completed' && topic.status !== 'resolved') {
      return res.status(400).json({ error: '仅已结票的议题支持重新计票' });
    }

    const oldResolution = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM resolutions WHERE topic_id = ?`, [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    const voteStats = await countVotes(id);
    const { options, totalVotes, winner, passed, passRate } = voteStats;

    const resultText = passed ? `通过：${winner.option_text}` : '未通过';
    const reportContent = generateReport(topic, options, totalVotes, winner, passed, passRate);

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO recount_logs (topic_id, operator_id, reason, before_result, after_result, before_vote_count, after_vote_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          req.user.id,
          reason || null,
          oldResolution ? oldResolution.result : null,
          resultText,
          oldResolution ? oldResolution.vote_count : 0,
          totalVotes,
        ],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE resolutions 
         SET result = ?, vote_count = ?, total_voters = ?, pass_rate = ?, report_content = ?
         WHERE topic_id = ?`,
        [resultText, totalVotes, totalVotes, passRate, reportContent, id],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE topics SET result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [resultText, id],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    await auditLog(
      'recount_votes',
      'vote',
      req.user.id,
      id,
      { reason, before_result: oldResolution?.result, after_result: resultText },
      req.ip
    );

    res.json({
      topic_id: id,
      result: resultText,
      passed,
      total_votes: totalVotes,
      pass_rate: passRate,
      message: '重新计票完成',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getRecountLogs = (req, res) => {
  const { topic_id, page = 1, page_size = 20 } = req.query;
  const offset = (page - 1) * page_size;

  let whereClause = 'WHERE 1=1';
  const params = [];

  if (topic_id) {
    whereClause += ' AND r.topic_id = ?';
    params.push(topic_id);
  }

  const countSql = `SELECT COUNT(*) as total FROM recount_logs r ${whereClause}`;
  const listSql = `
    SELECT r.*, 
           u.real_name as operator_name,
           t.title as topic_title
    FROM recount_logs r
    LEFT JOIN users u ON r.operator_id = u.id
    LEFT JOIN topics t ON r.topic_id = t.id
    ${whereClause}
    ORDER BY r.created_at DESC
    LIMIT ? OFFSET ?
  `;

  db.get(countSql, params, (err, countResult) => {
    if (err) return res.status(500).json({ error: '数据库错误' });

    db.all(listSql, [...params, parseInt(page_size), offset], (err, logs) => {
      if (err) return res.status(500).json({ error: '数据库错误' });

      res.json({
        list: logs,
        total: countResult.total,
        page: parseInt(page),
        page_size: parseInt(page_size),
      });
    });
  });
};

module.exports = { recountVotes, getRecountLogs };
