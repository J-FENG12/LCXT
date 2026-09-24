#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const [inputPath, outputPath, speedText = '1'] = process.argv.slice(2);
const speed = Number(speedText);

if (!inputPath || !outputPath || !Number.isFinite(speed) || speed <= 0) {
  console.error('Usage: node tools/scale-srt.cjs <input.srt> <output.srt> <speed>');
  process.exit(1);
}

function scaleTimestamp(value) {
  const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(value);
  if (!match) return value;
  const totalMs = (((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000) + Number(match[4]);
  const scaledMs = Math.max(0, Math.round(totalMs / speed));
  const hours = Math.floor(scaledMs / 3600000);
  const minutes = Math.floor((scaledMs % 3600000) / 60000);
  const seconds = Math.floor((scaledMs % 60000) / 1000);
  const milliseconds = scaledMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

const source = fs.readFileSync(path.resolve(inputPath), 'utf8').replace(/^\uFEFF/, '');
const scaled = source.replace(/\d{2}:\d{2}:\d{2},\d{3}/g, scaleTimestamp);
fs.writeFileSync(path.resolve(outputPath), `\uFEFF${scaled}`, 'utf8');
