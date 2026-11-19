/* Forge by UI8 —— OAuth(PKCE) 授权助手
 *
 * 用途：向 https://forge.ui8.ai 申请 MCP 相关 OAuth 客户端，完成 authorization_code 流程，
 *      拿到 access_token + refresh_token，供 MCP 连接器（headers.Authorization）或直接调用 REST API 使用。
 *
 * 用法：node scripts/forge_oauth.js
 * 流程：本脚本自动打开浏览器 → 你在网页登录并批准 → 回调 localhost:8974 → 打印 token
 *       token 会落到 scripts/.forge_token.json（已加入 .gitignore 建议）
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const AUTH = 'https://forge.ui8.ai';
const ISSUER = `${AUTH}/api/auth/mcp`;
const REDIRECT = 'http://localhost:8974/callback';
const PORT = 8974;
const TOKEN_FILE = path.join(__dirname, '.forge_token.json');
const CLIENT_FILE = path.join(__dirname, '.forge_client.json');

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function registerClient() {
  if (fs.existsSync(CLIENT_FILE)) {
    const c = JSON.parse(fs.readFileSync(CLIENT_FILE, 'utf8'));
    if (c.redirect_uris && c.redirect_uris.includes(REDIRECT)) return c;
  }
  const res = await fetch(`${ISSUER}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'WorkBuddy',
      redirect_uris: [REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'openid profile email offline_access'
    })
  });
  const j = await res.json();
  fs.writeFileSync(CLIENT_FILE, JSON.stringify(j, null, 2));
  return j;
}

function openBrowser(url) {
  const cmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function main() {
  const client = await registerClient();
  const clientId = client.client_id;

  // PKCE
  const verifier = b64u(crypto.randomBytes(48));
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  const state = b64u(crypto.randomBytes(16));

  const authUrl = new URL(`${ISSUER}/authorize`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT);
  authUrl.searchParams.set('scope', 'openid profile email offline_access');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('resource', `${AUTH}/mcp`);

  console.log('打开浏览器完成登录授权：');
  console.log(authUrl.toString());
  openBrowser(authUrl.toString());

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== '/callback') { res.writeHead(404); res.end('not found'); return; }
      const err = u.searchParams.get('error');
      const c = u.searchParams.get('code');
      const st = u.searchParams.get('state');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (err) {
        res.end(`<h2>授权失败</h2><p>${err}</p>`);
        reject(new Error(err));
      } else if (!c) {
        res.end('<h2>未收到 code</h2>');
        reject(new Error('no code'));
      } else {
        res.end('<h2>授权成功 ✅</h2><p>可以关闭此页面了。</p>');
        setTimeout(() => server.close(), 500);
        resolve(c);
      }
    });
    server.listen(PORT, '127.0.0.1', () => console.log(`等待回调 ${REDIRECT} ...`));
    server.on('error', reject);
    setTimeout(() => { server.close(); reject(new Error('timeout: 5 分钟未完成授权')); }, 5 * 60 * 1000);
  });

  const tokRes = await fetch(`${ISSUER}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier
    })
  });
  const tok = await tokRes.json();
  if (!tok.access_token) {
    console.error('换取 token 失败：', JSON.stringify(tok));
    process.exit(1);
  }
  tok.client_id = clientId;
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tok, null, 2));
  console.log('\n✅ 授权成功，token 已保存到', TOKEN_FILE);
  console.log('access_token 前缀:', String(tok.access_token).slice(0, 24) + '...');
  console.log('expires_in:', tok.expires_in, 'refresh_token:', tok.refresh_token ? '有' : '无');

  // 验证 userinfo
  const me = await fetch(`${ISSUER}/userinfo`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
  console.log('userinfo:', me.status, (await me.text()).slice(0, 300));
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
