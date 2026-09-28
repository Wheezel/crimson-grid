"""Fail deployment if generated map layers, metadata or links are incomplete."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
raw = (root / 'data.js').read_text()
data = json.loads(raw.removeprefix('window.MAP_DATA=').strip().removesuffix(';'))
assert data['commit'] == '75c11f5496d4b691fc71c74186dd843ba07f436b'
assert len(data['maps']) == 3
assert sum(len(m['levels']) for m in data['maps']) == 18
count = 0
for m in data['maps']:
    levels = {l['id']: l for l in m['levels']}
    for l in m['levels']:
        folder = root / 'assets' / l['image']
        assert (folder / 'overview.webp').is_file(), folder
        for resolution in (16, 32):
            for y in range((l['h'] * resolution + 511) // 512):
                for x in range((l['w'] * resolution + 511) // 512):
                    tile = folder / str(resolution) / f'{x}_{y}.webp'
                    assert tile.is_file() and tile.stat().st_size > 0, tile
    for n in m['nodes']:
        assert n['level'] in levels
        assert not n.get('oneWay') or not n['to']
        for dest in n['to']:
            assert 0 <= dest < len(m['nodes'])
            assert m['nodes'][dest]['level'] in levels
            count += 1
assert count == 727, count
assert not json.loads((root / 'transition-audit.json').read_text())
print(f'Validated 18 map layers and {count} directed transition links.')
