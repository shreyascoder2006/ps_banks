/**
 * Shared layout for the Retention Signal Network (3D scene and its 2D fallback).
 * Every coordinate is derived from real fields, nothing is random:
 *   - branch hubs sit on a ring, ordered by their critical-customer count
 *   - a customer orbits its own branch hub; nearer the hub = higher model score
 *   - height (3D) = balance on a log scale; node size = balance
 *   - colour = severity; ring = customer currently has an open early-warning alert
 */
export const NETWORK_RING = 11;

const hash01 = (n) => {
  // deterministic 0..1 from an integer id (so the same customer is always at the same angle)
  let x = (Math.imul(Number(n) | 0, 2654435761) >>> 0) / 4294967296;
  x = (x * 9301 + 0.4973) % 1;
  return x;
};

export function buildNetwork(customers, branches, alertIds = new Set()) {
  const names = [...new Set([...branches.map((b) => b.branch), ...customers.map((c) => c.branch)])];
  const stats = Object.fromEntries(branches.map((b) => [b.branch, b]));
  names.sort((a, b) => (stats[b]?.critical || 0) - (stats[a]?.critical || 0) || a.localeCompare(b));

  const hubs = names.map((name, i) => {
    const a = (i / names.length) * Math.PI * 2;
    return { name, x: Math.cos(a) * NETWORK_RING, z: Math.sin(a) * NETWORK_RING, stats: stats[name] || null, angle: a };
  });
  const hubByName = Object.fromEntries(hubs.map((h) => [h.name, h]));

  const lo = Math.min(...customers.map((c) => c.churnRiskScore), 100);
  const span = Math.max(100 - lo, 1);
  const maxBal = Math.max(...customers.map((c) => c.balance), 1);

  const nodes = customers.map((c) => {
    const hub = hubByName[c.branch];
    const a = hash01(c.customerId) * Math.PI * 2;
    const t = (100 - c.churnRiskScore) / span; // 0 = highest score in view
    const r = 0.9 + t * 2.6;
    const lift = Math.log10(c.balance + 1) / Math.log10(maxBal + 1);
    return {
      c,
      hub,
      x: hub.x + Math.cos(a) * r,
      z: hub.z + Math.sin(a) * r,
      y: lift * 4.2,
      size: 0.08 + lift * 0.14,
      alert: alertIds.has(c.customerId),
    };
  });
  return { hubs, nodes, scoreRange: [Math.min(...customers.map((c) => c.churnRiskScore)), Math.max(...customers.map((c) => c.churnRiskScore))] };
}

export const SEVERITY_HEX = { critical: '#f43f5e', high: '#f59e0b', medium: '#38bdf8', low: '#34d399' };

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}
