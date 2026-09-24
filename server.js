import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';
import { fileURLToPath } from 'url';
import stepHandler from './api/step.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;
const MAX_BODY_BYTES = 64 * 1024;

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 模拟 Vercel API 路由
  if (pathname === '/api/step') {
    req.query = parsedUrl.query;
    let body = '';
    let bodyTooLarge = false;
    req.on('data', chunk => {
      if (bodyTooLarge) return;
      body += chunk.toString();
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
        bodyTooLarge = true;
      }
    });
    req.on('end', () => {
      if (bodyTooLarge) {
        res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ code: 413, success: false, message: '请求体过大' }));
        return;
      }
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

      Promise.resolve(stepHandler(req, res)).catch((error) => {
        if (!res.headersSent) {
          res.status(500).json({ code: 500, success: false, message: error.message || '服务内部错误' });
        } else if (!res.writableEnded) {
          res.end();
        }
      });
    });
    return;
  }

  // 此项目没有其他静态资源。始终只提供页面，避免本地调试服务把源码或配置文件
  // 当作静态文件暴露出去（原来的 path.join 会允许 ../ 路径穿越）。
  const indexPath = path.join(__dirname, 'index.html');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(indexPath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`本地服务已启动: http://localhost:${PORT}`);
});
