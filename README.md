
  Jira Dashboard

DOWNLOAD (no install needed)
----------------------------
For people who do not use Node.js or the terminal:

  **Latest release:** https://github.com/namandeep-heer/jira-dashboard/releases/latest

  **Windows**
    1. Download `Jira-Dashboard-Windows.zip`
    2. Unzip anywhere (e.g. Desktop)
    3. Double-click `Jira-Dashboard.exe`
       (or `Start Jira Dashboard.vbs` to hide the black window)
    4. Your browser opens at http://localhost:3131
    5. Open **Jira Setup** in the sidebar and enter your credentials

  **Mac**
    1. Download the zip for your chip (Intel or Apple Silicon)
    2. Unzip and double-click `Jira-Dashboard`
       (If blocked: right-click → Open → Open)
    3. Follow steps 4–5 above

  **Stop the app:** close the window that opened, or press Ctrl+C in it.

  Windows may show a SmartScreen warning because the app is not code-signed.
  Click **More info** → **Run anyway**.


DEVELOPER SETUP
---------------
REQUIREMENTS
  Node.js (v16 or newer)
  Download from: https://nodejs.org

SETUP (one time only)
  1. Open a terminal inside the folder
  2. Run:  npm install

START
  Run:  npm start
  (or:  node proxy.js)

  This opens http://localhost:3131 in your browser automatically.
  Keep the terminal open while using the app.

BUILD STANDALONE DOWNLOADS
  npm run build:win     Windows zip in dist/
  npm run build:mac     macOS zips in dist/
  npm run build:all     Windows + macOS

  GitHub Actions builds release zips automatically when you publish a
  GitHub Release (tag e.g. v1.0.0). You can also run the workflow
  manually from the Actions tab to get test artifacts.


FIRST TIME USE
--------------
  1. Go to "Jira Setup" in the sidebar
  2. Enter your Jira URL:  https://yourcompany.atlassian.net
  3. Enter your email and API token
     (Generate token at: https://id.atlassian.com/manage-profile/security/api-tokens)
  4. Click "Test connection"
  5. Navigate to any project in the sidebar

CUSTOM FIELD IDs
----------------
  The custom fields (Scope Commitment, Dev Estimate, etc.) use placeholder
  IDs like customfield_10200. These differ per Jira instance.

  To find your real IDs:
    Jira Admin → Issues → Custom Fields → hover a field → note ID in URL

  Update them under: Field Configuration → Custom field ID mapping

FEATURES
--------
  - Project pages with live Jira data
  - Smart pagination with batch-by-batch control
    * First 100 issues load automatically
    * After each batch, prompts to load next 100 issues
    * Shows progress: "Fetched X of Y, load next 100?"
    * User can stop at any batch by clicking Cancel
    * "Load All" button available to fetch remaining without prompts
    * Works consistently for both individual projects and "Refresh All"
    * Cancel button available during refresh operations
  - Configurable columns (toggle fields on/off)
  - Custom field ID mapping
  - Analytics page: 
    * Developer Velocity tracking (behind/on-track/has capacity)
    * Status, priority, and issue-type charts per project
  - Developer Velocity metrics:
    * Track estimated vs actual time per developer
    * Visual indicators for behind schedule, on track, or has capacity
    * Drill down into individual ticket breakdowns
  - CSV export per project
  - Click any row to open the issue in Jira
  - Dark mode (follows system preference)

STOP
----
  Press Ctrl+C in the terminal (or close the app window for standalone builds).

==============================================