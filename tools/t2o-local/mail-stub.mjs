// Stands in for the panel's "email" (port 3000) and "email-template" (port 8080) services.
// Nothing is sent anywhere: each message is appended to outbox.jsonl so the test can read the codes.
import http from 'node:http';
import fs from 'node:fs';
const out = new URL('./outbox.jsonl', import.meta.url);
const body = (req) =>
  new Promise((r) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => r(b ? JSON.parse(b) : {}));
  });
const reply = (res, data) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ status: 'success', message: '', data }));
};
http
  .createServer(async (req, res) => {
    const b = await body(req);
    fs.appendFileSync(out, JSON.stringify({ svc: 'template', path: req.url, data: b }) + '\n');
    reply(res, `<p>${req.url}</p><pre>${JSON.stringify(b)}</pre>`);
  })
  .listen(8080);
http
  .createServer(async (req, res) => {
    const b = await body(req);
    fs.appendFileSync(
      out,
      JSON.stringify({ svc: 'email', to: b.to, subject: b.subject, content: b.content }) + '\n',
    );
    reply(res, { sent: false, stub: true });
  })
  .listen(3000);
console.log('mail stub on 3000 and 8080');
