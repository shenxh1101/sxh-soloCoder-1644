const db = require('../config/database');
const { auditLog } = require('../utils/audit');
const dayjs = require('dayjs');

const countVotes = (topicId) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM topics WHERE id = ?`, [topicId], (err, topic) => {
      if (err) return reject(err);
      if (!topic) return reject(new Error('议题不存在'));

      db.all(
        `SELECT o.id, o.option_text, o.sort_order, COUNT(v.id) as vote_count
         FROM options o
         LEFT JOIN votes v ON o.id = v.option_id
         WHERE o.topic_id = ?
         GROUP BY o.id
         ORDER BY vote_count DESC, o.sort_order ASC`,
        [topicId],
        (err, options) => {
          if (err) return reject(err);

          const totalVotes = options.reduce((sum, opt) => sum + opt.vote_count, 0);
          const winner = options.length > 0 ? options[0] : null;

          let passed = false;
          let passRate = 0;

          if (totalVotes > 0 && winner) {
            passRate = (winner.vote_count / totalVotes) * 100;

            if (topic.vote_rule === 'simple_majority') {
              passed = winner.vote_count > totalVotes / 2;
            } else if (topic.vote_rule === 'absolute_majority') {
              passed = winner.vote_count >= Math.ceil(totalVotes * 2 / 3);
            }
          }

          resolve({
            topic,
            options,
            totalVotes,
            winner,
            passed,
            passRate: Math.round(passRate * 100) / 100,
          });
        }
      );
    });
  });
};

const finalizeVote = async (topicId, operatorId = null, ip = null) => {
  const result = await countVotes(topicId);
  const { topic, options, totalVotes, winner, passed, passRate } = result;

  if (topic.status !== 'voting') {
    throw new Error('议题不在投票状态，无法结票');
  }

  const resultText = passed ? `通过：${winner.option_text}` : '未通过';
  const reportContent = generateReport(topic, options, totalVotes, winner, passed, passRate);

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`BEGIN TRANSACTION`);

      db.run(
        `UPDATE topics SET status = 'completed', result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [resultText, topicId],
        (err) => {
          if (err) {
            db.run(`ROLLBACK`);
            return reject(err);
          }
        }
      );

      db.run(
        `INSERT INTO resolutions (topic_id, result, vote_count, total_voters, pass_rate, report_content, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
        [topicId, resultText, totalVotes, totalVotes, passRate, reportContent],
        function (err) {
          if (err) {
            db.run(`ROLLBACK`);
            return reject(err);
          }

          const resolutionId = this.lastID;

          db.run(
            `UPDATE topics SET resolution_id = ? WHERE id = ?`,
            [resolutionId, topicId],
            (err) => {
              if (err) {
                db.run(`ROLLBACK`);
                return reject(err);
              }

              db.run(`COMMIT`, async (err) => {
                if (err) {
                  db.run(`ROLLBACK`);
                  return reject(err);
                }

                await auditLog(
                  'finalize_vote',
                  'vote',
                  operatorId,
                  topicId,
                  { result: resultText, total_votes: totalVotes, pass_rate: passRate },
                  ip
                );

                resolve({
                  topicId,
                  resolutionId,
                  result: resultText,
                  passed,
                  totalVotes,
                  passRate,
                  winner: winner ? winner.option_text : null,
                });
              });
            }
          );
        }
      );
    });
  });
};

const generateReport = (topic, options, totalVotes, winner, passed, passRate) => {
  const ruleText = topic.vote_rule === 'simple_majority' ? '简单多数' : '绝对多数';
  
  let report = `投票决议报告\n`;
  report += `================\n\n`;
  report += `议题名称：${topic.title}\n`;
  report += `投票规则：${ruleText}\n`;
  report += `总投票数：${totalVotes}\n\n`;
  report += `投票结果：\n`;
  report += `--------\n`;

  options.forEach((opt, idx) => {
    const percent = totalVotes > 0 ? ((opt.vote_count / totalVotes) * 100).toFixed(2) : '0.00';
    report += `${idx + 1}. ${opt.option_text}：${opt.vote_count}票 (${percent}%)\n`;
  });

  report += `\n决议结果：${passed ? '通过' : '未通过'}\n`;
  if (passed && winner) {
    report += `胜出选项：${winner.option_text}\n`;
    report += `得票率：${passRate.toFixed(2)}%\n`;
  }
  report += `\n生成时间：${dayjs().format('YYYY-MM-DD HH:mm:ss')}\n`;

  return report;
};

const getVoteStatistics = (req, res) => {
  const { id } = req.params;

  countVotes(id)
    .then((result) => {
      const { topic, options, totalVotes, winner, passed, passRate } = result;

      if (req.user.role === 'employee' && topic.status !== 'completed' && topic.status !== 'resolved') {
        return res.status(403).json({ error: '投票结束后才能查看结果' });
      }

      res.json({
        topic_id: id,
        topic_title: topic.title,
        status: topic.status,
        vote_rule: topic.vote_rule,
        total_votes: totalVotes,
        passed,
        pass_rate: passRate,
        winner: winner ? { id: winner.id, text: winner.option_text, votes: winner.vote_count } : null,
        options: options.map((opt) => ({
          id: opt.id,
          text: opt.option_text,
          votes: opt.vote_count,
          percentage: totalVotes > 0 ? Math.round((opt.vote_count / totalVotes) * 10000) / 100 : 0,
        })),
      });
    })
    .catch((err) => {
      res.status(500).json({ error: err.message });
    });
};

const finalizeTopic = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await finalizeVote(id, req.user.id, req.ip);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

module.exports = { countVotes, finalizeVote, getVoteStatistics, finalizeTopic, generateReport };
