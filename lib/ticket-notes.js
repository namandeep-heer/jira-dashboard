/**
 * File-backed notes and comments for dashboard tickets.
 * Stored separately from Jira and from data/store.json.
 * Comments are not posted back to Jira.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NOTE_MAX = 8000;
const COMMENT_MAX = 4000;
const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalizeKey(value) {
  const key = String(value || '').trim().toUpperCase();
  if (!KEY_RE.test(key)) throw httpError(400, 'Enter a ticket key like NFS-123.');
  return key;
}

function emptyFile() {
  return { version: 1, tickets: {} };
}

function atomicWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    fs.copyFileSync(tmp, filePath);
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
  }
}

function publicTicket(row) {
  if (!row) {
    return { note: '', noteUpdatedAt: null, noteUpdatedBy: null, comments: [] };
  }
  const comments = Array.isArray(row.comments) ? row.comments : [];
  return {
    note: typeof row.note === 'string' ? row.note : '',
    noteUpdatedAt: row.noteUpdatedAt || null,
    noteUpdatedBy: row.noteUpdatedBy || null,
    comments: comments.map(comment => ({
      id: comment.id,
      body: comment.body,
      author: comment.author || '',
      createdAt: comment.createdAt,
    })),
  };
}

function createTicketNotes(options) {
  const filePath = options.filePath;
  let db = load();

  function load() {
    if (!fs.existsSync(filePath)) return emptyFile();
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      const backup = filePath + '.corrupt-' + Date.now();
      try { fs.copyFileSync(filePath, backup); } catch (_) { /* ignore */ }
      throw new Error('Ticket notes file is unreadable. A backup was saved as ' + path.basename(backup));
    }
    const tickets = parsed && parsed.tickets && typeof parsed.tickets === 'object' && !Array.isArray(parsed.tickets)
      ? parsed.tickets
      : {};
    return { version: 1, tickets };
  }

  function save() {
    atomicWriteJson(filePath, db);
  }

  function ensure(key) {
    if (!db.tickets[key] || typeof db.tickets[key] !== 'object') {
      db.tickets[key] = { note: '', comments: [] };
    }
    if (!Array.isArray(db.tickets[key].comments)) db.tickets[key].comments = [];
    return db.tickets[key];
  }

  function prune(key) {
    const row = db.tickets[key];
    if (!row) return;
    const note = String(row.note || '').trim();
    const comments = Array.isArray(row.comments) ? row.comments : [];
    if (!note && !comments.length) delete db.tickets[key];
  }

  function snapshot(key) {
    return { key, ...publicTicket(db.tickets[key]) };
  }

  return {
    filePath,
    list() {
      const tickets = {};
      Object.keys(db.tickets).sort().forEach(key => {
        const pub = publicTicket(db.tickets[key]);
        if (!pub.note.trim() && !pub.comments.length) return;
        tickets[key] = pub;
      });
      return { version: 1, tickets };
    },
    get(key) {
      return snapshot(normalizeKey(key));
    },
    setNote(key, { note, author }) {
      const normalized = normalizeKey(key);
      const text = String(note == null ? '' : note).replace(/\r\n/g, '\n');
      if (text.length > NOTE_MAX) throw httpError(400, 'Note is too long (max ' + NOTE_MAX + ' characters).');
      const row = ensure(normalized);
      row.note = text.trim();
      row.noteUpdatedAt = new Date().toISOString();
      row.noteUpdatedBy = String(author || '');
      prune(normalized);
      save();
      return snapshot(normalized);
    },
    addComment(key, { body, author }) {
      const normalized = normalizeKey(key);
      const text = String(body || '').replace(/\r\n/g, '\n').trim();
      if (!text) throw httpError(400, 'Write a comment before saving.');
      if (text.length > COMMENT_MAX) throw httpError(400, 'Comment is too long (max ' + COMMENT_MAX + ' characters).');
      const row = ensure(normalized);
      row.comments.push({
        id: crypto.randomUUID(),
        body: text,
        author: String(author || ''),
        createdAt: new Date().toISOString(),
      });
      save();
      return snapshot(normalized);
    },
    deleteComment(key, commentId, { author, isAdmin }) {
      const normalized = normalizeKey(key);
      const row = db.tickets[normalized];
      const comments = row && Array.isArray(row.comments) ? row.comments : [];
      const idx = comments.findIndex(comment => comment.id === commentId);
      if (idx < 0) throw httpError(404, 'Comment not found.');
      const comment = comments[idx];
      if (!isAdmin && comment.author !== author) {
        throw httpError(403, 'You can delete only your own comments.');
      }
      comments.splice(idx, 1);
      prune(normalized);
      save();
      return snapshot(normalized);
    },
  };
}

module.exports = { createTicketNotes, NOTE_MAX, COMMENT_MAX };
