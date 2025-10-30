import re
from collections import Counter

with open('test-results-final.log', 'r') as f:
    content = f.read()

# Error patterns
error_patterns = {
    'Database Config Missing': len(re.findall(r'Connection configuration is required for undefined', content)),
    'Redis Connection': len(re.findall(r'Redis connection error', content)),
    'Timeout': len(re.findall(r'timed out|timeout', content, re.IGNORECASE)),
    'Health Check Failed': len(re.findall(r'health check.*failed|health check timed out', content, re.IGNORECASE)),
    'NOGROUP Error': len(re.findall(r'NOGROUP', content)),
}

# Test files
test_files = re.findall(r'test/[^\s]+\.spec\.ts', content)
test_file_counts = Counter(test_files)

print('Error Pattern Analysis:')
print('=' * 50)
for key, count in sorted(error_patterns.items(), key=lambda x: -x[1]):
    if count > 0:
        print(f'{key}: {count} occurrences')

print('\nMost Mentioned Test Files:')
print('=' * 50)
for file, count in test_file_counts.most_common(10):
    print(f'{file}: {count} mentions')

print(f'\nTotal unique test files: {len(test_file_counts)}')
