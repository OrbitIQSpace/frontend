// src/utils/orbitPhysics.js
// Shared orbital mechanics utilities used by ReboostPlanner and LifetimeForecaster.

// ─── Constants ────────────────────────────────────────────────────────────────
const GM    = 398600.4418; // km³/s²
const GM_M3 = 3.986004418e14; // m³/s²
const RE    = 6371;        // km
const G0    = 9.80665;     // m/s²

// ─── Hohmann Transfer ─────────────────────────────────────────────────────────
// Delta-v for a two-impulse Hohmann transfer between two circular orbits.
export const computeHohmannDv = (currentAlt_km, targetAlt_km) => {
  const r1  = RE + currentAlt_km;
  const r2  = RE + targetAlt_km;
  const v1  = Math.sqrt(GM / r1);
  const v2  = Math.sqrt(GM / r2);
  const vTP = Math.sqrt(GM * 2 * r2 / (r1 * (r1 + r2)));
  const vTA = Math.sqrt(GM * 2 * r1 / (r2 * (r1 + r2)));
  return {
    dv1_ms:     (vTP - v1) * 1000,
    dv2_ms:     (v2 - vTA) * 1000,
    dvTotal_ms: (vTP - v1 + v2 - vTA) * 1000,
  };
};

// ─── Tsiolkovsky Rocket Equation ──────────────────────────────────────────────
// Returns fuel mass consumed and remaining propellant for a given Δv.
// wetMassKg is the spacecraft wet mass AT THE TIME OF BURN (decreases with each burn).
export const computeFuelCost = (dvMs, wetMassKg, dryMassKg, ispS) => {
  if (!wetMassKg || !ispS || dvMs <= 0) return null;
  const exhaust   = ispS * G0;
  const mFinal    = wetMassKg / Math.exp(dvMs / exhaust);
  const deltaMass = wetMassKg - mFinal;
  const propAvail = dryMassKg ? wetMassKg - dryMassKg : null;
  const remaining = propAvail != null ? Math.max(0, propAvail - deltaMass) : null;
  const feasible  = propAvail != null ? deltaMass <= propAvail : true;
  return { deltaMass_kg: deltaMass, remainingPropellant_kg: remaining, propAvail_kg: propAvail, feasible };
};

// ─── Burn Duration ────────────────────────────────────────────────────────────
export const computeBurnDuration = (deltaMass_kg, thrustN, ispS) => {
  if (!thrustN || thrustN <= 0 || !ispS) return null;
  return deltaMass_kg / (thrustN / (ispS * G0));
};

// ─── Exponential Atmosphere Scale Height ─────────────────────────────────────
// COSPAR standard atmosphere reference values [alt_km, scale_height_km].
const SCALE_HEIGHTS = [
  [100, 5.9], [150, 8.5], [200, 14.0], [250, 21.0], [300, 28.0],
  [350, 34.0], [400, 40.0], [450, 48.0], [500, 55.0], [550, 65.0],
  [600, 75.0], [700, 95.0], [800, 110.0], [900, 120.0], [1000, 135.0],
];

const getScaleHeight = (altKm) => {
  const h = Math.max(100, Math.min(1000, altKm));
  for (let i = 1; i < SCALE_HEIGHTS.length; i++) {
    const [h0, H0] = SCALE_HEIGHTS[i - 1];
    const [h1, H1] = SCALE_HEIGHTS[i];
    if (h <= h1) {
      const t = (h - h0) / (h1 - h0);
      return H0 + t * (H1 - H0);
    }
  }
  return SCALE_HEIGHTS[SCALE_HEIGHTS.length - 1][1];
};

// ─── Improved Decay Model ─────────────────────────────────────────────────────
// Calibrates current decay rate from TLE mean_motion_dot, then scales it
// exponentially as altitude changes. Much more accurate than linear over 1-2 yrs.
//
// latestDerived must have: mean_motion (rev/day), mean_motion_dot (rev/day²)
// Returns km/day decay rate AT altKm (negative = decaying)
export const computeDailyDecayKm = (latestDerived, altKm) => {
  const n0 = parseFloat(latestDerived.mean_motion);
  const nd = parseFloat(latestDerived.mean_motion_dot);
  if (!isFinite(n0) || n0 <= 0 || !isFinite(nd)) return 0;

  // Semi-major axis at current TLE epoch
  const T0 = 86400 / n0; // seconds per revolution
  const a0 = Math.cbrt(GM * Math.pow(T0 / (2 * Math.PI), 2)); // km
  const currentAlt = a0 - RE; // km

  // Current da/dt from mean_motion_dot: da/dt = -(2/3) * a * (ndot/n)
  const dadt_current = -(2 / 3) * a0 * (nd / n0); // km/day (negative)
  if (dadt_current >= 0) return 0; // no measurable decay (e.g. very high orbit)

  // Exponential correction: drag scales with atmospheric density,
  // which drops exponentially with altitude.
  const H = getScaleHeight(currentAlt);
  return dadt_current * Math.exp(-(altKm - currentAlt) / H);
};

// ─── Lifetime Simulation ──────────────────────────────────────────────────────
// Simulates satellite lifetime for one reboost strategy, stepping 1 day at a time.
//
// startAltKm     — current altitude (km)
// latestDerived  — TLE-derived params: { mean_motion, mean_motion_dot }
// spacecraft     — { wet_mass_kg, dry_mass_kg, isp_s }
// currentFuelKg  — current propellant remaining (kg)
// strategy       — { triggerAltKm, targetAltKm }  (triggerAlt=0 → no reboosts)
// maxYears       — simulation cap (prevents infinite loop for high/stable orbits)
//
// Returns { lifetimeDays, reentryDate, finalFuelKg, events, altHistory }
//   events: [{ day, date, type:'reboost', fromAlt, toAlt, dvMs, fuelUsed, fuelAfter }]
//   altHistory: [{ day, date, altKm }] sampled every 7 days for chart
export const simulateLifetime = (
  startAltKm, latestDerived, spacecraft, currentFuelKg, strategy, maxYears = 3
) => {
  const { triggerAltKm, targetAltKm } = strategy;
  const { wet_mass_kg, dry_mass_kg, isp_s } = spacecraft;

  const maxDays = Math.round(maxYears * 365.25);
  let alt     = startAltKm;
  let fuel    = Math.max(0, currentFuelKg);
  let wetMass = wet_mass_kg; // tracks current wet mass as fuel is burned
  const now   = Date.now();

  const events     = [];
  const altHistory = [];

  for (let day = 0; day <= maxDays; day++) {
    const date = new Date(now + day * 86400 * 1000);

    // Sample altitude for chart (every 7 days + first/last)
    if (day === 0 || day % 7 === 0) {
      altHistory.push({ day, date: new Date(date), altKm: Math.max(0, alt) });
    }

    // Reentry check
    if (alt < 100) {
      altHistory.push({ day, date: new Date(date), altKm: 100 });
      return { lifetimeDays: day, reentryDate: date, finalFuelKg: fuel, events, altHistory };
    }

    // Reboost check: only if trigger is set and we have enough fuel
    if (triggerAltKm > 0 && alt <= triggerAltKm) {
      const dv    = computeHohmannDv(alt, targetAltKm).dvTotal_ms;
      const cost  = computeFuelCost(dv, wetMass, dry_mass_kg, isp_s);
      if (cost && cost.feasible && fuel >= cost.deltaMass_kg) {
        const fuelUsed = cost.deltaMass_kg;
        fuel    -= fuelUsed;
        wetMass -= fuelUsed;
        events.push({
          day,
          date:      new Date(date),
          type:      'reboost',
          fromAlt:   Math.round(alt * 10) / 10,
          toAlt:     targetAltKm,
          dvMs:      Math.round(dv * 10) / 10,
          fuelUsed:  Math.round(fuelUsed * 100) / 100,
          fuelAfter: Math.round(fuel * 100) / 100,
        });
        alt = targetAltKm;
        // Record post-reboost altitude in history
        altHistory.push({ day, date: new Date(date), altKm: targetAltKm });
        continue;
      }
    }

    // Decay for this day
    const decayKm = computeDailyDecayKm(latestDerived, alt);
    alt += decayKm; // decayKm is negative
  }

  // Hit maxYears without reentry — satellite still alive
  const finalDate = new Date(now + maxDays * 86400 * 1000);
  altHistory.push({ day: maxDays, date: finalDate, altKm: Math.max(100, alt) });
  return { lifetimeDays: maxDays, reentryDate: null, finalFuelKg: fuel, events, altHistory };
};

// ─── Lifetime Optimizer ───────────────────────────────────────────────────────
// Tries a grid of (triggerAlt, targetAlt) strategies, returns results sorted by
// lifetime descending. results[0] is the optimal strategy.
//
// Also returns the no-reboost baseline as the last element.
export const optimizeLifetime = (startAltKm, latestDerived, spacecraft, currentFuelKg) => {
  const results = [];

  // Baseline: no reboosts
  const baseline = simulateLifetime(startAltKm, latestDerived, spacecraft, currentFuelKg, {
    triggerAltKm: 0,
    targetAltKm:  startAltKm,
  });
  baseline.strategy = { triggerAltKm: 0, targetAltKm: startAltKm, label: 'No reboosts' };
  results.push(baseline);

  // Grid search: trigger altitude × target altitude
  const triggerPcts   = [0.90, 0.85, 0.80, 0.75, 0.70, 0.65, 0.60];
  const targetOffsets = [0, 5, 10, 20, 30, 40, 50]; // km above startAlt

  for (const pct of triggerPcts) {
    for (const offset of targetOffsets) {
      const triggerAltKm = Math.round(startAltKm * pct);
      const targetAltKm  = Math.round(startAltKm + offset);
      if (triggerAltKm >= targetAltKm) continue;

      const result = simulateLifetime(startAltKm, latestDerived, spacecraft, currentFuelKg, {
        triggerAltKm,
        targetAltKm,
      });
      result.strategy = { triggerAltKm, targetAltKm, label: `Trigger ${triggerAltKm}km → ${targetAltKm}km` };
      results.push(result);
    }
  }

  // Sort: longest lifetime first; treat "still alive at maxYears" as maxDays
  results.sort((a, b) => b.lifetimeDays - a.lifetimeDays);
  return results;
};

// ─── Date Formatting ──────────────────────────────────────────────────────────
export const fmtDate = (date) => {
  if (!date) return '—';
  const d = new Date(date);
  return d.toISOString().slice(0, 10);
};

export const fmtMonths = (days) => {
  if (!days || days <= 0) return '—';
  const months = days / 30.44;
  if (months < 24) return `${Math.round(months)} mo`;
  return `${(months / 12).toFixed(1)} yr`;
};
