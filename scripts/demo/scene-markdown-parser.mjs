import fs from 'node:fs';
import path from 'node:path';

function normalizeHeader(value) {
  return value.trim().toLowerCase();
}

function parseBoolean(value, fallback) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (['true', 'yes', '1', 'y'].includes(normalized)) {
    return true;
  }

  if (['false', 'no', '0', 'n'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseTableLines(markdownText) {
  const lines = markdownText.split(/\r?\n/);
  const tableBlocks = [];
  let currentBlock = [];

  for (const line of lines) {
    if (line.trim().startsWith('|')) {
      currentBlock.push(line);
      continue;
    }

    if (currentBlock.length) {
      tableBlocks.push(currentBlock);
      currentBlock = [];
    }
  }

  if (currentBlock.length) {
    tableBlocks.push(currentBlock);
  }

  return tableBlocks;
}

function parseMarkdownTable(tableLines) {
  if (tableLines.length < 2) {
    return [];
  }

  const headerParts = tableLines[0]
    .split('|')
    .slice(1, -1)
    .map(normalizeHeader)
    .filter((value) => value.length > 0);

  if (!headerParts.length) {
    return [];
  }

  const rows = [];
  for (let index = 2; index < tableLines.length; index += 1) {
    const cells = tableLines[index]
      .split('|')
      .slice(1, -1)
      .map((value) => value.trim());

    if (!cells.some((value) => value.length > 0)) {
      continue;
    }

    const row = {};
    for (let i = 0; i < headerParts.length; i += 1) {
      row[headerParts[i]] = cells[i] ?? '';
    }

    rows.push(row);
  }

  return rows;
}

export function parseScenesMarkdown(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Scenes file not found: ${absolutePath}`);
  }

  const content = fs.readFileSync(absolutePath, 'utf8');
  const tables = parseTableLines(content);

  const table = tables
    .map((lines) => parseMarkdownTable(lines))
    .find((rows) => rows.some((row) => row['scene']));

  if (!table || !table.length) {
    throw new Error(
      `No scene table found in ${absolutePath}. Add a markdown table with a 'scene' column.`
    );
  }

  const scenes = table.map((row, index) => {
    const scene = row['scene']?.trim();
    const mode = (row['mode'] || 'feature').trim().toLowerCase();
    const feature = row['feature']?.trim().toLowerCase() || '';
    const device = (row['device'] || 'desktop').trim().toLowerCase();
    const enabled = parseBoolean(row['enabled'] || '', true);
    const compose = parseBoolean(row['compose'] || '', true);
    const rerun = parseBoolean(row['rerun'] || '', true);
    const intro = row['intro']?.trim() || '';
    const outro = row['outro']?.trim() || '';

    if (!scene) {
      throw new Error(`Scene name is required (row ${index + 3}).`);
    }

    if (mode !== 'feature' && mode !== 'showcase') {
      throw new Error(`Scene '${scene}' has invalid mode '${mode}'. Use feature or showcase.`);
    }

    if (mode === 'feature' && !feature) {
      throw new Error(`Scene '${scene}' requires a feature value.`);
    }

    if (!['desktop', 'mobile', 'both'].includes(device)) {
      throw new Error(`Scene '${scene}' has invalid device '${device}'. Use desktop, mobile, or both.`);
    }

    return {
      scene,
      mode,
      feature,
      device,
      enabled,
      compose,
      rerun,
      intro,
      outro,
    };
  });

  return scenes.filter((scene) => scene.enabled);
}
