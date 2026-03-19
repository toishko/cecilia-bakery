import os
import re

def fix_js_files(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Find single-quoted HTML strings with inner single quotes
    # i.e. '<i data-lucide='...' class='icon'></i>'
    # And replace with backticks
    content = re.sub(r"'<i data-lucide='([^']+)' class='icon'></i>'", r"`<i data-lucide='\1' class='icon'></i>`", content)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

for root, dirs, files in os.walk("/Users/toishko/Desktop/Websites /cecilia-bakery"):
    for file in files:
        if file.endswith(".html") or file.endswith(".js"):
            if "node_modules" not in root and "dist" not in root:
                fix_js_files(os.path.join(root, file))
