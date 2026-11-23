// Local test harness only: the sandbox has no DNS, and the T2O User model checks for an MX record.
// Answer MX lookups for the reserved ".test" TLD; everything else behaves normally.
const dns = require('node:dns');
const { syncBuiltinESMExports } = require('node:module');
const real = dns.promises.resolveMx.bind(dns.promises);
dns.promises.resolveMx = async (d) =>
  String(d).endsWith('.test') ? [{ exchange: 'mx.local.test', priority: 10 }] : real(d);
const realCb = dns.resolveMx.bind(dns);
dns.resolveMx = (d, cb) =>
  String(d).endsWith('.test')
    ? process.nextTick(cb, null, [{ exchange: 'mx.local.test', priority: 10 }])
    : realCb(d, cb);
syncBuiltinESMExports();
