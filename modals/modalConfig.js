const modalConfig = {
    'report-bug': {
        title: 'Report a Bug',
        fields: [
            {
                id: 'bug-error',
                label: 'What error did you receive?',
                style: 'Paragraph',
                required: true
            },
            {
                id: 'bug-steps',
                label: 'How did you run into this error?',
                style: 'Paragraph',
                required: false
            }
        ],
    },
    'deny-modal': {
        title: 'Denial Form',
        fields: [
            {
                id: 'denial-reason',
                label: 'Reason For Denial',
                style: 'Paragraph',
                required: true
            }
        ],
    },
    'apply-base-league-modal': {
        title: 'Apply for Base League',
        fields: [
            {
                id: 'league-name',
                label: 'League Name',
                placeholder: 'Enter your league name',
                style: 'Short',
                required: true,
            },
            {
                id: 'discord-invite',
                label: 'Discord Invite Link',
                placeholder: 'Enter your Discord server invite link',
                style: 'Short',
                required: true,
            },
        ],
    },
    'deny-league-modal': {
        title: 'Reason for Denial',
        fields: [
            {
                id: 'denial-reason',
                label: 'Reason for Denial',
                placeholder: 'Enter reason for denial',
                style: 'Paragraph',
                required: true,

            },
        ],
    },
    'officialApplicationModal': {
        title: 'Official Application',
        fields: [
            {
                id: 'agreement',
                label: 'Have you read the Officials Program Doc?',
                style: 'Short',
                placeholder: 'Yes/No',
                required: true,
            },
            {
                id: 'banAwareness',
                label: 'Do you understand the Officials Program Doc?',
                placeholder: 'Yes/No',
                style: 'Short',
                required: true,
            },
            {
                id: 'username',
                label: 'In-game username',
                style: 'Short',
                placeholder: 'Enter your username',
                required: true,
            }
        ],
    },
    'ffOfficialApplicationModal': {
        title: 'FF Official Application',
        fields: [
            {
                id: 'ffUsername',
                label: 'In-Game Username',
                style: 'Short',
                placeholder: 'Enter your in-game username',
                required: true,
            },
            {
                id: 'ffOfficiatingDuration',
                label: 'How long have you been officiating?',
                style: 'Short',
                placeholder: 'e.g. 3 months, 1 year',
                required: true,
            },
            {
                id: 'ffRulesUnderstanding',
                label: 'Have you read/understand the FF rules?',
                style: 'Short',
                placeholder: 'Yes/No',
                required: true,
            },
            {
                id: 'ffMotivation',
                label: 'Why do you want to become an FF Official?',
                style: 'Paragraph',
                placeholder: 'Share your motivation',
                required: true,
            },
            {
                id: 'ffStatsLink',
                label: 'Link to recent FF stats/submissions',
                style: 'Short',
                placeholder: 'Paste a link to your recent FF stats',
                required: true,
            },
        ],
    },
    'LfgSystem1Create' : {
        title: 'Create LFG Post',
        fields: [
            {
                id: 'inGameUsernameSystem1',
                label: 'In-Game Username',
                placeholder: 'Enter your username',
                style: 'Short',
                required: true,
            },
            {
                id: 'descriptionSystem1',
                label: 'Post Description',
                placeholder: 'Enter your description',
                style: 'Paragraph',
                required: true,
            },
            {
                id: 'startTimeSystem1',
                label: 'Start Time',
                placeholder: 'Start Time',
                style: 'Short',
                required: true,
            },
            {
                id: 'placeSystem1',
                label: 'Place of Gathering',
                placeholder: 'Enter your place of gathering',
                style: 'Short',
                required: true,
            },
        ]
    },
    'LfgSystem2Create' : {
        title: 'Squad Recruitment Post',
        fields: [
            {
                id: 'requirementsSystem2',
                label: 'What are the requirements to join your squad?',
                placeholder: 'Please enter your requirements?',
                style: 'Paragraph',
                required: true,
            },
            {
                id: 'rulesSystem2',
                label: 'What are the rules in your squad? (Optional)',
                placeholder: 'What are the rules in your squad? (Optional)',
                style: 'Short',
                required: true,
            },
            {
                id: 'additionalInfoSystem2',
                label: 'Additional information? (Optional)',
                placeholder: 'Additional information (Optional)',
                style: 'Short',
                required: false,
            },
        ],
    },
    'LfgSystem3Create': {
        title: 'Request Officials for a League Game',
        fields: [
            {
                id: 'leagueNameSystem3',
                label: 'League Name',
                placeholder: 'Enter the name of your league.',
                style: 'Short',
                required: true,
            },
            {
                id: 'gameDetailsSystem3',
                label: 'Game Details',
                placeholder: 'Provide the game details (e.g., teams, date, and time)',
                style: 'Paragraph',
                required: true,
            },
            {
                id: 'officialRequirementsSystem3',
                label: 'Officials Required',
                placeholder: 'Specify the official preference, (e.g : Official Level, or amount of needed)',
                style: 'Paragraph',
                required: true,
            },
        ],
    },
    'koHostApplicationModal': {
        title: 'KO-Hosts Application',
        fields: [
            {
                id: 'koHostReason',
                label: 'Why do you want to be a KO-Host?',
                placeholder: 'Share your motivation and experience',
                style: 'Paragraph',
                required: true,
            },
            {
                id: 'koHostAvailability',
                label: 'What days of the week are you free?',
                placeholder: 'List the days and typical times',
                style: 'Paragraph',
                required: true,
            },
            {
                id: 'koHostBoxingAwareness',
                label: 'Do you know boxing operations/rules?',
                placeholder: 'Yes/No and any relevant details',
                style: 'Paragraph',
                required: true,
            },
            {
                id: 'koHostGuidelineAgreement',
                label: 'Host role will be removed upon rule violation',
                placeholder: 'Do you understand? Yes/No',
                style: 'Short',
                required: true,
            },
        ],
    },
    'rankedSessionModal': {
        title: 'Log Ranked Session',
        fields: [
            {
                id: 'coachName',
                label: 'Coach In-game Name',
                placeholder: 'Enter coach in-game name',
                style: 'Short',
                required: true,
            },
            {
                id: 'participantsName',
                label: 'Participants In-game Name',
                placeholder: 'Enter participants in-game name',
                style: 'Short',
                required: true,
            },
            {
                id: 'madeAttempts',
                label: 'Made Attempts (out of 10)',
                placeholder: 'Enter a number between 0 and 10',
                style: 'Short',
                required: true,
            }
        ],
    },
    'league-checkin-modal': {
        title: 'Monthly League Check-in',
        fields: [
            {
                id: 'activity-notes',
                label: 'Activity notes (optional)',
                placeholder: 'Share what your league has been up to',
                style: 'Paragraph',
                required: false,
            },
        ],
    },
    'update-league-invite-modal': {
        title: 'Update League Invite',
        fields: [
            {
                id: 'new-invite-link',
                label: 'New Discord Invite Link',
                placeholder: 'https://discord.gg/...',
                style: 'Short',
                required: true,
            },
        ],
    },
    'bugSquasherApplicationModal': {
        title: 'Community Bug Squasher Application',
        fields: [
            {
                id: 'cbsRequirementsAware',
                label: 'Aware of the CBS requirements?',
                placeholder: 'Yes/No',
                style: 'Short',
                required: true,
            },
            {
                id: 'cbsNoGuarantee',
                label: 'Aware applying doesn\'t guarantee the role?',
                placeholder: 'Yes/No',
                style: 'Short',
                required: true,
            },
            {
                id: 'cbsTosAware',
                label: 'Aware TOS breaks / begging can bar the role?',
                placeholder: 'Yes/No',
                style: 'Short',
                required: true,
            },
            {
                id: 'cbsMotivation',
                label: 'Why do you want Community Bug Squasher?',
                placeholder: 'Share your motivation',
                style: 'Paragraph',
                required: true,
            },
            {
                id: 'cbsValue',
                label: 'What do you bring vs. other applicants?',
                placeholder: 'What sets you apart',
                style: 'Paragraph',
                required: true,
            },
        ],
    },
};

module.exports = modalConfig;
