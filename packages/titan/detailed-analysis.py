import re

with open('test-results-final.log', 'r') as f:
    lines = f.readlines()

# Find stack traces for database config errors
db_config_errors = []
for i, line in enumerate(lines):
    if 'Connection configuration is required for undefined' in line:
        # Get context (5 lines before, current line, 5 lines after)
        context_start = max(0, i-5)
        context_end = min(len(lines), i+10)
        context = ''.join(lines[context_start:context_end])
        
        # Extract key info
        file_match = re.search(r'at.*\((.*?\.ts:\d+:\d+)\)', context)
        test_match = re.search(r'test/[^\s]+\.spec\.ts:\d+', context)
        
        info = {
            'line_num': i+1,
            'file': file_match.group(1) if file_match else 'unknown',
            'test': test_match.group(0) if test_match else 'unknown',
            'snippet': context[:500]
        }
        db_config_errors.append(info)

print('Database Config Error Locations:')
print('=' * 70)
# Show first 3 unique error locations
seen = set()
for err in db_config_errors[:20]:
    key = (err['file'], err['test'])
    if key not in seen:
        seen.add(key)
        print(f"\nFile: {err['file']}")
        print(f"Test: {err['test']}")
        print(f"Line: {err['line_num']}")
        if len(seen) >= 5:
            break

# Find where the error originates
print('\n\nError Origin Analysis:')
print('=' * 70)
origin_files = []
for err in db_config_errors:
    file_matches = re.findall(r'at.*\(([^)]+\.ts):\d+:\d+\)', err['snippet'])
    for f in file_matches:
        if 'database.manager.ts' in f or 'parseConnectionConfig' in err['snippet']:
            origin_files.append(f)

from collections import Counter
origin_counter = Counter(origin_files)
for file, count in origin_counter.most_common(5):
    print(f'{file}: {count} times')
