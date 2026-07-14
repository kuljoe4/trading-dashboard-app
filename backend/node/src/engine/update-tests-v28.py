import os
import re

files = [
    'backend/node/src/engine/industry_fixes.spec.ts',
    'backend/node/src/engine/environment_filtering.spec.ts',
    'backend/node/src/engine/orderManager.atomicity.spec.ts',
    'backend/node/src/engine/orderManager.service.spec.ts',
    'backend/node/src/engine/orderManager.pnl.spec.ts',
    'backend/node/src/engine/sl_multipart_integrity.spec.ts',
    'backend/node/src/engine/orderManager.idempotency.spec.ts',
    'backend/node/src/engine/race_condition.spec.ts',
    'backend/node/src/engine/sl_ratchet_race.spec.ts'
]

def fix_file(file_path):
    if not os.path.exists(file_path):
        print(f"Skipping {file_path}, not found.")
        return

    with open(file_path, 'r') as f:
        content = f.read()

    if "import { OrderFilterService }" not in content:
        content = "import { OrderFilterService } from './order-filter.service';\n" + content

    pattern = r'new OrderManagerService\('
    start_pos = 0
    new_content = ""
    last_end = 0

    while True:
        match = re.search(pattern, content[start_pos:])
        if not match:
            break

        start_idx = start_pos + match.start()
        new_content += content[last_end:start_idx]

        pos = start_idx + len('new OrderManagerService(')
        bracket_count = 1
        while bracket_count > 0 and pos < len(content):
            if content[pos] == '(': bracket_count += 1
            elif content[pos] == ')': bracket_count -= 1
            pos += 1

        constructor_call = content[start_idx:pos]
        inner_content = constructor_call[len('new OrderManagerService('):-1]

        args = []
        current_arg = ""
        depth = 0
        in_quote = False
        quote_char = ""

        i = 0
        while i < len(inner_content):
            char = inner_content[i]
            if in_quote:
                if char == quote_char and (i == 0 or inner_content[i-1] != '\\'):
                    in_quote = False
                current_arg += char
            else:
                if char in ['"', "'", '`']:
                    in_quote = True
                    quote_char = char
                    current_arg += char
                elif char == ',' and depth == 0:
                    args.append(current_arg)
                    current_arg = ""
                else:
                    if char in ['(', '{', '[']: depth += 1
                    elif char in [')', '}', ']']: depth -= 1
                    current_arg += char
            i += 1
        if current_arg:
            args.append(current_arg)

        if any("OrderFilterService" in arg for arg in args):
            new_content += constructor_call
        else:
            mf_mock = args[1].strip() if len(args) > 1 else "{}"
            tc_mock = args[2].strip() if len(args) > 2 else "{}"
            ss_mock = args[6].strip() if len(args) > 6 else "{}"

            mf_raw = mf_mock.replace(' as any', '')
            tc_raw = tc_mock.replace(' as any', '')
            ss_raw = ss_mock.replace(' as any', '')

            # SRE: Bridge OrderFilterService methods to the existing mocks in the test
            # If the test mocks orderManager.applyFilters, it will still work as orderManager.ts calls it.
            # But the constructor needs the object.
            insertion = f" new OrderFilterService({mf_raw} as any, {tc_raw} as any, {ss_raw} as any)"
            args.append(insertion)
            new_content += 'new OrderManagerService(' + ",".join(args) + ")"

        start_pos = pos
        last_end = pos

    new_content += content[last_end:]

    with open(file_path, 'w') as f:
        f.write(new_content)
    print(f"Updated {file_path}")

for f in files:
    fix_file(f)
