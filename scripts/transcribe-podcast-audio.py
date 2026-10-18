"""Transcribe an explicit public publisher-audio inventory for manual review.

Install faster-whisper and numpy; ffmpeg must be on PATH. Example:
  python scripts/transcribe-podcast-audio.py --inventory inventory.json --output /tmp/nfl-audio-review
Inventory: array (or {episodes:[...]}) with id, audioUrl, title, sourceFamily.
Never commit full audio/transcripts. This tool does not certify review or create picks.
"""
import argparse
import hashlib
import json
import pathlib
import subprocess
import urllib.error
import urllib.request

import numpy as np
from faster_whisper import WhisperModel

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--inventory', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--model', default='base.en')
parser.add_argument('--threads', type=int, default=4)
args = parser.parse_args()
out = pathlib.Path(args.output).resolve()
repo = pathlib.Path(__file__).resolve().parents[1]
if out == repo or repo in out.parents:
    parser.error('Output must be outside the public repository to protect full source content.')
out.mkdir(parents=True, exist_ok=True)
inventory = json.loads(pathlib.Path(args.inventory).read_text())
episodes = inventory if isinstance(inventory, list) else inventory['episodes']
model = WhisperModel(args.model, device='cpu', compute_type='int8', cpu_threads=args.threads)
failed = []
for episode in episodes:
    eid = str(episode['id'])
    if pathlib.Path(eid).name != eid or not eid:
        raise ValueError('Episode IDs must be plain filenames')
    target = out / (eid + '-transcript.json')
    if target.exists():
        print('RESUMED', eid, flush=True)
        continue
    url = episode.get('audioUrl') or episode.get('audio', {}).get('url')
    if not url or not url.startswith('https://'):
        raise ValueError('Explicit public HTTPS publisher audio URL required: ' + eid)
    audio_path = out / (eid + '.mp3')
    try:
        if not audio_path.exists():
            temporary = audio_path.with_suffix('.download')
            with urllib.request.urlopen(url, timeout=60) as response, temporary.open('wb') as stream:
                while chunk := response.read(1024 * 1024):
                    stream.write(chunk)
            temporary.replace(audio_path)
        pcm = subprocess.check_output(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(audio_path), '-f', 's16le', '-ac', '1', '-ar', '16000', 'pipe:1'])
        audio = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768.0
        segments, info = model.transcribe(audio, language='en', beam_size=3, vad_filter=True, condition_on_previous_text=False)
        rows = [dict(start=round(s.start, 2), end=round(s.end, 2), text=s.text, avg_logprob=s.avg_logprob) for s in segments]
        record = dict(episode=episode, asr=f'faster-whisper {args.model} int8; automated; no speaker diarization', duration=info.duration, audio_sha256=hashlib.sha256(audio_path.read_bytes()).hexdigest(), segments=rows)
        target.write_text(json.dumps(record, indent=2) + '\n')
        (out / (eid + '.txt')).write_text('\n'.join(f"[{s['start']}-{s['end']}] {s['text']}" for s in rows))
        print('TRANSCRIBED, REVIEW REQUIRED', eid, round(info.duration), flush=True)
    except (urllib.error.URLError, subprocess.CalledProcessError) as error:
        failed.append(eid)
        print('UNAVAILABLE; DO NOT CERTIFY', eid, str(error), flush=True)
if failed:
    raise SystemExit('Incomplete episodes: ' + ', '.join(failed))
