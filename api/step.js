import https from 'https';
import crypto from 'crypto';
import templateData from '../lib/template.js';

// 华米官方传输加密密钥与固定 IV (Zepp Life v2 协议标准)
const HM_AES_KEY = Buffer.from('xeNtBVqzDc6tuNTh', 'utf8');
const HM_AES_IV = Buffer.from('MAAAYAAAAAAAAABg', 'utf8');

// AES-128-CBC 加密
function encryptV2(plainText) {
  const cipher = crypto.createCipheriv('aes-128-cbc', HM_AES_KEY, HM_AES_IV);
  return Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
}

// 统一的原生 HTTPS 请求封装（避免 Vercel 环境下 global fetch/undici 对国内节点连接失败报错 fetch failed）
function request(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const postData = options.body;
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'MiFit6.14.0 (M2007J1SC; Android 12; Density/2.75)',
        ...(options.headers || {})
      }
    };
    if (postData) {
      reqOptions.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          text: async () => data,
          json: async () => {
            try {
              return JSON.parse(data);
            } catch {
              return {};
            }
          }
        });
      });
    });

    req.on('error', (err) => reject(new Error(`网络请求失败(${parsedUrl.hostname}): ${err.message}`)));
    req.setTimeout(options.timeout || 10000, () => {
      req.destroy();
      reject(new Error(`请求超时(${parsedUrl.hostname})`));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

// 工具函数：获取北京时间格式化字符串
function getBeijingDateTime() {
  const now = new Date();
  const beijingTime = new Date(now.getTime() + (8 * 60 + now.getTimezoneOffset()) * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${beijingTime.getFullYear()}-${pad(beijingTime.getMonth() + 1)}-${pad(beijingTime.getDate())}`;
  const timeStr = `${pad(beijingTime.getHours())}:${pad(beijingTime.getMinutes())}:${pad(beijingTime.getSeconds())}`;
  return { date: dateStr, full: `${dateStr} ${timeStr}` };
}

// 登录获取授权 Code（使用 Zepp Life 最新 v2 加密协议，多节点无缝容灾）
async function loginGetCode(user, password) {
  const isPhone = !user.includes('@');
  let emailOrPhone = user;
  if (isPhone && !user.startsWith('+')) {
    emailOrPhone = `+86${user}`;
  }

  const v2Data = new URLSearchParams({
    emailOrPhone: emailOrPhone,
    password: password,
    state: 'REDIRECTION',
    client_id: 'HuaMi',
    country_code: 'CN',
    token: 'access',
    redirect_uri: 'https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html'
  }).toString();

  const encryptedBody = encryptV2(v2Data);

  const hosts = [
    'api-user.zepp.com',
    'api-user.huami.com',
    'api-user-cn.huami.com',
    'api-user-us2.zepp.com',
    'api-user-us3.zepp.com'
  ];

  let lastError = null;

  for (const host of hosts) {
    try {
      const result = await new Promise((resolve, reject) => {
        const options = {
          hostname: host,
          port: 443,
          path: '/v2/registrations/tokens',
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'user-agent': 'MiFit6.14.0 (M2007J1SC; Android 12; Density/2.75)',
            'app_name': 'com.xiaomi.hm.health',
            'appname': 'com.xiaomi.hm.health',
            'appplatform': 'android_phone',
            'x-hm-ekv': '1',
            'hm-privacy-ceip': 'false',
            'Content-Length': encryptedBody.length
          }
        };

        const req = https.request(options, (res) => {
          res.resume();

          if (res.statusCode === 429) {
            return reject(new Error(`HOST_429: 节点 ${host} 正在触发限流`));
          }

          const location = res.headers.location || '';
          if (!location) {
            return reject(new Error(`HTTP ${res.statusCode} 未返回重定向`));
          }

          if (location.includes('error=')) {
            if (location.includes('error=401')) {
              const attemptsMatch = location.match(/attempts=(\d+)/);
              const maxAttemptsMatch = location.match(/max_attempts=(\d+)/);
              let countHint = '';
              if (attemptsMatch && maxAttemptsMatch) {
                countHint = ` (已尝试 ${attemptsMatch[1]}/${maxAttemptsMatch[1]} 次)`;
              }
              return reject(new Error(`AUTH_401: Zepp Life 账号或密码错误${countHint}。请注意：必须在 Zepp Life App 内设置独立登录密码，非微信授权密码`));
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
        req.write(encryptedBody);
        req.end();
      });

      return result;
    } catch (err) {
      lastError = err;
      if (err.message.startsWith('AUTH_401:')) {
        throw new Error(err.message.replace('AUTH_401: ', ''));
      }
      console.warn(`节点 ${host} v2 异常，尝试切换备用节点: ${err.message}`);
    }
  }

  throw new Error(`登录节点均受限或异常(${lastError ? lastError.message : '请稍后再试'})`);
}

// 获取 login_token 和 user_id
async function getLoginToken(code, isPhone) {
  const url = 'https://account.huami.com/v2/client/login';
  const deviceId = (crypto.randomUUID ? crypto.randomUUID() : '2C8B4939-0CCD-4E94-8CBA-CB8EA6E613A1').toUpperCase();
  const headers = {
    'app_name': 'com.xiaomi.hm.health',
    'x-request-id': deviceId,
    'accept-language': 'zh-CN',
    'appname': 'com.xiaomi.hm.health',
    'cv': '50818_6.14.0',
    'v': '2.0',
    'appplatform': 'android_phone',
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
  };

  const params = isPhone
    ? {
        app_name: 'com.xiaomi.hm.health',
        app_version: '6.14.0',
        code: code,
        country_code: 'CN',
        device_id: deviceId,
        device_model: 'phone',
        grant_type: 'access_token',
        third_name: 'huami_phone'
      }
    : {
        'allow_registration=': 'false',
        app_name: 'com.xiaomi.hm.health',
        app_version: '6.14.0',
        code: code,
        country_code: 'CN',
        device_id: deviceId,
        device_model: 'android_phone',
        dn: 'account.zepp.com,api-user.zepp.com,api-mifit.zepp.com,api-watch.zepp.com,app-analytics.zepp.com,api-analytics.huami.com,auth.zepp.com',
        grant_type: 'access_token',
        lang: 'zh_CN',
        os_version: '1.5.0',
        source: 'com.xiaomi.hm.health:6.14.0:50818',
        third_name: 'email'
      };

  const response = await request(url, {
    method: 'POST',
    headers: headers,
    body: new URLSearchParams(params).toString()
  });

  const resJson = await response.json();
  if (!resJson?.token_info?.login_token) {
    throw new Error(resJson?.message || resJson?.result || '获取 login_token 失败');
  }

  return {
    loginToken: resJson.token_info.login_token,
    appToken: resJson.token_info.app_token || null,
    userId: resJson.token_info.user_id
  };
}

// 获取业务凭据 app_token
async function getAppToken(loginToken) {
  const hosts = ['account.huami.com', 'account.zepp.com', 'account-cn.huami.com'];
  let lastError = null;

  for (const host of hosts) {
    try {
      const url = `https://${host}/v1/client/app_tokens?app_name=com.xiaomi.hm.health&dn=api-user.huami.com%2Capi-mifit.huami.com%2Capp-analytics.huami.com&login_token=${encodeURIComponent(loginToken)}`;
      const response = await request(url, { timeout: 6000 });
      const resJson = await response.json();
      if (resJson?.token_info?.app_token) {
        return resJson.token_info.app_token;
      }
      if (resJson?.message) {
        throw new Error(resJson.message);
      }
    } catch (e) {
      lastError = e;
      console.warn(`节点 ${host} 获取 app_token 异常，尝试备用节点:`, e.message);
    }
  }

  throw new Error(lastError?.message || '获取 app_token 失败');
}

// 根据 userId 生成账号专属的虚拟手环设备识别号与 MAC 地址，防止全局撞车
function getVirtualDeviceForUser(userId) {
  const hash = crypto.createHash('md5').update(String(userId || 'default_user')).digest('hex').toUpperCase();
  const deviceId = `DA${hash.slice(0, 14)}`;
  const macAddress = `${hash.slice(0, 2)}:${hash.slice(2, 4)}:${hash.slice(4, 6)}:${hash.slice(6, 8)}:${hash.slice(8, 10)}:${hash.slice(10, 12)}`;
  return { deviceId, macAddress };
}

// 获取并确保账号有名下的有效激活设备（若无设备则自动挂载专属小米手环 2）
async function ensureActiveDevice(appToken, userId) {
  const virtualDev = getVirtualDeviceForUser(userId);
  try {
    const listRes = await request(`https://api-mifit.huami.com/users/${userId}/devices?enable=true`, {
      headers: { apptoken: appToken },
      timeout: 5000
    });
    const listData = await listRes.json();
    const items = listData?.items || [];
    if (items.length > 0) {
      let activeDev = items.find(d => d.activeStatus === 1 && String(d.priority) !== '-1');
      if (!activeDev) {
        // 自动激活名下首个设备并启用优先级
        const target = items[0];
        try {
          await request(`https://api-mifit.huami.com/users/${userId}/devices/${target.deviceId}`, {
            method: 'PUT',
            headers: {
              apptoken: appToken,
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              deviceType: target.deviceType ?? 0,
              deviceSource: target.deviceSource ?? 24,
              activeStatus: 1,
              priority: 1,
              sort: 1
            }),
            timeout: 5000
          });
          activeDev = { ...target, activeStatus: 1, priority: 1, sort: 1 };
        } catch (err) {
          console.warn('自动激活设备异常:', err.message);
          activeDev = target;
        }
      }
      if (activeDev?.deviceId) {
        return activeDev.deviceId;
      }
    } else {
      // 账号下没有任何手环，直接自动为该用户挂载专属虚拟小米手环 2
      try {
        await request(`https://api-mifit.huami.com/users/${userId}/devices`, {
          method: 'POST',
          headers: {
            apptoken: appToken,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            deviceId: virtualDev.deviceId,
            deviceType: 0,
            deviceSource: 24,
            macAddress: virtualDev.macAddress,
            displayName: '小米手环 2',
            activeStatus: 1,
            bindingStatus: 1,
            priority: 1
          }),
          timeout: 5000
        });
        return virtualDev.deviceId;
      } catch (bindErr) {
        console.warn('自动挂载专属小米手环2失败:', bindErr.message);
      }
    }
  } catch (e) {
    console.warn('获取设备列表异常，使用专属虚拟设备:', e.message);
  }
  return virtualDev.deviceId;
}

// 提交步数数据
async function uploadBandData(appToken, userId, steps) {
  const { date: todayDate } = getBeijingDateTime();
  const activeDeviceId = await ensureActiveDevice(appToken, userId);

  // 必须先解码模板，防止 URLSearchParams 产生二次 URL 编码导致 "Error parameter 'data_json'"
  const decoded = decodeURIComponent(templateData);

  let finalDataJson = decoded.replace('2021-08-07', todayDate);
  finalDataJson = finalDataJson.replace('18272', String(steps));
  if (activeDeviceId !== 'DA932FFFFE8816E7') {
    finalDataJson = finalDataJson.replace(/DA932FFFFE8816E7/g, activeDeviceId);
  }

  const timestamp = Date.now();
  const payload = new URLSearchParams({
    userid: userId,
    last_sync_data_time: String(Math.floor(Date.now() / 1000) - 300),
    device_type: '0',
    last_deviceid: activeDeviceId,
    data_json: finalDataJson
  });

  const hosts = [
    'api-mifit.huami.com',
    'api-mifit.zepp.com',
    'api-mifit-cn.huami.com'
  ];

  let lastError = null;

  for (const host of hosts) {
    try {
      const url = `https://${host}/v1/data/band_data.json?&t=${timestamp}`;
      const response = await request(url, {
        method: 'POST',
        headers: {
          apptoken: appToken,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: payload.toString(),
        timeout: 6000
      });

      const resJson = await response.json();
      if (resJson?.code === 1) {
        return { success: true, message: resJson.message || '步数提交成功' };
      } else {
        return { success: false, message: resJson?.message || '服务器返回异常' };
      }
    } catch (e) {
      lastError = e;
      console.warn(`节点 ${host} 提交步数超时或异常，切换下一备用节点:`, e.message);
    }
  }

  throw new Error(`提交步数节点均不可用: ${lastError?.message || '网络超时'}`);
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

  // 如果有客户端缓存的有效 Token，优先尝试极速同步（跳过登录，0 限流风险）
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

  try {
    const { code, isPhone } = await loginGetCode(user, password);
    const { loginToken, appToken: directAppToken, userId: newUserId } = await getLoginToken(code, isPhone);
    const finalAppToken = directAppToken || (await getAppToken(loginToken));
    const result = await uploadBandData(finalAppToken, newUserId, steps);

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
          app_token: finalAppToken,
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

export { loginGetCode, getLoginToken, getAppToken, uploadBandData };

