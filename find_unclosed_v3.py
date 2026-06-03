import re

with open('frontend/src/views/DashboardView.jsx', 'r') as f:
    content = f.read()

# Match <div BUT NOT <div ... />
div_open_re = re.compile(r'<div(?![^>]*/>)[\s>]')
div_close_re = re.compile(r'</div\s*>')

# Process all div tokens in order
all_tokens = []
for m in div_open_re.finditer(content):
    all_tokens.append((m.start(), 'open'))
for m in div_close_re.finditer(content):
    all_tokens.append((m.start(), 'close'))

all_tokens.sort()

stack = []
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
