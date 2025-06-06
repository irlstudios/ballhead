const { schedule } = require('node-cron')
const { google } = require('googleapis')
const credentials = require('../resources/secret.json')

const SHEET_ID = '1yxGmKTN27i9XtOefErIXKgcbfi1EXJHYWH7wZn_Cnok'
const ROLES = [
  { min: 0, max: 3699, id: '1379598636068896828' },
  { min: 3700, max: 5099, id: '1379598705283432509' },
  { min: 5100, max: Infinity, id: '1379598755560685568' }
]

function authorize () {
  const { client_email, private_key } = credentials
  return new google.auth.JWT(
      client_email,
      null,
      private_key,
      ['https://www.googleapis.com/auth/spreadsheets.readonly']
  )
}

async function fetchMMRData () {
  const auth = authorize()
  const sheets = google.sheets({ version: 'v4', auth })
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID })
  const season = meta.data.sheets
      .map(s => s.properties.title)
      .filter(t => /^Season \d+$/.test(t))
      .sort((a, b) => parseInt(b.split(' ')[1]) - parseInt(a.split(' ')[1]))
      [0]
  console.log(season)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${season}!G2:H`
  })
  return res.data.values || []
}


async function updateRoles (client) {
  const guild = await client.guilds.fetch(process.env.GUILD_ID)
  const data = await fetchMMRData()
  for (const [mmrStr, discordIdRaw] of data) {
    const mmr = parseInt(mmrStr)
    const discordId = discordIdRaw?.trim()
    if (isNaN(mmr) || !/^\d{17,19}$/.test(discordId)) continue
    const role = ROLES.find(r => mmr >= r.min && mmr <= r.max)
    if (!role) continue
    try {
      const member = await guild.members.fetch(discordId)
      await Promise.all(ROLES.map(r => member.roles.remove(r.id).catch(() => {})))
      await member.roles.add(role.id)
    } catch (e) {
      console.error(e)
    }
  }
}

module.exports = {
  name: 'ready',
  execute (client) {
    schedule(
        '* * * * *',
        async () => {
          await updateRoles(client)
        },
        { timezone: 'America/Chicago' }
    )
  }
}