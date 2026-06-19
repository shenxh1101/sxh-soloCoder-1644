const db = require('../config/database');
const { hashPassword } = require('../utils/password');
const { auditLog } = require('../utils/audit');

const initSampleData = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      const departments = [
        { name: '技术部', manager_id: null },
        { name: '产品部', manager_id: null },
        { name: '市场部', manager_id: null },
        { name: '人力资源部', manager_id: null },
        { name: '财务部', manager_id: null },
      ];

      const deptStmt = db.prepare(`INSERT INTO departments (name, manager_id) VALUES (?, ?)`);
      let deptCount = 0;
      departments.forEach((d) => {
        deptStmt.run(d.name, d.manager_id, function (err) {
          if (err) console.log('部门已存在或创建失败:', d.name);
          deptCount++;
          if (deptCount === departments.length) {
            createUsers();
          }
        });
      });
      deptStmt.finalize();

      function createUsers() {
        db.all(`SELECT id, name FROM departments`, [], (err, depts) => {
          if (err) return reject(err);

          const deptMap = {};
          depts.forEach((d) => (deptMap[d.name] = d.id));

          const users = [
            {
              username: 'admin',
              password: hashPassword('admin123'),
              real_name: '系统管理员',
              email: 'admin@company.com',
              department_id: deptMap['人力资源部'],
              position: '总监',
              role: 'admin',
            },
            {
              username: 'tech_manager',
              password: hashPassword('123456'),
              real_name: '张技术',
              email: 'tech@company.com',
              department_id: deptMap['技术部'],
              position: '部门经理',
              role: 'manager',
            },
            {
              username: 'product_manager',
              password: hashPassword('123456'),
              real_name: '李产品',
              email: 'product@company.com',
              department_id: deptMap['产品部'],
              position: '部门经理',
              role: 'manager',
            },
            {
              username: 'employee1',
              password: hashPassword('123456'),
              real_name: '王开发',
              email: 'emp1@company.com',
              department_id: deptMap['技术部'],
              position: '高级工程师',
              role: 'employee',
            },
            {
              username: 'employee2',
              password: hashPassword('123456'),
              real_name: '赵测试',
              email: 'emp2@company.com',
              department_id: deptMap['技术部'],
              position: '测试工程师',
              role: 'employee',
            },
            {
              username: 'employee3',
              password: hashPassword('123456'),
              real_name: '钱设计',
              email: 'emp3@company.com',
              department_id: deptMap['产品部'],
              position: 'UI设计师',
              role: 'employee',
            },
          ];

          const userStmt = db.prepare(
            `INSERT OR IGNORE INTO users (username, password, real_name, email, department_id, position, role) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          );

          let userCount = 0;
          users.forEach((u) => {
            userStmt.run(
              u.username,
              u.password,
              u.real_name,
              u.email,
              u.department_id,
              u.position,
              u.role,
              function (err) {
                if (err) console.log('用户创建失败:', u.username);
                userCount++;
                if (userCount === users.length) {
                  updateDeptManagers(deptMap);
                }
              }
            );
          });
          userStmt.finalize();
        });
      }

      function updateDeptManagers(deptMap) {
        db.get(`SELECT id FROM users WHERE username = ?`, ['tech_manager'], (err, user) => {
          if (!err && user) {
            db.run(`UPDATE departments SET manager_id = ? WHERE id = ?`, [user.id, deptMap['技术部']]);
          }
        });
        db.get(`SELECT id FROM users WHERE username = ?`, ['product_manager'], (err, user) => {
          if (!err && user) {
            db.run(`UPDATE departments SET manager_id = ? WHERE id = ?`, [user.id, deptMap['产品部']]);
          }
        });

        console.log('示例数据初始化完成');
        console.log('默认账号:');
        console.log('  管理员: admin / admin123');
        console.log('  技术部经理: tech_manager / 123456');
        console.log('  产品部经理: product_manager / 123456');
        console.log('  普通员工: employee1 / 123456');
        resolve();
      }
    });
  });
};

module.exports = initSampleData;
