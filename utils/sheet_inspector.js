'use strict';

/**
 * CLI tool to inspect Google Sheets data for development.
 * Usage:
 *   node utils/sheet_inspector.js tabs <spreadsheetId>
 *   node utils/sheet_inspector.js peek <spreadsheetId> <sheetName> [rows=5]
 *   node utils/sheet_inspector.js search <spreadsheetId> <sheetName> <query>
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

async function main() {
    const [,, command, spreadsheetId, sheetName, extra] = process.argv;

    if (!command || !spreadsheetId) {
        console.log('Usage:');
        console.log('  node utils/sheet_inspector.js tabs <spreadsheetId>');
        console.log('  node utils/sheet_inspector.js peek <spreadsheetId> <sheetName> [rows=5]');
        console.log('  node utils/sheet_inspector.js search <spreadsheetId> <sheetName> <query>');
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
