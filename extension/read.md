I have a modular Chrome Extension that acts as a container for multiple tools (modules). I want you to integrate a new tool into this existing extension without deleting or breaking the existing modules.

Here is the current structure of the extension:
Unified_Extension/
├── manifest.json
├── background.js (Use importScripts to load module backgrounds)
└── modules/
    ├── meeting_tracker/ (Existing module)
    └── freshdesk_p1/ (Existing module)

My Goal:
I will provide you with the code for a NEW extension. You need to:
1. Create a new folder inside `modules/` for this new tool.
2. Adapt the new tool's `background.js` (if it exists) to be wrapped in a block scope `{ ... }` so it doesn't conflict with other variables, and instruct me to add an `importScripts` line to the main `background.js`.
3. Update the main `manifest.json` to include the permissions, content scripts, and resources required by the new tool, ensuring file paths point to the new `modules/[new_tool_name]/` directory.
4. Ensure no logic from the original extension is lost, only paths are updated.

Here is the code for the NEW extension I want to add:
[PASTE NEW EXTENSION CODE HERE]