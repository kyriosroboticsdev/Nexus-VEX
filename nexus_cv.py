#!/usr/bin/env python3
"""
Nexus CV Scorer — VEX Push Back Match Video Analyzer
=====================================================
Analyzes VEX Push Back match video (local file or YouTube VOD) and exports
scoring timeline + robot contribution data as JSON for import into Nexus.

INSTALL:
    pip install opencv-python numpy yt-dlp

USAGE:
    # Analyze a local video file
    python nexus_cv.py --video match.mp4 --red 1234A 5678B --blue 9012C 3456D

    # Download from YouTube and analyze
    python nexus_cv.py --youtube "https://youtube.com/watch?v=..." --red 1234A 5678B --blue 9012C 3456D

    # With debug window (shows detection overlay)
    python nexus_cv.py --video match.mp4 --red 1234A 5678B --blue 9012C 3456D --debug

    # Specify output file
    python nexus_cv.py --video match.mp4 --red 1234A 5678B --blue 9012C 3456D --output q5.json

PUSH BACK FIELD NOTES:
    - Field is 12x12 ft with red zone left, blue zone right (from standard stream angle)
    - Game elements: teal/green blocks (triballs replaced by Push Back blocks)
    - Alliance zones are visually distinct red/blue corner areas
    - Standard overhead stream shows full field from above-and-behind
"""

import cv2
import numpy as np
import json
import argparse
import os
import sys
import time
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Optional

# ─── PUSH BACK COLOR CALIBRATION ─────────────────────────────────────────────
# All ranges are HSV (Hue 0-179, Sat 0-255, Val 0-255)
# These are tuned for standard VEX event overhead lighting.
# Use --calibrate flag to tune for a specific stream.

COLOR_RANGES = {
    # Robot detection — robots wear colored bumpers/flags
    'red_robot':   [((0,   100, 80),  (10,  255, 255)),   # red wraps in HSV
                    ((165, 100, 80),  (179, 255, 255))],
    'blue_robot':  [((100, 100, 70),  (130, 255, 255))],

    # Push Back game elements — the blocks are a distinct teal/cyan color
    'block':       [((75,  80,  60),  (105, 255, 255))],   # teal/cyan blocks

    # Goal zones — elevated platforms at each end
    'red_zone':    [((0,   60,  60),  (15,  255, 200))],   # red field tiles
    'blue_zone':   [((100, 60,  60),  (130, 255, 200))],   # blue field tiles

    # Field boundary — white/light grey tape lines
    'field_line':  [((0,   0,   180), (179, 30,  255))],
}

# ─── CONFIGURATION ────────────────────────────────────────────────────────────
SAMPLE_INTERVAL_MS   = 1000   # analyze one frame per second
MIN_ROBOT_AREA       = 600    # minimum pixel area to count as a robot detection
MIN_BLOCK_AREA       = 80     # minimum pixel area for a block
CONTRIBUTION_RADIUS  = 150    # px — how close robot must be to claim block score
FIELD_MARGIN         = 0.05   # ignore outer 5% of frame (stream overlays/borders)
MATCH_DURATION_S     = 120    # VRC match is 2 minutes
AUTON_DURATION_S     = 15     # autonomous period

# Push Back scoring
POINTS_PER_BLOCK_IN_GOAL  = 5
POINTS_AUTON_WIN          = 8
POINTS_AUTON_TIE          = 4

# ─── DATA STRUCTURES ─────────────────────────────────────────────────────────
@dataclass
class RobotState:
    cx: int = 0
    cy: int = 0
    w: int = 0
    h: int = 0
    confidence: float = 0.0

@dataclass
class FrameData:
    timestamp_s: float
    red_score: int
    blue_score: int
    red_blocks_in_goal: int
    blue_blocks_in_goal: int
    red_robots: list = field(default_factory=list)   # [(cx,cy)]
    blue_robots: list = field(default_factory=list)
    period: str = 'driver'  # 'auton' or 'driver'

@dataclass
class RobotContribution:
    team_number: str
    alliance: str
    blocks_scored: int = 0
    blocks_near: int = 0      # times robot was near a block when it scored
    contribution_pct: float = 50.0
    avg_position: list = field(default_factory=lambda: [0, 0])

@dataclass
class MatchResult:
    source: str
    red_teams: list
    blue_teams: list
    duration_s: float
    final_red_score: int
    final_blue_score: int
    winner: str
    auton_winner: str
    robot_contributions: list
    timeline: list            # list of {t, red, blue} dicts
    field_bounds: dict        # detected field boundaries
    processing_info: dict

# ─── FIELD DETECTION ─────────────────────────────────────────────────────────

def detect_field_bounds(frame):
    """
    Detect the VEX field boundaries in the frame.
    Returns (x1, y1, x2, y2) crop bounds, or None if detection fails.
    The field is a large light-grey/white rectangle dominating the frame.
    """
    h, w = frame.shape[:2]
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    # Threshold for the light field surface
    _, thresh = cv2.threshold(gray, 140, 255, cv2.THRESH_BINARY)
    kernel = np.ones((15, 15), np.uint8)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)

    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    # Largest contour is the field
    largest = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(largest)

    # Field should occupy at least 25% of frame
    if area < (w * h * 0.25):
        return None

    x, y, fw, fh = cv2.boundingRect(largest)
    # Add small padding
    pad = 10
    return (max(0, x-pad), max(0, y-pad), min(w, x+fw+pad), min(h, y+fh+pad))


def crop_to_field(frame, bounds):
    """Crop frame to detected field bounds."""
    if bounds is None:
        return frame
    x1, y1, x2, y2 = bounds
    return frame[y1:y2, x1:x2]

# ─── COLOR DETECTION ─────────────────────────────────────────────────────────

def make_mask(hsv_frame, color_key):
    """Create a binary mask for a given color key."""
    ranges = COLOR_RANGES[color_key]
    mask = np.zeros(hsv_frame.shape[:2], dtype=np.uint8)
    for (lo, hi) in ranges:
        mask = cv2.bitwise_or(mask, cv2.inRange(hsv_frame, np.array(lo), np.array(hi)))
    # Clean up noise
    k = np.ones((5, 5), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k)
    return mask


def get_blobs(mask, min_area):
    """Return list of (cx, cy, w, h, area) for each blob above min_area."""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    blobs = []
    for c in contours:
        area = cv2.contourArea(c)
        if area < min_area:
            continue
        x, y, w, h = cv2.boundingRect(c)
        blobs.append((x + w//2, y + h//2, w, h, area))
    return sorted(blobs, key=lambda b: b[4], reverse=True)

# ─── SCORE ESTIMATION ────────────────────────────────────────────────────────

def estimate_goal_blocks(hsv_field, field_w, field_h):
    """
    Estimate blocks in red and blue goal zones.
    Push Back goals are at the far ends of the field — left=red, right=blue
    from standard stream overhead angle.
    Goal zones occupy roughly the outer 18% of field width.
    """
    zone_w = int(field_w * 0.18)
    block_mask = make_mask(hsv_field, 'block')

    # Red goal: left edge
    red_zone_mask = block_mask[:, :zone_w]
    # Blue goal: right edge
    blue_zone_mask = block_mask[:, field_w - zone_w:]

    def count_blocks_in_mask(m):
        blobs = get_blobs(m, MIN_BLOCK_AREA)
        return len(blobs)

    red_blocks  = count_blocks_in_mask(red_zone_mask)
    blue_blocks = count_blocks_in_mask(blue_zone_mask)
    return red_blocks, blue_blocks


def detect_robots(hsv_field):
    """
    Detect robot positions for both alliances.
    Returns (red_list, blue_list) each being [(cx, cy, w, h)] up to 2 robots.
    """
    red_mask  = make_mask(hsv_field, 'red_robot')
    blue_mask = make_mask(hsv_field, 'blue_robot')

    red_blobs  = get_blobs(red_mask,  MIN_ROBOT_AREA)[:2]
    blue_blobs = get_blobs(blue_mask, MIN_ROBOT_AREA)[:2]

    return (
        [(b[0], b[1], b[2], b[3]) for b in red_blobs],
        [(b[0], b[1], b[2], b[3]) for b in blue_blobs],
    )

# ─── CONTRIBUTION TRACKING ───────────────────────────────────────────────────

def attribute_score(robots, prev_blocks, curr_blocks, contributions, alliance_idx_offset):
    """
    When blocks in goal increases, attribute the new score to the nearest robot.
    alliance_idx_offset: 0 for red robots (indices 0,1), 2 for blue (indices 2,3)
    """
    new_blocks = curr_blocks - prev_blocks
    if new_blocks <= 0 or not robots:
        return

    # Find which robot is closest to the goal zone
    # Simple heuristic: robot with smallest x (red goal) or largest x (blue goal)
    for _ in range(new_blocks):
        if alliance_idx_offset == 0:  # red scores in left goal
            closest = min(range(len(robots)), key=lambda i: robots[i][0])
        else:  # blue scores in right goal
            closest = min(range(len(robots)), key=lambda i: -robots[i][0])

        robot_key = alliance_idx_offset + closest
        contributions[robot_key] = contributions.get(robot_key, 0) + 1


# ─── YOUTUBE DOWNLOAD ────────────────────────────────────────────────────────

def download_youtube(url, out_path='nexus_temp.mp4'):
    try:
        import yt_dlp
    except ImportError:
        print("ERROR: yt-dlp not installed. Run: pip install yt-dlp")
        sys.exit(1)

    print(f"Downloading: {url}")
    opts = {
        'format': 'best[height<=720][ext=mp4]/best[height<=720]/best',
        'outtmpl': out_path,
        'quiet': False,
        'no_warnings': True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        title = info.get('title', 'unknown')
        print(f"Downloaded: {title}")
    return out_path

# ─── MAIN ANALYSIS ───────────────────────────────────────────────────────────

def analyze(video_path, red_teams, blue_teams, debug=False, output_path=None):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps          = cap.get(cv2.CAP_PROP_FPS) or 30.0
    duration_s   = total_frames / fps
    frame_step   = max(1, int(fps * (SAMPLE_INTERVAL_MS / 1000.0)))

    print(f"\nVideo: {os.path.basename(video_path)}")
    print(f"  {total_frames} frames @ {fps:.1f}fps = {duration_s:.1f}s")
    print(f"  Sampling every {frame_step} frames (~{SAMPLE_INTERVAL_MS}ms)")
    print(f"  Red:  {' / '.join(red_teams)}")
    print(f"  Blue: {' / '.join(blue_teams)}")
    print()

    # State
    field_bounds    = None
    contributions   = {0: 0, 1: 0, 2: 0, 3: 0}  # robot_index -> blocks attributed
    timeline        = []
    prev_red_blocks = 0
    prev_blue_blocks= 0
    red_positions   = [[], []]   # per robot, list of (cx,cy)
    blue_positions  = [[], []]
    auton_winner    = 'tie'
    auton_checked   = False

    # Rolling window for temporal smoothing (reduces single-frame noise)
    SMOOTH_WINDOW = 3
    red_block_hist  = []
    blue_block_hist = []

    frame_num = 0
    processed = 0
    start_time = time.time()

    while frame_num < total_frames:
        # Seek directly to the target frame instead of reading every frame.
        # This is faster and avoids codec stalls that cause the video to freeze.
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)
        ret, frame = cap.read()
        if not ret:
            break

        timestamp_s = frame_num / fps
        period = 'auton' if timestamp_s < AUTON_DURATION_S else 'driver'

        # ── Field detection (run on first frame and every 5 seconds) ──
        if field_bounds is None or processed % 5 == 0:
            detected = detect_field_bounds(frame)
            if detected:
                field_bounds = detected

        field_frame = crop_to_field(frame, field_bounds)
        fh, fw = field_frame.shape[:2]
        hsv = cv2.cvtColor(field_frame, cv2.COLOR_BGR2HSV)

        # ── Detect robots ──
        red_bots, blue_bots = detect_robots(hsv)

        # Track positions for contribution analysis
        for i, bot in enumerate(red_bots[:2]):
            red_positions[i].append((bot[0], bot[1]))
        for i, bot in enumerate(blue_bots[:2]):
            blue_positions[i].append((bot[0], bot[1]))

        # ── Count blocks in goal zones (smoothed over last N frames) ──
        raw_red, raw_blue = estimate_goal_blocks(hsv, fw, fh)
        red_block_hist.append(raw_red)
        blue_block_hist.append(raw_blue)
        if len(red_block_hist)  > SMOOTH_WINDOW: red_block_hist.pop(0)
        if len(blue_block_hist) > SMOOTH_WINDOW: blue_block_hist.pop(0)
        # Use median of the window to suppress single-frame noise spikes
        red_blocks  = int(np.median(red_block_hist))
        blue_blocks = int(np.median(blue_block_hist))

        # ── Attribute new scores to robots ──
        if red_blocks > prev_red_blocks:
            attribute_score(red_bots, prev_red_blocks, red_blocks, contributions, 0)
        if blue_blocks > prev_blue_blocks:
            attribute_score(blue_bots, prev_blue_blocks, blue_blocks, contributions, 2)

        prev_red_blocks  = red_blocks
        prev_blue_blocks = blue_blocks

        # ── Auton winner check (at 15s mark) ──
        if not auton_checked and timestamp_s >= AUTON_DURATION_S:
            rs = red_blocks * POINTS_PER_BLOCK_IN_GOAL
            bs = blue_blocks * POINTS_PER_BLOCK_IN_GOAL
            auton_winner = 'red' if rs > bs else 'blue' if bs > rs else 'tie'
            auton_checked = True

        # ── Compute running scores ──
        red_score  = red_blocks  * POINTS_PER_BLOCK_IN_GOAL
        blue_score = blue_blocks * POINTS_PER_BLOCK_IN_GOAL
        # Add auton bonus to winner
        if auton_checked:
            if auton_winner == 'red':   red_score  += POINTS_AUTON_WIN
            elif auton_winner == 'blue': blue_score += POINTS_AUTON_WIN
            else: red_score += POINTS_AUTON_TIE; blue_score += POINTS_AUTON_TIE

        timeline.append({'t': round(timestamp_s, 1), 'red': red_score, 'blue': blue_score, 'period': period})

        # ── Debug window ──
        if debug:
            vis = field_frame.copy()
            for (cx, cy, w, h) in red_bots:
                cv2.rectangle(vis, (cx-w//2, cy-h//2), (cx+w//2, cy+h//2), (0, 0, 220), 3)
                cv2.putText(vis, 'R', (cx-8, cy+6), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)
            for (cx, cy, w, h) in blue_bots:
                cv2.rectangle(vis, (cx-w//2, cy-h//2), (cx+w//2, cy+h//2), (220, 0, 0), 3)
                cv2.putText(vis, 'B', (cx-8, cy+6), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 0, 0), 2)
            # Prominent score banner at the top
            banner = f"t={timestamp_s:.1f}s  |  RED: {red_score}  |  BLUE: {blue_score}  |  {period.upper()}"
            (bw, bh), _ = cv2.getTextSize(banner, cv2.FONT_HERSHEY_SIMPLEX, 0.85, 2)
            cv2.rectangle(vis, (0, 0), (bw + 16, bh + 16), (0, 0, 0), -1)
            cv2.putText(vis, banner, (8, bh + 6), cv2.FONT_HERSHEY_SIMPLEX, 0.85, (0, 255, 255), 2)
            # Raw vs smoothed block counts (bottom-left corner)
            detail = f"raw r={raw_red} b={raw_blue}  smooth r={red_blocks} b={blue_blocks}"
            cv2.rectangle(vis, (0, fh - 28), (len(detail) * 9 + 10, fh), (0, 0, 0), -1)
            cv2.putText(vis, detail, (6, fh - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (180, 255, 180), 1)
            cv2.imshow('Nexus CV Scorer — press Q to stop', vis)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                print("\nStopped by user.")
                break

        processed += 1
        if processed % 30 == 0:
            elapsed = time.time() - start_time
            pct = frame_num / max(total_frames, 1) * 100
            eta = (elapsed / max(processed, 1)) * ((total_frames - frame_num) / frame_step)
            print(f"  {pct:.0f}%  t={timestamp_s:.0f}s  RED:{red_score}  BLUE:{blue_score}  ETA:{eta:.0f}s")

        frame_num += frame_step

    cap.release()
    if debug:
        cv2.destroyAllWindows()

    # ── Final scores ──
    final = timeline[-1] if timeline else {'red': 0, 'blue': 0}
    final_red   = final['red']
    final_blue  = final['blue']
    winner = 'red' if final_red > final_blue else 'blue' if final_blue > final_red else 'tie'

    # ── Robot contribution percentages ──
    red_total  = contributions[0] + contributions[1]
    blue_total = contributions[2] + contributions[3]

    robot_contributions = []
    for i, team in enumerate(red_teams[:2]):
        pct = round(contributions[i] / max(red_total, 1) * 100, 1)
        avg_pos = list(np.mean(red_positions[i], axis=0).astype(int)) if red_positions[i] else [0,0]
        robot_contributions.append(asdict(RobotContribution(
            team_number=team, alliance='red',
            blocks_scored=contributions[i],
            blocks_near=contributions[i],
            contribution_pct=pct,
            avg_position=avg_pos
        )))
    for i, team in enumerate(blue_teams[:2]):
        pct = round(contributions[2+i] / max(blue_total, 1) * 100, 1)
        avg_pos = list(np.mean(blue_positions[i], axis=0).astype(int)) if blue_positions[i] else [0,0]
        robot_contributions.append(asdict(RobotContribution(
            team_number=team, alliance='blue',
            blocks_scored=contributions[2+i],
            blocks_near=contributions[2+i],
            contribution_pct=pct,
            avg_position=avg_pos
        )))

    result = MatchResult(
        source=os.path.basename(video_path),
        red_teams=red_teams,
        blue_teams=blue_teams,
        duration_s=round(duration_s, 1),
        final_red_score=final_red,
        final_blue_score=final_blue,
        winner=winner,
        auton_winner=auton_winner,
        robot_contributions=robot_contributions,
        timeline=timeline,
        field_bounds={'x1': field_bounds[0], 'y1': field_bounds[1], 'x2': field_bounds[2], 'y2': field_bounds[3]} if field_bounds else {},
        processing_info={
            'frames_processed': processed,
            'sample_interval_ms': SAMPLE_INTERVAL_MS,
            'fps': round(fps, 2),
            'processing_time_s': round(time.time() - start_time, 1),
        }
    )

    return asdict(result)

# ─── OUTPUT ──────────────────────────────────────────────────────────────────

def export_json(data, path):
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
    print(f"\nExported: {path}")
    print(f"  Final score — Red: {data['final_red_score']}  Blue: {data['final_blue_score']}")
    print(f"  Winner: {data['winner'].upper()}  |  Auton: {data['auton_winner'].upper()}")
    print(f"  Timeline points: {len(data['timeline'])}")
    print()
    print("Robot contributions:")
    for r in data['robot_contributions']:
        bar = '█' * int(r['contribution_pct'] / 5)
        print(f"  {r['team_number']:8s} ({r['alliance'].upper()})  {r['contribution_pct']:5.1f}%  {bar}")
    print()
    print("To import into Nexus:")
    print("  1. Open Nexus in your browser")
    print("  2. Navigate to the team analysis page")
    print("  3. Click 'Import CV Data' and select this file")

# ─── COLOR CALIBRATION HELPER ────────────────────────────────────────────────

def run_calibration(video_path):
    """
    Interactive HSV color picker. Click on robots/blocks in the frame
    to see their HSV values and tune COLOR_RANGES for your stream.
    Left/Right arrow keys (or A/D) jump 5 seconds. Press S to save frame, Q to quit.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print("Could not open video for calibration")
        return

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    pos = 0

    def load_frame(p):
        cap.set(cv2.CAP_PROP_POS_FRAMES, p)
        ok, f = cap.read()
        return (f, cv2.cvtColor(f, cv2.COLOR_BGR2HSV)) if ok else (None, None)

    frame, hsv = load_frame(0)
    if frame is None:
        print("Could not read frame for calibration")
        cap.release()
        return

    win = 'Nexus Calibration — arrows/AD to navigate, S to save, Q to quit'

    def on_mouse(event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN and hsv is not None:
            h, s, v = hsv[y, x]
            b, g, r = frame[y, x]
            t = pos / fps
            print(f"  t={t:.1f}s  Pixel ({x},{y}): HSV=({h},{s},{v})  BGR=({b},{g},{r})")

    cv2.namedWindow(win)
    cv2.setMouseCallback(win, on_mouse)
    print("Calibration mode: click pixels to print HSV values.")
    print("  Arrow keys / A-D: jump ±5 seconds    S: save frame    Q: quit")
    print(f"  Video: {total_frames} frames @ {fps:.1f}fps")

    jump = int(fps * 5)
    while True:
        if frame is not None:
            display = frame.copy()
            t = pos / fps
            label = f"t={t:.1f}s  frame {pos}/{total_frames}  (arrows to navigate)"
            cv2.rectangle(display, (0, 0), (len(label) * 9 + 10, 30), (0, 0, 0), -1)
            cv2.putText(display, label, (6, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 1)
            cv2.imshow(win, display)

        key = cv2.waitKey(20) & 0xFF
        if key == ord('q'):
            break
        if key == ord('s') and frame is not None:
            out = f'nexus_calibration_{pos}.png'
            cv2.imwrite(out, frame)
            print(f"Saved: {out}")
        if key in (83, ord('d')):   # right arrow or D — forward 5 s
            pos = min(pos + jump, total_frames - 1)
            frame, hsv = load_frame(pos)
        if key in (81, ord('a')):   # left arrow or A — back 5 s
            pos = max(pos - jump, 0)
            frame, hsv = load_frame(pos)

    cap.release()
    cv2.destroyAllWindows()

# ─── CLI ─────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(
        description='Nexus CV Scorer — VEX Push Back video analysis',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python nexus_cv.py --video Q5.mp4 --red 1234A 5678B --blue 9012C 3456D
  python nexus_cv.py --youtube "https://youtube.com/watch?v=..." --red 1234A 5678B --blue 9012C 3456D
  python nexus_cv.py --video Q5.mp4 --red 1234A 5678B --blue 9012C 3456D --debug
  python nexus_cv.py --video Q5.mp4 --calibrate   (tune colors for your stream)
        """
    )
    p.add_argument('--video',     help='Path to local video file')
    p.add_argument('--youtube',   help='YouTube URL to download and analyze')
    p.add_argument('--red',       nargs='+', default=['RED-1','RED-2'], metavar='TEAM')
    p.add_argument('--blue',      nargs='+', default=['BLUE-1','BLUE-2'], metavar='TEAM')
    p.add_argument('--output',    default=None, help='Output JSON path (default: auto-named)')
    p.add_argument('--debug',     action='store_true', help='Show live detection window')
    p.add_argument('--calibrate', action='store_true', help='Interactive HSV calibration mode')
    p.add_argument('--interval',  type=int, default=1000, help='Sample interval in ms (default: 1000)')
    args = p.parse_args()

    if not args.video and not args.youtube:
        p.print_help()
        sys.exit(1)

    global SAMPLE_INTERVAL_MS
    SAMPLE_INTERVAL_MS = args.interval

    video_path = args.video
    temp_file  = None

    if args.youtube:
        temp_file  = 'nexus_temp_video.mp4'
        video_path = download_youtube(args.youtube, temp_file)

    if args.calibrate:
        run_calibration(video_path)
        sys.exit(0)

    # Auto-name output
    if args.output is None:
        base = Path(video_path).stem
        args.output = f'nexus_{base}.json'

    try:
        result = analyze(video_path, args.red[:2], args.blue[:2], debug=args.debug)
        export_json(result, args.output)
    finally:
        if temp_file and os.path.exists(temp_file):
            os.remove(temp_file)
            print(f"Cleaned up temp file: {temp_file}")

if __name__ == '__main__':
    main()
