/*********************************
WeTalk + PingMe 二合一签到 - Shadowrocket 版
一个文件干三件事: 抓 WeTalk 的 CK、抓 PingMe 的 CK、定时把两个都签了。

为什么能合: 这俩是同一套接口和签名 (同 SECRET, 同 sign 算法),
只是域名、存 CK 的 key、视频次数不同, 所以共用一套逻辑, 按域名分流。

存 CK 的 key 和原脚本保持一致, 以前抓过的能直接接着用, 不用重抓:
- PingMe: pingme_capture_v3, 存 {url, paramsRaw, headers} (fmz200 格式)
- WeTalk: wetalk_accounts_v1, 存多账号 {accounts: {邮箱: {capture}}, order: []} (ZenmoFeiShi 格式, 按 email 区分账号)

配置 (script-path 填这一个文件就行, 抓 CK 和签到共用同一个):
[Script]
WeTalkPingMe抓CK = type=http-request,engine=jsc,script-path=WeTalkPingMe.js,pattern=^https:\/\/(api\.wetalkapp\.com|api\.pingmeapp\.net)\/app\/,enable=true
WeTalkPingMe签到 = type=cron,engine=jsc,script-path=WeTalkPingMe.js,cronexpr="5 8,20 * * *",timeout=300,enable=true

[MITM]
hostname = api.wetalkapp.com, api.pingmeapp.net

注意: 你原来 WeTalk 那行 timeout=10 是错的, 视频奖励跑不完就被杀, 二合一必须 300。
抓 CK: 打开对应 App, 进余额/签到页触发一次 queryBalanceAndBonus 请求即可, 会弹「获取成功」。
签到流程 (每个 App): 查余额 -> 签到 -> 视频奖励 (PingMe 5 次 / WeTalk 1 次, 按原脚本) -> 再查余额, 最后一条通知汇总两个 App。
*********************************/

const SECRET = '0fOiukQq7jXZV2GRi9LGlO'; // 两家共用, 取自原脚本

const PINGME = {
name: 'PingMe',
host: 'api.pingmeapp.net',
storeKey: 'pingme_capture_v3',
maxVideo: 5,
videoFirstDelay: 1500,
};
const WETALK = {
name: 'WeTalk',
host: 'api.wetalkapp.com',
storeKey: 'wetalk_accounts_v1',
maxVideo: 1,
videoFirstDelay: 3000,
};
const VIDEO_DELAY = 8000;

function MD5(string) {
  function RotateLeft(lValue, iShiftBits) { return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits)); }
  function AddUnsigned(lX, lY) {
    const lX4 = lX & 0x40000000, lY4 = lY & 0x40000000, lX8 = lX & 0x80000000, lY8 = lY & 0x80000000;
    const lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
    if (lX4 & lY4) return lResult ^ 0x80000000 ^ lX8 ^ lY8;
    if (lX4 | lY4) return (lResult & 0x40000000) ? (lResult ^ 0xC0000000 ^ lX8 ^ lY8) : (lResult ^ 0x40000000 ^ lX8 ^ lY8);
    return lResult ^ lX8 ^ lY8;
  }
  function F(x, y, z) { return (x & y) | ((~x) & z); }
  function G(x, y, z) { return (x & z) | (y & (~z)); }
  function H(x, y, z) { return x ^ y ^ z; }
  function I(x, y, z) { return y ^ (x | (~z)); }
  function FF(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
  function GG(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
  function HH(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
  function II(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
  function ConvertToWordArray(str) {
    const lMessageLength = str.length;
    const lNumberOfWords_temp1 = lMessageLength + 8;
    const lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
    const lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
    const lWordArray = Array(lNumberOfWords - 1).fill(0);
    let lBytePosition = 0, lByteCount = 0;
    while (lByteCount < lMessageLength) {
      const lWordCount = (lByteCount - (lByteCount % 4)) / 4;
      lBytePosition = (lByteCount % 4) * 8;
      lWordArray[lWordCount] |= str.charCodeAt(lByteCount) << lBytePosition;
      lByteCount++;
    }
    const lWordCount = (lByteCount - (lByteCount % 4)) / 4;
    lBytePosition = (lByteCount % 4) * 8;
    lWordArray[lWordCount] |= 0x80 << lBytePosition;
    lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
    lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
    return lWordArray;
  }
  function WordToHex(lValue) {
    let WordToHexValue = '';
    for (let lCount = 0; lCount <= 3; lCount++) {
      const lByte = (lValue >>> (lCount * 8)) & 255;
      const WordToHexValue_temp = '0' + lByte.toString(16);
      WordToHexValue += WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2);
    }
    return WordToHexValue;
  }
  const x = ConvertToWordArray(string);
  let a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
  const S11 = 7, S12 = 12, S13 = 17, S14 = 22, S21 = 5, S22 = 9, S23 = 14, S24 = 20;
  const S31 = 4, S32 = 11, S33 = 16, S34 = 23, S41 = 6, S42 = 10, S43 = 15, S44 = 21;
  for (let k = 0; k < x.length; k += 16) {
    const AA = a, BB = b, CC = c, DD = d;
    a = FF(a,b,c,d,x[k+0],S11,0xD76AA478); d = FF(d,a,b,c,x[k+1],S12,0xE8C7B756); c = FF(c,d,a,b,x[k+2],S13,0x242070DB); b = FF(b,c,d,a,x[k+3],S14,0xC1BDCEEE);
    a = FF(a,b,c,d,x[k+4],S11,0xF57C0FAF); d = FF(d,a,b,c,x[k+5],S12,0x4787C62A); c = FF(c,d,a,b,x[k+6],S13,0xA8304613); b = FF(b,c,d,a,x[k+7],S14,0xFD469501);
    a = FF(a,b,c,d,x[k+8],S11,0x698098D8); d = FF(d,a,b,c,x[k+9],S12,0x8B44F7AF); c = FF(c,d,a,b,x[k+10],S13,0xFFFF5BB1); b = FF(b,c,d,a,x[k+11],S14,0x895CD7BE);
    a = FF(a,b,c,d,x[k+12],S11,0x6B901122); d = FF(d,a,b,c,x[k+13],S12,0xFD987193); c = FF(c,d,a,b,x[k+14],S13,0xA679438E); b = FF(b,c,d,a,x[k+15],S14,0x49B40821);
    a = GG(a,b,c,d,x[k+1],S21,0xF61E2562); d = GG(d,a,b,c,x[k+6],S22,0xC040B340); c = GG(c,d,a,b,x[k+11],S23,0x265E5A51); b = GG(b,c,d,a,x[k+0],S24,0xE9B6C7AA);
    a = GG(a,b,c,d,x[k+5],S21,0xD62F105D); d = GG(d,a,b,c,x[k+10],S22,0x02441453); c = GG(c,d,a,b,x[k+15],S23,0xD8A1E681); b = GG(b,c,d,a,x[k+4],S24,0xE7D3FBC8);
    a = GG(a,b,c,d,x[k+9],S21,0x21E1CDE6); d = GG(d,a,b,c,x[k+14],S22,0xC33707D6); c = GG(c,d,a,b,x[k+3],S23,0xF4D50D87); b = GG(b,c,d,a,x[k+8],S24,0x455A14ED);
    a = GG(a,b,c,d,x[k+13],S21,0xA9E3E905); d = GG(d,a,b,c,x[k+2],S22,0xFCEFA3F8); c = GG(c,d,a,b,x[k+7],S23,0x676F02D9); b = GG(b,c,d,a,x[k+12],S24,0x8D2A4C8A);
    a = HH(a,b,c,d,x[k+5],S31,0xFFFA3942); d = HH(d,a,b,c,x[k+8],S32,0x8771F681); c = HH(c,d,a,b,x[k+11],S33,0x6D9D6122); b = HH(b,c,d,a,x[k+14],S34,0xFDE5380C);
    a = HH(a,b,c,d,x[k+1],S31,0xA4BEEA44); d = HH(d,a,b,c,x[k+4],S32,0x4BDECFA9); c = HH(c,d,a,b,x[k+7],S33,0xF6BB4B60); b = HH(b,c,d,a,x[k+10],S34,0xBEBFBC70);
    a = HH(a,b,c,d,x[k+13],S31,0x289B7EC6); d = HH(d,a,b,c,x[k+0],S32,0xEAA127FA); c = HH(c,d,a,b,x[k+3],S33,0xD4EF3085); b = HH(b,c,d,a,x[k+6],S34,0x04881D05);
    a = HH(a,b,c,d,x[k+9],S31,0xD9D4D039); d = HH(d,a,b,c,x[k+12],S32,0xE6DB99E5); c = HH(c,d,a,b,x[k+15],S33,0x1FA27CF8); b = HH(b,c,d,a,x[k+2],S34,0xC4AC5665);
    a = II(a,b,c,d,x[k+0],S41,0xF4292244); d = II(d,a,b,c,x[k+7],S42,0x432AFF97); c = II(c,d,a,b,x[k+14],S43,0xAB9423A7); b = II(b,c,d,a,x[k+5],S44,0xFC93A039);
    a = II(a,b,c,d,x[k+12],S41,0x655B59C3); d = II(d,a,b,c,x[k+3],S42,0x8F0CCC92); c = II(c,d,a,b,x[k+10],S43,0xFFEFF47D); b = II(b,c,d,a,x[k+1],S44,0x85845DD1);
    a = II(a,b,c,d,x[k+8],S41,0x6FA87E4F); d = II(d,a,b,c,x[k+15],S42,0xFE2CE6E0); c = II(c,d,a,b,x[k+6],S43,0xA3014314); b = II(b,c,d,a,x[k+13],S44,0x4E0811A1);
    a = II(a,b,c,d,x[k+4],S41,0xF7537E82); d = II(d,a,b,c,x[k+11],S42,0xBD3AF235); c = II(c,d,a,b,x[k+2],S43,0x2AD7D2BB); b = II(b,c,d,a,x[k+9],S44,0xEB86D391);
    a = AddUnsigned(a,AA); b = AddUnsigned(b,BB); c = AddUnsigned(c,CC); d = AddUnsigned(d,DD);
  }
  return (WordToHex(a) + WordToHex(b) + WordToHex(c) + WordToHex(d)).toLowerCase();
}

function safeDecode(v) {
if (v == null) return '';
try { return decodeURIComponent(String(v));} catch (e) { return String(v);}
}

// 原始 (未解码) 参数, fmz200 老 CK 只有这个
function parseRawQuery(url) {
const query = (String(url).split('?')[1] || '').split('#')[0];
const out = {};
query.split('&').forEach(pair => {
if (!pair) return;
const idx = pair.indexOf('=');
if (idx < 0) return;
out[pair.slice(0, idx)] = pair.slice(idx + 1);
});
return out;
}

// 解码后的参数, WeTalk 的 CK 和本脚本新抓的都带这个
function parseQuery(url) {
const raw = parseRawQuery(url);
const out = {};
Object.keys(raw).forEach(k => { out[safeDecode(k.replace(/\+/g, ' '))] = safeDecode(raw[k].replace(/\+/g, ' '));});
return out;
}

function getUTCSignDate() {
const now = new Date();
const pad = n => String(n).padStart(2, '0');
return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
}

function buildSignedParams(capture) {
// 有解码参数用解码的签 (WeTalk 原版做法); 只有老 paramsRaw 时按原样签 (fmz200 PingMe 老 CK 的做法, 保持兼容)
const useDecoded =!!capture.params;
const saved = capture.params || capture.paramsRaw || {};
const params = {};
Object.keys(saved).forEach(k => {
if (k!== 'sign' && k!== 'signDate') params[k] = String(saved[k]);
});
params.signDate = getUTCSignDate();
const signBase = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
params.sign = MD5(signBase + SECRET);
return params;
}

function buildUrl(cfg, capture, path) {
const params = buildSignedParams(capture);
const qs = Object.keys(params).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
return `https://${cfg.host}/app/${path}?${qs}`;
}

function buildHeaders(cfg, capture) {
const headers = {};
Object.keys(capture.headers || {}).forEach(k => { headers[k] = capture.headers[k];});
Object.keys(headers).forEach(k => {
const lk = k.toLowerCase();
if (lk === 'content-length' || lk === 'host' || lk === ':authority' || lk === ':method' || lk === ':path' || lk === ':scheme' || lk === 'connection' || lk === 'proxy-connection' || lk === 'keep-alive' || lk === 'accept-encoding') delete headers[k];
});
headers['Host'] = cfg.host;
if (!Object.keys(headers).some(k => k.toLowerCase() === 'accept')) headers['Accept'] = 'application/json';
if (!Object.keys(headers).some(k => k.toLowerCase() === 'user-agent') && capture.baseUA) headers['User-Agent'] = capture.baseUA;
return headers;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms));}

function httpGet(url, headers) {
return new Promise((resolve, reject) => {
$httpClient.get({ url: url, headers: headers}, (err, resp, data) => {
if (err) reject(err);
else {
try { resolve(JSON.parse(data || '{}'));}
catch (e) { reject(new Error('响应解析失败'));}
}
});
});
}

/* ---------------- WeTalk 多账号存储 ---------------- */
function loadWeTalkStore() {
const raw = $persistentStore.read(WETALK.storeKey);
if (!raw) return { version: 3, accounts: {}, order: []};
try {
const obj = JSON.parse(raw);
if (!obj.accounts) obj.accounts = {};
if (!Array.isArray(obj.order)) obj.order = Object.keys(obj.accounts);
return obj;
} catch (e) {
return { version: 3, accounts: {}, order: []};
}
}

/* ---------------- 抓 CK 模式 ---------------- */
function captureMode() {
const url = $request.url || '';
const headers = $request.headers || {};

if (url.indexOf('api.pingmeapp.net/app/queryBalanceAndBonus')!== -1) {
const capture = { url: url, paramsRaw: parseRawQuery(url), params: parseQuery(url), headers: headers};
$persistentStore.write(JSON.stringify(capture), PINGME.storeKey);
console.log('✅ PingMe CK 已保存');
$notification.post('PingMe', '获取成功 ✅', 'CK 已保存, 现在可以禁用抓 CK 配置了');
$done({});
return;
}

if (url.indexOf('api.wetalkapp.com/app/')!== -1) {
const params = parseQuery(url);
const email = (params.email || '').trim().toLowerCase();
if (!email) {
$notification.post('WeTalk', '抓取失败 ⚠️', '请求里没取到 email 参数, 确认已登录后再打开 App 触发一次');
$done({});
return;
}
let baseUA = '';
Object.keys(headers).forEach(k => { if (k.toLowerCase() === 'user-agent') baseUA = headers[k];});
const store = loadWeTalkStore();
const existed =!!store.accounts[email];
const now = Date.now();
store.accounts[email] = {
id: email,
email: email,
alias: existed? (store.accounts[email].alias || email): email,
capture: { url: url, params: params, headers: headers, baseUA: baseUA},
createdAt: existed? store.accounts[email].createdAt: now,
updatedAt: now,
};
if (!existed) store.order.push(email);
$persistentStore.write(JSON.stringify(store), WETALK.storeKey);
console.log('✅ WeTalk CK 已保存: ' + email);
$notification.post('WeTalk', existed? '账号参数已更新 🔄': '获取成功 ✅', email + '\n当前账号总数: ' + store.order.length);
$done({});
return;
}

$done({});
}

/* ---------------- 签到模式 ---------------- */
async function runApp(cfg, capture) {
const msgs = ['[' + cfg.name + ']'];
const headers = buildHeaders(cfg, capture);
const fetchApi = path => httpGet(buildUrl(cfg, capture, path), Object.assign({}, headers));

try {
const q1 = await fetchApi('queryBalanceAndBonus');
if (!q1 || q1.retcode!== 0) throw new Error('查询失败: ' + ((q1 && q1.retmsg) || '无响应'));
const r1 = q1.result || {};
const balance0 = Number(r1.balance);
msgs.push('💰 运行前余额: ' + r1.balance + ' Coins');

if (r1.isallowcheckin === false) {
msgs.push('⏭ 签到: ' + (r1.notallowcheckinreason || '当前不可签到'));
} else {
const ci = await fetchApi('checkIn');
if (ci && ci.retcode === 0) {
const cr = ci.result || {};
msgs.push('✅ 签到: ' + String(cr.bonusHint || ('+' + (cr.bonus == null? '?': cr.bonus) + ' Coins')).replace(/\n/g, ' '));
} else {
msgs.push('⚠️ 签到: ' + ((ci && ci.retmsg) || '失败'));
}
}

// 视频前再查一次, 顺带看有没有领取资格 (WeTalk 原版有这个判断, PingMe 一起用没坏处)
let allowVideo = true;
try {
const q2 = await fetchApi('queryBalanceAndBonus');
if (q2 && q2.retcode === 0 && q2.result && q2.result.isallowvideobonus === false) {
allowVideo = false;
msgs.push('⏭ 视频: ' + (q2.result.notallowvideobonusreason || '当前不可领取'));
}
} catch (e) { /* 查不到就照常试视频 */}

if (allowVideo) {
for (let i = 1; i <= cfg.maxVideo; i++) {
await sleep(i === 1? cfg.videoFirstDelay: VIDEO_DELAY);
try {
const v = await fetchApi('videoBonus');
if (v && v.retcode === 0) {
msgs.push('🎬 视频' + i + ': +' + (((v.result || {}).bonus == null? '?': v.result.bonus)) + ' Coins');
} else {
msgs.push('⏸ 视频' + i + ': ' + ((v && v.retmsg) || '失败'));
break; // 失败/限流就停, 和原脚本一致
}
} catch (e) {
msgs.push('❌ 视频' + i + ': 请求失败');
break;
}
}
}

const q3 = await fetchApi('queryBalanceAndBonus');
if (q3 && q3.retcode === 0) {
const b = (q3.result || {}).balance;
msgs.push('💰 最新余额: ' + b + ' Coins');
if (isFinite(balance0) && isFinite(Number(b))) msgs.push('📈 本次增加: ' + (Number(b) - balance0).toFixed(4) + ' Coins');
}
} catch (e) {
msgs.push('❌ 异常: ' + (e && e.message? e.message: String(e)) + ' (CK 可能已失效, 重新打开 App 抓一次)');
}
return msgs.join('\n');
}

async function signMode() {
const sections = [];

const pmRaw = $persistentStore.read(PINGME.storeKey);
if (pmRaw) {
try { sections.push(await runApp(PINGME, JSON.parse(pmRaw)));}
catch (e) { sections.push('[PingMe] ❌ CK 数据损坏, 重新打开 PingMe 抓一次');}
} else {
sections.push('[PingMe] ⚠️ 未抓到 CK, 先打开 PingMe 触发一次');
}

const store = loadWeTalkStore();
const ids = (store.order || []).filter(id => store.accounts[id]);
if (!ids.length) {
sections.push('[WeTalk] ⚠️ 未抓到 CK, 先打开 WeTalk 触发一次');
} else {
for (let i = 0; i < ids.length; i++) {
sections.push(await runApp(WETALK, store.accounts[ids[i]].capture || {}));
if (i < ids.length - 1) await sleep(5000); // 多账号间隔, 和原脚本一致
}
}

$notification.post('WeTalk+PingMe 签到', '', sections.join('\n———\n'));
$done();
}

/* ---------------- 入口: 有 $request 是抓 CK, 没有是定时签到 ---------------- */
if (typeof $request!== 'undefined' && $request && $request.url) {
captureMode();
} else {
signMode().catch(e => {
$notification.post('WeTalk+PingMe 签到', '', '❌ 任务异常: ' + (e && e.message? e.message: String(e)));
$done();
});
}
