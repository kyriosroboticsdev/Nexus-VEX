"""
Nexus RL Training Environment
==============================
A standalone Python replica of the Nexus simulator physics, wrapped as a
gymnasium.Env so any RL library (stable-baselines3, cleanRL, etc.) can train
against it without needing the Electron app running.

The physics constants are kept 1-to-1 with simulator.js so trained weights
transfer directly back to the JS sim via ONNX export.

Usage (install deps first):
    pip install gymnasium stable-baselines3 onnx torch

Train:
    python nexus_rl_env.py --train --steps 2_000_000 --out nexus_bot.zip

Export to ONNX (so JS can load it at runtime):
    python nexus_rl_env.py --export nexus_bot.zip --onnx nexus_bot.onnx

Analyze a session recorded by Nexus:
    python nexus_rl_env.py --analyze sessions/session_<id>_driver.json
"""

import argparse, json, math, random, time
import numpy as np

# ── Physics constants (mirror simulator.js exactly) ───────────────────────────
FIELD_IN    = 144.0
TICK_DT     = 0.016        # 16ms fixed step
DRIVE_SPEED = 200 * math.pi * 3.25 / 60   # ~34 in/s (200rpm, 3.25" wheel)
TRACK_WIDTH = 12.0
TURN_RATE   = (DRIVE_SPEED * 2 / TRACK_WIDTH) * (180 / math.pi)
DRIVE_TAU   = 0.10
COAST_TAU   = 0.20
TURN_TAU    = 0.09
COAST_TURN  = 0.17
MATCH_DUR   = 105.0        # driver period

OBS_DIM  = 15   # must match simGetObservation() in simulator.js
ACT_DIM  = 2    # [leftV, rightV] each in [-1, 1]

# ── Lightweight robot dataclass ───────────────────────────────────────────────
class Robot:
    def __init__(self, x, y, angle):
        self.x = x; self.y = y; self.angle = angle
        self.vx = 0.0; self.vy = 0.0; self.omega = 0.0

    def apply_action(self, left_v, right_v):
        rad        = math.radians(self.angle)
        fwd_speed  = (left_v + right_v) / 2 * DRIVE_SPEED
        turn_degs  = (right_v - left_v) / TRACK_WIDTH * DRIVE_SPEED * (180 / math.pi)
        tvx = math.sin(rad) * fwd_speed
        tvy = -math.cos(rad) * fwd_speed

        lin_alpha  = TICK_DT / (DRIVE_TAU  if abs(fwd_speed) > 0.1 else COAST_TAU)
        turn_alpha = TICK_DT / (TURN_TAU   if abs(turn_degs) > 0.1 else COAST_TURN)
        self.vx    += (tvx      - self.vx)    * lin_alpha
        self.vy    += (tvy      - self.vy)    * lin_alpha
        self.omega += (turn_degs - self.omega) * turn_alpha

        spd = math.hypot(self.vx, self.vy)
        if spd > DRIVE_SPEED:
            self.vx *= DRIVE_SPEED / spd; self.vy *= DRIVE_SPEED / spd

        hw = 8.0
        cosA = abs(math.cos(math.radians(self.angle)))
        sinA = abs(math.sin(math.radians(self.angle)))
        hx = hw * cosA + hw * sinA; hy = hw * sinA + hw * cosA

        nx = self.x + self.vx * TICK_DT
        ny = self.y + self.vy * TICK_DT
        if nx < hx or nx > FIELD_IN - hx:
            self.vx = 0; nx = max(hx, min(FIELD_IN - hx, nx))
        if ny < hy or ny > FIELD_IN - hy:
            self.vy = 0; ny = max(hy, min(FIELD_IN - hy, ny))
        self.x = nx; self.y = ny
        self.angle += self.omega * TICK_DT

    def wander(self, target_x, target_y):
        """Replicate tickAIRobot() wander logic for the player stand-in."""
        dx = target_x - self.x; dy = target_y - self.y
        dist = math.hypot(dx, dy)
        desired = math.degrees(math.atan2(dx, -dy))
        diff = ((desired - self.angle + 180) % 360) - 180
        facing = abs(diff) < 50
        speed  = min(dist / 30, 1) * DRIVE_SPEED * (0.75 if facing else 0.2)
        turn   = max(-1, min(1, diff / 40))
        rad = math.radians(self.angle)
        self.apply_action((speed / DRIVE_SPEED) - turn * 0.5,
                          (speed / DRIVE_SPEED) + turn * 0.5)


# ── Gymnasium environment ─────────────────────────────────────────────────────
try:
    import gymnasium as gym
    from gymnasium import spaces

    class NexusDriverEnv(gym.Env):
        """
        One RL agent controls a single opponent robot (red team).
        The player robot wanders toward randomly chosen targets to simulate
        a human driver at varying skill levels.

        Reward shaping (tunable via reward_weights):
          +score_diff   — opponent score minus player score
          +ball_pickup  — each time the bot passes near an unscored ball
          -wall_time    — penalty for hugging walls (encourage active play)
          +pressure     — reward for being close to the player (defensive)
        """
        metadata = {'render_modes': []}

        def __init__(self, difficulty=1.0, reward_weights=None):
            super().__init__()
            self.difficulty = difficulty   # 0.0=easy (slow player), 1.0=full speed
            self.rw = reward_weights or {
                'score': 2.0, 'ball': 0.3, 'wall': -0.005, 'pressure': 0.1
            }
            self.observation_space = spaces.Box(-1.0, 1.0, shape=(OBS_DIM,), dtype=np.float32)
            self.action_space      = spaces.Box(-1.0, 1.0, shape=(ACT_DIM,), dtype=np.float32)
            self._reset_state()

        def _reset_state(self):
            hw = 8.5
            # Player starts at blue corner (like the JS sim)
            self.player = Robot(hw + 10, FIELD_IN - hw - 10, 180)
            # Opponent starts at red corner
            self.agent  = Robot(FIELD_IN - hw - 10, hw + 10, 0)
            self.elapsed  = 0.0
            self.balls    = self._spawn_balls()
            self.p_score  = 0; self.a_score  = 0
            self.p_target = self._random_target('blue')
            self.p_stall  = 0.0
            self._prev_a_score = 0; self._prev_p_score = 0

        def _spawn_balls(self):
            balls = []
            for fy in [20, 36, 56, 88, 108, 124]:
                for fx in [24, 48, 72, 96, 120]:
                    balls.append([float(fx), float(fy), False])  # [x, y, scored]
            return balls

        def _random_target(self, side):
            mg = 18
            x = random.uniform(mg, FIELD_IN - mg)
            if side == 'blue':
                y = random.uniform(FIELD_IN / 2 + mg, FIELD_IN - mg)
            else:
                y = random.uniform(mg, FIELD_IN / 2 - mg)
            return (x, y)

        def _calc_score(self):
            p = sum(1 for b in self.balls if not b[2] and b[1] < FIELD_IN / 2)
            a = sum(1 for b in self.balls if not b[2] and b[1] >= FIELD_IN / 2)
            return p, a

        def _observe(self):
            p = self.player; ai = self.agent; F = FIELD_IN
            unscored = [b for b in self.balls if not b[2]]
            unscored.sort(key=lambda b: (b[0]-ai.x)**2 + (b[1]-ai.y)**2)
            b1 = unscored[0] if unscored     else [0, 0, False]
            b2 = unscored[1] if len(unscored)>1 else [0, 0, False]
            arad = math.radians(ai.angle)
            return np.array([
                ai.x / F,                    ai.y / F,
                math.sin(arad),              math.cos(arad),
                ai.vx / DRIVE_SPEED,         ai.vy / DRIVE_SPEED,
                (p.x - ai.x) / F,           (p.y - ai.y) / F,
                p.vx / DRIVE_SPEED,          p.vy / DRIVE_SPEED,
                (b1[0] - ai.x) / F,          (b1[1] - ai.y) / F,
                (b2[0] - ai.x) / F,          (b2[1] - ai.y) / F,
                (MATCH_DUR - self.elapsed) / MATCH_DUR,
            ], dtype=np.float32)

        def reset(self, *, seed=None, options=None):
            super().reset(seed=seed)
            self._reset_state()
            return self._observe(), {}

        def step(self, action):
            left_v, right_v = float(action[0]), float(action[1])

            # Player wander (scaled by difficulty)
            spd = math.hypot(self.player.vx, self.player.vy)
            self.p_stall += TICK_DT
            tx, ty = self.p_target
            if math.hypot(tx - self.player.x, ty - self.player.y) < 15 or \
               (self.p_stall > 1.5 and spd < 2):
                self.p_target = self._random_target('blue')
                self.p_stall  = 0.0
            # Scale player speed by difficulty (0=half speed, 1=full)
            eff_speed = 0.5 + 0.5 * self.difficulty
            px, py = self.p_target
            dx = px - self.player.x; dy = py - self.player.y
            dist = math.hypot(dx, dy)
            desired = math.degrees(math.atan2(dx, -dy))
            diff = ((desired - self.player.angle + 180) % 360) - 180
            facing = abs(diff) < 50
            fwd = min(dist / 30, 1) * eff_speed * (0.75 if facing else 0.2)
            turn = max(-1, min(1, diff / 40))
            self.player.apply_action(fwd - turn * 0.5, fwd + turn * 0.5)

            # Agent step
            self.agent.apply_action(left_v, right_v)
            self.elapsed += TICK_DT

            self.p_score, self.a_score = self._calc_score()

            # Reward
            score_delta = (self.a_score - self._prev_a_score) - \
                          (self.p_score - self._prev_p_score)
            self._prev_a_score = self.a_score
            self._prev_p_score = self.p_score

            wall_pen   = 1.0 if (self.agent.x < 12 or self.agent.x > FIELD_IN-12 or
                                  self.agent.y < 12 or self.agent.y > FIELD_IN-12) else 0.0
            pressure   = max(0, 1 - math.hypot(self.agent.x - self.player.x,
                                                self.agent.y - self.player.y) / 60)
            reward = (self.rw['score']    * score_delta
                    + self.rw['wall']     * wall_pen
                    + self.rw['pressure'] * pressure)

            done      = self.elapsed >= MATCH_DUR
            truncated = False
            return self._observe(), reward, done, truncated, {}

except ImportError:
    NexusDriverEnv = None


# ── Session analyzer ──────────────────────────────────────────────────────────
def analyze_session(path_to_json: str):
    with open(path_to_json) as f:
        session = json.load(f)

    frames = session['frames']
    if not frames:
        print('Empty session.'); return

    print(f"\n{'─'*50}")
    print(f"Session  : {session['date']}  ({session['mode']} mode)")
    print(f"Duration : {frames[-1]['t']:.1f}s  ({len(frames)} frames @ ~10fps)")
    print(f"{'─'*50}")

    px = [f['p']['x'] for f in frames]
    py = [f['p']['y'] for f in frames]
    pvx= [f['p']['vx'] for f in frames]
    pvy= [f['p']['vy'] for f in frames]
    speeds = [math.hypot(vx, vy) for vx, vy in zip(pvx, pvy)]

    # Field coverage: divide field into 6x6 grid, count visits
    grid = [[0]*6 for _ in range(6)]
    for x, y in zip(px, py):
        gx = min(5, int(x / FIELD_IN * 6))
        gy = min(5, int(y / FIELD_IN * 6))
        grid[gy][gx] += 1
    total = sum(sum(row) for row in grid)

    print("\nField Coverage (% of time in each zone):")
    print("  ← RED SIDE →          ← BLUE SIDE →")
    for row in reversed(grid):
        bar = '  '.join(f'{v/total*100:4.1f}%' for v in row)
        print(f"  {bar}")

    avg_speed  = sum(speeds) / len(speeds)
    max_speed  = max(speeds)
    time_red   = sum(1 for y in py if y < FIELD_IN / 2) / len(py) * 100
    time_blue  = 100 - time_red

    print(f"\nMovement Stats:")
    print(f"  Avg speed   : {avg_speed:.1f} in/s  (max: {max_speed:.1f})")
    print(f"  Time red half  : {time_red:.0f}%   Time blue half : {time_blue:.0f}%")

    # Identify dead zones (quadrants where driver spends <5% of time)
    dead = []
    labels = [('bottom-left','BR'), ('bottom-right','BR'), ('top-left','BL'), ('top-right','TR')]
    quads = [0, 0, 0, 0]
    for x, y in zip(px, py):
        q = (1 if x > FIELD_IN/2 else 0) + (2 if y > FIELD_IN/2 else 0)
        quads[q] += 1
    for i, (name, _) in enumerate([('bottom-left',''), ('bottom-right',''),
                                     ('top-left',''), ('top-right','')]):
        pct = quads[i] / len(px) * 100
        if pct < 8:
            dead.append(f'{name} ({pct:.0f}%)')

    if dead:
        print(f"\n⚠  Underused zones: {', '.join(dead)}")
        print("   The ML opponent will learn to exploit these areas.")
    else:
        print("\n✓  Field coverage is well-balanced.")

    # Final score
    last = frames[-1]
    print(f"\nFinal score — You: {last['sc']['player']}  AI: {last['sc']['opponent']}")
    print(f"{'─'*50}\n")


# ── CLI entrypoint ────────────────────────────────────────────────────────────
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Nexus RL trainer / analyzer')
    parser.add_argument('--train',   action='store_true', help='Train a new model')
    parser.add_argument('--steps',   type=int, default=2_000_000)
    parser.add_argument('--difficulty', type=float, default=0.7,
                        help='Player difficulty 0.0–1.0 (default 0.7)')
    parser.add_argument('--out',     default='nexus_bot.zip', help='Output model path')
    parser.add_argument('--export',  default='', help='Existing .zip to export as ONNX')
    parser.add_argument('--onnx',    default='nexus_bot.onnx')
    parser.add_argument('--analyze', default='', help='Path to a session JSON file')
    args = parser.parse_args()

    if args.analyze:
        analyze_session(args.analyze)

    elif args.train:
        if NexusDriverEnv is None:
            print("Install deps first:  pip install gymnasium stable-baselines3")
            exit(1)
        from stable_baselines3 import PPO
        from stable_baselines3.common.env_util import make_vec_env

        print(f"Training for {args.steps:,} steps at difficulty={args.difficulty}…")
        env = make_vec_env(lambda: NexusDriverEnv(difficulty=args.difficulty), n_envs=8)
        model = PPO('MlpPolicy', env, verbose=1,
                    n_steps=2048, batch_size=256, n_epochs=10,
                    learning_rate=3e-4, ent_coef=0.01,
                    policy_kwargs=dict(net_arch=[256, 256]))
        model.learn(total_timesteps=args.steps, progress_bar=True)
        model.save(args.out)
        print(f"Saved → {args.out}")

    elif args.export:
        try:
            import torch
            from stable_baselines3 import PPO
        except ImportError:
            print("Install:  pip install torch stable-baselines3"); exit(1)

        model = PPO.load(args.export)
        obs_t = torch.zeros(1, OBS_DIM)
        # Export only the policy (actor) network
        torch.onnx.export(
            model.policy,
            (obs_t,),
            args.onnx,
            input_names=['obs'],
            output_names=['action', 'value', 'log_prob'],
            opset_version=17,
            dynamic_axes={'obs': {0: 'batch'}},
        )
        print(f"Exported ONNX → {args.onnx}  (load this in the Nexus sim)")
