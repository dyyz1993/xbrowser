/**
 * Rule: Mouse Trajectory Analysis
 *
 * Detects automated mouse interactions by analyzing mouse movement patterns.
 * Natural human mouse movements exhibit acceleration curves, jitter, and
 * non-linear paths. Automated movements are often perfect straight lines
 * with constant speed.
 *
 * Detection heuristics:
 *   1. **Collinearity**: Path from A→B lies on a near-perfect straight line
 *      (very low residuals from linear regression)
 *   2. **Constant velocity**: Speed between consecutive move events is too uniform
 *   3. **No jitter**: Human hands have micro-tremors (1-3px variation)
 *
 * Stateful: tracks mouse positions per CDP session to analyze trajectories.
 */

import type { CDPInterceptorRule, RuleContext, DecisionResult } from '../types.js';

/** A single mouse position sample */
interface MouseSample {
  x: number;
  y: number;
  timestamp: number;
  /** Cumulative distance from start of this trajectory */
  distanceTraveled: number;
}

/** Per-session tracking state */
interface MouseTracker {
  /** Recent mouse position samples */
  samples: MouseSample[];
  /** Timestamp of last mouse down event */
  lastMouseDownAt: number;
  /** Whether a drag operation is in progress */
  isDragging: boolean;
}

const TRACKER_KEY = 'mouse-trajectory-tracker';
const MAX_SAMPLES = 200; // keep last N samples per session
const MIN_SAMPLES_FOR_ANALYSIS = 5;

export const mouseTrajectoryRule: CDPInterceptorRule = {
  id: 'mouse-trajectory',
  name: 'Mouse Trajectory Analysis',
  priority: 20,

  canHandle(ctx: RuleContext): boolean {
    return ctx.method === 'Input.dispatchMouseEvent';
  },

  evaluate(ctx: RuleContext): DecisionResult | null {
    const type = ctx.params.type as string | undefined;
    const x = ctx.params.x as number | undefined;
    const y = ctx.params.y as number | undefined;

    if (typeof x !== 'number' || typeof y !== 'number') return null;

    // Initialize or get tracker
    let tracker = ctx.sessionState.get(TRACKER_KEY) as MouseTracker | undefined;
    if (!tracker) {
      tracker = { samples: [], lastMouseDownAt: 0, isDragging: false };
      ctx.sessionState.set(TRACKER_KEY, tracker);
    }

    // Track drag state
    if (type === 'mousePressed') {
      // Analyze any accumulated trajectory before the click
      const priorResult = analyzeTrajectory(tracker.samples);
      tracker.lastMouseDownAt = Date.now();
      tracker.isDragging = true;
      tracker.samples = [];
      return priorResult;
    }
    if (type === 'mouseReleased') {
      tracker.isDragging = false;
      // Analyze the completed drag trajectory
      const result = analyzeTrajectory(tracker.samples);
      tracker.samples = [];
      return result;
    }

    if (type === 'mouseMoved') {
      const now = Date.now();
      const prevSample = tracker.samples[tracker.samples.length - 1];
      const distanceTraveled = prevSample
        ? prevSample.distanceTraveled + distance(prevSample.x, prevSample.y, x, y)
        : 0;

      const sample: MouseSample = { x, y, timestamp: now, distanceTraveled };
      tracker.samples.push(sample);

      if (tracker.samples.length > MAX_SAMPLES) {
        tracker.samples.shift();
      }

      // Don't analyze mid-trajectory — wait for completion
      return null;
    }

    // For isolated clicks (mousePressed + mouseReleased without moves),
    // the samples array will be empty — no trajectory to analyze
    if (type === 'mouseReleased' && tracker.samples.length < MIN_SAMPLES_FOR_ANALYSIS) {
      tracker.samples = [];
      return null;
    }

    return null;
  },
};

function analyzeTrajectory(samples: MouseSample[]): DecisionResult | null {
  if (samples.length < MIN_SAMPLES_FOR_ANALYSIS) return null;

  const issues: string[] = [];
  const startX = samples[0].x;
  const startY = samples[0].y;
  const endX = samples[samples.length - 1].x;
  const endY = samples[samples.length - 1].y;

  // ── Check 1: Collinearity ──────────────────────────────────
  // Fit a line from start to end, measure max deviation of all points
  const lineLength = distance(startX, startY, endX, endY);
  const collinearityResult = checkCollinearity(samples, startX, startY, endX, endY, lineLength);

  if (collinearityResult) {
    issues.push(collinearityResult);
  }

  // ── Check 2: Constant velocity ─────────────────────────────
  const velocityResult = checkConstantVelocity(samples);
  if (velocityResult) {
    issues.push(velocityResult);
  }

  // ── Check 3: No jitter ─────────────────────────────────────
  const jitterResult = checkJitter(samples);
  if (jitterResult) {
    issues.push(jitterResult);
  }

  if (issues.length === 0) return null;

  const stopX = samples[samples.length - 1].x;
  const stopY = samples[samples.length - 1].y;

  return {
    ruleId: 'mouse-trajectory',
    action: 'pass',
    severity: 'danger',
    reason: `Suspicious mouse trajectory: ${issues.join('; ')}`,
    suggestion: `This mouse movement appears automated (straight line A→B, no natural variation).
  Use a humanized mouse API that generates:
  - Bezier curves instead of straight lines
  - Random acceleration/deceleration
  - 1-3px micro-jitter per sample

  Example: The 'faker' or 'ghost-cursor' libraries generate realistic mouse paths.
  Target was: (${Math.round(startX)}, ${Math.round(startY)}) → (${Math.round(stopX)}, ${Math.round(stopY)})`,
    errorCode: -32002,
    errorMessage: '[CDP Firewall] Automated mouse trajectory blocked — appears non-human',
  };
}

// ── Analysis helpers ────────────────────────────────────────

/** Euclidean distance between two points */
function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

/**
 * Check if all points lie on a near-perfect straight line.
 * Uses point-to-line distance. If max deviation < 1.5px, it's suspicious.
 */
function checkCollinearity(
  samples: MouseSample[],
  x1: number, y1: number,
  x2: number, y2: number,
  lineLength: number,
): string | null {
  if (lineLength < 5) return null; // too short to matter

  let maxDeviation = 0;
  // Line direction and normal
  const dx = x2 - x1;
  const dy = y2 - y1;

  for (let i = 1; i < samples.length - 1; i++) {
    const { x, y } = samples[i];
    // Cross product gives perpendicular distance × line length
    const cross = Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1);
    const dev = cross / lineLength;
    if (dev > maxDeviation) maxDeviation = dev;
  }

  // If max deviation is less than 1.5px AND line is long enough (>20px)
  // this is almost certainly automated
  if (maxDeviation < 1.5 && lineLength > 20) {
    return `Perfectly straight line (max deviation ${maxDeviation.toFixed(1)}px over ${lineLength.toFixed(0)}px)`;
  }
  if (maxDeviation < 0.5 && lineLength > 10) {
    return `Near-perfect straight line (max deviation ${maxDeviation.toFixed(1)}px)`;
  }
  return null;
}

/**
 * Check if speed between consecutive points is suspiciously uniform.
 * Human motion has natural speed variation; automated moves often use
 * constant step intervals.
 */
function checkConstantVelocity(samples: MouseSample[]): string | null {
  if (samples.length < 3) return null;

  const speeds: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const d = distance(
      samples[i - 1].x, samples[i - 1].y,
      samples[i].x, samples[i].y,
    );
    const dt = samples[i].timestamp - samples[i - 1].timestamp;
    if (dt > 0) speeds.push(d / dt);
  }

  if (speeds.length < 2) return null;

  // Compute coefficient of variation (stddev / mean)
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  if (mean === 0) return null;

  const variance = speeds.reduce((sum, v) => sum + (v - mean) ** 2, 0) / speeds.length;
  const stddev = Math.sqrt(variance);
  const cv = stddev / mean;

  // CV < 0.05 means velocity is unnaturally uniform
  if (cv < 0.05) {
    return `Constant velocity (CV=${cv.toFixed(3)}, mean=${mean.toFixed(1)} px/ms)`;
  }
  return null;
}

/**
 * Check for micro-jitter: human hands have involuntary 1-3px tremors.
 * If every point lies exactly on the regression line with no lateral
 * variation at all, it's robotic.
 */
function checkJitter(samples: MouseSample[]): string | null {
  if (samples.length < 4) return null;

  // Check if consecutive points show ANY lateral variation
  let totalLateralChange = 0;
  for (let i = 1; i < samples.length; i++) {
    const d = distance(
      samples[i - 1].x, samples[i - 1].y,
      samples[i].x, samples[i].y,
    );
    totalLateralChange += d;
  }

  const avgLateral = totalLateralChange / (samples.length - 1);
  // Average move step < 0.3px — no human can move this precisely
  if (avgLateral < 0.3) {
    return 'No micro-jitter (sub-pixel precision, impossible for human)';
  }
  return null;
}
