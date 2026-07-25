'use strict';

/**
 * CLI tool to inspect Google Sheets data for development.
 * Usage:
 *   node utils/sheet_inspector.js tabs <spreadsheetId>
 *   node utils/sheet_inspector.js peek <spreadsheetId> <sheetName> [rows=5]
 *   node utils/sheet_inspector.js search <spreadsheetId> <sheetName> <query>
 *   node utils/sheet_inspector.js audit-squads <spreadsheetId> [competitiveSpreadsheetId]
 */

const { google } = require('googleapis');
const credentials = require('../resources/secret.json');

async function getClient() {
    const { client_email, private_key } = credentials;
    const auth = new google.auth.JWT({
        email: client_email,
        key: private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    await auth.authorize();
    return google.sheets({ version: 'v4', auth });
}

async function listTabs(spreadsheetId) {
    const sheets = await getClient();
    const info = await sheets.spreadsheets.get({ spreadsheetId });
    const tabs = info.data.sheets.map(s => ({
        title: s.properties.title,
        rows: s.properties.gridProperties.rowCount,
        cols: s.properties.gridProperties.columnCount,
    }));
    console.log(`\nSpreadsheet: ${info.data.properties.title}`);
    console.log(`Tabs (${tabs.length}):\n`);
    for (const tab of tabs) {
        console.log(`  ${tab.title}  (${tab.rows} rows x ${tab.cols} cols)`);
    }
}

async function peekSheet(spreadsheetId, sheetName, rowCount = 5) {
    const sheets = await getClient();
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!A:ZZ`,
    });
    const rows = response.data.values || [];
    const headers = rows[0] || [];
    const data = rows.slice(1, 1 + rowCount);

    console.log(`\nSheet: ${sheetName}`);
    console.log(`Total rows: ${rows.length - 1} (data) + 1 (header)`);
    console.log(`\nHeaders (${headers.length} columns):`);
    headers.forEach((h, i) => console.log(`  [${i}] ${h}`));

    console.log(`\nFirst ${data.length} data rows:\n`);
    for (const row of data) {
        const obj = {};
        headers.forEach((h, i) => {
            if (row[i] !== undefined && row[i] !== '') {
                obj[h] = row[i];
            }
        });
        console.log(JSON.stringify(obj, null, 2));
        console.log('---');
    }
}

async function searchSheet(spreadsheetId, sheetName, query) {
    const sheets = await getClient();
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!A:ZZ`,
    });
    const rows = response.data.values || [];
    const headers = rows[0] || [];
    const lowerQuery = query.toLowerCase();

    const matches = rows.slice(1).filter(row =>
        row.some(cell => String(cell).toLowerCase().includes(lowerQuery))
    );

    console.log(`\nSearch: "${query}" in ${sheetName}`);
    console.log(`Found ${matches.length} matching rows:\n`);

    for (const row of matches.slice(0, 20)) {
        const obj = {};
        headers.forEach((h, i) => {
            if (row[i] !== undefined && row[i] !== '') {
                obj[h] = row[i];
            }
        });
        console.log(JSON.stringify(obj, null, 2));
        console.log('---');
    }

    if (matches.length > 20) {
        console.log(`... and ${matches.length - 20} more rows`);
    }
}

function normalizeCell(value) {
    return String(value ?? '').trim();
}

function normalizeSquadName(value) {
    return normalizeCell(value).toUpperCase();
}

async function auditSquads(spreadsheetId, competitiveSpreadsheetId) {
    const sheets = await getClient();
    const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: ['All Data!A:H', 'Squad Leaders!A:G', 'Squad Members!A:E', 'Applications!A:F'],
    });
    const byRange = new Map(
        (response.data.valueRanges || []).map(valueRange => [
            valueRange.range.split('!')[0].replaceAll('\'', ''),
            valueRange.values || [],
        ])
    );
    const allData = (byRange.get('All Data') || []).slice(1);
    const leaders = (byRange.get('Squad Leaders') || []).slice(1);
    const members = (byRange.get('Squad Members') || []).slice(1);
    const applications = (byRange.get('Applications') || []).slice(1);
    const validTypes = new Set(['Casual', 'Competitive', 'Content']);
    let competitiveSquads = new Set();
    if (competitiveSpreadsheetId) {
        const competitiveResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: competitiveSpreadsheetId,
            range: '\'Squads + Aggregate Wins\'!A:B',
        });
        competitiveSquads = new Set(
            (competitiveResponse.data.values || []).slice(1)
                .filter(row => normalizeCell(row?.[1]) === 'Competitive')
                .map(row => normalizeSquadName(row?.[0]))
                .filter(Boolean)
        );
    }

    const allDataByOwnerAndSquad = new Map();
    const squadTypes = new Map();
    for (let index = 0; index < allData.length; index += 1) {
        const row = allData[index];
        const userId = normalizeCell(row?.[1]);
        const squadKey = normalizeSquadName(row?.[2]);
        const squadType = normalizeCell(row?.[3]);
        if (userId && squadKey && squadKey !== 'N/A') {
            const key = `${userId}::${squadKey}`;
            const entries = allDataByOwnerAndSquad.get(key) || [];
            entries.push({ rowNumber: index + 2, row, squadType });
            allDataByOwnerAndSquad.set(key, entries);

            const types = squadTypes.get(squadKey) || new Set();
            if (squadType && squadType !== 'N/A') types.add(squadType);
            squadTypes.set(squadKey, types);
        }
    }

    const leaderKeys = new Map();
    const missingAllData = [];
    const duplicateAllData = [];
    const invalidTypes = [];
    const nonCanonicalLeaderCells = [];
    const duplicateLeaders = [];
    for (let index = 0; index < leaders.length; index += 1) {
        const row = leaders[index];
        const rawUserId = String(row?.[1] ?? '');
        const rawSquadName = String(row?.[2] ?? '');
        const userId = normalizeCell(rawUserId);
        const squadKey = normalizeSquadName(rawSquadName);
        if (!userId || !squadKey || squadKey === 'N/A') continue;

        const key = `${userId}::${squadKey}`;
        const matchingLeaders = leaderKeys.get(key) || [];
        matchingLeaders.push(index + 2);
        leaderKeys.set(key, matchingLeaders);

        if (rawUserId !== userId || rawSquadName !== rawSquadName.trim()) {
            nonCanonicalLeaderCells.push({
                leaderRow: index + 2,
                userIdWhitespace: rawUserId !== userId,
                squadWhitespace: rawSquadName !== rawSquadName.trim(),
            });
        }

        const matches = allDataByOwnerAndSquad.get(key) || [];
        if (matches.length === 0) {
            const acceptedApplicationTypes = [...new Set(applications
                .filter(application => normalizeCell(application?.[1]) === userId
                    && normalizeSquadName(application?.[2]) === squadKey
                    && normalizeCell(application?.[5]) === 'Accepted')
                .map(application => normalizeCell(application?.[3]))
                .filter(Boolean))];
            missingAllData.push({
                leaderRow: index + 2,
                squad: rawSquadName,
                userId,
                squadTypes: [...(squadTypes.get(squadKey) || [])],
                acceptedApplicationTypes,
                inCompetitiveTracker: competitiveSquads.has(squadKey),
            });
            continue;
        }
        if (matches.length > 1) {
            duplicateAllData.push({
                leaderRow: index + 2,
                squad: rawSquadName,
                userId,
                allDataRows: matches.map(match => match.rowNumber),
            });
        }
        const usableTypes = [...new Set(matches
            .map(match => match.squadType)
            .filter(type => validTypes.has(type)))];
        if (usableTypes.length !== 1) {
            invalidTypes.push({
                leaderRow: index + 2,
                squad: rawSquadName,
                userId,
                allDataRows: matches.map(match => match.rowNumber),
                types: [...new Set(matches.map(match => match.squadType || '(blank)'))],
            });
        }
    }

    for (const [key, rowNumbers] of leaderKeys) {
        if (rowNumbers.length > 1) {
            const [, squad] = key.split('::');
            duplicateLeaders.push({ squad, leaderRows: rowNumbers });
        }
    }

    const leaderSquads = new Set(
        leaders.map(row => normalizeSquadName(row?.[2]))
            .filter(name => name && name !== 'N/A')
    );
    const orphanMembers = [];
    const memberDuplicates = new Map();
    for (let index = 0; index < members.length; index += 1) {
        const row = members[index];
        const userId = normalizeCell(row?.[1]);
        const squadKey = normalizeSquadName(row?.[2]);
        if (!userId || !squadKey || squadKey === 'N/A') continue;
        if (!leaderSquads.has(squadKey)) {
            orphanMembers.push({ memberRow: index + 2, squad: row[2], userId });
        }
        const key = `${userId}::${squadKey}`;
        const rows = memberDuplicates.get(key) || [];
        rows.push(index + 2);
        memberDuplicates.set(key, rows);
    }

    const duplicateMembers = [...memberDuplicates.entries()]
        .filter(([, rows]) => rows.length > 1)
        .map(([key, rows]) => ({
            squad: key.split('::')[1],
            memberRows: rows,
        }));
    const conflictingSquadTypes = [...squadTypes.entries()]
        .filter(([, types]) => types.size > 1)
        .map(([squad, types]) => ({ squad, types: [...types] }));

    const report = {
        rowCounts: {
            allData: allData.filter(row => row?.some(cell => normalizeCell(cell))).length,
            leaders: leaders.filter(row => row?.some(cell => normalizeCell(cell))).length,
            members: members.filter(row => row?.some(cell => normalizeCell(cell))).length,
            applications: applications.filter(row => row?.some(cell => normalizeCell(cell))).length,
        },
        leaderTypeResolution: {
            missingAllData,
            duplicateAllData,
            invalidTypes,
            nonCanonicalLeaderCells,
        },
        duplicateLeaders,
        duplicateMembers,
        orphanMembers,
        conflictingSquadTypes,
    };

    console.log(JSON.stringify(report, null, 2));
}

async function main() {
    const [,, command, spreadsheetId, sheetName, extra] = process.argv;

    if (!command || !spreadsheetId) {
        console.log('Usage:');
        console.log('  node utils/sheet_inspector.js tabs <spreadsheetId>');
        console.log('  node utils/sheet_inspector.js peek <spreadsheetId> <sheetName> [rows=5]');
        console.log('  node utils/sheet_inspector.js search <spreadsheetId> <sheetName> <query>');
        console.log('  node utils/sheet_inspector.js audit-squads <spreadsheetId> [competitiveSpreadsheetId]');
        console.log('\nKnown spreadsheet IDs:');
        console.log('  SQUADS:        1DHoimKtUof3eGqScBKDwfqIUf9Zr6BEuRLxY-Cwma7k');
        console.log('  COMP_WINS:     1nO8wK4p27DgbOHQhuFrYfg1y78AvjYmw7yGYato1aus');
        console.log('  CONTENT_POSTS: 1TF-JPBZ62Jqxe0Ilb_-GAe5xcOjQz-lE6NSFlrmNRvI');
        process.exit(1);
    }

    try {
        switch (command) {
        case 'tabs':
            await listTabs(spreadsheetId);
            break;
        case 'peek':
            await peekSheet(spreadsheetId, sheetName || 'Sheet1', parseInt(extra, 10) || 5);
            break;
        case 'search':
            await searchSheet(spreadsheetId, sheetName, extra);
            break;
        case 'audit-squads':
            await auditSquads(spreadsheetId, sheetName);
            break;
        default:
            console.log(`Unknown command: ${command}`);
            process.exit(1);
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

main();
