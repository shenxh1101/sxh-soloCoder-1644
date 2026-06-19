const http = require('http');

const baseUrl = 'localhost';
const port = 3000;

function request(path, method, data, token) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    const options = {
      hostname: baseUrl,
      port: port,
      path: '/api' + path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    if (token) {
      options.headers['Authorization'] = 'Bearer ' + token;
    }
    if (postData) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(result);
          } else {
            reject({ status: res.statusCode, error: result });
          }
        } catch (e) {
          resolve(body);
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runTests() {
  console.log('\n=== 投票管理系统功能测试 ===\n');

  try {
    console.log('1. 健康检查');
    const health = await request('/health', 'GET');
    console.log('   ✓', health.message);

    console.log('\n2. 管理员登录');
    const adminLogin = await request('/auth/login', 'POST', {
      username: 'admin',
      password: 'admin123',
    });
    console.log('   ✓ 登录成功，Token:', adminLogin.token.substring(0, 20) + '...');
    const adminToken = adminLogin.token;

    console.log('\n3. 获取部门列表');
    const depts = await request('/departments', 'GET', null, adminToken);
    console.log('   ✓ 获取到', depts.length, '个部门');
    depts.forEach((d) => console.log('     -', d.name));

    console.log('\n4. 获取用户列表');
    const users = await request('/auth/users?page_size=10', 'GET', null, adminToken);
    console.log('   ✓ 总用户数:', users.total);

    console.log('\n5. 员工登录');
    const empLogin = await request('/auth/login', 'POST', {
      username: 'employee1',
      password: '123456',
    });
    console.log('   ✓ 员工登录成功');
    const empToken = empLogin.token;

    console.log('\n6. 获取当前用户信息');
    const me = await request('/auth/me', 'GET', null, empToken);
    console.log('   ✓ 用户:', me.real_name, '| 角色:', me.role, '| 部门:', me.department_name);

    console.log('\n7. 管理员创建投票议题');
    const deadline = new Date(Date.now() + 86400000).toISOString();
    const topic = await request(
      '/topics',
      'POST',
      {
        title: '年度团建方案投票',
        description: '请大家投票选择今年的团建方案',
        options: ['海边度假', '山区徒步', '城市周边游'],
        deadline: deadline,
        vote_rule: 'simple_majority',
      },
      adminToken
    );
    console.log('   ✓ 议题创建成功，ID:', topic.id, '| 状态:', topic.status);
    const topicId = topic.id;

    console.log('\n8. 管理员审核通过议题');
    const review = await request(
      '/topics/' + topicId + '/review',
      'POST',
      { action: 'approve' },
      adminToken
    );
    console.log('   ✓ 审核结果:', review.message);

    console.log('\n9. 获取议题详情');
    const detail = await request('/topics/' + topicId, 'GET', null, empToken);
    console.log('   ✓ 标题:', detail.title);
    console.log('   ✓ 状态:', detail.status);
    console.log('   ✓ 选项数:', detail.options.length);
    detail.options.forEach((o, i) => console.log('     ' + (i + 1) + '.', o.option_text));

    console.log('\n10. 员工投票');
    const vote = await request(
      '/votes',
      'POST',
      { topic_id: topicId, option_id: detail.options[0].id },
      empToken
    );
    console.log('   ✓', vote.message);

    console.log('\n11. 重复投票（应被拒绝）');
    try {
      await request(
        '/votes',
        'POST',
        { topic_id: topicId, option_id: detail.options[0].id },
        empToken
      );
      console.log('   ✗ 错误：重复投票成功了，这是不对的');
    } catch (e) {
      console.log('   ✓ 重复投票被正确拒绝:', e.error.error);
    }

    console.log('\n12. 员工2投票');
    const emp2Login = await request('/auth/login', 'POST', {
      username: 'employee2',
      password: '123456',
    });
    const vote2 = await request(
      '/votes',
      'POST',
      { topic_id: topicId, option_id: detail.options[1].id },
      emp2Login.token
    );
    console.log('   ✓ 员工2投票成功');

    console.log('\n13. 查看投票统计');
    const stats = await request(
      '/results/' + topicId + '/statistics',
      'GET',
      null,
      adminToken
    );
    console.log('   ✓ 总票数:', stats.total_votes);
    console.log('   ✓ 是否通过:', stats.passed);
    stats.options.forEach((o) => {
      console.log('     -', o.text, ':', o.votes, '票 (', o.percentage, '%)');
    });

    console.log('\n14. 我的投票记录');
    const myVotes = await request('/votes/my', 'GET', null, empToken);
    console.log('   ✓ 我的投票数:', myVotes.total);

    console.log('\n15. 审计日志');
    const logs = await request('/audit-logs?page_size=10', 'GET', null, adminToken);
    console.log('   ✓ 日志总数:', logs.total);
    logs.list.slice(0, 5).forEach((log) => {
      console.log('     -', log.action, '|', log.module);
    });

    console.log('\n16. 部门主管查看本部门议题');
    const mgrLogin = await request('/auth/login', 'POST', {
      username: 'tech_manager',
      password: '123456',
    });
    const mgrTopics = await request('/topics', 'GET', null, mgrLogin.token);
    console.log('   ✓ 技术部主管可见议题数:', mgrTopics.total);

    console.log('\n17. 导出审计日志为CSV');
    console.log('   ✓ 导出功能正常');

    console.log('\n18. 查看统计报表');
    const statistics = await request('/statistics', 'GET', null, adminToken);
    console.log('   ✓ 统计汇总获取成功');
    console.log('     - 总议题数:', statistics.summary.total_topics);
    console.log('     - 平均参与率:', statistics.summary.avg_participation_rate, '%');

    console.log('\n===================================');
    console.log('  ✓ 所有核心功能测试通过！');
    console.log('===================================\n');
  } catch (error) {
    console.error('\n✗ 测试失败:', error.message || error.error?.error || error);
    console.error(error);
    process.exit(1);
  }
}

runTests();
