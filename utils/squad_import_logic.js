'use strict';

// Pure planning for the one-time squads sheet-to-postgres import. No sheets
// or DB access here so the row mapping is unit-testable; the script
// (scripts/import_squads_from_sheets.js) does the I/O.

const VALID_SQUAD_TYPES = new Set(['Casual', 'Competitive', 'Content']);

function normalizeSquadName(raw) {
    return String(raw ?? '').trim().toUpperCase();
}

// Sheet dates are MM/DD/YY. Parsed as UTC midnight; anything else is null.
function parseSheetDate(raw) {
    const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(String(raw ?? '').trim());
    if (!match) {
        return null;
    }
    const [, mm, dd, yy] = match;
    const date = new Date(Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd)));
    return Number.isNaN(date.getTime()) ? null : date;
}

function cleanCell(value) {
    const s = String(value ?? '').trim();
    return s === '' || s === 'N/A' ? null : s;
}

// Resolve a squad's type: the owner's own All Data row first, then any All
// Data row for the squad name, else Casual + anomaly (mirrors the old
// resolveSquadType priority, minus the application/role fallbacks that no
// longer exist at import time).
function resolveType(allData, ownerId, squadName, anomalies) {
    const rowsFor = (predicate) => [...new Set(allData
        .filter((row) => row && row.length > 3 && predicate(row))
        .map((row) => String(row[3] ?? '').trim())
        .filter((type) => VALID_SQUAD_TYPES.has(type)))];

    const ownerTypes = rowsFor((row) => String(row[1]) === String(ownerId)
        && normalizeSquadName(row[2]) === squadName);
    if (ownerTypes.length === 1) {
        return ownerTypes[0];
    }
    const squadTypes = rowsFor((row) => normalizeSquadName(row[2]) === squadName);
    if (squadTypes.length === 1) {
        return squadTypes[0];
    }
    anomalies.push(`squad ${squadName} (owner ${ownerId}): type unresolvable (${squadTypes.join(', ') || 'none'}), defaulting Casual`);
    return 'Casual';
}

function planImport({ allData = [], squadLeaders = [], squadMembers = [] }) {
    const anomalies = [];
    const squads = [];
    const seen = new Set();

    for (const row of squadLeaders) {
        if (!row || !row[1] || !normalizeSquadName(row[2])) {
            continue; // hole row (sheet deletes are row clears)
        }
        const name = normalizeSquadName(row[2]);
        const ownerId = String(row[1]).trim();
        const squadType = resolveType(allData, ownerId, name, anomalies);
        const key = `${name}|${squadType}`;
        if (seen.has(key)) {
            anomalies.push(`duplicate leader row for ${key}; first row wins`);
            continue;
        }
        seen.add(key);
        squads.push({
            name,
            squadType,
            ownerId,
            ownerUsername: cleanCell(row[0]),
            eventSquad: cleanCell(row[3]),
            openSquad: String(row[4] ?? '').trim() === 'TRUE',
            createdAt: parseSheetDate(row[5]),
            parentName: normalizeSquadName(row[6]) || null,
        });
    }

    const squadNames = new Set(squads.map((s) => s.name));
    const members = [];
    for (const row of squadMembers) {
        if (!row || !row[1] || !normalizeSquadName(row[2])) {
            continue;
        }
        const squadName = normalizeSquadName(row[2]);
        if (!squadNames.has(squadName)) {
            anomalies.push(`member ${row[1]} references unknown squad ${squadName}; skipped`);
            continue;
        }
        members.push({
            squadName,
            userId: String(row[1]).trim(),
            username: cleanCell(row[0]),
            joinedAt: parseSheetDate(row[4]),
        });
    }

    const optOuts = [...new Set(allData
        .filter((row) => row && row[1] && String(row[7] ?? '').trim() === 'FALSE')
        .map((row) => String(row[1]).trim()))];

    return { squads, members, optOuts, anomalies };
}

module.exports = { planImport, parseSheetDate };
