"""Build a searchable derivative without modifying the original research run.

Acceptance records the project owner's batch decision, not individual review.
Raw narrative annotations stay on the server; they are never direct UI options.
"""

import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
from datetime import datetime, timezone


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise SystemExit('Use a new output path to retain previous build evidence.')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    source = sqlite3.connect(f'{args.database.resolve().as_uri()}?mode=ro', uri=True)
    destination = sqlite3.connect(args.output)
    destination.executescript('''
        CREATE TABLE materials (
            id TEXT PRIMARY KEY, type TEXT, text TEXT, sentence TEXT,
            context TEXT, story_id TEXT, source_file TEXT, source_row INTEGER,
            original_review_status TEXT, acceptance TEXT
        );
        CREATE VIRTUAL TABLE search USING fts5(id UNINDEXED, text, sentence, context);
    ''')
    rows = source.execute('''
        SELECT m.material_id, m.material_type, m.text, a.sentence, a.context,
               m.story_id, a.source_file, a.source_row, m.review_status
        FROM materials m JOIN material_sources s ON s.material_id=m.material_id
        JOIN annotations a ON a.annotation_id=s.annotation_id
        WHERE a.annotation_id=(SELECT min(s2.annotation_id) FROM material_sources s2
                               WHERE s2.material_id=m.material_id)
        ORDER BY m.material_id
    ''')
    count = 0
    for row in rows:
        # Empty or very long labels remain in the raw research run, not retrieval.
        if not row[2].strip() or len(row[2]) > 400:
            continue
        destination.execute('INSERT INTO materials VALUES (?,?,?,?,?,?,?,?,?,?)',
                            (*row, 'owner_batch_accepted_2026-11-04'))
        destination.execute('INSERT INTO search VALUES (?,?,?,?)', row[:5:1][0:1] + (row[2], row[3], row[4]))
        count += 1
    destination.commit()
    assert destination.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    destination.close()
    source.close()
    manifest = {
        'created_at': datetime.now(timezone.utc).isoformat(),
        'source_database': str(args.database.resolve()),
        'source_sha256': hashlib.file_digest(args.database.open('rb'), 'sha256').hexdigest(),
        'output_sha256': hashlib.file_digest(args.output.open('rb'), 'sha256').hexdigest(),
        'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'records': count,
        'acceptance': 'Owner accepted pending materials in chat on 2026-11-04.',
        'review_scope': 'Batch acceptance, not documented individual item review.',
        'filters': ['nonempty text', 'at most 400 characters'],
        'source': 'Story Commonsense training annotations only',
        'source_url': 'https://uwnlp.github.io/storycommonsense/',
        'original_database_modified': False,
    }
    args.output.with_suffix('.manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Indexed {count} traceable materials.')


if __name__ == '__main__':
    main()
