import re

with open('frontend/src/views/DashboardView.jsx', 'r') as f:
    lines = f.readlines()

def check_range(start_line, end_line):
    stack = []
    print(f"Checking lines {start_line} to {end_line}")
    for i in range(start_line - 1, end_line):
        line = lines[i]
        line_num = i + 1

        # Strip comments
        line = re.sub(r'\{/\*.*?\*/\}', '', line)

        # Match <div BUT NOT self-closing
        # Simplification: <div and then check character before matching >
        for m in re.finditer(r'<div', line):
            # We need the full tag content to check for self-closing
            # Since tags can span lines, this is still tricky.
            # But let's assume they don't span lines for simple cases.
            tag_end = line.find('>', m.end())
            if tag_end != -1:
                if line[tag_end-1] == '/':
                    continue
            stack.append(line_num)

        for _ in re.finditer(r'</div', line):
            if stack:
                stack.pop()
            else:
                print(f"  Extra closing tag at line {line_num}")

    if stack:
        print(f"  Unclosed tags from lines: {stack}")
    else:
        print("  All tags balanced in range.")

check_range(34, 159)
