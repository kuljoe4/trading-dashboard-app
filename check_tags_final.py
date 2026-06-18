import re

with open('frontend/src/views/DashboardView.jsx', 'r') as f:
    content = f.read()

# Remove JSX comments
content = re.sub(r'\{/\*.*?\*/\}', '', content, flags=re.DOTALL)

stack = []
# Find all <div ... > and </div>
# Ignore <div ... />
div_open_pattern = re.compile(r'<div(?P<attrs>[^>]*)(?P<self>/?)>')
div_close_pattern = re.compile(r'</div\s*>')

# Process all div tokens in order
all_tokens = []
for m in div_open_pattern.finditer(content):
    if not m.group('self'):
        all_tokens.append((m.start(), 'open'))
for m in div_close_pattern.finditer(content):
    all_tokens.append((m.start(), 'close'))

all_tokens.sort()

for pos, token_type in all_tokens:
    line = content.count('\n', 0, pos) + 1
    if token_type == 'open':
        stack.append(line)
    else:
        if stack:
            stack.pop()
        else:
            print(f"Extra closing </div> at line {line}")

if stack:
    print(f"Unclosed <div> tags from lines: {stack}")
else:
    print("All <div> tags are balanced!")
