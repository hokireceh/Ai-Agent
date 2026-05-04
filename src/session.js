'use strict';

const fs   = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, '..', 'sessions.json');

function loadSessions() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return new Map(Object.entries(JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'))));
    }
  } catch { /* corrupt — start fresh */ }
  return new Map();
}

const sessions = loadSessions();

function saveSessions() {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(Object.fromEntries(sessions)), 'utf8');
  } catch (e) {
    console.warn('⚠️ Gagal simpan session:', e.message);
  }
}

function getSession(chatId) {
  const key = String(chatId);
  if (!sessions.has(key)) {
    sessions.set(key, { history: [], mode: 'general', model: 'auto', adminMode: false });
  }
  return sessions.get(key);
}

module.exports = { sessions, getSession, saveSessions };
