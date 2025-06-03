const { SlashCommandBuilder } = require('@discordjs/builders')
const { EmbedBuilder } = require('discord.js')
const { google } = require('googleapis')
const credentials = require('../resources/secret.json')
const moment = require('moment')

function authorize() {
    const { client_email, private_key } = credentials
    return new google.auth.JWT(client_email, null, private_key, ['https://www.googleapis.com/auth/spreadsheets'])
}

const sheets = google.sheets({ version: 'v4', auth: authorize() })
const sheetId = '15P8BKPbO2DQX6yRXmc9gzuL3iLxfu4ef83Jb8Bi8AJk'
const rangeApp = 'YouTube!A:O'
const rangeData = 'YT NF Data!L:AP'

async function getUserData(discordId) {
    try {
        const [resApp, resData] = await Promise.all([
            sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: rangeApp }),
            sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: rangeData })
        ])
        const rowsApp = resApp.data.values || []
        const rowsData = resData.data.values || []

        let appRow = null
        for (const row of rowsApp) {
            if (row && row.length > 2 && row[2]?.trim() === discordId) {
                appRow = row
                break
            }
        }
        if (!appRow) return null

        let dataRow = null
        for (const row of rowsData) {
            if (row && row.length > 1 && row[1]?.trim() === discordId) {
                dataRow = row
                break
            }
        }
        return { appRow, dataRow }
    } catch {
        return null
    }
}

function nextMonday() {
    return moment().day(8)
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('check-youtube-account')
        .setDescription('Checks your YouTube application status and 3-week requirement data.'),
    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true })
            const uid = interaction.user.id
            const info = await getUserData(uid)
            if (!info || !info.appRow) {
                await interaction.editReply({ content: 'It looks like you haven\'t applied for the YouTube CC program yet, or we couldn\'t find your application record.', ephemeral: true })
                return
            }
            const { appRow, dataRow } = info
            const appDateStr = appRow[3]
            if (!appDateStr) {
                await interaction.editReply({ content: 'We found your application, but the application date is missing in our records. Please contact support.', ephemeral: true })
                return
            }
            const appDate = moment(appDateStr.trim(), 'M/D/YYYY', true)
            if (!appDate.isValid()) {
                await interaction.editReply({ content: `We found your application, but the date stored ('${appDateStr}'). Please note that we begin pulling new form data every Sunday, and platform check data is updated on Mondays. If you believe there’s an issue with your submission, please contact support.`, ephemeral: true })
                return
            }
            if (!dataRow) {
                const ts = `<t:${nextMonday().unix()}:F>`
                await interaction.editReply({ content: `We found your application submitted on **${appDate.format('MMMM Do, YYYY')}**. Your performance data hasn't been processed yet. Please check back around ${ts}.`, ephemeral: true })
                return
            }

            const req = { posts: 2, likes: 15 }

            const followers = dataRow[5] || 'N/A'

            const w1 = {
                posts: parseInt(dataRow[6], 10) || 0,
                likes: parseInt(dataRow[8], 10) || 0,
                quality: dataRow[9] || 'N/A'
            }
            const w2 = {
                posts: parseInt(dataRow[13], 10) || 0,
                likes: parseInt(dataRow[15], 10) || 0,
                quality: dataRow[16] || 'N/A'
            }
            const w3 = {
                posts: parseInt(dataRow[20], 10) || 0,
                likes: parseInt(dataRow[22], 10) || 0,
                quality: dataRow[23] || 'N/A'
            }

            const check = w => ({ ...w, metP: w.posts >= req.posts, metL: w.likes >= req.likes })

            const week1 = check(w1)
            const week2 = check(w2)
            const week3 = check(w3)

            const fmt = (label, w) => {
                let m = `**${label}:**\nVideos: \`${w.posts}\` | Avg Views/Likes: \`${w.likes}\` | Avg Quality: \`${w.quality}\`\n`
                if (!w.metP || !w.metL) {
                    const miss = []
                    if (!w.metP) miss.push(`Need ≥ ${req.posts} videos`)
                    if (!w.metL) miss.push(`Need ≥ ${req.likes} avg views/likes`)
                    m += '**Missing:** ' + miss.join('; ') + '\n'
                } else {
                    m += '**Requirements Met** ✅\n'
                }
                return m
            }

            const embed = new EmbedBuilder()
                .setTitle('📊 Your YouTube 3-Week Stats')
                .setColor('#FF0000')
                .setDescription(
                    `**Subscribers:** ${followers}\n\n` +
                    fmt('3 weeks ago', week1) + '\n' +
                    fmt('2 weeks ago', week2) + '\n' +
                    fmt('Last week', week3)
                )
                .setTimestamp()
                .setFooter({ text: 'YouTube CC Requirements Check' })

            await interaction.editReply({ embeds: [embed], ephemeral: false })
        } catch {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'An unexpected error occurred while processing your request.', ephemeral: true })
            } else {
                await interaction.editReply({ content: 'An unexpected error occurred while processing your request.', ephemeral: true })
            }
        }
    }
}