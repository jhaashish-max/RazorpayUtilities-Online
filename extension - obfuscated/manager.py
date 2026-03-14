import tkinter as tk
from tkinter import ttk, messagebox
import json
import os
import re

MANIFEST_PATH = "manifest.json"
BG_PATH = "background.js"
CONFIG_PATH = "manager_config.json"

class ExtensionManager(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Razorpay Extension Manager")
        self.geometry("400x500")
        
        self.config = self.load_config()
        self.module_vars = {}
        
        self.create_widgets()
        
    def load_config(self):
        if not os.path.exists(CONFIG_PATH):
            return {}
        try:
            with open(CONFIG_PATH, 'r') as f:
                return json.load(f).get("modules", {})
        except:
            return {}

    def parse_current_state(self):
        active_modules = set()
        
        # We can figure out what is active just by looking at background.js
        # and checking if a module that requires a background actually has it.
        # But even simpler: just check manifest content scripts.
        if os.path.exists(MANIFEST_PATH):
            with open(MANIFEST_PATH, 'r') as f:
                try:
                    manifest = json.load(f)
                    content_str = json.dumps(manifest.get('content_scripts', []))
                    for mod in self.config.keys():
                        if f"modules/{mod}/" in content_str:
                            active_modules.add(mod)
                except:
                    pass
                    
        return active_modules

    def create_widgets(self):
        if not self.config:
            ttk.Label(self, text=f"Error: {CONFIG_PATH} not found.\nRun build_config.py first.", font=('Helvetica', 12)).pack(pady=20)
            return

        ttk.Label(self, text="Select Modules to Enable:", font=('Helvetica', 14, 'bold')).pack(pady=10)
        
        # Scrollable frame for modules
        canvas = tk.Canvas(self, borderwidth=0, highlightthickness=0)
        scrollbar = ttk.Scrollbar(self, orient="vertical", command=canvas.yview)
        scrollable_frame = ttk.Frame(canvas)

        scrollable_frame.bind(
            "<Configure>",
            lambda e: canvas.configure(
                scrollregion=canvas.bbox("all")
            )
        )

        canvas.create_window((0, 0), window=scrollable_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.pack(side="left", fill="both", expand=True, padx=(20, 0))
        scrollbar.pack(side="right", fill="y")
        
        active_modules = self.parse_current_state()
        
        for mod in sorted(self.config.keys()):
            # Special logic: Modules without manifest entries but with background entries
            # Need to check background.js if manifest check failed.
            if mod not in active_modules and self.config[mod].get("background"):
                 if os.path.exists(BG_PATH):
                     with open(BG_PATH, 'r') as f:
                         if f"modules/{mod}/" in f.read():
                             active_modules.add(mod)

            var = tk.BooleanVar(value=(mod in active_modules))
            self.module_vars[mod] = var
            ttk.Checkbutton(scrollable_frame, text=mod, variable=var).pack(anchor=tk.W, pady=4)
            
        btn_frame = ttk.Frame(self)
        btn_frame.pack(fill=tk.X, pady=20, padx=20)
        
        ttk.Button(btn_frame, text="Apply Changes", command=self.apply_changes).pack(side=tk.RIGHT)
        
    def apply_changes(self):
        enabled_modules = [mod for mod, var in self.module_vars.items() if var.get()]
        
        try:
            self.update_background_js(enabled_modules)
            self.update_manifest(enabled_modules)
            messagebox.showinfo("Success", "Extension updated successfully!\n\nPlease reload the extension in chrome://extensions")
        except Exception as e:
            messagebox.showerror("Error", f"Failed to update files:\n{str(e)}")
            
    def update_background_js(self, enabled_modules):
        if not os.path.exists(BG_PATH): return
        
        with open(BG_PATH, 'r') as f:
            content = f.read()
            
        blocks = re.split(r'\n\n+', content.strip())
        new_blocks = []
        
        for block in blocks:
            if 'importScripts' in block and 'modules/' in block:
                match = re.search(r"modules/([^/]+)/", block)
                if match:
                    mod = match.group(1)
                    if mod in enabled_modules:
                        new_blocks.append(block)
                else:
                    new_blocks.append(block)
            else:
                new_blocks.append(block)
                
        # Append anything enabled but missing
        for mod in enabled_modules:
            if self.config[mod].get("background"):
                found = False
                for b in new_blocks:
                    if f"modules/{mod}/background.js" in b:
                        found = True
                        break
                if not found:
                    new_block = f'try {{\n    importScripts(\'modules/{mod}/background.js\');\n}} catch (e) {{\n    console.error("Failed to load {mod} background:", e);\n}}'
                    new_blocks.append(new_block)
                    
        with open(BG_PATH, 'w') as f:
            f.write("\n\n".join(new_blocks) + "\n")
            
    def update_manifest(self, enabled_modules):
        if not os.path.exists(MANIFEST_PATH): return
        
        with open(MANIFEST_PATH, 'r') as f:
            manifest = json.load(f)
            
        # Rebuild content_scripts and web_accessible_resources from scratch 
        # based ONLY on enabled modules, PLUS preserve any globals if present. (Assume our config captured everything).
        # Actually a safer way is to remove all module-specific items, then add back enabled ones.
        
        # 1. Strip all module-specific entries
        all_known_modules = list(self.config.keys())
        
        def is_module_specific(item, key):
            # item is dict, key is 'js', 'css', or 'resources'
            files = []
            if key == 'resources':
                files = item.get('resources', [])
            else:
                files = item.get('js', []) + item.get('css', [])
                
            for mod in all_known_modules:
                if any(f"modules/{mod}/" in fl for fl in files):
                    return True
            return False

        if 'content_scripts' in manifest:
            manifest['content_scripts'] = [cs for cs in manifest['content_scripts'] if not is_module_specific(cs, 'js')]
        else:
            manifest['content_scripts'] = []
            
        if 'web_accessible_resources' in manifest:
            manifest['web_accessible_resources'] = [war for war in manifest['web_accessible_resources'] if not is_module_specific(war, 'resources')]
        else:
             manifest['web_accessible_resources'] = []

        # 2. Add back enabled modules
        for mod in enabled_modules:
            mod_manifest = self.config[mod].get("manifest", {})
            for cs in mod_manifest.get("content_scripts", []):
                manifest['content_scripts'].append(cs)
            for war in mod_manifest.get("web_accessible_resources", []):
                manifest['web_accessible_resources'].append(war)
                
        # Clean up empty arrays
        if not manifest['content_scripts']: del manifest['content_scripts']
        if not manifest['web_accessible_resources']: del manifest['web_accessible_resources']
        
        with open(MANIFEST_PATH, 'w') as f:
            json.dump(manifest, f, indent=4)

if __name__ == "__main__":
    app = ExtensionManager()
    app.mainloop()
