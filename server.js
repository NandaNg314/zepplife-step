const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const stepHandler = require('./api/step');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 模拟 Vercel API 路由
  if (pathname === '/api/step') {
    req.query = parsedUrl.query;
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      if (body) {
        try {
          req.body = JSON.parse(body);
        } catch {
          req.body = Object.fromEntries(new URLSearchParams(body));
        }
      } else {
        req.body = {};
      }

      // 补充 Vercel res.status / res.json 辅助方法
      res.status = (statusCode) => {
        res.statusCode = statusCode;
        return res;
      };
      res.json = (data) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(data));
      };

      stepHandler(req, res);
    });
    return;
  }

  // 静态页面
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png'
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    // 默认兜底到 index.html
    const indexPath = path.join(__dirname, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(indexPath).pipe(res);
  }
});

server.listen(PORT, () => {
  console.log(`本地服务已启动: http://localhost:${PORT}`);
});
