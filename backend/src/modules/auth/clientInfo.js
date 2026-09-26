import dns from 'node:dns';
import { execFile } from 'node:child_process';

/**
 * Where a request comes from: the client's IP address and, best effort, its computer name.
 * A browser cannot report its own host name, so the name is looked up from the IP (reverse DNS,
 * then NetBIOS for Windows PCs on the LAN), cached for an hour, and never delays a response.
 */

const HOST_CACHE_TTL_MS = 60 * 60 * 1000;
const REVERSE_DNS_TIMEOUT_MS = 1500;
const NBTSTAT_TIMEOUT_MS = 2500;
const hostCache = new Map(); // ip -> { host, at }

const stripV6Mapping = (ip) => (ip?.startsWith('::ffff:') ? ip.slice(7) : ip);
export const isLoopback = (ip) => ip === '::1' || ip === '127.0.0.1';

/**
 * The client IP. X-Forwarded-For is believed only from a proxy on this machine (the Vite dev
 * server, a local reverse proxy) or when TRUST_PROXY is set (Express then fills req.ip);
 * otherwise any PC on the LAN could write a false address into the sign-in log.
 */
export function clientIp(req) {
  const peer = stripV6Mapping(req.socket?.remoteAddress ?? '');
  const forwarded = req.get?.('x-forwarded-for');
  if (isLoopback(peer) && forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    if (first) return stripV6Mapping(first);
  }
  return stripV6Mapping(req.ip ?? peer) || null;
}

async function reverseDns(ip) {
  let timer;
  try {
    const names = await Promise.race([
      dns.promises.reverse(ip),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), REVERSE_DNS_TIMEOUT_MS); }),
    ]);
    return names?.[0] ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Windows PCs on a LAN often have no DNS name but answer NetBIOS queries (Windows servers only).
function netbiosName(ip) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return resolve(null);
    execFile('nbtstat', ['-A', ip], { timeout: NBTSTAT_TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const m = /^\s*(\S+)\s+<00>\s+UNIQUE/m.exec(stdout);
      resolve(m ? m[1] : null);
    });
  });
}

/** The computer name for an IP, or null when neither DNS nor NetBIOS knows it. */
export async function resolveHostName(ip) {
  if (!ip) return null;
  if (isLoopback(ip)) return 'localhost (this server)';
  const cached = hostCache.get(ip);
  if (cached && Date.now() - cached.at < HOST_CACHE_TTL_MS) return cached.host;
  const host = (await reverseDns(ip)) ?? (await netbiosName(ip));
  hostCache.set(ip, { host, at: Date.now() });
  return host;
}
