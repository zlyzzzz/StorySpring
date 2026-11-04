"""Export a deliberately small, traceable Story Commonsense pilot catalog.

The selected adaptations are reviewed for this local implementation only.
This does not approve the full corpus or validate it for a participant study.
Run with --database pointing to the previously prepared local SQLite file.
"""

import argparse
import hashlib
import json
from pathlib import Path
import sqlite3


# Each adaptation is deliberately narrower than a universal claim about people.
SELECTIONS = [
    ('make_happy', 'SCM_8e3617566dcf7c0271de5023', 'To make someone happy',
     'Abstracts a mother promising a surprise; does not prescribe an outcome.'),
    ('trusted_help', 'SCM_65f23a5aad8e6963197bc519', 'Ask someone they trust for help',
     'Abstracts asking parents for help after an injury; no injury is imported.'),
    ('help_friend', 'SCM_e5c4054d47144e9b78426ae3', 'Be there for a friend who needs them',
     'Keeps the idea of helping a friend, without importing the car or urgency.'),
    ('rest', 'SCM_3a7771619564b266a3a4cb46', 'To feel well rested',
     'Keeps a rest-related motivation in its original context.'),
    ('companionship', 'SCM_6c47662e1c0ea80879c28de2', 'Spend time with a friend',
     'Abstracts companionship without importing the beach.'),
    ('belonging', 'SCM_a759ccdb1dfa3a213ee34388', 'To feel that they belong',
     'Abstracts a school belonging motivation without imposing a school setting.'),
    ('support_success', 'SCM_574e595b75fa49e5f118f313', 'Help someone else succeed',
     'Abstracts a coach motivation without importing a sports setting.'),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True, type=Path)
    parser.add_argument('--output', type=Path,
                        default=Path(__file__).resolve().parents[1] / 'character-catalog.json')
    args = parser.parse_args()
    connection = sqlite3.connect(f'{args.database.resolve().as_uri()}?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    items = {}
    for key, material_id, adapted_text, review_note in SELECTIONS:
        material = connection.execute('SELECT * FROM materials WHERE material_id=?',
                                      [material_id]).fetchone()
        source = connection.execute(
            'SELECT a.* FROM annotations a JOIN material_sources s '
            'ON a.annotation_id=s.annotation_id WHERE s.material_id=? '
            'ORDER BY a.source_row LIMIT 1', [material_id]).fetchone()
        if material is None or source is None:
            raise ValueError(f'Missing selected source: {material_id}')
        items[key] = {
            'id': material_id, 'dataset': 'Story Commonsense', 'split': 'train',
            'annotation': material['text'], 'annotation_type': material['material_type'],
            'character': source['character'], 'sentence': source['sentence'],
            'context': source['context'], 'story_id': source['story_id'],
            'source_file': source['source_file'], 'source_record_index': source['source_row'],
            'adapted_text': adapted_text, 'review_note': review_note,
            'source_url': 'https://uwnlp.github.io/storycommonsense/data/storycommonsense_data.zip',
        }
    connection.close()
    result = {'version': 1, 'status': 'curated_for_local_pilot_only',
              'scope': 'Seven explicit contextual adaptations, not approval of the full corpus.',
              'items': items}
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    digest = hashlib.sha256(args.output.read_bytes()).hexdigest()
    args.output.with_suffix('.manifest.json').write_text(json.dumps({
        'catalog_sha256': digest, 'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'source_material_ids': [item['id'] for item in items.values()],
        'selection': 'Explicit implementation-reviewed list in SELECTIONS; no LLM calls.',
    }, indent=2), encoding='utf8')
    print(f'Exported {len(items)} traceable adaptations: {args.output}')


if __name__ == '__main__':
    main()
