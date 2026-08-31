
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
    3. Follow the packaged setup steps in the `README.txt` included with the download.

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
  1. Copy `config/.env.example` to `config/.env` (or edit the existing file).
    Set `JIRA_URL`, `JIRA_CREDENTIAL_ENCRYPTION_KEY`, and `ADMIN_EMAIL`.
    Keep the encryption key private and do not commit `.env`.
  2. Open the dashboard and choose "Create an account".
  3. Enter your email, password (at least 8 characters), and Jira API token
    (Generate token at: https://id.atlassian.com/manage-profile/security/api-tokens)
  4. The dashboard verifies Jira access and encrypts the token before storing it
    in the local data file on this machine.
  5. The account whose email matches `ADMIN_EMAIL` becomes the administrator
    automatically. Other accounts are created as viewers.
  6. Open "Jira Setup" and click "Test connection".

  Access roles
  ------------
  Users sign in with email and password stored locally by the proxy. During
  registration, they verify their email and API token against the Jira URL in
  `config/.env`. The account matching `ADMIN_EMAIL` is an administrator; later
  accounts are viewers. Administrators can change configuration; viewers can
  read the shared dashboard but cannot change it.

  Local persistence
  -----------------
  Accounts, sessions, encrypted Jira tokens, shared workspace settings, release
  and project configuration, synced Jira data, connector schedules, and activity
  logs are stored in `data/store.json` next to the app (or next to the standalone
  executable). No cloud database or extra service is required. The connector
  scheduler runs while the dashboard tab is open.

  Set `JIRA_URL` and `JIRA_CREDENTIAL_ENCRYPTION_KEY` in `config/.env`; the Jira
  base URL is managed by the proxy and API tokens are encrypted before storage.
  Optional: set `XAI_API_KEY` so Release Report can read ticket descriptions
  with SpaceXAI.

    Account setup
    ------------
    1. Start the proxy and open the dashboard.
    2. Choose "Create an account" and enter your email, password, and Jira API token.
      The account email is used as the Jira email. Jira access is verified before registration.
    3. If the account email matches `ADMIN_EMAIL`, that account is created as `admin`.
      Other accounts are assigned `viewer`.
    4. The header shows the assigned role after sign-in.

    Credential security
    -------------------
    Jira API tokens are encrypted with AES-256-GCM by the local proxy before being
    stored in `data/store.json`. Jira URL and email are not secrets. The encryption
    key stays in `config/.env` and is never written into the data file as plaintext.
    Rotate the Jira token and encryption key if either is exposed, then save the
    new token through the dashboard. Losing the encryption key makes existing
    encrypted tokens unusable. Never commit `config/.env` or `data/`.

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
  - Release Report (selected release, accounting portfolio):
    * Snapshot any time during the release, or an end-of-release briefing
    * One progress slide per project (status mix vs milestone dates)
    * Release-at-a-glance table across projects
    * High-value deliverables from every project, then cumulative portfolio risks
    * Download as PowerPoint for a company all-hands, plus an HTML list of every ticket
    * Group the HTML ticket list by status, by project, or by project then status when generating the report
    * Optional SpaceXAI write-up of ticket descriptions when `XAI_API_KEY` is set in `config/.env`
  - Click any row to open the issue in Jira
  - Dark mode (follows system preference)

STOP
----
  Press Ctrl+C in the terminal (or close the app window for standalone builds).

==============================================