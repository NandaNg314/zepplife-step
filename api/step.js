import https from 'https';
import templateData from '../lib/template.js';

// 工具函数：获取北京时间格式化字符串
function getBeijingDateTime() {
  const now = new Date();
  const beijingTime = new Date(now.getTime() + (8 * 60 + now.getTimezoneOffset()) * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${beijingTime.getFullYear()}-${pad(beijingTime.getMonth() + 1)}-${pad(beijingTime.getDate())}`;
  const timeStr = `${pad(beijingTime.getHours())}:${pad(beijingTime.getMinutes())}:${pad(beijingTime.getSeconds())}`;
  return { date: dateStr, full: `${dateStr} ${timeStr}` };
}

// 登录获取授权 Code，支持多节点故障/429限流自动轮询备用接入点
async function loginGetCode(user, password, clientIp = '114.114.114.114') {
  const isPhone = !user.includes('@');
  let urlUser = user;
  if (isPhone && !user.startsWith('+')) {
    urlUser = `+86${user}`;
  }

  const postData = new URLSearchParams({
    client_id: 'HuaMi',
    password: password,
    redirect_uri: 'https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html',
    token: 'access'
  }).toString();

  // 华米官方多接入节点，当遇到 429 限流或网络异常时自动无缝降级切换
  const hosts = [
    'api-user-cn.huami.com',
    'api-user.huami.com',
    'api-user.zepp.com'
  ];

  let lastError = null;

  for (const host of hosts) {
    try {
      const result = await new Promise((resolve, reject) => {
        const options = {
          hostname: host,
          port: 443,
          path: `/registrations/${encodeURIComponent(urlUser)}/tokens`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 ZeppLife/6.8.0',
            'Content-Length': Buffer.byteLength(postData),
            'Accept': '*/*',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'X-Forwarded-For': clientIp,
            'X-Real-IP': clientIp
          }
        };

        const req = https.request(options, (res) => {
          res.resume(); // 释放 socket 连接

          if (res.statusCode === 429) {
            return reject(new Error(`HOST_429: 节点 ${host} 正在触发限流`));
          }

          const location = res.headers.location || '';
          if (!location) {
            return reject(new Error(`HTTP ${res.statusCode} 未返回重定向`));
          }

          if (location.includes('error=')) {
            if (location.includes('error=401')) {
              return reject(new Error('AUTH_401: Zepp Life 账号或密码错误。如使用的是手机号，强烈建议使用邮箱注册登录'));
            }
            const errMatch = location.match(/error=([^&]+)/);
            return reject(new Error(`登录接口返回错误代码: ${errMatch ? errMatch[1] : '未知'}`));
          }

          const codeMatch = location.match(/access=([^&]+)/);
          if (!codeMatch) {
            return reject(new Error('未在响应中解析到授权 access code'));
          }

          resolve({ code: codeMatch[1], isPhone });
        });

        req.on('error', (err) => reject(new Error(`网络错误(${host}): ${err.message}`)));
        req.setTimeout(8000, () => {
          req.destroy();
          reject(new Error(`请求超时(${host})`));
        });
        req.write(postData);
        req.end();
      });

      return result;
    } catch (err) {
      lastError = err;
      // 密码错误无需切换节点重试，直接抛出
      if (err.message.startsWith('AUTH_401:')) {
        throw new Error(err.message.replace('AUTH_401: ', ''));
      }
      console.warn(`节点 ${host} 异常，自动切换下一备用节点: ${err.message}`);
    }
  }

  throw new Error(`登录节点均受限或异常(${lastError ? lastError.message : '请稍后再试'})`);
}

// 获取 login_token 和 user_id
async function getLoginToken(code, isPhone) {
  const url = 'https://account.huami.com/v2/client/login';
  const params = isPhone
    ? {
        app_name: 'com.xiaomi.hm.health',
        app_version: '4.6.0',
        code: code,
        country_code: 'CN',
        device_id: '2C8B4939-0CCD-4E94-8CBA-CB8EA6E613A1',
        device_model: 'phone',
        grant_type: 'access_token',
        third_name: 'huami_phone'
      }
    : {
        'allow_registration=': 'false',
        app_name: 'com.xiaomi.hm.health',
        app_version: '6.3.5',
        code: code,
        country_code: 'CN',
        device_id: '2C8B4939-0CCD-4E94-8CBA-CB8EA6E613A1',
        device_model: 'phone',
        dn: 'api-user.huami.com%2Capi-mifit.huami.com%2Capp-analytics.huami.com',
        grant_type: 'access_token',
        lang: 'zh_CN',
        os_version: '1.5.0',
        source: 'com.xiaomi.hm.health',
        third_name: 'email'
      };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
    },
    body: new URLSearchParams(params).toString()
  });

  const resJson = await response.json();
  if (!resJson?.token_info?.login_token) {
    throw new Error(resJson?.message || '获取 login_token 失败');
  }

  return {
    loginToken: resJson.token_info.login_token,
    userId: resJson.token_info.user_id
  };
}

// 获取业务凭据 app_token
async function getAppToken(loginToken) {
  const url = `https://account-cn.huami.com/v1/client/app_tokens?app_name=com.xiaomi.hm.health&dn=api-user.huami.com%2Capi-mifit.huami.com%2Capp-analytics.huami.com&login_token=${loginToken}`;
  const response = await fetch(url);
  const resJson = await response.json();
  if (!resJson?.token_info?.app_token) {
    throw new Error(resJson?.message || '获取 app_token 失败');
  }
  return resJson.token_info.app_token;
}

// 提交步数数据
async function uploadBandData(appToken, userId, steps) {
  const { date: todayDate } = getBeijingDateTime();
  let dataJson = templateData;

  const dateMatch = dataJson.match(/date%22%3A%22(.*?)%22%2C%22data/);
  const stepMatch = dataJson.match(/ttl%5C%22%3A(.*?)%2C%5C%22dis/);

  if (dateMatch) {
    dataJson = dataJson.replace(dateMatch[1], todayDate);
  }
  if (stepMatch) {
    dataJson = dataJson.replace(stepMatch[1], String(steps));
  }

  const timestamp = Date.now();
  const url = `https://api-mifit-cn.huami.com/v1/data/band_data.json?&t=${timestamp}`;

  const payload = new URLSearchParams({
    userid: userId,
    last_sync_data_time: '1597306380',
    device_type: '0',
    last_deviceid: 'DA932FFFFE8816E7',
    data_json: dataJson
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apptoken: appToken,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: payload.toString()
  });

  const resJson = await response.json();
  if (resJson?.code === 1) {
    return { success: true, message: resJson.message || '步数提交成功' };
  } else {
    return { success: false, message: resJson?.message || '服务器返回异常' };
  }
}

// Vercel Serverless Function 入口
export default async function handler(req, res) {
  // 设置跨域 CORS 头，方便网页或快捷指令跨域访问
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  let user = '';
  let password = '';
  let steps = 0;

  if (req.method === 'POST') {
    // 兼容 JSON 或 Form-urlencoded
    const body = req.body || {};
    user = (body.user || body.account || '').trim();
    password = (body.password || body.pwd || '').trim();
    steps = parseInt(body.steps || body.step || 0, 10);
  } else if (req.method === 'GET') {
    const query = req.query || {};
    user = (query.user || query.account || '').trim();
    password = (query.password || query.pwd || '').trim();
    steps = parseInt(query.steps || query.step || 0, 10);
  } else {
    return res.status(405).json({ code: 405, message: '只支持 GET 或 POST 请求' });
  }

  let appToken = (req.body?.app_token || req.query?.app_token || '').trim();
  let userId = (req.body?.user_id || req.query?.user_id || '').trim();

  // 如果有客户端缓存的 Token，优先尝试极速同步（跳过登录，0 限流风险）
  if (appToken && userId) {
    try {
      const result = await uploadBandData(appToken, userId, steps);
      if (result.success) {
        const { full: nowTime, date: nowDate } = getBeijingDateTime();
        return res.status(200).json({
          code: 200,
          success: true,
          message: '步数修改成功！(极速Token通道)',
          data: {
            account: user ? (user.includes('@') ? user : `${user.slice(0, 3)}****${user.slice(-4)}`) : 'Token用户',
            steps: steps,
            date: nowDate,
            time: nowTime,
            app_token: appToken,
            user_id: userId
          }
        });
      }
    } catch (e) {
      console.warn('缓存 Token 已过期失效，转入常规账号登录流程:', e.message);
    }
  }

  if (!user || !password) {
    return res.status(400).json({
      code: 400,
      message: '请提供 Zepp Life 账号 (user/account) 和密码 (password/pwd)'
    });
  }

  // 如果没有填写步数，随机生成 18,000 ~ 26,000 之间的合理步数
  if (isNaN(steps) || steps <= 0) {
    steps = Math.floor(Math.random() * (26000 - 18000 + 1)) + 18000;
  } else if (steps > 98800) {
    steps = 98800;
  }

  const rawIp = req.headers?.['x-forwarded-for'] || req.headers?.['x-real-ip'] || '114.114.114.114';
  const clientIp = typeof rawIp === 'string' ? rawIp.split(',')[0].trim() : '114.114.114.114';

  try {
    const { code, isPhone } = await loginGetCode(user, password, clientIp);
    const { loginToken, userId: newUserId } = await getLoginToken(code, isPhone);
    const newAppToken = await getAppToken(loginToken);
    const result = await uploadBandData(newAppToken, newUserId, steps);

    const { full: nowTime, date: nowDate } = getBeijingDateTime();

    if (result.success) {
      return res.status(200).json({
        code: 200,
        success: true,
        message: '步数修改成功！微信可能需要几分钟同步',
        data: {
          account: user.includes('@') ? user : `${user.slice(0, 3)}****${user.slice(-4)}`,
          steps: steps,
          date: nowDate,
          time: nowTime,
          app_token: newAppToken,
          user_id: newUserId
        }
      });
    } else {
      return res.status(502).json({
        code: 502,
        success: false,
        message: `提交步数失败: ${result.message}`
      });
    }
  } catch (error) {
    const isAuthError = error.message.includes('账号或密码错误');
    return res.status(isAuthError ? 401 : 500).json({
      code: isAuthError ? 401 : 500,
      success: false,
      message: error.message || '执行过程出现异常'
    });
  }
}


