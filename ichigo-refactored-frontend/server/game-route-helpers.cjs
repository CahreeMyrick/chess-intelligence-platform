'use strict';

const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const VALID_RESULTS = new Set(['*', '1-0', '0-1', '1/2-1/2']);

function parsePositiveInteger(raw) {
  const text = String(raw ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function normalizeUci(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  return UCI_PATTERN.test(value) ? value : null;
}

function normalizeResult(raw = '*') {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return VALID_RESULTS.has(value) ? value : null;
}

function parseMoveHistory(raw) {
  if (raw == null || raw === '') return [];
  if (typeof raw !== 'string') return null;
  const moves = raw.trim().split(/\s+/).filter(Boolean).map(normalizeUci);
  return moves.every(Boolean) ? moves : null;
}

module.exports = {
  UCI_PATTERN,
  VALID_RESULTS,
  normalizeResult,
  normalizeUci,
  parseMoveHistory,
  parsePositiveInteger,
};
