#!/usr/bin/env python3
"""Write the capture manifest `goldie frame` needs.

goldie normally produces this in its `capture` stage, which is iOS-only. The
Android captures are dropped into out/raw/iphone-6.9/ by hand, so the manifest
is written by hand too. `frame` only reads sceneId and file from it.
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'out', 'raw', 'iphone-6.9')
SCENES = ['home', 'gcode', 'files', 'printsheet', 'history',
          'model', 'mesh', 'filament']  # keep in config order; Play caps at 8

missing = [s for s in SCENES if not os.path.exists(os.path.join(RAW, s + '.png'))]
if missing:
    sys.exit('missing captures: ' + ', '.join(missing))

manifest = {'screenshots': [{'sceneId': s, 'file': os.path.join(RAW, s + '.png')}
                            for s in SCENES]}
with open(os.path.join(RAW, 'manifest.json'), 'w') as f:
    json.dump(manifest, f, indent=2)
print('wrote', os.path.join(RAW, 'manifest.json'), 'with', len(SCENES), 'scenes')
