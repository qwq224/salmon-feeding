const localtunnel = require('localtunnel');
console.log('starting...');
(async () => {
  try {
    const tunnel = await localtunnel({ port: 3456 });
    console.log('TUNNEL=' + tunnel.url);
    console.log('FEISHU=' + tunnel.url + '/api/webhook/feishu');
    tunnel.on('close', () => console.log('CLOSED'));
    tunnel.on('error', (e) => console.log('ERR:' + e.message));
  } catch(e) {
    console.log('FAILED: ' + e.message);
  }
})();
