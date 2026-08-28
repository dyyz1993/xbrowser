/**
 * 火山引擎 imageX V4 签名上传（掘金图床）
 * 协议：ApplyImageUpload（获取上传 URI）→ PUT 上传 → CommitImageUpload
 * 签名：volc V4（HMAC-SHA256 链）
 */
import crypto from 'node:crypto';

const [tokFile, imgFile] = process.argv.slice(2);
const tok = JSON.parse((await import('node:fs')).readFileSync(tokFile, 'utf8'));
const img = (await import('node:fs')).readFileSync(imgFile);

const SERVICE = 'ImageX';
const REGION = 'cn-north-1';
function hmac(key, data) { return crypto.createHmac('sha256', key).update(data).digest(); }
function sha256hex(d) { return crypto.createHash('sha256').update(d).digest('hex'); }


function v4Sign(method, path, query, headers, payload, creds) {
  const t = new Date();
  const formatDate = t.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '').slice(0, 15) + 'Z';
  const date = formatDate.slice(0, 8);
  const bodyHash = sha256hex(payload);
  headers['X-Date'] = formatDate;
  headers['X-Content-Sha256'] = bodyHash;
  if (creds.SessionToken) headers['X-Security-Token'] = creds.SessionToken;

  const signed = {};
  for (const [k, v] of Object.entries(headers)) {
    const kl = k.toLowerCase();
    if (['content-type', 'content-md5', 'host'].includes(kl) || kl.startsWith('x-')) {
      signed[kl] = String(v);
    }
  }
  const keys = Object.keys(signed).sort();
  const signedStr = keys.map(k => k + ':' + signed[k] + '\n').join('');
  const sh = keys.join(';');

  const q = (str) => encodeURIComponent(String(str)).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const cq = Object.keys(query).map(k => [q(k), q(query[k])]).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => k + '=' + v).join('&');

  const creq = [method, path, cq, signedStr, sh, bodyHash].join('\n');
  const scope = [date, REGION, SERVICE, 'request'].join('/');
  const sts = ['HMAC-SHA256', formatDate, scope, sha256hex(creq)].join('\n');

  let key = crypto.createHmac('sha256', creds.SecretAccessKey).update(date).digest();
  key = crypto.createHmac('sha256', key).update(REGION).digest();
  key = crypto.createHmac('sha256', key).update(SERVICE).digest();
  key = crypto.createHmac('sha256', key).update('request').digest();
  const sig = crypto.createHmac('sha256', key).update(sts).digest('hex');

  return {
    ...headers,
    'Authorization': `HMAC-SHA256 Credential=${creds.AccessKeyId}/${scope}, SignedHeaders=${sh}, Signature=${sig}`,
  };
}


// 1. ApplyImageUpload
const applyQuery = {
  Action: 'ApplyImageUpload',
  Version: '2018-08-01',
  ServiceId: 'k3u1fbpfcp',
  'ApplyNum': '1',
  'Scene': 'default',
  'UploadHostNum': '1',
};
const applyHeaders = {
  'Host': 'imagex.bytedanceapi.com',
  'X-Security-Token': tok.SessionToken,
};
const body = ''; // GET 请求无 body
const signed = v4Sign('GET', '/', applyQuery, applyHeaders, body, tok);
const url = 'https://imagex.bytedanceapi.com/?' + new URLSearchParams(applyQuery).toString();
const resp = await fetch(url, { headers: signed, method: 'GET' });
let data; try { data = await resp.json(); } catch { data = { raw: await resp.text() }; }
console.log('ApplyImageUpload:', resp.status, JSON.stringify(data).substring(0, 300));
