// run.js — 一键启动服务器 + 隧道，断了自动重连
const { spawn } = require('child_process');

function startServer() {
  const srv = spawn('node', ['server/server.js'], { stdio: 'inherit' });
  srv.on('exit', (code) => {
    console.log('服务器退出(code=' + code + ')，3秒后重启...');
    setTimeout(startServer, 3000);
  });
}

function startTunnel() {
  const ssh = spawn('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ConnectTimeout=10',
    '-R', '80:localhost:3456',
    'serveo.net',
  ]);

  ssh.stderr.on('data', (d) => {
    const s = d.toString();
    process.stdout.write(s);
    const m = s.match(/https:\/\/[a-z0-9.-]+\.serveousercontent\.com/);
    if (m) {
      console.log('\n========================================');
      console.log('📡 飞书回调地址:');
      console.log('   ' + m[0] + '/api/webhook/feishu');
      console.log('   复制上行地址到飞书开发者后台 -> 事件订阅');
      console.log('========================================\n');
    }
  });

  ssh.on('exit', (code) => {
    console.log('隧道断开，5秒后重连...');
    setTimeout(startTunnel, 5000);
  });
}

console.log('🐟 SalmonFeeding 启动中...');
startServer();
setTimeout(startTunnel, 3000);
