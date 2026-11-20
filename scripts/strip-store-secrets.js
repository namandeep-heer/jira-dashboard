#!/usr/bin/env node
/**
 * Git clean filter for data/store.json.
 * Drops the encrypted Jira API token, password hash, and session token
 * so those values are not stored in git. The working file is left unchanged.
 */
'use strict';

const chunks = [];
process.stdin.on('data', chunk => chunks.push(chunk));
process.stdin.on('end', () => {
  const raw = Buffer.concat(chunks).toString('utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    process.stderr.write('data/store.json is not valid JSON, so it was not staged.\n');
    process.exit(1);
  }
  if (Array.isArray(data.credentials)) {
    data.credentials.forEach(row => {
      if (row && typeof row === 'object') delete row.jiraTokenCiphertext;
    });
  }
  if (Array.isArray(data.users)) {
    data.users.forEach(row => {
      if (row && typeof row === 'object') delete row.passwordHash;
    });
  }
  if (Array.isArray(data.sessions)) {
    data.sessions.forEach(row => {
      if (row && typeof row === 'object') delete row.tokenHash;
    });
  }
  const creds = data.sharedState && data.sharedState.state && data.sharedState.state.creds;
  if (creds && typeof creds === 'object') delete creds.token;
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
});
