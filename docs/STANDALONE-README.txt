Jira Dashboard — Quick Start
============================

No Node.js or terminal commands needed.


WINDOWS
-------
1. Unzip this folder anywhere (e.g. your Desktop).
2. Double-click "Jira-Dashboard.exe"
   — or double-click "Start Jira Dashboard.vbs" to run without a black window.
3. Your browser opens automatically at http://localhost:3131
4. In the sidebar, open "Jira Setup" and enter:
   - Your Jira URL (e.g. https://yourcompany.atlassian.net)
   - Your email
   - Your API token
     Create one at: https://id.atlassian.com/manage-profile/security/api-tokens
5. Click "Test connection", then pick a project from the sidebar.

To stop the app: close the small black window, or press Ctrl+C in it.


MAC
---
1. Unzip this folder.
2. Double-click "Jira-Dashboard"
   (If macOS blocks it: right-click → Open → Open.)
3. Follow steps 3–5 above.


TROUBLESHOOTING
---------------
- "Port already in use" — another copy is already running. Close it first.
- Browser does not open — go to http://localhost:3131 manually.
- Windows SmartScreen warning — click "More info" → "Run anyway"
  (the app is not code-signed).


KEEP THIS FOLDER TOGETHER
-------------------------
Do not move Jira-Dashboard.exe away from dashboard.html and the config folder.
They must stay in the same directory.