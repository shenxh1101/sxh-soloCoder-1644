const http = require('http');

const baseUrl = '127.0.0.1';
const port = 3000;

function request(path, method, data, token) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    const options = {
      hostname: baseUrl,
      port: port,
      path: '/api' + path,
      method: method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    if (postData) options.headers['Content-Length'] = Buffer.byteLength(postData);

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(result);
          else reject({ status: res.statusCode, error: result });
        } catch (e) {
          resolve(body);
        }
      });
    });
    req.on('error', (e) => reject(e));
    if (postData) req.write(postData);
    req.end();
  });
}

const pass = (msg) => console.log('  ✓ PASS:', msg);
const fail = (msg) => {
  console.log('  ✗ FAIL:', msg);
  process.exitCode = 1;
};

async function runTests() {
  console.log('\n============================================');
  console.log('   5项功能改进验证测试');
  console.log('============================================\n');

  let adminToken, mgrToken, productMgrToken, empToken;
  let deptIdTech, deptIdProduct, topicTechId, topicProductId;

  console.log('--- 准备：登录获取各类令牌 ---');
  try {
    adminToken = (await request('/auth/login', 'POST', { username: 'admin', password: 'admin123' })).token;
    pass('管理员登录成功');
    mgrToken = (await request('/auth/login', 'POST', { username: 'tech_manager', password: '123456' })).token;
    pass('技术部经理登录成功');
    productMgrToken = (await request('/auth/login', 'POST', { username: 'product_manager', password: '123456' })).token;
    pass('产品部经理登录成功');
    empToken = (await request('/auth/login', 'POST', { username: 'employee1', password: '123456' })).token;
    pass('普通员工登录成功');

    const depts = await request('/departments', 'GET', null, adminToken);
    deptIdTech = depts.find((d) => d.name === '技术部').id;
    deptIdProduct = depts.find((d) => d.name === '产品部').id;
    pass(`获取部门：技术部#${deptIdTech} 产品部#${deptIdProduct}`);
  } catch (e) {
    fail('准备工作失败: ' + (e.error?.error || e.message));
    return;
  }

  console.log('\n============================================');
  console.log('【需求1】仅管理员可提建议题');
  console.log('============================================');

  try {
    await request('/topics', 'POST', {
      title: '员工发起的议题',
      options: ['A', 'B'],
      deadline: new Date(Date.now() + 86400000).toISOString(),
    }, empToken);
    fail('普通员工居然创建议题成功了！');
  } catch (e) {
    if (e.status === 403) {
      pass('普通员工创建议题 → 正确返回403权限不足: ' + (e.error?.error || ''));
    } else {
      fail('普通员工创建议题返回错误状态码: ' + e.status);
    }
  }

  try {
    const result = await request('/topics', 'POST', {
      title: '管理员发起的技术部议题',
      description: '用于测试的议题',
      department_id: deptIdTech,
      options: ['选项1', '选项2', '选项3'],
      deadline: new Date(Date.now() + 86400000).toISOString(),
      vote_rule: 'simple_majority',
    }, adminToken);
    topicTechId = result.id;
    pass(`管理员创建议题成功 → 议题#${topicTechId} 状态:${result.status}`);
  } catch (e) {
    fail('管理员创建议题失败: ' + (e.error?.error || e.message));
  }

  try {
    const topic2 = await request('/topics', 'POST', {
      title: '管理员发起的产品部议题',
      description: '用于测试部门隔离的产品部议题',
      department_id: deptIdProduct,
      options: ['产品方案A', '产品方案B'],
      deadline: new Date(Date.now() + 86400000).toISOString(),
    }, adminToken);
    topicProductId = topic2.id;
    pass(`管理员创建产品部议题 → 议题#${topicProductId}`);
  } catch (e) {
    fail('创建产品部议题失败: ' + (e.error?.error || e.message));
  }

  console.log('\n============================================');
  console.log('【需求2】部门主管审核按部门隔离');
  console.log('============================================');

  try {
    await request(`/topics/${topicProductId}/review`, 'POST', { action: 'approve' }, mgrToken);
    fail('技术部经理居然审核通过了产品部议题！');
  } catch (e) {
    if (e.status === 403) {
      pass('技术部经理审核产品部议题 → 正确返回403: ' + (e.error?.error || ''));
    } else {
      fail('错误状态码: ' + e.status);
    }
  }

  try {
    const r = await request(`/topics/${topicTechId}/review`, 'POST', { action: 'approve' }, mgrToken);
    pass(`技术部经理审核技术部议题 → 审核通过: ${r.message}`);
  } catch (e) {
    fail('技术部经理审核自己部门议题失败: ' + (e.error?.error || e.message));
  }

  try {
    const r = await request(`/topics/${topicProductId}/review`, 'POST', { action: 'approve' }, productMgrToken);
    pass(`产品部经理审核产品部议题 → 审核通过: ${r.message}`);
  } catch (e) {
    fail('产品部经理审核自己部门议题失败: ' + (e.error?.error || e.message));
  }

  console.log('\n============================================');
  console.log('【需求3】统计模块 + 报表趋势数据');
  console.log('============================================');

  try {
    const r = await request('/statistics/trigger?days=14', 'POST', null, adminToken);
    pass('手动触发14天统计: ' + (r.message || JSON.stringify(r)));
  } catch (e) {
    fail('触发统计失败: ' + JSON.stringify(e.error || e));
  }

  try {
    const stats = await request('/statistics', 'GET', null, adminToken);
    const hasTrend = stats.trend && stats.trend.length > 0;
    const hasAscii = !!stats.trend_ascii;
    const hasSummary = !!stats.summary && stats.summary.total_topics > 0;
    if (hasTrend && hasAscii && hasSummary) {
      pass(`统计接口返回完整 → 趋势数据:${stats.trend.length}天, ASCII图:${hasAscii}, 议题总数:${stats.summary.total_topics}`);
      console.log('\n' + stats.trend_ascii.split('\n').map(l => '     ' + l).join('\n') + '\n');
    } else {
      fail(`统计数据不完整 trend=${hasTrend} ascii=${hasAscii} summary=${hasSummary}`);
    }
  } catch (e) {
    fail('统计接口失败: ' + JSON.stringify(e.error || e));
  }

  try {
    const deptStats = await request('/statistics/departments', 'GET', null, adminToken);
    if (deptStats.departments && deptStats.departments.length > 0 && deptStats.department_chart) {
      pass(`部门统计正常 → ${deptStats.departments.length}个部门有数据, 排名图存在`);
      console.log(deptStats.department_chart.split('\n').map(l => '     ' + l).join('\n'));
    } else {
      fail('部门统计数据缺失');
    }
  } catch (e) {
    fail('部门统计失败: ' + JSON.stringify(e.error || e));
  }

  try {
    const res = await new Promise((resolve, reject) => {
      const opts = { hostname: baseUrl, port, path: '/api/statistics/export/pdf?days=14', headers: { Authorization: 'Bearer ' + adminToken } };
      const req = http.get(opts, (r) => {
        let chunks = 0;
        r.on('data', () => chunks++);
        r.on('end', () => resolve({ status: r.statusCode, type: r.headers['content-type'], received: chunks }));
      });
      req.on('error', reject);
    });
    if (res.status === 200 && res.type === 'application/pdf' && res.received > 0) {
      pass(`PDF报表生成成功 → 状态:${res.status} 类型:${res.type} 数据块:${res.received}`);
    } else {
      fail('PDF报表异常: ' + JSON.stringify(res));
    }
  } catch (e) {
    fail('PDF生成失败: ' + e.message);
  }

  try {
    const res = await new Promise((resolve, reject) => {
      const opts = { hostname: baseUrl, port, path: '/api/statistics/export/excel?days=14', headers: { Authorization: 'Bearer ' + adminToken } };
      const req = http.get(opts, (r) => {
        let size = 0;
        r.on('data', (c) => (size += c.length));
        r.on('end', () => resolve({ status: r.statusCode, type: r.headers['content-type'], bytes: size }));
      });
      req.on('error', reject);
    });
    if (res.status === 200 && res.bytes > 1000) {
      pass(`Excel报表生成成功 → 大小:${(res.bytes / 1024).toFixed(1)}KB`);
    } else {
      fail('Excel报表异常: ' + JSON.stringify(res));
    }
  } catch (e) {
    fail('Excel生成失败: ' + e.message);
  }

  console.log('\n============================================');
  console.log('【需求4】任务分配部门主管 + 升级标记');
  console.log('============================================');

  try {
    await request('/votes', 'POST', { topic_id: topicTechId, option_id: 1 }, empToken);
    const e2 = await request('/auth/login', 'POST', { username: 'employee2', password: '123456' });
    await request('/votes', 'POST', { topic_id: topicTechId, option_id: 1 }, e2.token);
    const e3 = await request('/auth/login', 'POST', { username: 'employee3', password: '123456' });
    await request('/votes', 'POST', { topic_id: topicTechId, option_id: 1 }, e3.token);
    pass('收集到3票（全投选项1，确保简单多数通过），准备结票');
  } catch (e) {
    fail('投票失败: ' + (e.error?.error || e.message));
  }

  let resolutionId;
  try {
    const r = await request(`/results/${topicTechId}/finalize`, 'POST', null, adminToken);
    resolutionId = r.resolutionId;
    pass(`结票成功 → 决议#${resolutionId} 结果:${r.result}`);
  } catch (e) {
    fail('结票失败: ' + (e.error?.error || e.message));
  }

  if (resolutionId) {
    try {
      const ap = await request(`/results/resolutions/${resolutionId}/approve`, 'POST', {}, adminToken);
      pass(`管理员审批决议通过 → ${ap.message || ''}`);
    } catch (e) {
      fail('审批决议失败: ' + (e.error?.error || e.message));
    }
  }

  if (resolutionId) {
    try {
      const r = await request(`/results/resolutions/${resolutionId}`, 'GET', null, adminToken);
      pass('决议详情可查 → escalated标记: is_escalated=' + r.is_escalated + ' (' + r.escalation_status + ')');
      if (r.tasks && r.tasks.length > 0) {
        const t = r.tasks[0];
        pass(`任务已生成 → 负责人显示: ${t.assignee_display}`);
        if (t.assignee_display && t.assignee_display !== '待分配') {
          pass(`任务负责人正确: ${t.assignee_display} (应为技术部主管)`);
        } else {
          fail('任务负责人未正确分配');
        }
      } else {
        fail('通过的决议未生成任务');
      }

      if (r.time_since_created) {
        pass('升级倒计时信息存在 → ' +
          `剩余${r.time_since_created.hours_until_escalation}小时` +
          `, 截止:${r.time_since_created.escalation_deadline}`);
      }
    } catch (e) {
      fail('决议详情异常: ' + JSON.stringify(e.error || e));
    }
  }

  try {
    const list = await request('/results/resolutions', 'GET', null, adminToken);
    const hasEscalationField = list.list[0] && 'escalation_status' in list.list[0];
    if (hasEscalationField) {
      pass('决议列表包含升级状态字段 → ' + list.list.map(r => `#${r.id}[${r.escalation_status}]`).join(', '));
    } else {
      fail('决议列表缺少升级标记字段');
    }
  } catch (e) {
    fail('决议列表失败: ' + JSON.stringify(e.error || e));
  }

  try {
    const tasks = await request('/results/tasks', 'GET', null, adminToken);
    if (tasks.total > 0) {
      const t = tasks.list[0];
      pass(`任务列表返回${tasks.total}条 → assignee_display:${t.assignee_display}, escalation_note:${t.task_escalation_note || '（未升级）'}`);
    } else {
      fail('任务列表为空');
    }
  } catch (e) {
    fail('任务列表失败: ' + JSON.stringify(e.error || e));
  }

  console.log('\n============================================');
  console.log('【需求5】审计日志组合筛选 + 导出一致');
  console.log('============================================');

  let queryTopicTitle = '技术部';
  let queryDeptId = deptIdTech;
  const topicNameEncoded = encodeURIComponent(queryTopicTitle);

  try {
    const r = await request('/audit-logs/filters', 'GET', null, adminToken);
    if (r.actions && r.departments) {
      pass(`筛选条件接口正常 → ${r.actions.length}种操作, ${r.departments.length}个部门, 时间范围:${r.date_range.min?.slice(0, 10)}~${r.date_range.max?.slice(0, 10)}`);
    } else {
      fail('筛选条件接口数据缺失');
    }
  } catch (e) {
    fail('筛选条件接口失败: ' + JSON.stringify(e.error || e));
  }

  const allLogs = await request('/audit-logs?page_size=1000', 'GET', null, adminToken);
  const totalAll = allLogs.summary.total_records;
  pass(`查询全部日志 → ${totalAll}条记录`);

  try {
    const r = await request(`/audit-logs?topic_name=${topicNameEncoded}&page_size=1000`, 'GET', null, adminToken);
    if (r.summary.filters_applied.includes('topic_name')) {
      pass(`按议题名称"${queryTopicTitle}"筛选 → ${r.summary.total_records}条, 筛选条件已记录`);
    } else {
      fail('议题名称筛选未生效');
    }
  } catch (e) {
    fail('议题名称筛选失败: ' + JSON.stringify(e.error || e));
  }

  let deptFilterCount;
  try {
    const r = await request(`/audit-logs?department_id=${queryDeptId}&page_size=1000`, 'GET', null, adminToken);
    deptFilterCount = r.summary.total_records;
    if (r.summary.filters_applied.includes('department_id')) {
      pass(`按部门ID=${queryDeptId}筛选 → ${deptFilterCount}条, 筛选条件已记录`);
    } else {
      fail('部门筛选未生效');
    }
  } catch (e) {
    fail('部门筛选失败: ' + JSON.stringify(e.error || e));
  }

  const today = new Date().toISOString().slice(0, 10);
  try {
    const r = await request(`/audit-logs?start_date=${today}&page_size=1000`, 'GET', null, adminToken);
    if (r.summary.filters_applied.includes('start_date')) {
      pass(`按起始日期筛选 → ${r.summary.total_records}条`);
    } else {
      fail('日期筛选未生效');
    }
  } catch (e) {
    fail('日期筛选失败: ' + JSON.stringify(e.error || e));
  }

  const comboQuery = `department_id=${queryDeptId}&start_date=${today}&action=create_topic`;
  let pageCount;
  try {
    const r = await request(`/audit-logs?${comboQuery}&page_size=1000`, 'GET', null, adminToken);
    pageCount = r.summary.total_records;
    if (r.summary.filters_applied.length >= 3) {
      pass(`组合筛选(部门+日期+动作) → ${pageCount}条, 应用了${r.summary.filters_applied.length}个条件: ${r.summary.filters_applied.join(',')}`);
    } else {
      fail('组合筛选条件未全部记录');
    }
  } catch (e) {
    fail('组合筛选失败: ' + JSON.stringify(e.error || e));
  }

  try {
    const r = await request(`/audit-logs/export?${comboQuery}&format=json`, 'GET', null, adminToken);
    const exportCount = r.total;
    if (exportCount === pageCount) {
      pass(`导出与查询一致 → 查询${pageCount}条, 导出${exportCount}条, 数量匹配`);
      if (r.export_info && r.export_info.filters.length >= 3) {
        pass(`导出元数据正确 → 记录了${r.export_info.filters.length}个筛选条件, 导出时间:${r.export_info.exported_at}`);
      }
    } else {
      fail(`导出查询不一致！查询${pageCount}条, 导出${exportCount}条`);
    }
  } catch (e) {
    fail('导出失败: ' + JSON.stringify(e.error || e));
  }

  try {
    const res = await new Promise((resolve, reject) => {
      const p = `/api/audit-logs/export?${comboQuery}&format=excel`;
      const opts = { hostname: baseUrl, port, path: p, headers: { Authorization: 'Bearer ' + adminToken } };
      const req = http.get(opts, (r) => {
        let size = 0;
        r.on('data', (c) => (size += c.length));
        r.on('end', () => resolve({ status: r.statusCode, type: r.headers['content-type'], bytes: size }));
      });
      req.on('error', reject);
    });
    if (res.status === 200 && res.bytes > 5000) {
      pass(`筛选条件的Excel导出成功 → ${(res.bytes / 1024).toFixed(1)}KB`);
    } else {
      fail('Excel导出异常');
    }
  } catch (e) {
    fail('Excel导出失败: ' + e.message);
  }

  try {
    const res = await new Promise((resolve, reject) => {
      const p = `/api/audit-logs/export?${comboQuery}&format=csv`;
      const opts = { hostname: baseUrl, port, path: p, headers: { Authorization: 'Bearer ' + adminToken } };
      const req = http.get(opts, (r) => {
        let size = 0, disp = '';
        r.on('data', (c) => (size += c.length));
        r.on('end', () => resolve({ status: r.statusCode, bytes: size, disp: r.headers['content-disposition'] }));
      });
      req.on('error', reject);
    });
    if (res.status === 200 && res.bytes > 100) {
      const filename = res.disp?.match(/filename="(.+?)"/)?.[1] || '';
      const matchCount = filename.match(/_(\d+)_records\./);
      if (matchCount && parseInt(matchCount[1]) === pageCount) {
        pass(`CSV导出成功 → 文件名已标记条数: ${filename}, 数量匹配${pageCount}条`);
      } else {
        fail(`CSV文件名未正确标记导出条数, 或数量不匹配 → ${filename}`);
      }
    } else {
      fail('CSV导出异常: status=' + res.status);
    }
  } catch (e) {
    fail('CSV导出失败: ' + e.message);
  }

  console.log('\n============================================');
  console.log('   所有5项功能验证完成！');
  console.log('============================================\n');
}

runTests().catch((e) => {
  console.error('测试异常:', e);
  process.exitCode = 1;
});
