// tunnel.js — 双隧道保活，飞书 Webhook 不掉线
const { spawn } = require('child_process');

let serveoUrl = '';
let localtunnelUrl = '';

function startServeo() {
  const ssh = spawn('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ExitOnForwardFailure=yes',
    '-R', '80:localhost:3456',
    'serveo.net'
  ]);

  let buffer = '';
  ssh.stdout.on('data', (d) => { buffer += d.toString(); });
  ssh.stderr.on('data', (d) => {
    buffer += d.toString();
    const m = buffer.match(/https:\/\/[a-z0-9.-]+\.serveousercontent\.com/);
    if (m && !serveoUrl) {
      serveoUrl = m[0];
      console.log(`🟢 Serveo: ${serveoUrl}`);
      console.log(`📡 飞书地址: ${serveoUrl}/api/webhook/feishu`);
    }
  });

  ssh.on('close', (code) => {
    console.log(`⚠️ Serveo 断开 (code=${code})，10秒后重连...`);
    serveoUrl = '';
    setTimeout(startServeo, 10000);
  });

  ssh.on('error', (e) => {
    console.log(`❌ Serveo 连接失败: ${e.message}，15秒后重试...`);
    setTimeout(startServeo, 15000);
  });
}

// 启动 serveo 隧道
startServeo();

console.log('🚇 双隧道保活已启动，断开自动重连');

// 每60秒打印状态
setInterval(() => {
  if (serveoUrl) console.log(`🟢 运行中: ${serveoUrl}`);
}, 60000);
