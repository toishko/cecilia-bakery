import os

def fix_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Replace double quotes with single quotes for the icon tags to avoid breaking HTML attributes
    content = content.replace('<i data-lucide="', "<i data-lucide='")
    content = content.replace('" class="icon"></i>', "' class='icon'></i>")
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

for root, dirs, files in os.walk("/Users/toishko/Desktop/Websites /cecilia-bakery"):
    for file in files:
        if file.endswith(".html") or file.endswith(".js"):
            if "node_modules" not in root and "dist" not in root:
                fix_file(os.path.join(root, file))
