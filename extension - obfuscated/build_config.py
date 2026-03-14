import json
import os
import glob

MANIFEST_PATH = 'manifest.json'

def build_config():
    with open(MANIFEST_PATH, 'r') as f:
        manifest = json.load(f)

    # find all subdirectories in modules
    modules = [d for d in os.listdir('modules') if os.path.isdir(os.path.join('modules', d))]
    
    config = {"modules": {}}
    
    for mod in modules:
        mod_config = {
            "background": False,
            "manifest": {
                "content_scripts": [],
                "web_accessible_resources": []
            }
        }
        
        # Check if it has a background.js
        if os.path.exists(os.path.join('modules', mod, 'background.js')):
            mod_config["background"] = True
            
        # Find its content scripts in current manifest
        for cs in manifest.get('content_scripts', []):
            files = cs.get('js', []) + cs.get('css', [])
            if any(f"modules/{mod}/" in fl for fl in files):
                mod_config["manifest"]["content_scripts"].append(cs)
                
        # Find its WARs in current manifest
        for war in manifest.get('web_accessible_resources', []):
            files = war.get('resources', [])
            if any(f"modules/{mod}/" in fl for fl in files):
                mod_config["manifest"]["web_accessible_resources"].append(war)
                
        config["modules"][mod] = mod_config
        
    with open('manager_config.json', 'w') as f:
        json.dump(config, f, indent=4)
        
if __name__ == '__main__':
    build_config()
    print("Successfully built manager_config.json")
