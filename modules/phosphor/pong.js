/**
 * PHOSPONG line router.
 * The playable program is text recalled from the injector. This host only
 * steps the opcodes in that text. It does not embed a second copy of the match.
 */

export function parsePhosphong(source) {
  const text = String(source || "").replace(/^\uFEFF/, "");
  const rawLines = text.split(/\r?\n/);
  const lines = rawLines.map((textLine, index) => ({
    i: index,
    text: textLine,
    op: textLine.trim(),
  }));
  const code = lines.filter((line) => line.op && !line.op.startsWith(";"));
  if (!code.length || code[0].op !== "PHOSPONG/1") {
    throw new Error("phosphong program required");
  }
  const spec = {
    court: [320, 180],
    paddle: [8, 36],
    ball: 4,
    speed: 120,
    goal: 5,
    ticks: [],
  };
  for (const line of code.slice(1)) {
    const parts = line.op.split(/\s+/);
    const head = parts[0];
    if (head === "court") spec.court = [Number(parts[1]), Number(parts[2])];
    else if (head === "paddle") spec.paddle = [Number(parts[1]), Number(parts[2])];
    else if (head === "ball") spec.ball = Number(parts[1]);
    else if (head === "speed") spec.speed = Number(parts[1]);
    else if (head === "goal") spec.goal = Number(parts[1]);
    else if (head === "tick") spec.ticks.push({ line: line.i, op: parts[1] || "" });
    else throw new Error("unknown phosphong op " + head);
  }
  if (!spec.ticks.length) throw new Error("phosphong tick routes required");
  if (!(spec.court[0] > 16) || !(spec.court[1] > 16)) throw new Error("phosphong court required");
  return { lines, spec };
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

export function createMatch(source) {
  const program = parsePhosphong(source);
  const [w, h] = program.spec.court;
  const speed = program.spec.speed;
  return {
    program,
    w,
    h,
    paddleW: program.spec.paddle[0],
    paddleH: program.spec.paddle[1],
    ballR: program.spec.ball,
    speed,
    goal: program.spec.goal,
    leftY: h / 2,
    rightY: h / 2,
    ballX: w / 2,
    ballY: h / 2,
    vx: speed,
    vy: speed * 0.35,
    scoreL: 0,
    scoreR: 0,
    over: false,
    routeIndex: program.spec.ticks[0].line,
    keys: { up: false, down: false },
  };
}

function resetBall(match, dir) {
  match.ballX = match.w / 2;
  match.ballY = match.h / 2;
  match.vx = match.speed * dir;
  const sign = (match.scoreL + match.scoreR) % 2 === 0 ? 1 : -1;
  match.vy = match.speed * 0.35 * sign;
}

function nudgePaddle(match, which, target, rate, dt) {
  const key = which === "left" ? "leftY" : "rightY";
  const delta = clamp(target - match[key], -match.speed * rate * dt, match.speed * rate * dt);
  match[key] = clamp(match[key] + delta, match.paddleH / 2, match.h - match.paddleH / 2);
}

function runTick(match, op, dt) {
  if (op === "input") {
    if (match.keys.up) nudgePaddle(match, "left", match.leftY - match.speed, 0.9, dt);
    else if (match.keys.down) nudgePaddle(match, "left", match.leftY + match.speed, 0.9, dt);
    else nudgePaddle(match, "left", match.ballY, 0.55, dt);
    return;
  }
  if (op === "ai") {
    nudgePaddle(match, "right", match.ballY, 0.72, dt);
    return;
  }
  if (op === "move") {
    match.ballX += match.vx * dt;
    match.ballY += match.vy * dt;
    return;
  }
  if (op === "walls") {
    if (match.ballY < match.ballR) {
      match.ballY = match.ballR;
      match.vy = Math.abs(match.vy);
    }
    if (match.ballY > match.h - match.ballR) {
      match.ballY = match.h - match.ballR;
      match.vy = -Math.abs(match.vy);
    }
    return;
  }
  if (op === "paddle") {
    const overlapY = (y) => Math.abs(match.ballY - y) <= match.paddleH / 2 + match.ballR;
    const leftFace = 16 + match.paddleW;
    if (match.vx < 0 && overlapY(match.leftY) && match.ballX - match.ballR <= leftFace && match.ballX >= 16) {
      match.ballX = leftFace + match.ballR;
      match.vx = Math.abs(match.speed);
      match.vy = ((match.ballY - match.leftY) / (match.paddleH / 2)) * match.speed;
    }
    const rightFace = match.w - 16 - match.paddleW;
    if (match.vx > 0 && overlapY(match.rightY) && match.ballX + match.ballR >= rightFace && match.ballX <= match.w - 16) {
      match.ballX = rightFace - match.ballR;
      match.vx = -Math.abs(match.speed);
      match.vy = ((match.ballY - match.rightY) / (match.paddleH / 2)) * match.speed;
    }
    return;
  }
  if (op === "score") {
    if (match.ballX < -match.ballR) {
      match.scoreR += 1;
      resetBall(match, -1);
    } else if (match.ballX > match.w + match.ballR) {
      match.scoreL += 1;
      resetBall(match, 1);
    }
    if (match.scoreL >= match.goal || match.scoreR >= match.goal) match.over = true;
    return;
  }
  if (op === "draw") return;
  throw new Error("unknown phosphong tick " + op);
}

/** Run one frame of the recalled route list. Returns the source line now active. */
export function stepMatch(match, dt) {
  const frame = Math.max(0, Math.min(Number(dt) || 0, 0.05));
  const ticks = match.program.spec.ticks;
  for (const tick of ticks) {
    match.routeIndex = tick.line;
    runTick(match, tick.op, frame);
    if (match.over) break;
  }
  return match.routeIndex;
}
