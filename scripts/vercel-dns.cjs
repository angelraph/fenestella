// Preload for the Vercel CLI only: resolve Vercel's API and upload hosts to an
// edge address that this network can reach (76.76.21.21 times out here).
// Affects this one Node process; no system setting is changed.
const dns = require("node:dns");
// Several Vercel edge addresses serve the API; if one stops answering, set
// VERCEL_PIN_IP to another (76.76.21.61, 76.76.21.98, 76.76.21.123, ...).
const PIN = process.env.VERCEL_PIN_IP || "76.76.21.61";
const HOSTS = new Set(["api.vercel.com", "vercel.com"]);
const orig = dns.lookup;
dns.lookup = function (hostname, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  if (HOSTS.has(hostname)) {
    const opts = typeof options === "number" ? { family: options } : options || {};
    if (opts.all) return process.nextTick(callback, null, [{ address: PIN, family: 4 }]);
    return process.nextTick(callback, null, PIN, 4);
  }
  return orig.call(dns, hostname, options, callback);
};
