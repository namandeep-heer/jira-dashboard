
  Jira Dashboard

REQUIREMENTS
------------
  Node.js (v16 or newer)
  Download from: https://nodejs.org

SETUP (one time only)
---------------------
  1. Open a terminal inside the folder
  2. Run:  npm install

START
-----
  Run:  node proxy.js

  This opens http://localhost:3131 in your browser automatically.
  Keep the terminal open while using the app.

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
  - Analytics page: status / priority / issue-type charts per project
  - CSV export per project
  - Click any row to open the issue in Jira
  - Dark mode (follows system preference)

STOP
----
  Press Ctrl+C in the terminal.

==============================================
